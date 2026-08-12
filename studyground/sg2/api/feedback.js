/* SMEAG StudyGround — /api/feedback : 채점 결과 → 리뷰(총평 · 문항별 · 학습 계획).
 *
 * 점수는 여기서 나오지 않는다. 채점은 /api/score(산출형 0~5)와 브라우저(객관식 O/X)의
 * 몫이고, 이 함수는 **이미 매겨진 점수를 읽어 말로 옮긴다**. 그래서 이 함수가 실패해도
 * 성적은 멀쩡하다 — 학생이 잃는 것은 설명뿐이다.
 *
 * 언제 도는가
 *   제출이 끝나고 인터넷이 있으면 응시 기기가 그 자리에서 부른다(exam-shell.js).
 *   오프라인 응시라 그때 못 돌았으면, 학생이 나중에 리뷰 화면을 여는 순간 돈다
 *   (review.html). 두 자리 다 같은 계약을 쓴다.
 *
 * 왜 학생이 부를 수 있게 되었나
 *   예전에는 선생님만 부를 수 있었다. 그러면 선생님이 눌러 주기 전까지 학생의 리뷰
 *   화면에는 점수만 있고 "왜" 가 없다. 시험 직후가 가장 많이 배우는 자리인데 그때
 *   아무 말도 없는 것이 가장 나쁘다. 다만 **자기 응시만** 부를 수 있다.
 *
 * 무엇을 믿는가
 *   /api/score 와 같은 규칙이다. 채점 근거가 되는 것(답안 · 과제 점수 · 전사문)은
 *   언제나 서버가 sg_results · sg_task_scores 에서 직접 읽는다. 본문으로 받는 것은
 *   문항 메타데이터(어느 문항인지 · 문제문 · 정답)뿐이다 — 이건 콘텐츠 팩이 브라우저에만
 *   있어서 서버가 알 길이 없기 때문이고, 위조해도 점수는 1점도 움직이지 않는다.
 *   학생이 보낸 '내 답' 은 쓰지 않는다. DB 의 답안으로 덮어 쓴 뒤 모델에 보낸다.
 *
 * 어디에 남는가
 *   sg_comments 에 source='ai' 로. 학생은 이 표에 못 쓴다(RLS) — 그래서 여기서
 *   service_role 로 쓴다. 자리는 셋이다.
 *     scope='overall'|'reading'|… , question_id=''      총평
 *     scope='question'            , question_id='R1-7'  문항별
 *     scope='plan'                , question_id=''      학습 계획(전문은 data 칸)
 *   같은 자리에 두 번 쓰면 덮인다(sg_comments_target_key). 그래서 다시 불러도
 *   리뷰가 쌓이지 않고 최신 한 벌만 남는다.
 *
 * 두 번 사지 않는다
 *   이미 AI 리뷰가 있는 응시는 모델을 부르지 않고 'already_reviewed' 로 돌아간다.
 *   force 는 선생님만 쓴다 — 학생이 새로고침할 때마다 다시 사면 안 된다.
 *
 * 계약
 *   GET  /api/feedback   → { providers:[{id,label,ready,why,models,default}] }
 *   POST /api/feedback
 *     헤더 Authorization: Bearer <supabase access token>
 *     { session, owner?, provider?, model?, lang?, force?,
 *       questions:[{ question_id, section, kind, no?, prompt?, correct?, ok }] }
 *     → { session, owner, provider, model, lang, sections, questions, plan, saved }
 *     → { skipped:'already_reviewed' }  이미 리뷰가 있고 force 가 아닐 때
 *
 *   owner 는 staff 만 남의 것을 지정할 수 있다.
 */

'use strict';

const LLM = require('./_llm.js');
const BAND = require('../assets/sg-band.js');   // UMD — 브라우저와 같은 환산표를 쓴다

const SERVICE_KEY = LLM.env('SUPABASE_SERVICE_ROLE_KEY');

/* 모델에 실어 보낼 상한. 틀린 문항 40개면 할 말은 충분하고, 그 위는 비용만 는다. */
const MAX_WRONG = 40;
const MAX_OPEN = 10;

