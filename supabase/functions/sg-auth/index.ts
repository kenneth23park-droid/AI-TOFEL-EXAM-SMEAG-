import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/* SMEAG MockTest — 수험생 · 선생님 · 관리자 계정 엔드포인트.
 *
 * 등록의 주요 키: 학생아이디 · 이메일 · 이름  (+ 시험응시 일자 · 담당 선생님)
 *  • 입력받는 건 이름 + 이메일 + 시험일자 + 담당 선생님. 아이디는 서버가 배정한다.
 *  • 아이디는 해당 시험일의 smeag000 ~ smeag999 중 가장 빠른 빈 번호.
 *    구글 시트에서 한 칸씩 내려 채우듯 서버가 순서대로 배정한다 — 사람이 번호를
 *    고르는 자리는 없고, 같은 날 같은 번호는 DB 의 unique(student_id, exam_date)
 *    가 막는다. 번호가 겹치면 그 자리는 건너뛰고 다음 빈 번호로 간다.
 *  • 비밀번호는 전부 smeag2222.
 *  • 이름·이메일·담당 선생님은 비워도 된다 — 학생 수만 넣고 자리를 먼저 뽑는 대량 발급
 *    (admin-students.html)이 그렇게 쓴다. 비면 배정된 아이디가 이름이 되고,
 *    이메일은 합성 로그인 주소가 그대로 들어간다. 그 주소는 (아이디, 시험일)
 *    으로 만들어지므로 자리 이메일끼리 겹칠 수 없다.
 *  • 키는 (student_id, exam_date) — 같은 날 중복 불가, 다른 날 재사용 가능.
 *  • 같은 시험일에 같은 이메일/이름이 이미 있으면 팝업으로 알리고 다시 만들게
 *    한다. 그대로 진행하려면 force: true.
 *
 * 담당 선생님은 화면의 드롭다운에서 고른다. 그 값은 여기서 "정말 선생님 계정인가"를
 * 확인한 뒤에만 user_metadata.teacher_id 로 들어가고, auth 트리거가 그대로
 * sg_profiles.teacher_id 에 박는다. 이 한 칸이 선생님의 열람 범위를 정한다 —
 * RLS 의 sg_can_see() 가 이 값만 보고 행을 돌려줄지 말지 가른다
 * (supabase/teacher_scope.sql).
 *
 * 로그인은 세 가지로 들어온다 — 학생아이디(smeag###), 등록한 이메일,
 * 그리고 선생님·관리자 계정(상주 이메일). 비밀번호는 수험생이면 smeag2222.
 *
 * Supabase Auth 는 이메일이 필수라 아이디+시험일로 합성한다:
 *   smeag007.20260901@smeagstudyground.com
 * 학생이 적은 진짜 이메일은 sg_exam_accounts.email 에만 넣는다 — 같은
 * 사람이 여러 시험일에 응시하므로 이메일은 전역 유일이 아니다.
 *
 * POST { action: "next_id",  exam_date? }   → { student_id, used, free }
 * POST { action: "teachers" }               → { teachers: [{ id, name, student_id }] }
 * POST { action: "lookup", q, limit?, exam_date? } → { matches: [{ student_id, name, exam_date }] }
 * POST { action: "register", name, email, teacher_id?, exam_date?, student_id?, force? }
 * POST { action: "signin",   login, password?, exam_date? }
 * POST { action: "create_staff", token, name, login, password?, email?, role? }  ← 관리자만
 *   → 200 { session, user, student_id?, password?, exam_date?, email? }
 *   → 4xx { error, message, message_ko, ... }
 */

const PW = "smeag2222";
const STAFF_PW = "smeag2222";
const DOMAIN = "smeagstudyground.com";
/* 학생아이디는 이 한 가지 모양뿐이다 — 배정도, 로그인도, 직원 아이디 금지도 같은 자. */
const ID_RE = /^smeag\d{3}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* 선생님·관리자 아이디. PostgREST 질의에 그대로 들어가므로 화이트리스트로 좁힌다. */
const STAFF_LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
/* 배정 범위는 smeag000 ~ smeag999 — 한 시험일에 1000 자리. */
const MIN_ID = 0;
const MAX_ID = 999;
const ID_COUNT = MAX_ID - MIN_ID + 1;

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function fail(status: number, error: string, en: string, ko: string, extra: Record<string, unknown> = {}) {
  return json({ error, message: en, message_ko: ko, ...extra }, status);
}

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const today = () => new Date().toISOString().slice(0, 10);
function dateOf(v: unknown) {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today();
}
const pad3 = (n: number) => "smeag" + String(n).padStart(3, "0");
const authEmail = (id: string, date: string) => `${id}.${date.replace(/-/g, "")}@${DOMAIN}`;

