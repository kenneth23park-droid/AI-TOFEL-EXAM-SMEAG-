/* Story 2.4 — Writing 렌더러 필드 계약 검증 (node)
 * 실행: node studyground/tests/test_render_writing.js
 *
 * 목적: 컴파일러가 실제로 뽑아내는 writing 화면(build-set / free-write)을 대상으로,
 *       exam-render-writing.js 가 렌더 중 참조하는 필드가 전부 존재하는지 assert 한다.
 *       DOM 은 만들지 않는다(document 없음 → 렌더러는 순수부만 노출된 상태로 로드된다).
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-engine.js');
load('assets/exam-render-writing.js');   // document 가 없으므로 DOM 코드는 실행되지 않는다

var W = window.SG_WRITING;
var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, timing, { profile: 'toefl' });

var fails = [];
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra === undefined ? '' : ' → ' + extra));
  if (!cond) fails.push(name);
}
function eq(name, actual, expected) { check(name + ': ' + actual, actual === expected, actual === expected ? undefined : 'expected ' + expected); }

console.log('\n[0] 모듈 로드');
check('window.SG_WRITING 노출', !!W);
check('SG_WRITING.install() 은 SG_RENDER 없이도 죽지 않는다', W.install() === false);

console.log('\n[1] 담당 화면 추출');
var mine = res.screens.filter(function (s) { return W.handles(s); });
var build = mine.filter(function (s) { return s.blockKind === 'build-set'; });
var free = mine.filter(function (s) { return s.blockKind === 'free-write'; });
eq('handles() 가 집는 writing 화면 수', mine.length, 12);
eq('build-set 화면 수 (W1 문항 1개 = 화면 1개)', build.length, 10);
eq('free-write 화면 수 (W2 + W3)', free.length, 2);
check('writing 섹션의 다른 화면은 건드리지 않는다',
  res.screens.filter(function (s) { return s.section === 'writing' && !W.handles(s); }).length === 5);

console.log('\n[2] build-set — 렌더러가 참조하는 필드 전수 검사');
var setPack = window.SMEAG_SET1;
build.forEach(function (s) {
  var qid = (s.questionIds || [])[0];
  var f = W.findQuestion(setPack, qid);
  if (!f) { check(s.id + ' findQuestion', false); return; }
  var q = f.question;
  var ok = !!qid &&
    s.screenType === 'question' &&
    (s.questionIds || []).length === 1 &&
    q.slots instanceof Array && q.slots.length > 0 &&
    q.tiles instanceof Array && q.tiles.length > 0 &&
    typeof q.context === 'string' && q.context.length > 0 &&
    q.answerTokens instanceof Array;
  // slots 의 각 원소는 t:'f'(+text) 또는 t:'b'(+a)
  q.slots.forEach(function (sl) {
    if (sl.t === 'f') { if (typeof sl.text !== 'string') ok = false; }
    else if (sl.t === 'b') { if (typeof sl.a !== 'string') ok = false; }
    else ok = false;
  });
  // 빈칸 개수 == answerTokens 개수, 그리고 팔레트 타일이 빈칸을 모두 채울 수 있어야 한다
  var blanks = W.blankIndexes(q.slots);
  if (blanks.length !== q.answerTokens.length) ok = false;
  if (q.tiles.length < blanks.length) ok = false;
  check(s.id + ' (' + qid + ') 필드/불변식', ok,
    'blanks=' + blanks.length + ' tiles=' + q.tiles.length);
});

console.log('\n[3] build-set — 정답 배치 시 answerTokens 와 정확히 일치');
build.forEach(function (s) {
  var q = W.findQuestion(setPack, s.questionIds[0]).question;
  var blanks = W.blankIndexes(q.slots);
  // 정답 토큰을 팔레트에서 찾아 배치(렌더러의 restorePlaced 와 같은 매칭 규칙)
  var placed = W.restorePlaced(q.tiles, blanks.length, { tokens: q.answerTokens });
  var toks = W.tokensOf(q.tiles, placed);
  // 저장 토큰은 "학생이 실제로 놓은 타일 텍스트"다. set1.js 의 tiles[] 는 문장 첫 단어를
  // 소문자로 담고 있으므로(예: 'why' vs answerTokens 'Why') 대조는 대소문자 무시다.
  var same = toks.length === q.answerTokens.length;
  for (var i = 0; i < toks.length; i++) {
    if (String(toks[i]).toLowerCase() !== String(q.answerTokens[i]).toLowerCase()) same = false;
  }
  var complete = W.isComplete(placed);
  var sentence = W.sentenceOf(q.slots, q.tiles, placed);
  check(s.questionIds[0] + ' 토큰 왕복 + 완성판정', same && complete, sentence);
});

console.log('\n[4] build-set — 완성 문장이 set1.js 의 sentence 와 일치');
build.forEach(function (s) {
  var q = W.findQuestion(setPack, s.questionIds[0]).question;
  var blanks = W.blankIndexes(q.slots);
  var placed = W.restorePlaced(q.tiles, blanks.length, { tokens: q.answerTokens });
  var got = W.sentenceOf(q.slots, q.tiles, placed);
  check(s.questionIds[0] + ' sentence', got === q.sentence, got === q.sentence ? undefined : 'got "' + got + '" vs "' + q.sentence + '"');
});

console.log('\n[5] free-write — 렌더러가 참조하는 필드 전수 검사');
free.forEach(function (s) {
  var qid = (s.questionIds || [])[0];
  var q = W.findQuestion(setPack, qid).question;
  var ok = typeof q.minWords === 'number' && q.minWords > 0;
  if (q.kind === 'email') {
    ok = ok && typeof q.to === 'string' && typeof q.subject === 'string' &&
         typeof q.situation === 'string' && q.bullets instanceof Array && q.bullets.length === 3 &&
         typeof q.situationLabel === 'string' && typeof q.bulletsLabel === 'string';
  } else if (q.kind === 'discussion') {
    ok = ok && typeof q.professor === 'string' && typeof q.prompt === 'string' &&
         q.posts instanceof Array && q.posts.length === 2;
    q.posts.forEach(function (p) { if (typeof p.name !== 'string' || typeof p.text !== 'string') ok = false; });
  } else ok = false;
  check(s.id + ' (' + qid + ' · ' + q.kind + ') 필드', ok, 'minWords=' + q.minWords);
  check(qid + ' Read-aloud 텍스트 존재', W.promptTextOf(q).length > 0);
});

console.log('\n[6] TTS 키가 번들 index.json 에 실제로 존재');
var ttsIndex = JSON.parse(fs.readFileSync(path.join(SG2, 'media/tts/index.json'), 'utf8'));
free.forEach(function (s) {
  var q = W.findQuestion(setPack, s.questionIds[0]).question;
  var id = W.ttsIdFor(q);
  check('ttsIdFor(' + q.id + ') = ' + id, !!ttsIndex[id]);
});

console.log('\n[7] 타이머 — writing 은 task scope sharedDeadline 600초');
var KF = window.SG_EXAM.clockKeyFor;
mine.forEach(function (s) {
  var ts = (s.timers || []).concat(s.timer && (!s.timers || s.timers.indexOf(s.timer) < 0) ? [s.timer] : []);
  var task = null;
  ts.forEach(function (t) { if (t && t.scope === 'task') task = t; });
  check(s.id + ' task 타이머', !!task && task.seconds === 600 && task.sharedDeadline === true,
    task ? task.seconds + 's key=' + KF(s, task) : 'none');
});
// 같은 태스크의 화면들은 같은 clock key 를 공유해야 만료가 한 번에 온다
var w1keys = {};
build.forEach(function (s) {
  var t = (s.timers || []).filter(function (x) { return x.scope === 'task'; })[0];
  if (t) w1keys[KF(s, t)] = 1;
});
eq('W1 10화면이 공유하는 clock key 수', Object.keys(w1keys).length, 1);

console.log('\n[8] wordCount 순수 함수');
eq('빈 문자열', W.wordCount(''), 0);
eq('공백만', W.wordCount('   \n\t '), 0);
eq('한 단어', W.wordCount(' hello '), 1);
eq('개행/다중공백', W.wordCount('a  b\nc\td'), 4);
eq('minWords 경계(79)', W.wordCount(new Array(80).join('x ')), 79);

console.log('\n[9] 문항 그리드 — W1 10화면이 연속이고 순서가 W-1..W-10');
var idxs = build.map(function (s) { return res.screens.indexOf(s); });
var contiguous = true;
for (var i = 1; i < idxs.length; i++) { if (idxs[i] !== idxs[i - 1] + 1) contiguous = false; }
check('연속 배치', contiguous, idxs.join(','));
check('문항 순서', build.map(function (s) { return s.questionIds[0]; }).join(',') ===
  'W-1,W-2,W-3,W-4,W-5,W-6,W-7,W-8,W-9,W-10');

console.log('\n' + (fails.length ? 'FAILED: ' + fails.length + '\n  - ' + fails.join('\n  - ')
                                 : 'ALL PASS (' + '2.4 writing renderer' + ')') + '\n');
process.exit(fails.length ? 1 : 0);