const SYSTEM =
  'You are an ESL assessment specialist at SMEAG writing a score report for one TOEFL-style ' +
  'mock test. You receive one scored attempt as JSON: band scores, section detail, the ' +
  'questions the student missed, and the AI rubric scores for the productive tasks. ' +
  'Be concrete and reference the numbers you are given. Never invent a score, a question, ' +
  'or a fact that is not in the JSON. Speak to the student directly, plainly, and kindly. ' +
  'Your job is not to praise — it is to make the next two weeks of study obvious. ' +
  'Return only JSON.';

const SCHEMA = `Return ONLY a JSON object, no prose, in this exact shape:
{"sections":[{"scope":"reading","summary":"...","strengths":["..."],"improvements":["..."],
              "issues":[{"issue":"...","evidence":"...","fix":"..."}]},
             {"scope":"listening", ...},{"scope":"writing", ...},{"scope":"speaking", ...},
             {"scope":"overall", ...}],
 "questions":[{"question_id":"R1-7","problem":"what exactly went wrong in this answer",
               "cause":"the underlying gap it points to","solution":"what to do instead, step by step"}],
 "plan":{"summary":"one short paragraph: where this student stands and what changes it",
         "focus":[{"skill":"listening","why":"...","target":"..."}],
         "study":[{"title":"...","detail":"...","minutes":30,"how_often":"daily"}],
         "weeks":[{"week":1,"goal":"...","tasks":["...","..."]}],
         "next_test":"what to do differently on the next mock test"}}
Rules:
- Every scope in "sections" appears exactly once, in that order.
- 2-3 sentences per summary; 1-3 short strings each for strengths and improvements.
- Scores are TOEFL band scores from 1.0 (lowest) to 6.0 (highest), in 0.5 steps.
  Quote them as bands ("Band 4.5"), never as percentages or /30 scores. A section whose
  band is null has not been scored yet — say so plainly and do not guess it.
- Productive tasks (Writing, Speaking) also carry a 0-5 rubric score from the official ETS
  scoring guide, with the rater's own comments. Use those comments; do not contradict them.
- "issues": 1-3 per section, and this is where the report earns its keep. Each one is a
  named, concrete problem — not a restatement of the score.
  * "issue": the problem in one clause ("misses negation in short conversations"), never
    a grade word ("weak listening") and never a generic label ("vocabulary").
  * "evidence": the proof from the JSON — quote the question_id(s), the student's own
    wrong answer, or the rater's comment. If you cannot point at evidence, drop the issue.
  * "fix": what the student does about it, specific enough to start today.
  A section that was not scored gets one issue explaining what is missing and how to get
  it scored next time, and nothing else.
- "questions": only for items given in wrong_questions and open_answers, at most 25 entries,
  each keyed by the exact question_id you were given. Skip the ones with nothing to say.
  * "problem": what is wrong with THIS answer. Compare the student's answer to the correct
    one and name the difference ("wrote 'has went', the present perfect needs the past
    participle 'gone'"). Never write "this was incorrect" — that is already on the screen.
  * "cause": the gap behind it, so the student sees the pattern, not one unlucky item.
  * "solution": the repair. Give the rule, the correct answer restated in a full sentence,
    or the reading/listening move that would have caught it. One or two sentences.
  * For an open answer (writing/speaking), "problem" points at real sentences from the
    student's own text and "solution" rewrites or restructures one of them as a model.
- "plan" is the point of this report. It must follow from the weakest sections in the JSON,
  name the skill it fixes, and be doable by one student alone with no teacher:
  * "focus": 1-3 skills, weakest first. "target" is the band to aim for next time.
  * "study": 3-6 concrete drills. "detail" says exactly what to do, not "practice more".
    "minutes" is an integer. "how_often" is plain English ("daily", "3x a week").
  * "weeks": exactly 2 entries (week 1 and week 2), 2-4 tasks each, built from "study".
- Do not recommend a paid product, a website, or an app by name.`;

/* ── Supabase (service_role) ─────────────────────────────────────────────── */

function svcHeaders(extra) {
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function svc(path, init) {
  const r = await fetch(LLM.SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, init, {
    headers: svcHeaders((init && init.headers) || {})
  }));
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text().catch(() => '')));
  const text = await r.text().catch(() => '');
  return text ? JSON.parse(text) : null;
}

