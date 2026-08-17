/* SMEAG StudyGround — /api 공용 LLM 배관. 엔드포인트가 아니다(밑줄로 시작한다).
 *
 * /api/feedback(코멘트)과 /api/score(채점)가 같은 프로바이더 목록·같은 키 규칙·같은
 * JSON 파싱을 쓴다. 두 벌로 갈라 두었더니 한쪽에만 모델이 추가되는 일이 생겨서
 * 여기로 모았다. 이 파일은 "무엇을 물어볼지"는 모르고 "어떻게 물어볼지"만 안다.
 *
 * 프로바이더 — 키가 있는 쪽만 목록에 나온다.
 *   openai      OPENAI_API_KEY      (OPENAI_MODEL 이 기본값)
 *   anthropic   ANTHROPIC_API_KEY   (ANTHROPIC_MODEL 이 기본값)
 *
 * chat() 은 본문뿐 아니라 **토큰 사용량**도 돌려준다. 돈이 나가는 호출이라 얼마나
 * 썼는지 남기지 않으면 모델을 바꿀 때 근거가 없다(app/scoring/pricing.py 와 같은
 * 취지). 금액 환산은 여기서 하지 않는다 — 단가표는 파이썬 쪽 한 곳에만 둔다.
 *
 *   chat(key, model, system, user, opts) -> { text, usage:{in,out}, truncated }
 *   opts.maxTokens  Anthropic 의 상한(기본 2000). 코멘트·채점은 그 안에서 끝나지만
 *                   /api/generate 의 강의 대본은 그 배가 든다. OpenAI 는 상한을
 *                   보내지 않는다 — 모델마다 받는 필드 이름이 달라서, 안 보내는 쪽이
 *                   새 모델이 나올 때마다 고치지 않아도 된다.
 *   opts.temperature 채점은 같은 답안에 같은 점수를 내야 한다. 0 을 보내면 같은 글이
 *                   같은 점수로 돌아올 확률이 높아진다(보장은 아니다). 온도를 아예
 *                   안 받는 모델도 있어서, 거절당하면 온도만 떼고 한 번 더 부른다 —
 *                   채점이 통째로 죽는 것보다 온도를 잃는 편이 낫다.
 *   truncated       상한에 걸려 잘렸다. 잘린 JSON 은 파싱만 실패하고 이유는 안 남아서,
 *                   호출자가 "모델이 이상한 걸 줬다" 와 "길이가 모자랐다" 를 구분하려면
 *                   이 값이 필요하다.
 *
 * 인용 검증(isVerbatim)
 *   채점과 리뷰가 "학생이 이렇게 썼다" 고 인용할 때, 그 말이 실제 답안에 있는지는
 *   모델에게 묻지 않고 여기서 문자로 확인한다. 지어낸 인용은 학생이 자기 답안에서
 *   찾을 수 없는 지적이라, 리뷰 전체를 못 믿게 만든다.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qrmidnmlethqvdbmnyun.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFybWlkbm1sZXRocXZkYm1ueXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Mzg3NzQsImV4cCI6MjEwMTMxNDc3NH0.U2cprYXkpIS_1tSAiEjCFuHAztZRwIIK6DYCCowgxg4';

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : '';
}

/* 목록을 못 받아왔을 때만 쓰는 최소 후보. 실제 목록은 프로바이더에게 묻는다. */
const FALLBACK = {
  openai: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-sonnet-5', 'claude-haiku-4-5-20251001']
};

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    key: () => env('OPENAI_API_KEY'),
    def: () => env('OPENAI_MODEL') || 'gpt-4o',
    async models(key) {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: 'Bearer ' + key }
      });
      if (!r.ok) throw new Error('models ' + r.status);
      const j = await r.json();
      return (j.data || [])
        .map((m) => m.id)
        // 글을 쓰는 모델만 남긴다 — 임베딩·이미지·음성은 채점도 코멘트도 못 한다.
        .filter((id) => /^(gpt-|o[0-9])/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embed)/.test(id))
        .sort()
        .reverse();   // 새 모델이 위로 — 고르는 사람이 먼저 보는 게 최신이어야 한다.
    },
    async chat(key, model, system, user, opts) {
      const temp = opts && opts.temperature;
      const ask = async (withTemp) => {
        const body = {
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' }
        };
        if (withTemp) body.temperature = temp;
        const rr = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return { rr, jj: await rr.json().catch(() => ({})) };
      };

      let { rr: r, jj: j } = await ask(temp !== undefined && temp !== null);
      /* 온도를 안 받는 모델(gpt-5 계열)은 400 으로 거절한다. 그 한 필드 때문에 채점이
         멈추면 안 되므로, 온도만 떼고 한 번 더 부른다. */
      if (!r.ok && r.status === 400 && /temperature/i.test(JSON.stringify(j.error || ''))) {
        ({ rr: r, jj: j } = await ask(false));
      }
      if (!r.ok) throw new Error((j.error && j.error.message) || 'OpenAI ' + r.status);
      const u = j.usage || {};
      const c0 = (j.choices && j.choices[0]) || {};
      return {
        text: c0.message && c0.message.content,
        usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 },
        truncated: c0.finish_reason === 'length'
      };
    }
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    key: () => env('ANTHROPIC_API_KEY'),
    def: () => env('ANTHROPIC_MODEL') || 'claude-sonnet-5',
    async models(key) {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      });
      if (!r.ok) throw new Error('models ' + r.status);
      const j = await r.json();
      return (j.data || []).map((m) => m.id).sort();
    },
    async chat(key, model, system, user, opts) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({
          model,
          max_tokens: (opts && opts.maxTokens) || 2000,
          system,
          messages: [{ role: 'user', content: user }]
        }, (opts && opts.temperature !== undefined && opts.temperature !== null)
             ? { temperature: opts.temperature } : {}))
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic ' + r.status);
      const part = (j.content || []).find((c) => c.type === 'text');
      const u = j.usage || {};
      return {
        text: part && part.text,
        usage: { in: u.input_tokens || 0, out: u.output_tokens || 0 },
        truncated: j.stop_reason === 'max_tokens'
      };
    }
  }
};

