/* 문항 교체 저장 검증 — admin-questions.html 의 "Save replacement" 가 기대는 계약.
 * 실행: node studyground/tests/test_question_override_save.js
 *
 * 화면에서 고친 값은 콘텐츠 팩(assets/set9.js)이 아니라 localStorage 오버라이드에만
 * 남고, 다음 로드 때 팩 위에 다시 얹힌다. 그래서 검증할 것은 세 가지다.
 *   ① 저장한 필드(제한시간·오디오 경로·발문·선택지·정답)가 그대로 남는가
 *   ② 새로고침(스토어를 처음부터 다시 로드)해도 팩에 그대로 다시 얹히는가
 *   ③ 되돌리기가 팩의 원문을 정확히 복원하는가
 * 저장이 조용히 실패하면(quota·키 오타·필드 누락) 강사는 고쳤다고 믿은 채 시험을 낸다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var fails = [];

function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

/* 브라우저 한 판. 스토어는 파일을 다시 eval 할 때마다 새로 만들어지므로,
   같은 store 객체를 물려주면 "새로고침" 을 그대로 흉내낼 수 있다. */
var store = {};
function boot() {
  global.window = global;
  delete global.SG_QUESTIONS;
  try { delete global.SMEAG_SET9; } catch (e) {}
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  eval(fs.readFileSync(path.join(SG2, 'assets/question-config.js'), 'utf8'));
  eval(fs.readFileSync(path.join(SG2, 'assets/set9.js'), 'utf8'));
  return { Q: window.SG_QUESTIONS, pack: window.SMEAG_SET9 };
}

function findQuestion(Q, pack, id) {
  var hit = null;
  Q.eachQuestion(pack, function (q) { if (q.id === id) hit = q; });
  return hit;
}
function findIntro(Q, pack) {
  var hit = null;
  Q.eachIntro(pack, 'set9', function (id, block) { if (!hit) hit = { id: id, block: block }; });
  return hit;
}

var b = boot();
var Q = b.Q, pack = b.pack;
var QID = 'L1-1';
var q = findQuestion(Q, pack, QID);
check('the sample question is in the pack', !!q, 'true');

var orig = {
  prompt: q.prompt, choices: q.choices.slice(), answer: q.answer,
  audio: q.audio, timeLimitSec: q.timeLimitSec
};

/* ① 저장 — 화면이 만드는 패치와 같은 모양이다(바꾸지 않은 필드는 null = 원본 유지). */
Q.set('set9', QID, {
  prompt: null, choices: null, answer: null, hint: null, sentence: null,
  audio: 'media/audio/set9/l1-q01.mp3', image: null, timeLimitSec: 20
});
check('제한시간이 문항에 반영된다', q.timeLimitSec, 20);
check('오디오 경로가 문항에 반영된다', q.audio, 'media/audio/set9/l1-q01.mp3');
check('건드리지 않은 발문은 원문 그대로다', q.prompt, orig.prompt);
check('교체됨으로 표시된다', Q.isOverridden('set9', QID), 'true');
check('localStorage 에 실제로 쓰였다',
  !!(store['sg2_question_overrides_v1'] || '').indexOf('"timeLimitSec":20') >= 0, 'true');

/* 발문·선택지·정답도 같은 저장소를 탄다. */
Q.set('set9', QID, { prompt: 'Rewritten prompt.', choices: ['a', 'b', 'c', 'd'], answer: 2 });
check('발문이 바뀐다', q.prompt, 'Rewritten prompt.');
check('선택지가 바뀐다', q.choices, ['a', 'b', 'c', 'd']);
check('정답 번호가 바뀐다', q.answer, 2);
check('앞서 저장한 제한시간은 살아 있다', q.timeLimitSec, 20);

/* 정답 0번(A)은 흔한 함정이다 — falsy 라 "값 없음" 으로 새면 A 로 못 고친다. */
Q.set('set9', QID, { answer: 0 });
check('정답을 A(0)로도 저장할 수 있다', q.answer, 0);

/* ② 새로고침 — 같은 localStorage 로 처음부터 다시 세운다. */
var b2 = boot();
var Q2 = b2.Q, q2 = findQuestion(Q2, b2.pack, QID);
check('새로고침 뒤에도 제한시간이 남는다', q2.timeLimitSec, 20);
check('새로고침 뒤에도 오디오 경로가 남는다', q2.audio, 'media/audio/set9/l1-q01.mp3');
check('새로고침 뒤에도 발문이 남는다', q2.prompt, 'Rewritten prompt.');
check('새로고침 뒤에도 정답 0 이 남는다', q2.answer, 0);

/* ③ 되돌리기 — 팩의 원문이 정확히 복원된다. */
Q2.reset('set9', QID);
check('되돌리면 발문이 원문이다', q2.prompt, orig.prompt);
check('되돌리면 선택지가 원문이다', q2.choices, orig.choices);
check('되돌리면 정답이 원문이다', q2.answer, orig.answer);
check('되돌리면 오디오 경로가 원문이다', q2.audio, orig.audio == null ? 'undefined' : orig.audio);
check('되돌리면 제한시간이 원문이다', q2.timeLimitSec,
  orig.timeLimitSec == null ? 'undefined' : orig.timeLimitSec);
check('교체 표시가 사라진다', Q2.isOverridden('set9', QID), 'false');

/* 안내 방송(Task 머리말)도 같은 저장소를 쓴다 — 대본과 음원 둘뿐이다. */
var intro = findIntro(Q2, b2.pack);
if (!intro) {
  check('안내 방송 블록이 있다', false, 'true');
} else {
  var origScript = intro.block.script, origAudio = intro.block.introAudio;
  Q2.set('set9', intro.id, { script: 'New directions text.', introAudio: 'media/audio/set9/x.mp3' });
  check('안내 방송 대본이 저장된다', intro.block.script, 'New directions text.');
  check('안내 방송 음원이 저장된다', intro.block.introAudio, 'media/audio/set9/x.mp3');
  Q2.reset('set9', intro.id);
  check('안내 방송을 되돌리면 원문이다', intro.block.script,
    origScript == null ? 'undefined' : origScript);
  check('안내 방송 음원도 원문이다', intro.block.introAudio, origAudio);
}

console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall ok');
process.exit(fails.length ? 1 : 0);
