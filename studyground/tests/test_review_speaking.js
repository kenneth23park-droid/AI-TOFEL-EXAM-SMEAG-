/* 스피킹 채점 리뷰(assets/sg-review-speaking.js) — node 전용.
 * 실행: node "studyground/tests/test_review_speaking.js"
 *
 * 지키는 것 다섯.
 *  [A] SET 9 스피킹이 과제 둘로 펴진다 — Listen and Repeat 7문항 · Interview 4문항.
 *  [B] 팩이 들려준 문장(script)을 들고 있다. 이 값이 복창 채점의 원문이라, 없으면
 *      화면에 원문이 안 뜨는 것으로 끝나지 않고 채점 자체가 중앙값으로 내려앉는다.
 *  [C] 낱말 대조가 서버(app/scoring/rubric.py compare_repeat)와 같은 규칙으로 센다 —
 *      소문자·구두점 무시, 바꿔 말함은 빠뜨림이자 덧붙임.
 *  [D] 화면에 넷이 함께 실린다 — 들려준 문장 · 오디오 · 전사문 · 점수 근거.
 *  [E] 채점 전은 0점이 아니라 '아직 채점 전'이고, 인터뷰에는 대조 카드가 없다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

function load(rel) {
  var code = fs.readFileSync(path.join(SG2, rel), 'utf8');
  (0, eval)(code);
}

load('assets/set9.js');
load('assets/sg-review-speaking.js');

var RS = window.SG_REVIEW_SPEAKING;
var PACK = window.SMEAG_SET9;
var fails = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }

function speaking() {
  return PACK.sections.filter(function (s) { return s.id === 'speaking'; })[0];
}
function questions(modIndex) {
  return speaking().modules[modIndex].blocks[0].questions;
}

/* ── [B] 팩이 원문을 들고 있는가 ─────────────────────────────── */

var repeats = questions(0);
ok(repeats.length === 7, 'B: 복창은 7문항이어야 한다 — 실제 ' + repeats.length);
repeats.forEach(function (q) {
  ok(!!q.script, 'B: 복창 문항 ' + q.id + ' 에 들려준 문장이 없다 — 원문 없이 채점된다');
});
questions(1).forEach(function (q) {
  ok(!!q.script, 'B: 인터뷰 문항 ' + q.id + ' 에 질문 글이 없다');
});

/* 원문의 출처는 오디오 대본 하나뿐 — 여기서 지어낸 값이 아님을 확인한다. */
var script = {};
JSON.parse(fs.readFileSync(
  path.join(SG2, 'config', '_set9_fragments', 'speaking_script.json'), 'utf8')
).lines.forEach(function (l) { script[l.id] = l.text.trim(); });
repeats.concat(questions(1)).forEach(function (q) {
  ok(q.script === script[q.id], 'B: ' + q.id + ' 의 문장이 대본과 다르다');
});

/* ── [C] 낱말 대조 ─────────────────────────────────────────── */

var REF = 'Let us get ready for our watercolor class.';

var perfect = RS.compare(REF, 'let us get ready for our watercolor class');
ok(perfect.accuracy === 100 && perfect.missing === 0 && perfect.added === 0,
   'C: 그대로 따라 말하면 100% 여야 한다 — 실제 ' + perfect.accuracy + '%');

/* 구두점·대소문자는 무시한다. 전사기는 물음표를 거의 찍지 않는다. */
var punct = RS.compare('Is this your first time in our cafeteria?',
                       'is this your first time in our cafeteria');
ok(punct.accuracy === 100, 'C: 구두점 때문에 깎이면 안 된다 — 실제 ' + punct.accuracy + '%');

/* 한 낱말을 바꿔 말했다: 빠뜨림 1 · 덧붙임 1 · 바꿔 말함 1 (겹쳐 센다). */
var swap = RS.compare(REF, 'let us get it for our watercolor class');
ok(swap.total === 8 && swap.matched === 7,
   'C: 여덟 낱말 중 일곱이 맞아야 한다 — 실제 ' + swap.matched + '/' + swap.total);
ok(swap.missing === 1 && swap.added === 1 && swap.substituted === 1,
   'C: 바꿔 말함은 빠뜨림이자 덧붙임이어야 한다 — 실제 ' +
   swap.missing + '/' + swap.added + '/' + swap.substituted);

/* 빠뜨리기만 했다면 덧붙임은 0 이다. */
var short = RS.compare(REF, 'let us get ready for our class');
ok(short.missing === 1 && short.added === 0 && short.substituted === 0,
   'C: 빠뜨리기만 한 답에 덧붙임이 붙으면 안 된다');

/* 아포스트로피는 낱말의 일부, 하이픈은 구두점이다(서버와 같은 규칙). */
ok(RS.tokens("today's first-time 3.5").join(' ') === "today's first time 3 5",
   'C: 낱말 자르기 규칙이 서버와 어긋난다 — 실제 ' + RS.tokens("today's first-time 3.5").join(' '));

ok(RS.compare('', 'anything at all') === null, 'C: 원문이 없으면 대조는 없다(지어내지 않는다)');

/* ── [A] · [D] · [E] 모델과 화면 ──────────────────────────── */

/* 채점 행을 흉내낸다. 복창 1번은 한 낱말을 바꿔 말했고, 2번은 아직 채점 전이다.
   인터뷰 1번만 채점됐다. */