/* ── 전사(STT) ────────────────────────────────────────────────────────────
 *
 * 스피킹 채점은 "무슨 말을 했는가"가 있어야 시작된다. 글은 학생이 직접 써서 DB 에
 * 들어오지만 말은 음성 파일로만 남아서, 채점 앞에 한 단계가 더 필요하다.
 *
 * 프로바이더를 고르게 하지 않는다 — 지금 음성을 받는 곳은 OpenAI 뿐이고, 없으면
 * 스피킹은 조용히 "전사 없음"으로 넘어간다(0점이 아니다). 채점 모델이 Anthropic 이어도
 * 전사만 OpenAI 를 타는 게 정상 구성이다.
 *   OPENAI_API_KEY / OPENAI_STT_MODEL (기본 gpt-4o-transcribe)
 */
const STT_DEFAULT_MODEL = 'gpt-4o-transcribe';

function sttModel() { return env('OPENAI_STT_MODEL') || STT_DEFAULT_MODEL; }
function sttReady() { return !!env('OPENAI_API_KEY'); }

/** 확장자를 mime 에서 되찾는다. OpenAI 는 파일 이름의 확장자로 컨테이너를 판정한다. */
function audioExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('webm') >= 0) return 'webm';
  if (m.indexOf('ogg') >= 0) return 'ogg';
  if (m.indexOf('mp4') >= 0 || m.indexOf('m4a') >= 0 || m.indexOf('aac') >= 0) return 'm4a';
  if (m.indexOf('wav') >= 0) return 'wav';
  if (m.indexOf('mpeg') >= 0 || m.indexOf('mp3') >= 0) return 'mp3';
  return 'webm';
}

/**
 * 음성 한 개를 글로 옮긴다.
 * @param {ArrayBuffer|Buffer|Uint8Array} bytes  음성 원본
 * @param {string} mime  'audio/webm;codecs=opus' 등
 * @returns {Promise<{text:string, model:string}>}
 * @throws  키가 없거나 API 가 거절하면 던진다 — 호출자가 'no_transcript' 로 접는다.
 */
