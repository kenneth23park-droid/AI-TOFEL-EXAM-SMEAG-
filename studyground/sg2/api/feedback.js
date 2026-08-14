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
 * 무엇을 근거로 쓰는가
 *   틀린 문항에는 그 문항이 딛고 선 원문(리딩 지문 · 리스닝 대본)이 함께 실린다.
 *   원문 없이 쓴 해설은 "정답은 B 입니다" 아니면 지어낸 근거뿐이다 — 학생이 배울
 *   것이 없다. 원문은 브라우저(콘텐츠 팩)에서 오고, 같은 지문을 쓰는 문항끼리는
 *   한 벌로 묶어 보낸다(sources).
 *   그리고 모델이 옮겨 적었다고 말한 것은 옮겨 적었는지 확인한다(verifyQuotes):
 *   학생의 말이라며 지어낸 인용은 그 해설째로 버리고, 지문 근거가 지문에 없으면
 *   그 칸만 비운다. 지어낸 근거는 없는 근거보다 나쁘다.
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
 *       questions:[{ question_id, section, kind, no?, prompt?, correct?, ok,
 *                    choices?, source?:{ kind, title, text } }] }
 *     → { session, owner, provider, model, lang, sections, questions, plan, saved,
 *         unverified? }
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

/* 지문·대본을 함께 싣는 대신 총량에 선을 둔다. SET 9 한 벌이면 3만 자 안쪽이지만,
 * 지문이 긴 세트에서 프롬프트가 끝없이 불어나면 안 된다. 선을 넘은 문항은 원문 없이
 * 간다 — 그 문항의 해설이 얕아질 뿐, 리뷰 전체가 죽지는 않는다. */
const MAX_SOURCE_CHARS = 30000;

/* 리뷰 한 벌은 총평 다섯에 문항 해설 스물다섯, 거기에 학습 계획까지다. 기본 상한
 * (2000 토큰)으로는 중간에 잘리고, 잘린 JSON 은 파싱만 실패해 리뷰가 통째로 사라진다.
 * 인용 칸이 붙으면서 길이가 더 늘었으므로 넉넉히 잡는다. */
const MAX_OUT_TOKENS = 8000;

const SYSTEM =
  'You are an ESL assessment specialist at SMEAG writing a score report for one TOEFL-style ' +
  'mock test. You receive one scored attempt as JSON: band scores, section detail, the ' +
  'questions the student missed together with the passage or listening script each one came ' +
  'from, and the AI rubric scores for the productive tasks. ' +
  'Be concrete and reference the numbers you are given. Never invent a score, a question, ' +
  'or a fact that is not in the JSON. Everything you say about this student must be traceable ' +
  'to the JSON: if you cannot point at the line that shows it, do not say it. Do not guess at ' +
  'causes the evidence does not support, and do not soften a real problem into a generality. ' +
  'Speak to the student directly, plainly, and kindly. ' +
  'Your job is not to praise — it is to make the next two weeks of study obvious. ' +
  'Return only JSON.';

/* 리뷰도 같은 응시에 대해 매번 다른 글이 될 이유가 없다. 온도를 낮게 못 박는다. */
const TEMPERATURE = 0.2;