async function issueSession(email: string, password: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

const PROFILE_COLS = "id,email,name,student_id,plan,role,is_admin,verified,teacher_id";
async function profileOf(id: string) {
  const r = await admin(
    `/rest/v1/sg_profiles?id=eq.${encodeURIComponent(id)}&select=${PROFILE_COLS}`,
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function usedIds(date: string) {
  const r = await admin(
    `/rest/v1/sg_exam_accounts?exam_date=eq.${date}&select=student_id&order=student_id.asc`,
  );
  const rows = await r.json().catch(() => []);
  return new Set<string>((Array.isArray(rows) ? rows : []).map((x: { student_id: string }) => x.student_id));
}

async function handleNextId(b: Record<string, unknown>) {
  const date = dateOf(b.exam_date);
  const used = await usedIds(date);
  let next: string | null = null;
  for (let i = MIN_ID; i <= MAX_ID; i++) {
    if (!used.has(pad3(i))) { next = pad3(i); break; }
  }
  return json({ exam_date: date, student_id: next, used: used.size, free: ID_COUNT - used.size });
}

/* ── 담당 선생님 ─────────────────────────────────────────────
 *
 * 가입 화면은 로그인 전이라 sg_profiles 를 직접 못 읽는다(RLS). 그래서 목록은
 * 여기서 service_role 로 뽑아 이름만 내보낸다 — 이메일·학생 수는 나가지 않는다.
 */
async function teacherList() {
  const r = await admin(
    `/rest/v1/sg_profiles?role=eq.teacher&select=id,name,student_id&order=name.asc`,
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function handleTeachers() {
  return json({ teachers: await teacherList() });
}

async function handleLookup(b: Record<string, unknown>) {
  const q = String(b.q ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(String(b.limit ?? "8"), 10) || 8, 1), 12);
  if (!q) return json({ matches: [] });

  const safe = q.replace(/[^a-z0-9@\s._-]/g, "");
  let orClause = "";
  if (/^smeag\d{0,3}$/.test(safe)) {
    orClause = `or=(student_id.ilike.${encodeURIComponent(safe + '%')},name.ilike.${encodeURIComponent('%' + safe + '%')})`;
  } else if (/^\d{1,3}$/.test(safe)) {
    const id = 'smeag' + safe.padStart(3, '0');
    orClause = `or=(student_id.eq.${encodeURIComponent(id)},student_id.ilike.${encodeURIComponent('%' + safe + '%')},name.ilike.${encodeURIComponent('%' + safe + '%')})`;
  } else if (safe.length >= 2) {
    orClause = `or=(name.ilike.${encodeURIComponent('%' + safe + '%')},student_id.ilike.${encodeURIComponent('%' + safe.replace(/\s+/g, '') + '%')})`;
  } else {
    return json({ matches: [] });
  }
  const date = String(b.exam_date ?? "").trim();
  const datePart = date ? `&exam_date=eq.${encodeURIComponent(date)}` : '';
  const r = await admin(
    `/rest/v1/sg_exam_accounts?${orClause}${datePart}&select=student_id,name,exam_date&order=student_id.asc&limit=${limit}`,
  );
  const rows = await r.json().catch(() => []);
  return json({ matches: Array.isArray(rows) ? rows.slice(0, limit) : [] });
}

async function handleRegister(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  const date = dateOf(b.exam_date);
  const wanted = String(b.student_id ?? "").trim().toLowerCase();
  const teacherId = String(b.teacher_id ?? "").trim();
  const force = b.force === true;

  /* 이름과 이메일은 비어 있어도 통과한다 — 적었다면 모양은 본다. 빈 칸을 무엇으로
     채울지는 아이디가 정해진 뒤에 claim() 이 결정한다. */
  if (email && !EMAIL_RE.test(email)) {
    return fail(400, "invalid_email", "Enter a valid email address.", "올바른 이메일 주소를 입력하세요.");
  }
  if (wanted && !ID_RE.test(wanted)) {
    return fail(400, "bad_id", "The ID must be smeag000 – smeag999.", "아이디는 smeag000 ~ smeag999 형식이어야 합니다.");
  }

  /* 담당 선생님도 선택이다. 고르면 그 값이 정말 선생님 계정인지 확인하고, 비우면
     담당 없이 등록된다 — 그 학생의 답안은 관리자만 열 수 있고, 나중에
     sg_profiles.teacher_id 를 채우면 그때부터 그 선생님이 본다. */
  let teacher: { id: string; name: string } | null = null;
  if (teacherId) {
    if (!UUID_RE.test(teacherId)) {
      return fail(400, "bad_teacher", "Pick your teacher from the list.", "담당 선생님을 목록에서 고르세요.");
    }
    teacher = (await teacherList()).find((t: { id: string }) => t.id === teacherId) ?? null;
    if (!teacher) {
      return fail(400, "unknown_teacher", "That teacher no longer exists. Pick again.", "그 선생님 계정이 없습니다. 다시 고르세요.");
    }
  }

  // 같은 시험일에 같은 이메일은 중복 등록이 거의 확실하다 — 이건 force 에도 막는다.
  const mailRows = email
    ? await (await admin(
        `/rest/v1/sg_exam_accounts?exam_date=eq.${date}&email=eq.${encodeURIComponent(email)}` +
          `&select=student_id,name&limit=1`,
      )).json().catch(() => [])
    : [];
  if (Array.isArray(mailRows) && mailRows.length) {
    return fail(
      409, "email_taken_today",
      `${email} is already registered for ${date} as ${mailRows[0].student_id}.`,
      `${email} 은(는) ${date} 시험일에 ${mailRows[0].student_id} 로 이미 등록되어 있습니다.`,
      { exam_date: date, student_id: mailRows[0].student_id },
    );
  }

  // 이름만 같은 경우는 동명이인일 수 있다 — 묻기만 하고 force 로 넘어간다.
  if (name && !force) {
    const same = await admin(
      `/rest/v1/sg_exam_accounts?exam_date=eq.${date}&name=eq.${encodeURIComponent(name)}` +
        `&select=student_id&order=created_at.desc&limit=1`,
    );
    const rows = await same.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) {
      return fail(
        409, "same_name_today",
        `"${name}" is already registered for ${date} as ${rows[0].student_id}. Register again anyway?`,
        `"${name}" 은(는) ${date} 시험일에 ${rows[0].student_id} 로 이미 등록되어 있습니다. 그래도 다시 만드시겠습니까?`,
        { exam_date: date, student_id: rows[0].student_id },
      );
    }
  }

  let got: { user: { id: string }; login: string; name: string; email: string } | null = null;
  let assigned = "";
  const mine = teacher ? teacher.id : "";

  if (wanted) {
    got = await claim(wanted, date, name, email, mine);
    assigned = wanted;
    if (!got) {
      return fail(409, "id_taken_today", `${wanted} is already used on ${date}. Pick another ID.`,
        `${wanted} 은(는) ${date} 시험일에 이미 사용 중입니다. 다른 아이디를 골라주세요.`,
        { exam_date: date, student_id: wanted });
    }
  } else {
    const used = await usedIds(date);
    for (let i = MIN_ID; i <= MAX_ID && !got; i++) {
      const id = pad3(i);
      if (used.has(id)) continue;
      got = await claim(id, date, name, email, mine);
      if (got) assigned = id;
    }
    if (!got) {
      return fail(409, "no_free_id", `All ${ID_COUNT} IDs are used for ${date}.`,
        `${date} 시험일의 아이디 ${ID_COUNT}개가 모두 사용 중입니다.`, { exam_date: date });
    }
  }

  const s = await issueSession(got.login, PW);
  if (!s.ok) {
    return fail(500, "session_failed", "Registered, but automatic login failed. Please log in.", "등록은 됐지만 자동 로그인에 실패했습니다. 로그인해 주세요.",
      { student_id: assigned, password: PW, exam_date: date, email: got.email, name: got.name });
  }
  const prof = await profileOf(got.user.id);
  return json({
    session: s.body,
    user: prof ?? { id: got.user.id, name: got.name, student_id: assigned },
    student_id: assigned,
    password: PW,
    exam_date: date,
    email: got.email,
    name: got.name,
    teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
  });
}

/** 계정 생성 + 등록 행 삽입. 이미 나간 아이디면 null 을 돌려 재시도하게 한다.
 *
 * 빈 칸은 여기서 채운다 — 아이디가 정해진 자리라서다. 이름이 없으면 아이디가
 * 이름이 되고(명단이 빈 줄로 보이지 않게), 이메일이 없으면 합성 로그인 주소를
 * 그대로 쓴다. 그 주소는 아이디+시험일로 만들어져 자리끼리 겹칠 수 없다. */
async function claim(studentId: string, date: string, rawName: string, rawEmail: string, teacherId: string) {
  const login = authEmail(studentId, date);
  const name = rawName || studentId;
  const email = rawEmail || login;
  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: login,
      password: PW,
      email_confirm: true,
      user_metadata: {
        name, student_id: studentId, exam_date: date, contact_email: email,
        plan: "lite", teacher_id: teacherId || null,
      },
    }),
  });
  const user = await created.json().catch(() => ({}));
  if (!created.ok) return null;

  const ins = await admin("/rest/v1/sg_exam_accounts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      user_id: user.id, student_id: studentId, exam_date: date, name, email,
      teacher_id: teacherId || null,
    }]),
  });
  if (!ins.ok) {
    await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    return null;
  }
  return { user, login, name, email };
}

