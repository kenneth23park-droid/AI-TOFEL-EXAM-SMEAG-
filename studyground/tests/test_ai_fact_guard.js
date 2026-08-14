/* AI 채점과 AI 리뷰는 확인할 수 있는 것만 말한다.
 *
 * 왜 이 시험이 있나
 *   모델은 그럴듯한 글을 잘 쓴다. 그래서 채점 근거로 학생이 쓰지도 않은 문장을 인용하고,
 *   오답 해설로 지문에 없는 문장을 "지문에 이렇게 나온다" 고 적는 일이 생긴다. 한 번
 *   그러면 학생은 맞는 지적까지 못 믿는다 — 그 순간 리뷰는 공부 도구가 아니라 소음이다.
 *   그리고 Listen and Repeat 처럼 **세면 알 수 있는** 과제를 눈대중으로 채점하면 같은
 *   녹음이 부를 때마다 다른 점수를 받는다.
 *
 *   그래서 세 자리를 못 박는다.
 *     1. 셀 수 있는 것은 센다 — 원문과 전사문의 차이는 서버가 세고, 루브릭이 그 셈에
 *        허락하지 않는 점수는 내린다.
 *     2. 인용은 확인한다 — 답안·지문에 글자 그대로 없는 인용은 지운다.
 *     3. 근거를 준다 — 오답 해설을 쓰려면 지문·대본이 모델 앞에 있어야 한다.
 *
 * 실행: node studyground/tests/test_ai_fact_guard.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var fails = 0;
function ok(cond, what) {
  if (cond) return;
  fails++;
  console.error('FAIL — ' + what);
}

var SG2 = path.join(__dirname, '..', 'sg2');
var RUBRIC = require(path.join(SG2, 'api', '_rubric_toefl.js'));
var LLM = require(path.join(SG2, 'api', '_llm.js'));
var FEEDBACK = require(path.join(SG2, 'api', 'feedback.js'));

/* ── 1. 셀 수 있는 것은 센다 (Listen and Repeat) ──────────────────────── */

var REF = 'The library will be closed for renovations until the end of the month.';

var same = RUBRIC.compareRepeat(REF, 'the library will be closed for renovations until the end of the month');
ok(same.exact, 'A: 문장부호와 대소문자만 다른 것은 "그대로 따라 한" 것이다');
ok(RUBRIC.capFor(same) === 5, 'A: 그대로 따라 했으면 상한은 5 다');

var oneOff = RUBRIC.compareRepeat(REF, 'The library will be closed for renovations until the end of the week.');
ok(!oneOff.exact, 'B: 한 단어라도 다르면 그대로가 아니다');
ok(oneOff.missingContent.indexOf('month') >= 0, 'B: 빠진 내용어를 이름으로 짚는다');
ok(oneOff.added.indexOf('week') >= 0, 'B: 원문에 없던 말도 짚는다');
ok(RUBRIC.capFor(oneOff) === 4, 'B: 내용어 하나만 바뀌면 상한 4 (루브릭의 4점 서술)');

var half = RUBRIC.compareRepeat(REF, 'The library will be closed.');
ok(RUBRIC.capFor(half) <= 3, 'C: 내용어가 여럿 사라지면 4 이상은 못 준다 (지금 ' +
   RUBRIC.capFor(half) + ')');

var barely = RUBRIC.compareRepeat(REF, 'The library.');
ok(RUBRIC.capFor(barely) <= 2, 'C: 앞 토막만 남으면 2 이하다 (지금 ' + RUBRIC.capFor(barely) + ')');

/* 기능어는 내용어와 다르게 센다 — 루브릭이 "function words" 한둘은 4점에서 봐 준다. */
var fnOnly = RUBRIC.compareRepeat(REF, 'Library will be closed for renovations until end of the month.');
ok(fnOnly.missingContent.length === 0 && fnOnly.missingFunction.length > 0,
   'D: 관사만 빠진 것은 내용어 손실로 세지 않는다');
ok(RUBRIC.capFor(fnOnly) === 4, 'D: 기능어만 빠졌으면 상한은 4 다');