/* ── 답안 꺼내기 ─────────────────────────────────────────────────────────── */

/** sg_results.answers 한 칸 → 사람이 읽는 글. 모양이 여러 가지라 여기서 흡수한다.
 *  녹음(idb:…)은 글이 아니다 — 스피킹의 '답' 은 전사문이라 그쪽에서 온다. */
function answerText(rec) {
  if (rec === null || rec === undefined) return '';
  if (typeof rec === 'string') return rec.indexOf('idb:') === 0 ? '' : rec.trim();
  if (typeof rec !== 'object') return String(rec).trim();
  if (rec.notSubmit) return '';
  if (typeof rec.text === 'string' && rec.text.trim()) return rec.text.trim();
  const v = rec.v;
  if (typeof v === 'string') return v.indexOf('idb:') === 0 ? '' : v.trim();
  if (Array.isArray(v)) return v.filter(Boolean).join(' ').trim();
  return '';
}

function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }

/* ── 모델에 보낼 응시 한 건 ──────────────────────────────────────────────── */

/**
 * 점수는 DB 에서, 문항 본문은 본문(questions)에서. 학생의 답은 언제나 DB 에서.
 * 신원(이름·학번·이메일)은 넣지 않는다 — 리뷰를 쓰는 데 필요하지 않다.
 */
function attemptFor(row, taskRows, meta) {
  const view = BAND.of(row, taskRows);
  const answers = row.answers || {};

  const sections = {};
  BAND.SKILLS.forEach(function (skill) {
    const s = view.sections[skill] || {};
    sections[skill] = {
      band: s.band,
      status: s.status,                       // scored | draft | final | pending
      detail: s.detail || null                // R·L 은 {correct,total,scaled}, W·S 는 {tasks,confirmed}
    };
  });

  /* 산출형 과제는 점수만으로는 할 말이 없다. 채점자(모델)가 남긴 근거와, 스피킹이면
     무엇으로 들렸는지(전사문)까지 실어 보낸다 — 리뷰가 채점과 어긋나지 않으려면
     같은 글을 보고 써야 한다. */
  const tasks = (taskRows || []).map(function (t) {
    const rub = t.ai_rubric || {};
    const final = (t.teacher_score === null || t.teacher_score === undefined)
      ? t.ai_score : t.teacher_score;
    return {
      question_id: t.question_id,
      skill: t.skill,
      task_kind: t.task_kind,
      score: final === null || final === undefined ? null : Number(final),
      max: BAND.TASK_MAX,
      confirmed: !!t.confirmed_at,
      rater_summary: clip(rub.summary, 600),
      criteria: (rub.criteria || []).map(function (c) {
        return { criterion: c.criterion, comment: clip(c.comment, 300) };
      }),
      response: t.skill === 'speaking'
        ? clip(t.transcript, 2500)
        : clip(answerText(answers[t.question_id]), 3000)
    };
  });

  /* 틀린 문항. 문제문·정답은 콘텐츠 팩(브라우저)에서 오고, '내 답' 은 DB 에서 온다.
     Build a Sentence 는 빼고 보낸다 — 리뷰 화면이 이미 빈칸마다 정답을 펴 준다. */
  const wrong = [], open = [];
  (meta.questions || []).forEach(function (q) {
    if (!q || !q.question_id || q.kind === 'build') return;
    const given = answerText(answers[q.question_id]);
    if (q.ok === false && wrong.length < MAX_WRONG) {
      wrong.push({
        question_id: q.question_id, no: q.no, section: q.section, kind: q.kind,
        prompt: clip(q.prompt, 200),
        given: clip(given, 200),
        correct: clip(q.correct, 200)
      });
    } else if (q.ok === null && given && open.length < MAX_OPEN) {
      open.push({
        question_id: q.question_id, section: q.section, kind: q.kind,
        prompt: clip(q.prompt, 300),
        answer: clip(given, 3000)
      });
    }
  });

  return {
    set_code: row.set_code || '',
    submitted_at: row.submitted_at || '',
    scale: 'TOEFL band 1.0-6.0',
    overall_band: view.overall,
    cefr: view.cefr,
    includes_unconfirmed_ai_draft: !!view.draft,
    sections: sections,
    productive_tasks: tasks,
    wrong_questions: wrong,
    open_answers: open
  };
}