/** 같은 아이디가 여러 시험일에 있을 때 로그인 시도 순서.
 *  명단만 남고 Auth 계정이 지워진 고아 행이 있어도 다음 계정을 시도한다. */
async function resolveAccounts(filter: string, wanted?: unknown) {
  const datePart = wanted ? `&exam_date=eq.${dateOf(wanted)}` : "";
  const r = await admin(
    `/rest/v1/sg_exam_accounts?${filter}${datePart}&select=student_id,exam_date&order=exam_date.desc`,
  );
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows)) return [];
  if (wanted) return rows;
  const t = today();
  return rows.sort((a, b) => {
    const ad = String(a.exam_date), bd = String(b.exam_date);
    const ar = ad === t ? 0 : ad < t ? 1 : 2;
    const br = bd === t ? 0 : bd < t ? 1 : 2;
    if (ar !== br) return ar - br;
    return ar === 2 ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });
}

/** 시험일 명단 도입 전 계정의 실제 인증 이메일. */
async function legacyStudentEmails(studentId: string) {
  const r = await admin(
    `/rest/v1/sg_profiles?student_id=ilike.${encodeURIComponent(studentId)}` +
      `&select=email&order=id.asc`,
  );
  const rows = await r.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row.email ?? "").trim().toLowerCase())
    .filter(Boolean);
}

