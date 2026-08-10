import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/* SMEAG StudyGround 2.0 — 수험생 계정 엔드포인트.
 *
 * 규칙(2026-08-10 확정):
 *  • 가입 입력은 이름 + 시험일자 둘뿐이다. 이메일·비밀번호를 받지 않는다.
 *  • 아이디는 서버가 smeag000 ~ smeag999 중 빈 번호를 자동 배정한다.
 *  • 비밀번호는 전부 2222.
 *  • 같은 시험일에 같은 아이디는 두 번 생기지 않는다. 다른 시험일에는 같은
 *    아이디를 다시 쓸 수 있다 — 그래서 키가 (student_id, exam_date) 다.
 *  • 같은 시험일에 같은 이름이 이미 있으면 경고만 하고(팝업) 다시 만들게 한다.
 *    그대로 진행하려면 force: true 로 다시 보낸다.
 *
 * Supabase Auth 는 이메일이 필수라 아이디+시험일로 합성한다:
 *   smeag007.20260810@smeagstudyground.com   (메일은 안 나간다 — email_confirm:true 로 생성)
 * 이메일 UNIQUE + sg_exam_accounts UNIQUE(student_id, exam_date) 두 곳에서
 * 중복이 막힌다. 화면 검사가 뚫려도 DB 가 두 번째를 거절한다.
 *
 * 로그인은 수험생 아이디(smeag###) 말고 선생님·관리자 계정도 받는다. 이들은
 * 시험일마다 새로 만드는 계정이 아니라 sg_profiles 에 한 줄로 상주하므로,
 * 아이디(student_id, 예: admin)나 이메일 앞부분으로 프로필을 찾아 이메일을
 * 알아낸 뒤 같은 비밀번호 흐름을 탄다. 아이디만 바뀌고 인증은 그대로다.
 *
 * POST { action: "next_id",  exam_date? }   → { student_id, used, free }
 * POST { action: "register", name, exam_date?, student_id?, force? }
 * POST { action: "signin",   login, password?, exam_date? }
 *   → 200 { session, user, student_id, password, exam_date }
 *   → 4xx { error, message, message_ko, ... }
 */

const PW = "2222";
const DOMAIN = "smeagstudyground.com";
const ID_RE = /^smeag\d{3}$/;
/* 수험생 아이디가 아닌 로그인(선생님·관리자)에 허용하는 글자. PostgREST 질의에
   그대로 들어가므로 화이트리스트로 좁힌다. */
const STAFF_LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MAX_ID = 1000;

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

function dateOf(v: unknown) {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}
const pad3 = (n: number) => "smeag" + String(n).padStart(3, "0");
const emailFor = (id: string, date: string) => `${id}.${date.replace(/-/g, "")}@${DOMAIN}`;

async function issueSession(email: string, password: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

async function profileOf(id: string) {
  const r = await admin(
    `/rest/v1/sg_profiles?id=eq.${encodeURIComponent(id)}&select=id,email,name,student_id,plan,role,is_admin,verified`,
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

/** 그 시험일에 이미 쓴 아이디 집합. */
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
  for (let i = 0; i < MAX_ID; i++) {
    if (!used.has(pad3(i))) { next = pad3(i); break; }
  }
  return json({ exam_date: date, student_id: next, used: used.size, free: MAX_ID - used.size });
}

/** 계정 생성 + 명부 행 삽입. 아이디가 이미 나간 경우 null 을 돌려 재시도하게 한다. */
async function claim(studentId: string, date: string, name: string) {
  const email = emailFor(studentId, date);
  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: PW,
      email_confirm: true,
      user_metadata: { name, student_id: studentId, exam_date: date, plan: "lite" },
    }),
  });
  const user = await created.json().catch(() => ({}));
  if (!created.ok) return null;                       // 이메일 중복 = 이미 나간 아이디

  const ins = await admin("/rest/v1/sg_exam_accounts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ user_id: user.id, student_id: studentId, exam_date: date, name }]),
  });
  if (!ins.ok) {
    await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    return null;                                      // UNIQUE(student_id, exam_date) 에 걸렸다
  }
  return { user, email };
}