async function transcribe(bytes, mime, opts) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is not set; speech cannot be transcribed.');
  const model = (opts && opts.model) || sttModel();

  const form = new FormData();
  const type = String(mime || 'audio/webm').split(';')[0];
  form.append('file', new Blob([bytes], { type }), 'response.' + audioExt(mime));
  form.append('model', model);
  // 시험 언어는 영어다. 언어를 못 박아야 짧은 발화에서 엉뚱한 언어로 새지 않는다.
  form.append('language', 'en');
  form.append('response_format', 'json');
  /* 무엇을 옮겨 적는지 알려 주면 짧은 발화의 정확도가 오른다. 다만 프롬프트의 문장을
     그대로 베껴 쓰지 않도록 "들린 대로" 를 못 박는다 — Listen and Repeat 채점은
     실제로 말한 것과 원문의 차이를 보기 때문에, 원문을 채워 넣으면 채점이 무너진다. */
  form.append('prompt', 'A TOEFL speaking response by an English learner. ' +
    'Transcribe exactly what is said, including errors and hesitations. Do not correct or complete it.');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: form
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'OpenAI STT ' + r.status);
  return { text: String((j && j.text) || '').trim(), model };
}

/* 환경변수로 모델을 못 박지 않았을 때의 기본값. 목록에서 "이름에 군더더기가 없는"
 * 최신 세대를 고른다 — gpt-5.5 는 되고 gpt-5.5-pro·-codex·-2026-04-23 은 안 된다.
 * 날짜·용도가 붙은 이름은 선생님이 직접 고를 때만 쓴다. */
function pickDefault(id, models) {
  if (id === 'openai') {
    let best = null, bestV = -1;
    models.forEach(function (m) {
      const hit = /^gpt-(\d+(?:\.\d+)?)$/.exec(m);
      if (!hit) return;
      const v = parseFloat(hit[1]);
      if (v > bestV) { bestV = v; best = m; }
    });
    return best;
  }
  if (id === 'anthropic') {
    const pref = models.filter(function (m) { return /sonnet/.test(m); });
    return pref[0] || null;
  }
  return null;
}

async function listProviders() {
  const out = [];
  for (const id of Object.keys(PROVIDERS)) {
    const P = PROVIDERS[id];
    const key = P.key();
    if (!key) {
      out.push({ id, label: P.label, ready: false, why: id.toUpperCase() + '_API_KEY is not set on the server.', models: [], default: '' });
      continue;
    }
    let models = [];
    try { models = await P.models(key); } catch (e) { models = []; }
    if (!models.length) models = FALLBACK[id] || [];
    const def = env(id.toUpperCase() + '_MODEL') || pickDefault(id, models) || P.def();
    if (def && models.indexOf(def) < 0) models.unshift(def);
    out.push({ id, label: P.label, ready: true, why: '', models, default: def || models[0] || '' });
  }
  return out;
}

/** 프로바이더를 고른다. 지정이 없으면 키가 있는 쪽. 없으면 null. */
function resolve(id) {
  const want = String(id || '').trim();
  if (want) return PROVIDERS[want] ? { id: want, P: PROVIDERS[want] } : null;
  for (const key of Object.keys(PROVIDERS)) {
    if (PROVIDERS[key].key()) return { id: key, P: PROVIDERS[key] };
  }
  return null;
}

/** 모델이 ```json 울타리를 씌워 보내도 받아낸다. */
function parseJSON(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
  return null;
}

/* ── 인용 검증 ────────────────────────────────────────────────────────────
 *
 * "학생이 'has went' 라고 썼다" 는 확인할 수 있는 주장이다. 확인하지 않으면 모델이
 * 그럴듯한 문장을 지어내고, 학생은 자기 답안에서 찾을 수 없는 지적을 받는다. 한 번
 * 그런 일이 있으면 맞는 지적까지 못 믿게 된다 — 그래서 인용만은 문자로 확인한다.
 *
 * 느슨하게 볼 것과 엄하게 볼 것을 가른다. 대소문자·따옴표 모양·줄바꿈·겹공백은
 * 옮겨 적는 과정에서 어차피 달라지므로 눌러서 본다. 단어는 눌러 주지 않는다. */