async function handleSignin(b: Record<string, unknown>) {
  const login = String(b.login ?? "").trim().toLowerCase();
  const password = String(b.password ?? "") || PW;
  if (!login) return fail(400, "missing_fields", "Enter your ID or email.", "아이디 또는 이메일을 입력하세요.");

  const bad = () => fail(401, "bad_credentials", "Wrong ID or password.", "아이디 또는 비밀번호가 올바르지 않습니다.");
  let targets: string[] = [login];

  if (ID_RE.test(login)) {
    const accounts = await resolveAccounts(`student_id=eq.${login}`, b.exam_date);
    targets = accounts.map((acc) => authEmail(acc.student_id, acc.exam_date));
    targets.push(...await legacyStudentEmails(login));
  } else if (login.includes("@")) {
    const accounts = await resolveAccounts(`email=eq.${encodeURIComponent(login)}`, b.exam_date);
    targets = accounts.map((acc) => authEmail(acc.student_id, acc.exam_date));
    targets.push(login); // 예전 학생·선생님·관리자의 실제 Auth 이메일
  } else {
    return bad();
  }

  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  for (const target of uniqueTargets) {
    const s = await issueSession(target, password);
    if (!s.ok) continue;
    const id = s.body?.user?.id;
    return json({ session: s.body, user: id ? await profileOf(id) : null });
  }
  return bad();
}

