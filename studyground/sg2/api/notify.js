/* SMEAG StudyGround — /api/notify : 시험장에서 난 일을 이메일로 알린다.
 *
 * 왜 있는가
 *   시험이 끝난 뒤에야 무엇이 잘못됐는지 알게 되는 것이 문제였다. 2026-08-12 시험은
 *   녹음 61건이 전부 거절당했는데(400 InvalidMimeType) 아무도 그날 저녁까지 몰랐다.
 *   화면에 적는 것만으로는 부족하다 — 학생은 읽고 나가 버리고, 감독 선생님은 그 화면
 *   앞에 없다. 그래서 같은 사실을 사람이 반드시 보는 자리(메일함)로도 보낸다.
 *
 * 무엇을 보내는가 — 두 가지뿐이다.
 *   issue  무언가 어긋난 그 순간. 녹음 업로드 실패, 오래 끊긴 회선, 버려진 답안,
 *          채점 거절. 즉시 나간다.
 *   done   한 학생의 응시가 끝난 자리에서 한 통. 제출 사실 + 밴드 점수 + 그 응시에서
 *          있었던 문제를 함께 싣는다. 제출과 채점을 따로 보내면 학생 수의 두 배가
 *          메일함에 쌓이는데, 어차피 제출 화면이 채점까지 기다린다(exam-shell.js).
 *
 * 계약
 *   POST /api/notify
 *     헤더 Authorization: Bearer <supabase access token>
 *     { kind: 'issue'|'done', code?, session?, set_code?, mode?,
 *       message?, detail?: {…}, bands?: {…} }
 *     → 200 { sent: true, to: n } | { sent: false, reason }
 *
 *   본문의 글은 **전부 남이 쓴 값으로 취급한다**. 학생 기기가 보내는 것이라
 *   그대로 HTML 에 넣으면 메일이 곧 주입 경로가 된다. 모든 값은 이스케이프하고
 *   길이를 자른다. 제목 줄에는 개행을 넣지 않는다(헤더 주입).
 *
 *   "누가" 는 본문에서 읽지 않는다 — 토큰이 말해 준다. 학생이 남의 이름으로 사고를
 *   보고할 수 없어야 한다.
 *
 * 보내는 길
 *   Resend HTTP API. 이 저장소의 /api/* 는 의존성이 없다(package.json 이 없다) —
 *   그래서 SMTP 라이브러리가 아니라 fetch 한 번으로 끝나는 길을 골랐다.
 *
 * Vercel 환경변수
 *   RESEND_API_KEY   필수. 없으면 조용히 { sent:false, reason:'not_configured' } 다.
 *                    503 이 아닌 이유: 알림이 없다고 시험이 실패하면 안 된다(F12).
 *   NOTIFY_TO        받는 사람. 쉼표로 여럿. 기본값은 아래 DEFAULT_TO.
 *   NOTIFY_FROM      보내는 사람. 기본 'SMEAG MockTest <onboarding@resend.dev>'.
 *                    실제 운영에서는 인증된 도메인 주소로 바꾼다(스팸함 방지).
 *   NOTIFY_KINDS     보낼 종류. 'issue,done' 이 기본. 'issue' 만 두면 완료 메일이 멎는다.
 */

'use strict';

const LLM = require('./_llm.js');

const DEFAULT_TO = 'jitnet57@gmail.com, ai@smeagschool.com';
const DEFAULT_FROM = 'SMEAG MockTest <onboarding@resend.dev>';

const KINDS = { issue: true, done: true };

/* 한 사람이 한 통에 실을 수 있는 양의 상한. 시험 한 회차가 메일함을 채우지 않게 한다. */
const MAX_DETAIL_KEYS = 24;
const MAX_VALUE = 400;
const MAX_MESSAGE = 1200;

/* 같은 인스턴스가 살아 있는 동안의 중복·폭주 방지. 완벽한 잠금이 아니다(람다는 여럿
 * 뜬다) — 클라이언트도 세션별로 한 번만 보내므로, 여기서는 "같은 사고가 재시도로
 * 열 번 오는" 흔한 경우만 걷어내면 된다. */
const seen = new Map();          // key → 마지막 발송 시각
const DEDUPE_MS = 10 * 60 * 1000;
const RATE_MAX = 40;             // 인스턴스당 10분 안에 보내는 총량
const rate = [];

function tooMany(now) {
  while (rate.length && now - rate[0] > DEDUPE_MS) rate.shift();
  return rate.length >= RATE_MAX;
}

function duplicate(key, now) {
  const last = seen.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  seen.set(key, now);
  // 오래된 열쇠는 버린다 — 이 Map 이 자라기만 하면 안 된다.
  if (seen.size > 500) for (const [k, t] of seen) { if (now - t > DEDUPE_MS) seen.delete(k); }
  return false;
}