const SCHEMA = `Return ONLY a JSON object, no prose, in this exact shape:
{"sections":[{"scope":"reading","summary":"...","strengths":["..."],"improvements":["..."],
              "issues":[{"issue":"...","evidence":"...","quote":"...","fix":"..."}]},
             {"scope":"listening", ...},{"scope":"writing", ...},{"scope":"speaking", ...},
             {"scope":"overall", ...}],
 "questions":[{"question_id":"R1-7","problem":"what exactly went wrong in this answer",
               "cause":"the underlying gap it points to","solution":"what to do instead, step by step",
               "quote":"the student's own words, copied exactly, or \\"\\"",
               "evidence":"the sentence from the passage or script that settles it, copied exactly, or \\"\\""}],
 "plan":{"summary":"one short paragraph: where this student stands and what changes it",
         "focus":[{"skill":"listening","why":"...","target":"..."}],
         "study":[{"title":"...","detail":"...","minutes":30,"how_often":"daily"}],
         "weeks":[{"week":1,"goal":"...","tasks":["...","..."]}],
         "next_test":"what to do differently on the next mock test"}}
Rules:
- COPIED TEXT. Two fields are quotations, not writing: "quote" (the student's own words,
  from their answer, essay or transcript) and "evidence" on a question (the sentence from
  that question's reading passage or listening script that decides the answer). Copy them
  CHARACTER FOR CHARACTER from the JSON. Do not paraphrase, tidy up the grammar, translate,
  or stitch together words from different places. Keep each under about 30 words; use "..."
  if you skip the middle. If nothing in the JSON can be copied, write "" — the server checks
  every one of these against the attempt and throws away what it cannot find, so an invented
  quote does not reach the student, it only costs the comment that carried it.
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
  * "evidence": the proof from the JSON — name the question_id(s), the student's own
    wrong answer, or the rater's comment. If you cannot point at evidence, drop the issue.
  * "quote": the student's own words that show it, copied exactly, or "". A pattern claimed
    across several questions is stronger with one real quote than with none.
  * "fix": what the student does about it, specific enough to start today.
  A section that was not scored gets one issue explaining what is missing and how to get
  it scored next time, and nothing else.
- "questions": one entry for EVERY item in wrong_questions and open_answers, in the order
  given, up to 25 entries — a missed question with no comment is the one the student will
  miss again. Key each by the exact question_id you were given. If a multiple-choice item
  gives you "choices", say what makes the correct option right and the chosen one wrong.
  * "problem": what is wrong with THIS answer. Quote the student's own answer and the
    correct one verbatim, in quotation marks, and name the difference between them
    ("wrote 'has went'; the present perfect needs the past participle 'gone'"). For a
    multiple-choice item, quote the option text, never the option number. Never write
    "this was incorrect" or "chose the wrong option" — that is already on the screen.
  * "cause": the gap behind it, so the student sees the pattern, not one unlucky item.
    Say why the answer they chose was tempting — which words in the passage or the option
    pulled them there — because that is the trap they will meet again.
  * "solution": the repair. Give the rule, the correct answer restated in a full sentence,
    or the reading/listening move that would have caught it. One or two sentences.
  * "evidence": for a question whose "source_id" points at a passage or script, copy the
    one sentence from that source that makes the correct answer correct. This is the heart
    of the explanation — the student should be able to find that sentence and see it. If
    the question has no source, write "".
  * "quote": the student's own words for an open answer, or the option they chose, copied
    exactly. "" if there is nothing to copy (a blank answer).
  * For an open answer (writing/speaking), "problem" points at real sentences from the
    student's own text and "solution" rewrites or restructures one of them as a model.
  * Do not claim the student misread or mishead something you cannot see. What you can see
    is which option they chose and what the source says; build the explanation from that.
- "plan" is the point of this report. It must follow from the weakest sections in the JSON,
  name the skill it fixes, and be doable by one student alone with no teacher:
  * "focus": 1-3 skills, weakest first. "target" is the band to aim for next time.
  * "study": 3-6 concrete drills. "detail" says exactly what to do and ends with something
    the student can hand in or check off — a rewritten paragraph, a list of 20 words with
    their own sentences, a re-answered question set. Build the drills out of material this
    student already has (the passages and recordings of this test, their own two essays,
    the questions they missed), not out of material they would have to go find.
    Never "practice more", "review grammar" or "build vocabulary" on their own.
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

/** 객관식에서 학생이 남긴 것은 보기 번호다. 리뷰가 "2번을 골랐다" 고 쓰면 학생은
 *  자기가 무엇을 골랐는지 다시 찾아봐야 한다. 보기 목록이 함께 왔으면 문장으로 편다.
 *  (보기 목록은 콘텐츠 팩에서 오므로 브라우저가 보내 준다 — 서버는 팩을 모른다.) */
function choiceText(rec, choices) {
  const raw = answerText(rec);
  if (!Array.isArray(choices) || raw === '') return raw;
  const i = Number(raw);
  return (Number.isInteger(i) && choices[i] != null) ? String(choices[i]) : raw;
}

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
      status: s.status,                       // scored | final | pending
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

  /* 틀린 문항. 문제문·정답·원문은 콘텐츠 팩(브라우저)에서 오고, '내 답' 은 DB 에서 온다.
     Build a Sentence 는 빼고 보낸다 — 리뷰 화면이 이미 빈칸마다 정답을 펴 준다. */
  const wrong = [], open = [], sources = [], seen = {};

  /* 한 지문에 문항이 대여섯 개씩 붙는다. 문항마다 지문을 실으면 같은 글이 여섯 번
     프롬프트에 들어가 돈만 나간다. 한 벌로 모으고 문항은 번호로 가리킨다. */
  let sourceChars = 0;
  function sourceId(src) {
    if (!src || !src.text) return '';
    const text = clip(src.text, 6000);
    const key = text.slice(0, 200) + '|' + text.length;
    if (seen[key]) return seen[key];
    if (sourceChars + text.length > MAX_SOURCE_CHARS) return '';   // 선을 넘으면 원문 없이 간다
    sourceChars += text.length;
    const id = 'S' + (sources.length + 1);
    seen[key] = id;
    sources.push({ id: id, kind: src.kind || 'passage', title: clip(src.title, 120), text: text });
    return id;
  }

  (meta.questions || []).forEach(function (q) {
    if (!q || !q.question_id || q.kind === 'build') return;
    const given = choiceText(answers[q.question_id], q.choices);
    if (q.ok === false && wrong.length < MAX_WRONG) {
      wrong.push({
        question_id: q.question_id, no: q.no, section: q.section, kind: q.kind,
        prompt: clip(q.prompt, 300),
        choices: Array.isArray(q.choices)
          ? q.choices.slice(0, 8).map(function (c) { return clip(c, 200); })
          : undefined,
        given: clip(given, 200),
        correct: clip(q.correct, 200),
        source_id: sourceId(q.source) || undefined
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
    sections: sections,
    productive_tasks: tasks,
    wrong_questions: wrong,
    open_answers: open,
    /* 리딩 지문·리스닝 대본. 오답 해설이 "지문의 이 문장이 답을 정한다" 고 짚으려면
       그 문장이 여기 있어야 하고, 그 인용이 진짜인지 확인할 자리도 여기다. */
    sources: sources
  };
}

/* ── 인용 검증 ───────────────────────────────────────────────────────────
 *
 * 리뷰가 "너는 이렇게 썼다", "지문에 이렇게 적혀 있다" 고 말할 때, 그 말이 사실인지는
 * 여기서 글자로 확인한다. 지어낸 인용은 학생이 자기 답안이나 지문에서 찾을 수 없는
 * 지적이고, 한 번 그런 일이 있으면 맞는 지적까지 함께 못 믿게 된다.
 *
 * 검사하는 것은 **옮겨 적은 칸**(quote · evidence)뿐이다. 설명하는 문장까지 글자로
 * 검사하면 "'gone' 을 써야 한다" 처럼 옳은 교정까지 지어낸 인용으로 몰린다 —
 * 학생 글에 없는 것이 당연한 말이기 때문이다. 그래서 칸을 갈라 두었다. */

/** 이 응시에서 인용해도 되는 글 전부. 학생이 쓴 것 + 문항이 딛고 선 원문. */
function haystackOf(attempt) {
  const parts = [];
  (attempt.productive_tasks || []).forEach(function (t) { if (t.response) parts.push(t.response); });
  (attempt.open_answers || []).forEach(function (o) { parts.push(o.answer); });
  (attempt.wrong_questions || []).forEach(function (w) {
    parts.push(w.given, w.correct, w.prompt);
    (w.choices || []).forEach(function (c) { parts.push(c); });
  });
  (attempt.sources || []).forEach(function (s) { parts.push(s.text); });
  return parts.filter(Boolean).join('\n');
}

/** 학생이 실제로 쓴 말만. "너는 이렇게 썼다" 는 지문에서 확인해 줄 수 없다. */
function studentTextOf(attempt) {
  const parts = [];
  (attempt.productive_tasks || []).forEach(function (t) { if (t.response) parts.push(t.response); });
  (attempt.open_answers || []).forEach(function (o) { parts.push(o.answer); });
  (attempt.wrong_questions || []).forEach(function (w) { parts.push(w.given); });
  return parts.filter(Boolean).join('\n');
}

/**
 * 지어낸 인용을 걷어 낸다. 원본을 고치지 않고 새 객체를 돌려준다.
 *
 * 무엇을 지우고 무엇을 남기는가 — 두 가지 잘못을 갈라서 다룬다.
 *   지어낸 말(응시 어디에도 없는 문장)
 *     문항 해설이면 **통째로 버린다**. 학생이 쓰지도 않은 말을 인용해 놓고 그 위에
 *     세운 설명은 고칠 곳을 엉뚱한 데로 가리킨다. 영역 총평의 문제점(issue)도 버린다 —
 *     근거 없는 문제 제기다.
 *   자리를 잘못 짚은 말(응시에는 있지만 학생이 쓴 말은 아닌 것 — 지문 문장, 정답 보기)
 *     인용 칸만 비우고 설명은 남긴다. "네가 이렇게 썼다" 가 틀린 것이지, 지적이
 *     틀렸다고 밝혀진 것은 아니다.
 *   - evidence 가 지문에 없으면 그 칸만 비운다. 같은 이유다.
 *
 * @returns {{ parsed:object, unverified:{questions:number,evidence:number,issues:number} }}
 */
function verifyQuotes(parsed, attempt) {
  const hay = haystackOf(attempt);
  const mine = studentTextOf(attempt);
  const byId = {};
  (attempt.sources || []).forEach(function (s) { byId[s.id] = s.text; });
  const srcOf = {};
  (attempt.wrong_questions || []).forEach(function (w) {
    srcOf[w.question_id] = w.source_id ? (byId[w.source_id] || '') : '';
  });

  const bad = { questions: 0, misquoted: 0, evidence: 0, issues: 0 };

  /* '학생의 말' 인가 · 이 응시 안의 글이기는 한가 · 아무 데도 없는가. */
  function judge(quote) {
    if (LLM.isVerbatim(quote, mine)) return 'mine';
    if (LLM.isVerbatim(quote, hay)) return 'misplaced';
    return 'invented';
  }

  const sections = (parsed.sections || []).map(function (s) {
    if (!s || !Array.isArray(s.issues)) return s;
    const kept = [];
    s.issues.forEach(function (x) {
      const q = x && String(x.quote || '').trim();
      if (!q) { kept.push(x); return; }          // 인용이 없는 문제 제기는 원래 있던 것이다
      const verdict = judge(q);
      if (verdict === 'mine') { kept.push(x); return; }
      if (verdict === 'invented') { bad.issues++; return; }
      bad.misquoted++;
      kept.push(Object.assign({}, x, { quote: '' }));
    });
    return Object.assign({}, s, { issues: kept });
  });

  const questions = (parsed.questions || []).map(function (q) {
    const quote = q && String(q.quote || '').trim();
    if (!quote) return q;
    /* 객관식이면 고른 보기가 곧 '내 말' 이라 mine 에 들어 있고, 서술형이면 답안 전문이
       들어 있다. 지문 문장이나 정답 보기를 '내 말' 이라 붙여 온 것은 자리를 잘못 짚은
       것이라 인용만 떼고, 아무 데도 없는 문장은 지어낸 것이라 해설째 버린다. */
    const verdict = judge(quote);
    if (verdict === 'mine') return q;
    if (verdict === 'invented') { bad.questions++; return null; }
    bad.misquoted++;
    return Object.assign({}, q, { quote: '' });
  }).filter(Boolean).map(function (q) {
    const ev = String(q.evidence || '').trim();
    if (!ev) return q;
    const src = srcOf[q.question_id];
    /* 지문이 있으면 그 지문에서, 없으면 이 응시의 글 어디에서든 찾아 준다 — 문항에
       원문이 안 실린 세트(예전 팩)에서 근거를 통째로 잃지 않기 위한 것이다. */
    if (LLM.isVerbatim(ev, src || hay)) return q;
    bad.evidence++;
    return Object.assign({}, q, { evidence: '' });
  });

  return {
    parsed: Object.assign({}, parsed, { sections: sections, questions: questions }),
    unverified: bad
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
      quote: clip(x.quote, 300),
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
    /* 확인된 인용은 글에도 넣는다. data 칸을 못 그리는 자리(인쇄, 예전 화면)에서
       근거만 사라지면, 남는 것은 "이래서 틀렸다" 는 단정뿐이다. */
    const quote = clip(q.quote, 300);
    const evidence = clip(q.evidence, 500);
    const body = clip(joinText(problem, cause, solution,
      quote ? 'You wrote: “' + quote + '”' : '',
      evidence ? 'The source says: “' + evidence + '”' : ''
    ) || q.body, 2000);
    if (!body) return;
    out.push(commentRow(owner, session, 'question', String(q.question_id),
                        model, lang, body, {
      data: (problem || solution)
        ? { problem: problem, cause: cause, solution: solution,
            quote: quote, evidence: evidence }
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
    out = await P.chat(key, model, SYSTEM, user,
                       { temperature: TEMPERATURE, maxTokens: MAX_OUT_TOKENS });
  } catch (e) {
    return LLM.json(res, 502, { error: String(e.message || e) });
  }
  const raw = LLM.parseJSON(out && out.text);
  if (!raw) {
    /* 잘린 JSON 은 파싱만 실패하고 이유는 안 남는다. 그 둘을 갈라 말해야 다음 사람이
       프롬프트를 의심할지 상한을 의심할지 안다. */
    return LLM.json(res, 502, {
      error: (out && out.truncated)
        ? 'The review was cut off before it finished (the model hit its output limit).'
        : 'The model did not return usable JSON.'
    });
  }

  /* 저장하기 전에 인용을 확인한다. 지어낸 인용은 학생이 자기 답안에서 찾을 수 없는
     지적이라, 남겨 두면 리뷰 전체의 신뢰를 갉아먹는다. */
  const checked = verifyQuotes(raw, attempt);
  const parsed = checked.parsed;

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
    /* 몇 개를 걷어 냈는지 숨기지 않는다. 늘 0 이 아니라면 프롬프트나 모델을 바꿀 때다. */
    unverified: (checked.unverified.questions || checked.unverified.evidence ||
                 checked.unverified.issues || checked.unverified.misquoted)
      ? checked.unverified : undefined,
    saveError: saveError || undefined
  });
};

/* 테스트와 tools/ai_review_run.js(시험 끝난 뒤 한 반을 통째로 돌리는 자리)가 쓴다.
 * 프롬프트는 여기 한 벌뿐이다 — 화면에서 부른 리뷰와 배치로 부른 리뷰가 다른 글이면
 * "AI 리뷰" 라는 말이 두 가지를 가리키게 된다. */
module.exports.attemptFor = attemptFor;
module.exports.verifyQuotes = verifyQuotes;
module.exports.rowsFor = rowsFor;
module.exports.putComments = putComments;
module.exports.SYSTEM = SYSTEM;
module.exports.SCHEMA = SCHEMA;

/* 리뷰 한 벌은 모델 호출 한 번이지만, 응시 하나를 통째로 읽고 쓰는 긴 프롬프트다.
   기본 상한(10초)으로는 끝나지 않는다. */
module.exports.config = { maxDuration: 60 };