/* ── 선생님 계정 만들기 (관리자 전용) ─────────────────────────
 *
 * 예전에는 SQL 편집기에서 `update sg_profiles set role='teacher'` 를 쳐야 했다.
 * 계정 생성과 승격을 한 번에 여기서 한다 — 화면(admin-teachers.html)이 이걸 부른다.
 *
 * 호출자는 자기 access token 을 body 에 실어 보낸다. 그 토큰으로 사용자를 되짚어
 * sg_profiles 의 role 을 서버가 다시 확인한다 — 화면에서 관리자인 척하는 것으로는
 * 통과하지 못한다.
 */
async function callerOf(token: unknown) {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${t}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? await profileOf(u.id) : null;
}

async function handleCreateStaff(b: Record<string, unknown>) {
  const me = await callerOf(b.token);
  if (!me || !(me.is_admin || me.role === "admin")) {
    return fail(403, "not_admin", "Administrators only.", "관리자만 할 수 있습니다.");
  }

  const name = String(b.name ?? "").trim();
  const login = String(b.login ?? "").trim().toLowerCase();
  const password = String(b.password ?? "") || STAFF_PW;
  const contact = String(b.email ?? "").trim().toLowerCase();
  const role = b.role === "admin" ? "admin" : "teacher";

  if (!name) return fail(400, "missing_name", "Enter the teacher's name.", "선생님 이름을 입력하세요.");
  if (!STAFF_LOGIN_RE.test(login) || ID_RE.test(login)) {
    return fail(400, "bad_login", "The ID must be 2–32 letters/digits and must not look like smeag000.",
      "아이디는 영문·숫자 2~32자여야 하며 smeag000 형식은 쓸 수 없습니다.");
  }
  if (password.length < 4) {
    return fail(400, "weak_password", "The password must be at least 4 characters.", "비밀번호는 4자 이상이어야 합니다.");
  }
  if (contact && !EMAIL_RE.test(contact)) {
    return fail(400, "invalid_email", "Enter a valid email address.", "올바른 이메일 주소를 입력하세요.");
  }

  const email = `${login}@${DOMAIN}`;
  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, student_id: login, plan: "staff", contact_email: contact || null },
    }),
  });
  const user = await created.json().catch(() => ({}));
  if (!created.ok || !user.id) {
    return fail(409, "login_taken", `${login} is already in use. Pick another ID.`,
      `${login} 은(는) 이미 사용 중입니다. 다른 아이디를 골라주세요.`, { login: login });
  }

  /* 트리거가 만든 프로필을 선생님으로 올린다. 여기서 실패하면 학생 프로필이 남아
     아무것도 못 보는 계정이 되므로, 계정을 지우고 처음부터 다시 하게 한다. */
  const up = await admin(`/rest/v1/sg_profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      role, name, student_id: login, is_admin: role === "admin", verified: true,
    }),
  });
  if (!up.ok) {
    await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    return fail(500, "promote_failed", "The account was created but could not be promoted. Try again.",
      "계정은 만들었지만 권한 부여에 실패했습니다. 다시 시도해 주세요.");
  }

  return json({ user: await profileOf(user.id), login, email, password, role });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.", "POST 만 허용됩니다.");

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return fail(400, "bad_json", "Malformed request body.", "요청 본문이 올바르지 않습니다.");
  }

  if (b.action === "next_id") return await handleNextId(b);
  if (b.action === "teachers") return await handleTeachers();
  if (b.action === "lookup") return await handleLookup(b);
  if (b.action === "register" || b.action === "signup") return await handleRegister(b);
  if (b.action === "signin") return await handleSignin(b);
  if (b.action === "create_staff") return await handleCreateStaff(b);
  return fail(400, "unknown_action",
    'action must be "next_id", "teachers", "lookup", "register", "signin" or "create_staff".',
    'action 은 "next_id" · "teachers" · "lookup" · "register" · "signin" · "create_staff" 중 하나여야 합니다.');
});