function flatten(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ′`]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[ \s]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** 인용 부호와 꼬리 문장부호를 뗀 알맹이. 모델은 "…" 를 붙여 오기도 한다. */
function core(s) {
  return flatten(s).replace(/^["'\s]+/, '').replace(/["'\s.,!?;:]+$/, '');
}

/**
 * quote 가 hay 에 **글자 그대로** 들어 있는가.
 * 가운데를 …/... 로 줄인 인용은 토막마다 순서대로 들어 있으면 인정한다.
 * 빈 인용은 false — "인용이 없다" 와 "인용이 틀렸다" 는 호출자가 가른다.
 */
function isVerbatim(quote, hay) {
  const H = flatten(hay);
  if (!H) return false;
  const parts = String(quote == null ? '' : quote)
    .split(/\s*(?:\.\.\.|…)\s*/).map(core).filter(Boolean);
  if (!parts.length) return false;
  let at = 0;
  for (const p of parts) {
    const i = H.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return null; }
}

/** 호출자가 누구인지. 로그인이 아니면 null. role 은 sg_profiles 에서 읽는다. */
async function whoIs(req) {
  const auth = req.headers.authorization || '';
  const tok = auth.replace(/^Bearer\s+/i, '').trim();
  if (!tok) return null;
  const head = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + tok };

  const who = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: head });
  if (!who.ok) return null;
  const user = await who.json().catch(() => null);
  if (!user || !user.id) return null;

  // RLS 는 본인 프로필을 읽게 해 준다 — 여기에 서비스 키가 필요 없는 이유다.
  const pr = await fetch(
    SUPABASE_URL + '/rest/v1/sg_profiles?select=role,is_admin,name&id=eq.' + encodeURIComponent(user.id),
    { headers: head }
  );
  const rows = pr.ok ? await pr.json().catch(() => []) : [];
  const p = (rows && rows[0]) || null;
  const role = (p && p.role) || (p && p.is_admin ? 'admin' : 'student');
  return { id: user.id, token: tok, name: (p && p.name) || '', role, staff: role === 'teacher' || role === 'admin' };
}

/** 선생님·관리자만. 아니면 null. (기존 /api/feedback 의 staffOf 와 같은 의미) */
async function staffOf(req) {
  const me = await whoIs(req);
  return me && me.staff ? me : null;
}

/* ── 관리자 토큰 ────────────────────────────────────────────────────────
 *
 * 두 번째 문. 관리자 화면(assets/admin-session.js)의 비밀번호는 이 브라우저 안에서만
 * 통하는 가림막이라 서버가 믿을 근거가 없다 — 계정표가 정적 파일에 그대로 들어 있기
 * 때문이다. 그렇다고 선생님 Supabase 계정이 없으면 아무것도 못 하게 두면, 관리자
 * 비밀번호만 아는 사람은 AI 생성을 영영 못 쓴다.
 *
 * 그래서 서버에만 있는 값을 하나 둔다. 관리자가 그 값을 화면에 한 번 붙여넣으면
 * (이 브라우저에 남는다) 그 뒤로는 선생님 로그인 없이 열린다. /api/tts 가 이미
 * 같은 방식으로 SG_TTS_TOKEN 을 쓰고 있어서, 따로 SG_ADMIN_TOKEN 을 두지 않았으면
 * 그 토큰을 그대로 인정한다 — 관리자에게 열쇠를 두 개 쥐게 할 이유가 없다.
 *
 * 환경변수 (Vercel → Project → Settings → Environment Variables)
 *   SG_ADMIN_TOKEN   AI 생성을 열어 주는 관리자 토큰. 없으면 SG_TTS_TOKEN 을 본다.
 *                    둘 다 없으면 이 문은 닫힌 채다(선생님 계정 길만 남는다).
 *
 * 관리자 화면의 비밀번호(smeag2222 등)를 여기에 넣지 말 것 — 그 값은 정적 파일에
 * 공개되어 있어서, 넣는 순간 누구나 이 함수의 AI 키로 청구서를 만들 수 있다.
 */
function adminToken() { return env('SG_ADMIN_TOKEN') || env('SG_TTS_TOKEN'); }

/** x-sg-token 이 서버 토큰과 같으면 관리자로 친다. 아니면 null. */
function byAdminToken(req) {
  const want = adminToken();
  if (!want) return null;
  const got = String((req.headers && req.headers['x-sg-token']) || '').trim();
  if (!got || got !== want) return null;
  return { id: 'admin-token', token: '', name: 'Admin', role: 'admin', staff: true, viaToken: true };
}

/** 선생님·관리자 계정, 또는 관리자 토큰. Supabase 를 부르기 전에 토큰부터 본다. */
async function staffOrToken(req) {
  const byTok = byAdminToken(req);
  if (byTok) return byTok;
  return staffOf(req);
}

module.exports = {
  SUPABASE_URL, SUPABASE_ANON,
  PROVIDERS, FALLBACK,
  env, listProviders, pickDefault, resolve, parseJSON,
  flatten, isVerbatim,
  json, cors, readBody, whoIs, staffOf, adminToken, byAdminToken, staffOrToken,
  STT_DEFAULT_MODEL, sttModel, sttReady, audioExt, transcribe
};
