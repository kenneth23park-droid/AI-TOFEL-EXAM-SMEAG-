import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/* SMEAG MockTest — 리뷰 열람 문지기.
 *
 * 문항과 정답은 이제 공개 파일이 아니라 sg_set_questions 에 있고, 그 표에는 RLS
 * 정책이 하나도 없다 — service_role 말고는 아무도 읽지 못한다. 학생 화면
 * (smeag.com/scores.html)은 여기에 물어야 하고, 이 함수가 세 가지를 확인한 뒤에만
 * 문항과 정답을 내려준다.
 *
 *   1) 이 응시를 볼 자격이 있는가   — 학생의 토큰으로 sg_results 를 읽어 본다.
 *                                     판정은 여기가 아니라 RLS 의 sg_can_see() 다.
 *   2) 열람 기한이 남았는가         — sg_review_status(): 응시일과 교사 리뷰일 중
 *                                     늦은 쪽 + 7일.
 *   3) 관리자가 다시 열어 주었는가  — sg_review_grants 의 살아 있는 해제.
 *
 * 선생님·관리자는 기한과 무관하게 본다(채점하려면 봐야 한다).
 *
 * 기한이 지났으면 questions 는 **빈 배열**로 나간다. 화면이 감추는 것이 아니라
 * 서버가 주지 않는다 — 그것이 이 함수가 있는 이유다.
 *
 * POST { session }   Authorization: Bearer <학생 access_token>
 *   → 200 { open, until, granted_until, unlocked, staff, set_code, questions: [...] }
 *   → 401 토큰 없음 · 403 남의 응시 · 404 없는 세션
 *
 * ⚠️ 남은 구멍: 시험 앱(sg2)의 팩 파일(assets/set9.js)에는 여전히 정답이 들어 있고
 *    그 파일은 공개 주소로 받을 수 있다. 오프라인 채점이 그 파일에 기대고 있어서
 *    이 함수만으로는 닫히지 않는다 — studyground/supabase/review_window.sql 머리말과
 *    studyground/smeag-com/README.md 참고.
 */

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
function fail(status: number, error: string, en: string, ko: string) {
  return json({ error, message: en, message_ko: ko }, status);
}

/* service_role — RLS 를 지나친다. 정답을 만지는 건 이 통로뿐이다. */
const admin = (path: string) =>
  fetch(`${URL_}${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  });

/* 학생의 토큰 — RLS 가 그대로 걸린다. "이 사람이 이 응시를 볼 수 있는가" 는
   여기서 다시 판단하지 않고 서버의 정책에게 묻는다. */
const asUser = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method", "POST only.", "POST 만 받습니다.");

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "no_token", "Sign in first.", "로그인이 필요합니다.");

  const body = await req.json().catch(() => ({}));
  const session = String(body?.session ?? "").trim();
  if (!session) return fail(400, "no_session", "session is required.", "session 이 필요합니다.");

  /* ── 1. 볼 자격 — 학생의 토큰으로 읽어 본다. 한 행도 안 나오면 남의 응시다. ── */
  /* owner 까지 받아 둔다 — 같은 session 이 서로 다른 소유자에게 들어가 있는 행이
     실제로 있어서(관리자 seed·중복 동기화), 세션만으로 창을 계산하면 남의 행을
     집을 수 있다. */
  const mine = await asUser(
    `/rest/v1/sg_results?session=eq.${encodeURIComponent(session)}` +
      `&select=session,set_code,owner&order=submitted_at.desc&limit=1`,
    token,
  );
  if (mine.status === 401) return fail(401, "bad_token", "Session expired.", "로그인이 만료되었습니다.");
  const rows = await mine.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) {
    return fail(403, "not_yours", "This result is not available to you.", "이 응시는 볼 수 없습니다.");
  }

  /* ── 2. 선생님·관리자인가 — 기한을 넘어서도 봐야 채점을 한다. ── */
  const staffRes = await asUser(`/rest/v1/rpc/sg_is_staff`, token, {
    method: "POST",
    body: "{}",
  });
  const staff = staffRes.ok ? (await staffRes.json().catch(() => false)) === true : false;

  /* ── 3. 열람 창 — 규칙은 DB 에 한 벌만 있다(sg_review_status). ── */
  const statusRes = await admin(
    `/rest/v1/rpc/sg_review_status?p_session=${encodeURIComponent(session)}` +
      `&p_owner=${encodeURIComponent(String(rows[0].owner ?? ""))}`,
  );
  const status = statusRes.ok ? await statusRes.json().catch(() => null) : null;
  if (!status || !status.session) {
    return fail(404, "no_session", "No such result.", "그런 응시가 없습니다.");
  }

  const open = status.open === true || staff;
  const shell = {
    session,
    set_code: status.set_code ?? rows[0].set_code ?? "",
    open,
    until: status.until ?? null,
    granted_until: status.granted_until ?? null,
    unlocked: status.unlocked === true,
    teacher_at: status.teacher_at ?? null,
    staff,
  };

  /* 닫혔으면 문항을 아예 싣지 않는다. 감추는 것과 주지 않는 것은 다른 말이다. */
  if (!open) return json({ ...shell, questions: [] });

  const setCode = String(shell.set_code || "").toUpperCase();
  if (!setCode) return json({ ...shell, questions: [] });

  const qRes = await admin(
    `/rest/v1/sg_set_questions?set_code=eq.${encodeURIComponent(setCode)}` +
      `&select=question_id,ord,no,section,prompt,answer&order=ord.asc`,
  );
  const questions = qRes.ok ? await qRes.json().catch(() => []) : [];

  return json({ ...shell, questions: Array.isArray(questions) ? questions : [] });
});