/* 원문을 모르면 아무 선도 긋지 않는다 — 셀 것이 없으면 세지 않는다. */
ok(RUBRIC.capFor(null) === RUBRIC.MAX_SCORE, 'E: 견줄 원문이 없으면 상한을 두지 않는다');

/* ── 2. 인용은 글자로 확인한다 ───────────────────────────────────────── */

var ESSAY = 'Dear Professor Kim,\nI have went to the office yesterday but you were not there. ' +
            'Could you tell me when is your office hour?';

ok(LLM.isVerbatim('I have went to the office', ESSAY), 'F: 그대로 옮긴 인용은 통과한다');
ok(LLM.isVerbatim('i HAVE WENT', ESSAY), 'F: 대소문자는 옮겨 적기의 차이일 뿐이다');
ok(LLM.isVerbatim('“I have went”', ESSAY), 'F: 둥근 따옴표를 씌워 와도 통과한다');
ok(LLM.isVerbatim('I have went ... office hour', ESSAY), 'F: 가운데를 줄인 인용은 순서대로 확인한다');
ok(!LLM.isVerbatim('I have gone to the office', ESSAY),
   'G: 문법을 고쳐 옮긴 것은 인용이 아니다 — 학생은 자기 글에서 못 찾는다');
ok(!LLM.isVerbatim('I visited your office and waited an hour', ESSAY),
   'G: 지어낸 문장은 걸러진다');
ok(!LLM.isVerbatim('', ESSAY), 'G: 빈 인용은 인용이 아니다');
ok(!LLM.isVerbatim('anything', ''), 'G: 견줄 원본이 없으면 통과시키지 않는다');

/* ── 3. 리뷰: 지어낸 인용은 학생에게 가지 않는다 ─────────────────────── */

var ATTEMPT = {
  productive_tasks: [{ question_id: 'W2-1', skill: 'writing', response: ESSAY }],
  open_answers: [],
  wrong_questions: [
    { question_id: 'R1-32', prompt: 'The passage states that medical students',
      choices: ['completed their training in half the time', 'achieved significantly higher scores'],
      given: 'completed their training in half the time',
      correct: 'achieved significantly higher scores',
      source_id: 'S1' }
  ],
  sources: [{ id: 'S1', kind: 'passage', title: 'AR',
              text: 'Medical students who practiced surgical techniques through AR simulations ' +
                    'demonstrated proficiency scores thirty percent higher than peers.' }]
};

var RAW = {
  sections: [{
    scope: 'writing', summary: 's',
    issues: [
      { issue: 'past participle after "have"', evidence: 'W2-1', quote: 'I have went', fix: 'drill' },
      { issue: 'run-on sentences', evidence: 'W2-1', quote: 'I waited for two hours and then', fix: 'x' }
    ]
  }],
  questions: [
    { question_id: 'R1-32', problem: 'p', cause: 'c', solution: 's',
      quote: 'completed their training in half the time',
      evidence: 'demonstrated proficiency scores thirty percent higher' },
    { question_id: 'R1-32', problem: 'p2', cause: 'c2', solution: 's2',
      quote: 'completed their training in half the time',
      evidence: 'The passage never mentions how long the training took.' },
    { question_id: 'W2-1', problem: 'p3', cause: 'c3', solution: 's3',
      quote: 'I am writing to ask about the deadline', evidence: '' },
    /* 지문 문장을 '내가 쓴 말' 칸에 넣어 온 것. 지어낸 것은 아니다 — 자리를 잘못 짚었다. */
    { question_id: 'R1-32', problem: 'p4', cause: 'c4', solution: 's4',
      quote: 'demonstrated proficiency scores thirty percent higher', evidence: '' }
  ]
};

var V = FEEDBACK.verifyQuotes(RAW, ATTEMPT);

ok(V.parsed.sections[0].issues.length === 1 &&
   V.parsed.sections[0].issues[0].quote === 'I have went',
   'H: 학생이 쓰지 않은 말을 근거로 든 문제 제기는 버린다');
ok(V.unverified.issues === 1, 'H: 버린 개수를 센다');