/* ── sg_comments 로 옮겨 적기 ────────────────────────────────────────────── */

/* data 칸(구조가 있는 것 — 영역별 문제점, 문항의 문제점·해결책, 학습 계획)은
   supabase/ai_review_plan.sql 을 돌린 DB 에만 있다. 그 칸이 없으면 보내는 순간
   PostgREST 가 400 을 내고 배열 전체가 저장에 실패하므로, put() 이 한 번 더
   data 를 떼고 넣는다 — 구조는 잃어도 글은 남는다(body 에 다 들어 있다). */
function commentRow(owner, session, scope, questionId, model, lang, body, extra) {
  return Object.assign({
    owner: owner, session: session,
    scope: scope, question_id: questionId || '',
    source: 'ai', author: null, author_name: '',
    model: model || '', lang: lang || 'en',
    body: String(body || ''),
    strengths: [], improvements: []
  }, extra || {});
}

function strList(arr, n) {
  return (Array.isArray(arr) ? arr : []).slice(0, n)
    .map(function (x) { return clip(x, 400); })
    .filter(Boolean);
}

const SCOPES = { reading: 1, listening: 1, writing: 1, speaking: 1, overall: 1 };

/** 문제점·원인·해결책을 한 문단으로 잇는다.
 *
 * 화면은 data 칸의 세 조각을 따로 그리지만, body 는 그 칸을 못 읽는 자리(인쇄,
 * 예전 리뷰 화면, data 칸 없는 DB)에서 남는 유일한 글이다. 거기서도 "무엇이
 * 잘못됐고 어떻게 고치는가" 가 온전히 읽혀야 한다. */
function joinText() {
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const s = String(arguments[i] == null ? '' : arguments[i]).trim();
    if (s) parts.push(/[.!?]$/.test(s) ? s : s + '.');
  }
  return parts.join(' ');
}

/** 근거 없는 문제 제기는 버린다 — 화면에 남는 것은 짚을 수 있는 것뿐이다. */
function issueList(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 3).map(function (x) {
    if (!x || !x.issue) return null;
    return {
      issue: clip(x.issue, 300),
      evidence: clip(x.evidence, 500),
      fix: clip(x.fix, 600)
    };
  }).filter(Boolean);
}

/** sg_comments 에 넣는다. 같은 자리는 덮어쓴다 — 리뷰는 쌓이는 것이 아니다.
 *
 * data 칸이 없는 DB 라면 그 칸만 떼고 한 번 더 넣는다. 구조(문제점 목록·계획표)는
 * 잃지만 글은 남는다 — body 에 문제점·원인·해결책이 이미 한 문단으로 들어 있다.
 * 여기서 포기하면 리뷰가 통째로 사라지는데, 그건 훨씬 나쁘다.
 * 돌려주는 값은 실제로 넣은 행 수다. */
async function putComments(rows) {
  if (!rows || !rows.length) return 0;
  const post = function (payload) {
    return svc('sg_comments?on_conflict=owner,session,source,scope,question_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload)
    });
  };
  try {
    await post(rows);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // PGRST204: "Could not find the 'data' column of 'sg_comments' in the schema cache"
    if (!/PGRST204/.test(msg) && !/'data'/.test(msg)) throw e;
    await post(rows.map(function (r) {
      const copy = Object.assign({}, r);
      delete copy.data;
      return copy;
    }));
  }
  return rows.length;
}