/* ── 문자열 다루기 ───────────────────────────────────────────────────────── */

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 제목 한 줄. 개행·제어문자를 지운다(메일 헤더 주입 방지). */
function oneLine(v, max) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 120);
}

function clip(v, max) {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  const n = max || MAX_VALUE;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ── 시각 ────────────────────────────────────────────────────────────────── */

/** 세부 학원은 세부(Asia/Manila), 보는 사람은 서울(Asia/Seoul)에 있다. 둘 다 적는다. */
function when(now) {
  function at(tz) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(now);
    } catch (e) { return now.toISOString(); }
  }
  return at('Asia/Manila') + ' Cebu · ' + at('Asia/Seoul') + ' Seoul';
}

/* ── 보내는 사람·받는 사람 ───────────────────────────────────────────────── */

function recipients() {
  return (LLM.env('NOTIFY_TO') || DEFAULT_TO)
    .split(',')
    .map((s) => oneLine(s, 200))
    .filter((s) => s.indexOf('@') > 0);
}

function kindEnabled(kind) {
  const list = (LLM.env('NOTIFY_KINDS') || 'issue,done').split(',').map((s) => s.trim());
  return list.indexOf(kind) >= 0;
}

/* ── 학생 한 줄 ──────────────────────────────────────────────────────────── */

/** whoIs 는 이름·역할까지만 안다. 메일에는 로그인 아이디(smeag000)가 있어야 사람이
 *  누구인지 바로 안다 — 본인 프로필은 RLS 가 읽게 해 주므로 서비스 키가 필요 없다. */
async function profileOf(me) {
  try {
    const r = await fetch(
      LLM.SUPABASE_URL + '/rest/v1/sg_profiles?select=student_id,email,name&id=eq.' +
      encodeURIComponent(me.id),
      { headers: { apikey: LLM.SUPABASE_ANON, Authorization: 'Bearer ' + me.token } }
    );
    if (!r.ok) return {};
    const rows = await r.json().catch(() => []);
    return (rows && rows[0]) || {};
  } catch (e) { return {}; }
}

/* ── 메일 본문 ───────────────────────────────────────────────────────────── */

const ISSUE_LABEL = {
  media_upload_failed: '스피킹 녹음을 올리지 못했다',
  media_dropped: '녹음 한 건을 끝내 못 올렸다',
  answers_not_uploaded: '답안이 이 기기에만 남았다',
  offline: '회선이 오래 끊겼다',
  scoring_unavailable: '채점을 할 수 없었다',
  attempt_abandoned: '응시를 처음부터 다시 시작했다',
  storage_blocked: '브라우저 저장소를 쓸 수 없다'
};

function row(k, v) {
  return '<tr>' +
    '<td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top">' + esc(k) + '</td>' +
    '<td style="padding:6px 0;vertical-align:top">' + esc(v) + '</td>' +
  '</tr>';
}

function bandRows(bands) {
  if (!bands || typeof bands !== 'object') return '';
  const NAMES = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking' };
  let out = '';
  Object.keys(NAMES).forEach(function (k) {
    if (bands[k] === undefined || bands[k] === null) return;
    out += row(NAMES[k], clip(bands[k], 40));
  });
  if (bands.overall !== undefined && bands.overall !== null) {
    out += row('Overall', clip(bands.overall, 40) + (bands.cefr ? ' (' + clip(bands.cefr, 20) + ')' : ''));
  }
  return out;
}

function detailRows(detail) {
  if (!detail || typeof detail !== 'object') return '';
  let out = '', n = 0;
  for (const k of Object.keys(detail)) {
    if (n++ >= MAX_DETAIL_KEYS) break;
    const v = detail[k];
    if (v === null || v === undefined || v === '') continue;
    out += row(oneLine(k, 60), clip(v));
  }
  return out;
}