var TASKS = [
  { question_id: repeats[0].id, skill: 'speaking', task_kind: 'repeat',
    ai_score: 3.5, transcript: 'is this your first time in the cafeteria',
    transcript_model: 'whisper-1', ai_model: 'test-model', media_path: 'u/s/q.webm',
    ai_rubric: { summary: 'Nearly all of the sentence came back.',
                 criteria: [{ criterion: 'Repetition Accuracy', score: 3.5, comment: '7/8 matched' }] } },
  { question_id: questions(1)[0].id, skill: 'speaking', task_kind: 'interview',
    ai_score: 4, teacher_score: 3, confirmed_at: '2026-08-11T00:00:00Z',
    transcript: 'I usually go running in the morning because it wakes me up.',
    ai_rubric: { summary: 'A clear answer with one reason.',
                 criteria: [{ criterion: 'Delivery', score: 3, comment: 'steady pace' }] } }
];

var rows = repeats.concat(questions(1)).map(function (q) {
  return { qid: q.id, section: 'speaking', kind: q.kind, given: 'idb:' + q.id, key: null, ok: null };
});

var M = RS.model(PACK, rows, TASKS);

ok(M.length === 2, 'A: 스피킹은 과제 둘이어야 한다 — 실제 ' + M.length);
ok(M[0].items.length === 7 && M[1].items.length === 4,
   'A: 7문항 · 4문항이어야 한다 — 실제 ' + M[0].items.length + ' · ' + M[1].items.length);
ok(RS.shortLabel(M[0].label) === 'Listen & Repeat' && RS.shortLabel(M[1].label) === 'Interview',
   'A: 긴 과제 이름은 칩에서 줄어야 한다');

/* 점수 칩 — 채점된 문항의 평균이고, 선생님이 고치면 선생님이 이긴다. */
ok(M[0].score.text === '3.50/5.00', 'A: 복창 칩은 3.50/5.00 이어야 한다 — 실제 ' + M[0].score.text);
ok(M[1].score.text === '3.00/5.00',
   'A: 교사 점수가 AI 초안을 이겨야 한다 — 실제 ' + M[1].score.text);

/* 복창 1번의 대조가 모델에 실려 있다(전사와 원문이 둘 다 있을 때만). */
ok(M[0].items[0].compare && M[0].items[0].compare.total === 8,
   'C: 복창 1번에 낱말 대조가 실려야 한다');
ok(M[0].items[1].compare === null, 'E: 전사문이 없으면 대조도 없다');
ok(M[1].items[0].compare === null, 'E: 인터뷰에는 대조가 없다(정답 문장이 없다)');

var rep = RS.html(M, { m: 0, q: 0 });
ok(rep.indexOf(RS.esc(repeats[0].script)) >= 0, 'D: 들려준 문장이 화면에 있어야 한다');
ok(rep.indexOf(RS.esc(repeats[0].audio)) >= 0, 'D: 들려준 오디오가 화면에 있어야 한다');
ok(rep.indexOf('Reference text') >= 0, 'D: 복창에는 원문이라는 이름이 붙어야 한다');
ok(rep.indexOf(RS.esc(TASKS[0].transcript)) >= 0, 'D: 전사문이 화면에 있어야 한다');
ok(rep.indexOf('3.50') >= 0, 'D: 점수가 화면에 있어야 한다');
ok(rep.indexOf('Nearly all of the sentence came back.') >= 0, 'D: 채점 근거가 실려야 한다');
ok(rep.indexOf('data-play="' + repeats[0].id + '"') >= 0, 'D: 녹음 자리가 있어야 한다');
ok(rep.indexOf('Word by word') >= 0, 'D: 복창에는 낱말 대조 카드가 있어야 한다');
ok(/rs-diff/.test(rep) && /<i class="del">/.test(rep),
   'D: 빠뜨린 낱말이 취소선으로 갈려야 한다');
ok(rep.indexOf('Scored by AI') >= 0, 'D: 확정 전이면 AI 채점이라고 말해야 한다');
ok(rep.indexOf('AI draft') < 0, 'D: 초안이라고 부르지 않는다 — AI 점수가 곧 점수다');

var ask = RS.html(M, { m: 1, q: 0 });
ok(ask.indexOf('What the interviewer asked') >= 0, 'D: 인터뷰에는 질문이라는 이름이 붙어야 한다');
ok(ask.indexOf(RS.esc(questions(1)[0].script)) >= 0, 'D: 면접관의 질문이 화면에 있어야 한다');
ok(ask.indexOf('Word by word') < 0, 'E: 인터뷰에 낱말 대조 카드가 뜨면 안 된다');
ok(ask.indexOf('Confirmed by a teacher.') >= 0, 'E: 확정된 점수는 확정이라고 말해야 한다');

/* [E] 채점 전은 0점이 아니다 */
var wait = RS.html(M, { m: 0, q: 1 });
ok(wait.indexOf('Not scored yet.') >= 0, 'E: 채점 전이라고 말해야 한다');
ok(wait.indexOf('0.00') < 0, 'E: 채점 전을 0.00 으로 보여 주면 안 된다');

/* 이동 줄 — 번호 아래에 점수가 선다. 채점 전은 '—' 다. */
ok(/rs-dot rated/.test(rep), 'E: 이동 줄에 채점된 문항이 갈려야 한다');
ok(rep.indexOf('>3.50<') >= 0, 'E: 이동 줄에 점수가 실려야 한다');
ok(rep.indexOf('>—<') >= 0, 'E: 채점 전 문항은 이동 줄에서 — 여야 한다');

/* 팩에 스피킹이 없으면 빈 화면이 아니라 말이 나온다. */
ok(RS.html([], { m: 0, q: 0 }).indexOf('no speaking tasks') >= 0,
   'E: 스피킹이 없는 세트에서는 그렇다고 말해야 한다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (m) { console.error('  · ' + m); });
  process.exit(1);
}
console.log('OK — 스피킹 리뷰: 구조 · 원문 배선 · 낱말 대조 · 화면 · 채점 전 표시');
