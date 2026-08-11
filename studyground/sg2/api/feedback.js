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
 * 프로바이더 목록·모델 고르기·JSON 파싱은 _llm.js 에 있다(/api/score 와 공유).
 * 이 파일에 남은 것은 "무엇을 물어볼지" 하나뿐이다.
 *
 * 점수는 여기서 나오지 않는다. 코멘트만 쓴다 — 채점은 /api/score 의 몫이다.
 *
 * 계약
 *   GET  /api/feedback            헤더 Authorization: Bearer <supabase access token>
 *        → { providers:[{id,label,ready,why,models:[…],default}] }
 *   POST /api/feedback { provider?, model?, lang?, attempt:{…} }
 *        → { scope 별 코멘트 } — 아래 SCHEMA 참고
 */

const LLM = require('./_llm.js');

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
- Scores you are given are TOEFL 1-6 band scores (1.0 lowest, 6.0 highest, 0.5 steps).
  Quote them as bands ("Band 4.5"), never as percentages or /30 scores.
- "questions": only for items given in wrong_questions and open_answers, at most 25 entries,
  each keyed by the exact question_id you were given. Skip the rest.`;

module.exports = async function handler(req, res) {
  if (LLM.cors(req, res)) return;

  const staff = await LLM.staffOf(req);
  if (!staff) return LLM.json(res, 401, { error: 'Teacher or administrator sign-in is required.' });

  if (req.method === 'GET') return LLM.json(res, 200, { providers: await LLM.listProviders() });
  if (req.method !== 'POST') return LLM.json(res, 405, { error: 'GET or POST only.' });

  const body = await LLM.readBody(req);
  if (!body) return LLM.json(res, 400, { error: 'Malformed JSON body.' });

  const picked = LLM.resolve(body.provider);
  if (!picked) return LLM.json(res, 400, { error: 'Unknown provider "' + (body.provider || '') + '".' });
  const { id, P } = picked;
  const key = P.key();
  if (!key) return LLM.json(res, 503, { error: P.label + ' is not configured on the server.' });

  const model = String(body.model || '').trim() || P.def();
  const lang = body.lang === 'ko' ? 'ko' : 'en';
  const attempt = body.attempt || {};

  const user =
    (lang === 'ko' ? 'Write every comment in Korean.\n' : 'Write every comment in English.\n') +
    SCHEMA + '\n\nScored attempt:\n' + JSON.stringify(attempt);

  let out;
  try {
    out = await P.chat(key, model, SYSTEM, user);
  } catch (e) {
    return LLM.json(res, 502, { error: String(e.message || e) });
  }
  const parsed = LLM.parseJSON(out && out.text);
  if (!parsed) return LLM.json(res, 502, { error: 'The model did not return usable JSON.' });

  return LLM.json(res, 200, {
    provider: id, model, lang,
    usage: (out && out.usage) || {},
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : []
  });
};