function compose(o) {
  const issue = o.kind === 'issue';
  const head = issue
    ? '[시험 문제] ' + (ISSUE_LABEL[o.code] || o.code || '알 수 없는 문제')
    : '[응시 완료]';
  const subject = oneLine(
    head + ' · ' + (o.studentId || o.name || 'unknown') +
    (o.setCode ? ' · ' + o.setCode : '') +
    (!issue && o.bands && o.bands.overall !== null && o.bands.overall !== undefined
      ? ' · Overall ' + o.bands.overall : ''),
    160
  );

  let table = '';
  table += row('학생', (o.name || '(이름 없음)') + (o.studentId ? ' · ' + o.studentId : '') +
                       (o.role && o.role !== 'student' ? ' · ' + o.role : ''));
  if (o.email) table += row('계정', o.email);
  table += row('시각', when(o.now));
  if (o.setCode) table += row('세트', o.setCode);
  if (o.mode) table += row('모드', o.mode);
  if (o.session) table += row('세션', o.session);
  if (issue && o.code) table += row('코드', o.code);
  if (o.message) table += row('내용', clip(o.message, MAX_MESSAGE));
  table += bandRows(o.bands);
  table += detailRows(o.detail);
  if (o.reviewUrl) table += row('리뷰', o.reviewUrl);

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#222">' +
      '<p style="font-size:17px;font-weight:700;margin:0 0 12px' +
        (issue ? ';color:#c0392b' : ';color:#1c7c3f') + '">' + esc(head) + '</p>' +
      '<table style="border-collapse:collapse">' + table + '</table>' +
      (issue
        ? '<p style="margin:16px 0 0;color:#666">이 학생이 아직 그 자리에 있다면 지금 회수할 수 있습니다 — ' +
          'recover-recordings.html 에서 기기에 남은 녹음을 올릴 수 있습니다.</p>'
        : '') +
      '<p style="margin:18px 0 0;font-size:12px;color:#999">SMEAG MockTest · /api/notify</p>' +
    '</div>';

  // 텍스트 본문도 함께 보낸다 — 알림만 보고 판단하는 휴대폰에서 이쪽이 먼저 읽힌다.
  const text = html
    .replace(/<\/(p|tr|table|div)>/g, '\n').replace(/<\/td>\s*<td[^>]*>/g, ': ')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();

  return { subject, html, text };
}

/* ── Resend ──────────────────────────────────────────────────────────────── */

async function send(mail, to) {
  const key = LLM.env('RESEND_API_KEY');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: LLM.env('NOTIFY_FROM') || DEFAULT_FROM,
      to: to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    })
  });
  if (!r.ok) throw new Error('resend ' + r.status + ' ' + clip(await r.text().catch(() => ''), 200));
  return true;
}

/* ── handler ─────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (LLM.cors(req, res)) return;

  const configured = !!LLM.env('RESEND_API_KEY');
  // GET 은 설정 여부만 말한다 — 키도 주소도 내보내지 않는다.
  if (req.method === 'GET') return LLM.json(res, 200, { configured: configured, kinds: Object.keys(KINDS) });
  if (req.method !== 'POST') return LLM.json(res, 405, { error: 'GET or POST only.' });

  const me = await LLM.whoIs(req);
  if (!me) return LLM.json(res, 401, { error: 'Sign-in is required.' });

  const body = await LLM.readBody(req);
  if (!body) return LLM.json(res, 400, { error: 'Malformed JSON body.' });

  const kind = String(body.kind || '').trim();
  if (!KINDS[kind]) return LLM.json(res, 400, { error: 'Unknown "kind".' });

  /* 아래 세 갈래는 전부 200 이다. 클라이언트는 알림 실패로 아무 것도 바꾸지 않고,
     4xx 로 돌려주면 큐가 "다시 보내야 할 실패" 로 오해해 재시도를 쌓는다. */
  if (!configured) return LLM.json(res, 200, { sent: false, reason: 'not_configured' });
  if (!kindEnabled(kind)) return LLM.json(res, 200, { sent: false, reason: 'kind_disabled' });

  const to = recipients();
  if (!to.length) return LLM.json(res, 200, { sent: false, reason: 'no_recipients' });

  const now = Date.now();
  if (tooMany(now)) return LLM.json(res, 200, { sent: false, reason: 'rate_limited' });

  const session = oneLine(body.session, 80);
  const code = oneLine(body.code, 60);
  const key = [me.id, kind, code, session].join('|');
  if (duplicate(key, now)) return LLM.json(res, 200, { sent: false, reason: 'duplicate' });

  const p = await profileOf(me);
  const host = oneLine(req.headers['x-forwarded-host'] || req.headers.host, 120);

  const mail = compose({
    kind: kind,
    code: code,
    now: new Date(now),
    name: oneLine(me.name || p.name, 80),
    studentId: oneLine(p.student_id, 40),
    email: oneLine(p.email, 120),
    role: me.role,
    session: session,
    setCode: oneLine(body.set_code, 40),
    mode: oneLine(body.mode, 40),
    message: body.message,
    detail: body.detail,
    bands: body.bands,
    reviewUrl: host && session
      ? 'https://' + host + '/review.html?session=' + encodeURIComponent(session) +
        '&owner=' + encodeURIComponent(me.id)
      : ''
  });

  try {
    await send(mail, to);
  } catch (e) {
    // 보내지 못한 것도 200 이다 — 다만 이유는 그대로 돌려준다(대시보드·콘솔에서 읽는다).
    seen.delete(key);
    return LLM.json(res, 200, { sent: false, reason: 'send_failed', detail: String(e.message || e) });
  }
  rate.push(now);
  return LLM.json(res, 200, { sent: true, to: to.length });
};

// 테스트용 — 메일 조립은 네트워크 없이 검사할 수 있어야 한다.
module.exports.compose = compose;
module.exports.oneLine = oneLine;