async function handleRegister(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  const date = dateOf(b.exam_date);
  const wanted = String(b.student_id ?? "").trim().toLowerCase();
  const force = b.force === true;

  if (!name) return fail(400, "missing_name", "Enter the student's name.", "이름을 입력하세요.");
  if (wanted && !ID_RE.test(wanted)) {
    return fail(400, "bad_id", "The ID must be smeag000 – smeag999.", "아이디는 smeag000 ~ smeag999 형식이어야 합니다.");
  }

  // 같은 시험일에 같은 이름이 이미 있다 — 중복 등록일 가능성이 높으니 팝업으로 묻는다.
  if (!force) {
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

  // 아이디 배정. 지정했으면 그것만, 안 했으면 빈 번호를 순서대로 놓고 다투리를 피한다.
  let got: { user: { id: string }; email: string } | null = null;
  let assigned = "";

  if (wanted) {
    got = await claim(wanted, date, name);
    assigned = wanted;
    if (!got) {
      return fail(409, "id_taken_today", `${wanted} is already used on ${date}. Pick another ID.`,
        `${wanted} 은(는) ${date} 시험일에 이미 사용 중입니다. 다른 아이디를 골라주세요.`,
        { exam_date: date, student_id: wanted });
    }
  } else {
    const used = await usedIds(date);
    for (let i = 0; i < MAX_ID && !got; i++) {
      const id = pad3(i);
      if (used.has(id)) continue;
      got = await claim(id, date, name);   // 경합에서 지면 null → 다음 번호로
      if (got) assigned = id;
    }
    if (!got) {
      return fail(409, "no_free_id", `All 1000 IDs are used for ${date}.`,
        `${date} 시험일의 아이디 1000개가 모두 사용 중입니다.`, { exam_date: date });
    }
  }

  const s = await issueSession(got.email, PW);
  if (!s.ok) {
    return fail(500, "session_failed", "Registered, but automatic login failed. Please log in.", "등록은 됐지만 자동 로그인에 실패했습니다. 로그인해 주세요.",
      { student_id: assigned, password: PW, exam_date: date });
  }
  return json({
    session: s.body,
    user: (await profileOf(got.user.id)) ?? { id: got.user.id, name, student_id: assigned },
    student_id: assigned,
    password: PW,
    exam_date: date,
  });
}

/** 수험생 아이디(smeag###) → 그 아이디로 만든 계정의 합성 이메일. */
async function examEmail(login: string, examDate: unknown) {
  const q = examDate ? `&exam_date=eq.${dateOf(examDate)}` : "";
  const r = await admin(
    `/rest/v1/sg_exam_accounts?student_id=eq.${login}${q}&select=exam_date&order=exam_date.desc&limit=1`,
  );
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  return emailFor(login, rows[0].exam_date);
}

/** 선생님·관리자 아이디 → 프로필에 적힌 실제 이메일.
 *  student_id(대소문자 무시) 로 찾고, 없으면 아이디@도메인 계정을 본다. */
async function staffEmail(login: string) {
  if (!STAFF_LOGIN_RE.test(login)) return null;
  const or = `or=(student_id.ilike.${login},email.eq.${login}@${DOMAIN})`;
  const r = await admin(`/rest/v1/sg_profiles?${or}&select=email&limit=1`);
  const rows = await r.json().catch(() => []);
  const email = Array.isArray(rows) && rows[0] ? String(rows[0].email || "") : "";
  return email || null;
}

async function handleSignin(b: Record<string, unknown>) {
  const login = String(b.login ?? "").trim().toLowerCase();
  const password = String(b.password ?? "") || PW;
  if (!login) return fail(400, "missing_fields", "Enter your ID.", "아이디를 입력하세요.");

  let email: string | null = login;
  if (!login.includes("@")) {
    email = ID_RE.test(login) ? await examEmail(login, b.exam_date) : await staffEmail(login);
  }
  if (!email) {
    return fail(401, "bad_credentials", "Wrong ID or password.", "아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  const s = await issueSession(email, password);
  if (!s.ok) {
    return fail(401, "bad_credentials", "Wrong ID or password.", "아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  const id = s.body?.user?.id;
  return json({ session: s.body, user: id ? await profileOf(id) : null });
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
  if (b.action === "register" || b.action === "signup") return await handleRegister(b);
  if (b.action === "signin") return await handleSignin(b);
  return fail(400, "unknown_action", 'action must be "next_id", "register" or "signin".', 'action 은 "next_id" · "register" · "signin" 중 하나여야 합니다.');
});