/** { rows, plan } — 총평·문항별과 학습 계획을 갈라 준다(저장도 따로 한다). */
function rowsFor(owner, session, model, lang, parsed) {
  const out = [];

  (parsed.sections || []).forEach(function (s) {
    if (!s || !SCOPES[s.scope]) return;
    const issues = issueList(s.issues);
    out.push(commentRow(owner, session, s.scope, '', model, lang, clip(s.summary, 2000), {
      strengths: strList(s.strengths, 3),
      /* 문제점의 '고치는 법' 은 보완할 점이기도 하다. data 칸을 못 그리는 자리에서도
         최소한 무엇을 해야 하는지는 남게 겹쳐 둔다 — 계획 행과 같은 이유다. */
      improvements: strList(
        (s.improvements || []).concat(issues.map(function (x) { return x.fix; })), 4),
      data: issues.length ? { issues: issues } : {}
    }));
  });

  (parsed.questions || []).slice(0, 25).forEach(function (q) {
    if (!q || !q.question_id) return;
    const problem = clip(q.problem, 800);
    const cause = clip(q.cause, 500);
    const solution = clip(q.solution, 800);
    const body = clip(joinText(problem, cause, solution) || q.body, 2000);
    if (!body) return;
    out.push(commentRow(owner, session, 'question', String(q.question_id),
                        model, lang, body, {
      data: (problem || solution)
        ? { problem: problem, cause: cause, solution: solution }
        : {}
    }));
  });

  const plan = parsed.plan;
  const planRow = (plan && typeof plan === 'object')
    ? commentRow(owner, session, 'plan', '', model, lang, clip(plan.summary, 2000), {
        /* 계획 안의 '해야 할 일' 은 개선점 목록이기도 하다. 화면이 계획 카드를 못
           그리는 자리(인쇄·data 칸 없는 DB)에서도 이 줄들은 보이게 겹쳐 둔다. */
        improvements: strList((plan.study || []).map(function (x) { return x && x.title; }), 6),
        data: plan
      })
    : null;

  return { rows: out, plan: planRow };
}

