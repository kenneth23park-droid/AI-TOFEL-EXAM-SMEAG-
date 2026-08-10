/* SMEAG StudyGround — /api/feedback : 채점 결과 → 코멘트(총평 · 문항별).
 *
 * 왜 서버가 필요한가
 *   정적 사이트라 프런트에 LLM 키를 두면 그대로 공개된다. 키는 Vercel 환경변수에만
 *   두고, 브라우저는 이 함수에 "채점 결과 요약"만 보낸다. 답안 원문은 보내되 이름·학번
 *   같은 신원은 보내지 않는다 — 코멘트를 쓰는 데 필요하지 않기 때문이다.
 *
 * 누가 부를 수 있나
 *   /api/tts 처럼 공용 토큰을 두지 않는다. 호출자의 Supabase 로그인 토큰을 그대로 받아
 *   (1) 진짜 로그인인지 auth/v1/user 로 확인하고 (2) sg_profiles.role 이 teacher·admin
 *   인지 본다. 학생 토큰으로는 401 이다. 서비스 키는 쓰지 않는다.
 *
 * 프로바이더 — 키가 있는 쪽만 목록에 나온다.
 *   openai      OPENAI_API_KEY      (OPENAI_MODEL 이 기본값)
 *   anthropic   ANTHROPIC_API_KEY   (ANTHROPIC_MODEL 이 기본값)
 * 모델은 화면에서 고른다. 목록은 프로바이더의 /models 를 실제로 물어보고, 못 물어보면
 * 아래 FALLBACK 로 떨어진다 — 새 모델이 나와도 이 파일을 고칠 필요가 없다.
 *
 * 계약
 *   GET  /api/feedback            헤더 Authorization: Bearer <supabase access token>
 *        → { providers:[{id,label,ready,why,models:[…],default}] }
 *   POST /api/feedback { provider?, model?, lang?, attempt:{…} }
 *        → { scope 별 코멘트 } — 아래 SCHEMA 참고
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
        // 글을 쓰는 모델만 남긴다 — 임베딩·이미지·음성은 코멘트를 못 쓴다.
        .filter((id) => /^(gpt-|o[0-9])/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embed)/.test(id))
        .sort();
    },
    async chat(key, model, system, user) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' }
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'OpenAI ' + r.status);
      return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
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
    async chat(key, model, system, user) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system,
          messages: [{ role: 'user', content: user }]
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic ' + r.status);
      const part = (j.content || []).find((c) => c.type === 'text');
      return part && part.text;
    }
  }
};

/* 프롬프트 — studyground/app/scoring/llm.py 와 같은 성격의 보고서를 쓴다.
 * 점수를 지어내지 말 것, 받은 숫자를 그대로 인용할 것. */
const SYSTEM =
  'You are an ESL assessment specialist writing score-report feedback for a TOEFL-style ' +
  'test at SMEAG. You receive one scored attempt as JSON. Be concrete and reference the ' +
  'numbers you are given. Never invent scores or facts that are not in the JSON. ' +
  'Speak to the student directly, plainly, and kindly.';

const SCHEMA = `Return ONLY a JSON object, no prose, in this exact shape:
{"sections":[{"scope":"reading","summary":"...","strengths":["..."],"improvements":["..."]},
             {"scope":"listening", ...},{"scope":"writing", ...},{"scope":"speaking", ...},
             {"scope":"overall", ...}],
 "questions":[{"question_id":"R1-7","body":"one or two sentences on why this was missed and what to do"}]}
Rules:
- Every scope in "sections" appears exactly once, in that order.
- 1-2 sentences per summary; 1-2 short strings each for strengths and improvements.
- For a section with no auto-score (writing, speaking), comment on the submitted answer itself.
- "questions": only for items given in wrong_questions and open_answers, at most 25 entries,
  each keyed by the exact question_id you were given. Skip the rest.`;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** 호출자가 선생님·관리자인지 확인한다. 아니면 null. */
async function staffOf(req) {
  const auth = req.headers.authorization || '';
  const tok = auth.replace(/^Bearer\s+/i, '').trim();
  if (!tok) return null;
  const head = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + tok };

  const who = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: head });
  if (!who.ok) return null;
  const user = await who.json().catch(() => null);
  if (!user || !user.id) return null;

  // RLS 는 본인 프로필을 읽게 해 준다 — 서비스 키가 필요 없는 이유다.
  const pr = await fetch(
    SUPABASE_URL + '/rest/v1/sg_profiles?select=role,is_admin,name&id=eq.' + encodeURIComponent(user.id),
    { headers: head }
  );
  if (!pr.ok) return null;
  const rows = await pr.json().catch(() => []);
  const p = rows && rows[0];
  const role = (p && p.role) || (p && p.is_admin ? 'admin' : 'student');
  if (role !== 'teacher' && role !== 'admin') return null;
  return { id: user.id, name: (p && p.name) || '', role };
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
    const def = P.def();
    if (def && models.indexOf(def) < 0) models.unshift(def);
    out.push({ id, label: P.label, ready: true, why: '', models, default: def || models[0] || '' });
  }
  return out;
}

/** 모델이 ```json 울타리를 씌워 보내도 받아낸다. */
function parseJSON(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  const staff = await staffOf(req);
  if (!staff) return json(res, 401, { error: 'Teacher or administrator sign-in is required.' });

  if (req.method === 'GET') return json(res, 200, { providers: await listProviders() });
  if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST only.' });

  const body = await readBody(req);
  if (!body) return json(res, 400, { error: 'Malformed JSON body.' });

  const id = String(body.provider || '') || (env('OPENAI_API_KEY') ? 'openai' : 'anthropic');
  const P = PROVIDERS[id];
  if (!P) return json(res, 400, { error: 'Unknown provider "' + id + '".' });
  const key = P.key();
  if (!key) return json(res, 503, { error: P.label + ' is not configured on the server.' });

  const model = String(body.model || '').trim() || P.def();
  const lang = body.lang === 'ko' ? 'ko' : 'en';
  const attempt = body.attempt || {};

  const user =
    (lang === 'ko' ? 'Write every comment in Korean.\n' : 'Write every comment in English.\n') +
    SCHEMA + '\n\nScored attempt:\n' + JSON.stringify(attempt);

  let text;
  try {
    text = await P.chat(key, model, SYSTEM, user);
  } catch (e) {
    return json(res, 502, { error: String(e.message || e) });
  }
  const parsed = parseJSON(text);
  if (!parsed) return json(res, 502, { error: 'The model did not return usable JSON.' });

  return json(res, 200, {
    provider: id, model, lang,
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : []
  });
};