var qs = V.parsed.questions;
ok(qs.length === 3, 'I: 학생의 답을 지어낸 해설은 통째로 버린다 (지금 ' + qs.length + '개 남음)');
ok(qs.every(function (q) { return q.question_id !== 'W2-1'; }),
   'I: 버려진 것은 지어낸 인용을 단 그 해설이다');
ok(V.unverified.questions === 1, 'I: 버린 개수를 센다');

/* 지어낸 것과 자리를 잘못 짚은 것은 다르게 다룬다. 지문 문장을 '내가 쓴 말' 로 붙여
   온 것은 인용만 떼고 설명은 남긴다 — 지적까지 틀렸다고 밝혀진 것은 아니다. */
var misplaced = qs[2];
ok(misplaced && misplaced.problem === 'p4' && misplaced.quote === '',
   'I2: 지문 문장을 내 말이라 붙여 온 것은 인용만 떼고 해설은 남긴다');
ok(V.unverified.misquoted === 1, 'I2: 그 개수는 따로 센다');

ok(qs[0].evidence.indexOf('thirty percent higher') >= 0,
   'J: 지문에 실제로 있는 근거는 그대로 남는다');
ok(qs[1].evidence === '' && qs[1].problem === 'p2',
   'J: 지문에 없는 근거는 그 칸만 비우고 설명은 남긴다 — 근거가 약해진 것이지 틀린 것은 아니다');
ok(V.unverified.evidence === 1, 'J: 비운 개수를 센다');

ok(RAW.questions.length === 4 && RAW.sections[0].issues.length === 2 &&
   RAW.questions[3].quote !== '',
   'K: 원본은 고치지 않는다 (검증은 새 객체로 돌려준다)');

/* ── 4. 리뷰는 지문을 보고 쓴다 ──────────────────────────────────────── */

var attempt = FEEDBACK.attemptFor(
  { set_code: 'SET9', answers: { 'R1-32': { v: 0 }, 'R1-33': { v: 1 } }, by_section: {} },
  [],
  { questions: [
      { question_id: 'R1-32', section: 'reading', kind: 'mcq', ok: false, prompt: 'q1',
        choices: ['a', 'b'], correct: 'b',
        source: { kind: 'passage', title: 'AR', text: 'The very same passage text.' } },
      { question_id: 'R1-33', section: 'reading', kind: 'mcq', ok: false, prompt: 'q2',
        choices: ['a', 'b'], correct: 'a',
        source: { kind: 'passage', title: 'AR', text: 'The very same passage text.' } }
  ] });

ok(attempt.sources.length === 1,
   'L: 한 지문을 여러 문항이 함께 쓰면 한 벌로 묶는다 (지금 ' + attempt.sources.length + '벌)');
ok(attempt.wrong_questions.length === 2 &&
   attempt.wrong_questions[0].source_id === attempt.wrong_questions[1].source_id,
   'L: 문항은 그 한 벌을 번호로 가리킨다');
ok(attempt.sources[0].text.indexOf('The very same passage') === 0,
   'L: 지문 원문이 실제로 실린다 — 이게 없으면 해설은 "정답은 B 입니다" 밖에 못 쓴다');

/* ── 5. 배선 — 지문이 브라우저에서 서버까지 간다 ─────────────────────── */