/* ── handler ─────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (LLM.cors(req, res)) return;

  const me = await LLM.whoIs(req);
  if (!me) return LLM.json(res, 401, { error: 'Sign-in is required.' });

  if (req.method === 'GET') return LLM.json(res, 200, { providers: await LLM.listProviders() });
  if (req.method !== 'POST') return LLM.json(res, 405, { error: 'GET or POST only.' });

  if (!SERVICE_KEY) {
    return LLM.json(res, 503, {
      error: 'AI review is not configured: SUPABASE_SERVICE_ROLE_KEY is not set on the server.'
    });
  }

  const body = await LLM.readBody(req);
  if (!body) return LLM.json(res, 400, { error: 'Malformed JSON body.' });

  const session = String(body.session || '').trim();
  if (!session) return LLM.json(res, 400, { error: '"session" is required.' });

  // 학생은 자기 응시만. staff 만 남의 응시를 지정할 수 있다.
  const owner = (me.staff && body.owner) ? String(body.owner) : me.id;
  const lang = body.lang === 'ko' ? 'ko' : 'en';
  const force = !!body.force && me.staff;      // 다시 사는 것은 선생님만

  const picked = LLM.resolve(body.provider);
  if (!picked) return LLM.json(res, 400, { error: 'Unknown provider "' + (body.provider || '') + '".' });
  const { id: providerId, P } = picked;
  const key = P.key();
  if (!key) return LLM.json(res, 503, { error: P.label + ' is not configured on the server.' });
  const model = String(body.model || '').trim() || P.def();

  /* 1) 이미 리뷰가 있으면 모델을 부르지 않는다.
   *
   * "계획 행이 있는가" 가 아니라 "AI 코멘트가 하나라도 있는가" 로 본다. 계획 저장이
   * 실패하는 DB(아래 SQL 미적용)에서 계획만 찾으면 학생이 화면을 열 때마다 리뷰를
   * 새로 사게 된다 — 저장되지 않을 것을 매번 사는 셈이다.
   * 그래서 옛 방식으로 총평만 받아 둔 답안지에는 계획이 저절로 붙지 않는다.
   * 그건 선생님이 Generate(force)로 다시 부른다. */
  if (!force) {
    let had = [];
    try {
      had = await svc('sg_comments?select=id&source=eq.ai&owner=eq.' +
        encodeURIComponent(owner) + '&session=eq.' + encodeURIComponent(session) + '&limit=1') || [];
    } catch (e) { had = []; }
    if (had.length) return LLM.json(res, 200, { session: session, owner: owner, skipped: 'already_reviewed' });
  }

  // 2) 채점 결과를 서버가 직접 읽는다.
  let row, taskRows = [];
  try {
    const rows = await svc('sg_results?select=answers,set_code,submitted_at,by_section,score,total,scale&owner=eq.' +
      encodeURIComponent(owner) + '&session=eq.' + encodeURIComponent(session));
    row = rows && rows[0];
  } catch (e) {
    return LLM.json(res, 502, { error: 'Could not read the attempt: ' + String(e.message || e) });
  }
  if (!row) return LLM.json(res, 404, { error: 'No such attempt for this student.' });

  try {
    taskRows = await svc('sg_task_scores?select=question_id,skill,task_kind,ai_score,ai_rubric,' +
      'teacher_score,teacher_note,confirmed_at,transcript&owner=' +
      'eq.' + encodeURIComponent(owner) + '&session=eq.' + encodeURIComponent(session)) || [];
  } catch (e) { taskRows = []; }

  const attempt = attemptFor(row, taskRows, { questions: body.questions });

  /* 아직 아무것도 채점되지 않았으면 쓸 말이 없다. 여기서 억지로 리뷰를 쓰면
     "채점을 기다리는 중" 인 시험에 대해 지어낸 총평이 남는다. */
  if (attempt.overall_band === null && !attempt.wrong_questions.length) {
    return LLM.json(res, 200, { session: session, owner: owner, skipped: 'not_scored_yet' });
  }

  // 3) 리뷰를 쓴다.
  const user =
    (lang === 'ko'
      ? 'Write every summary, comment and plan in Korean. Keep skill names in English.\n'
      : 'Write every summary, comment and plan in English.\n') +
    SCHEMA + '\n\nScored attempt:\n' + JSON.stringify(attempt);

  let out;
  try {
    out = await P.chat(key, model, SYSTEM, user);
  } catch (e) {
    return LLM.json(res, 502, { error: String(e.message || e) });
  }
  const parsed = LLM.parseJSON(out && out.text);
  if (!parsed) return LLM.json(res, 502, { error: 'The model did not return usable JSON.' });

  /* 4) 남긴다. 같은 자리는 덮어쓴다 — 리뷰는 쌓이는 것이 아니라 최신 한 벌이다.
   *
   * 총평·문항별과 학습 계획을 **따로** 쓴다. 계획 행은 새 scope('plan')와 새 칸(data)을
   * 쓰는데, supabase/ai_review_plan.sql 을 아직 안 돌린 DB 에서는 그 한 행 때문에
   * PostgREST 가 배열 전체를 400 으로 되돌려보낸다. 그러면 있는 기능(총평·해설)까지
   * 새 기능을 기다리며 함께 죽는다. */
  const writes = rowsFor(owner, session, model, lang, parsed);
  let saved = 0, saveError = '';

  async function put(rows) {
    saved += await putComments(rows);
  }

  try { await put(writes.rows); }
  catch (e) { saveError = String(e.message || e); }

  if (writes.plan) {
    /* 계획만 실패했으면 그렇게 말한다. 조용히 넘기면 화면에는 총평만 뜨고, 계획이
       왜 없는지는 아무도 모른다 — 대개 위의 SQL 을 안 돌린 것이다. */
    try { await put([writes.plan]); }
    catch (e) {
      saveError = (saveError ? saveError + ' · ' : '') +
        'the study plan could not be saved (run supabase/ai_review_plan.sql): ' +
        String(e.message || e);
    }
  }

  return LLM.json(res, 200, {
    session: session,
    owner: owner,
    provider: providerId,
    model: model,
    lang: lang,
    usage: (out && out.usage) || {},
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    plan: parsed.plan || null,
    saved: saved,
    saveError: saveError || undefined
  });
};

/* 테스트와 tools/ai_review_run.js(시험 끝난 뒤 한 반을 통째로 돌리는 자리)가 쓴다.
 * 프롬프트는 여기 한 벌뿐이다 — 화면에서 부른 리뷰와 배치로 부른 리뷰가 다른 글이면
 * "AI 리뷰" 라는 말이 두 가지를 가리키게 된다. */
module.exports.attemptFor = attemptFor;
module.exports.rowsFor = rowsFor;
module.exports.putComments = putComments;
module.exports.SYSTEM = SYSTEM;
module.exports.SCHEMA = SCHEMA;

/* 리뷰 한 벌은 모델 호출 한 번이지만, 응시 하나를 통째로 읽고 쓰는 긴 프롬프트다.
   기본 상한(10초)으로는 끝나지 않는다. */
module.exports.config = { maxDuration: 60 };