var RESULTS = fs.readFileSync(path.join(SG2, 'assets', 'sg-results.js'), 'utf8');
ok(/function sourceOf\(/.test(RESULTS) && /src: sourceOf\(all\[i\]\)/.test(RESULTS),
   'M: 채점 결과의 문항마다 그 문항이 딛고 선 원문을 달아 둔다');

/* 리스닝은 학생이 '들은' 말이 문항 어디에도 없다 — 대본 인덱스에만 있다. 그걸 안 붙이면
   리스닝 오답 해설은 무엇을 들었는지 모른 채 쓰인다(SET 9 는 오답 47개가 그렇다). */
ok(/SG_SCRIPT_CHECK\.forPath\(q\.audio\)/.test(RESULTS) &&
   /SG_SCRIPT_CHECK\.forPath\(blk\.audio\)/.test(RESULTS),
   'M2: 리스닝은 문항 음원 · 블록 공용 음원의 대본을 원문으로 삼는다');
var SHELL2 = fs.readFileSync(path.join(SG2, 'assets', 'exam-shell.js'), 'utf8');
ok(/assets\/audio-script-check\.js/.test(SHELL2) && /function scriptsReady\(\)/.test(SHELL2),
   'M2: 제출 화면은 대본을 손에 쥔 뒤에 리뷰를 부른다');
ok(/SG_SCRIPT_CHECK\.load\(/.test(fs.readFileSync(path.join(SG2, 'review.html'), 'utf8')),
   'M2: 리뷰 화면도 같은 순서를 지킨다');

var COMMENTS = fs.readFileSync(path.join(SG2, 'assets', 'sg-comments.js'), 'utf8');
ok(/q\.source = \{ kind: r\.src\.kind/.test(COMMENTS),
   'M: 서버로 보내는 문항 메타데이터에 그 원문이 실린다');

/* 그래도 학생의 답은 여전히 보내지 않는다 — 서버가 DB 에서 직접 읽는다(위조 방지). */
global.window = {};
require(path.join(SG2, 'assets', 'sg-comments.js'));
var sent = global.window.SG_COMMENTS.questionsFor({ rows: [
  { qid: 'R1-1', no: 1, section: 'reading', kind: 'mcq', prompt: 'p', key: 1, ok: false,
    given: 0, choices: ['a', 'b'], src: { kind: 'passage', title: 't', text: 'body text' } }
] });
ok(sent.length === 1 && sent[0].source && sent[0].source.text === 'body text',
   'N: 오답에는 원문이 붙어 나간다');
ok(!('given' in sent[0]) && !('answer' in sent[0]),
   'N: 학생의 답은 여전히 나가지 않는다 — 서버가 DB 에서 읽는다');

/* ── 6. 채점 쪽 배선 ─────────────────────────────────────────────────── */

var SCORE = fs.readFileSync(path.join(SG2, 'api', 'score.js'), 'utf8');
ok(/temperature: TEMPERATURE/.test(SCORE) && /const TEMPERATURE = 0/.test(SCORE),
   'O: 채점은 온도 0 — 같은 답안에 같은 점수가 나와야 채점이다');
ok(/RUBRIC\.compareRepeat\(/.test(SCORE) && /RUBRIC\.capFor\(/.test(SCORE),
   'O: 복창은 세어 보고, 셈이 허락하지 않는 점수는 내린다');
ok(/LLM\.isVerbatim\(quote, text\)/.test(SCORE),
   'O: 채점 근거의 인용은 답안에 있는지 확인한다');
ok(/guard: guard/.test(SCORE),
   'O: 무엇이 점수를 움직였는지 남긴다 — 선생님이 뒤집으려면 근거가 있어야 한다');

var LLMSRC = fs.readFileSync(path.join(SG2, 'api', '_llm.js'), 'utf8');
ok(/temperature/i.test(LLMSRC) && /ask\(false\)/.test(LLMSRC),
   'P: 온도를 안 받는 모델이면 온도만 떼고 다시 부른다 — 채점이 통째로 죽으면 안 된다');

/* ── 7. 화면 — 확인된 근거는 학생 눈앞까지 간다 ──────────────────────── */

var HTML = fs.readFileSync(path.join(SG2, 'review.html'), 'utf8');
ok(/d\.quote/.test(HTML) && /d\.evidence/.test(HTML),
   'Q: 오답 해설 카드가 내 답과 지문 근거를 함께 그린다');
var WRITE = fs.readFileSync(path.join(SG2, 'assets', 'sg-review-writing.js'), 'utf8');
var SPEAK = fs.readFileSync(path.join(SG2, 'assets', 'sg-review-speaking.js'), 'utf8');
ok(/c\.quote/.test(WRITE) && /c\.quote/.test(SPEAK),
   'Q: 채점 근거의 인용이 라이팅·스피킹 리뷰에 보인다');
ok(/rub\.guard/.test(SPEAK),
   'Q: 복창은 "몇 개 중 몇 개를 옮겼는가" 를 학생에게 그대로 보여 준다');

if (fails) { console.error('\n' + fails + '개 실패'); process.exit(1); }
console.log('OK — 채점은 세고, 인용은 확인하고, 해설은 지문을 보고 쓴다');
