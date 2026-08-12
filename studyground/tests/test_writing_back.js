/* 라이팅 — 답을 쓰다가 앞 문제로 돌아가 고칠 수 있다. node 전용.
 * 실행: node "studyground/tests/test_writing_back.js"
 *
 * 발주 요구(2026-08-12): "writing 시 백으로 가서 문제를 보고 수정할 수 있도록 다음버튼도
 * 같이 활성화". 리딩에 이미 있던 규칙(554c5e8 — 같은 모듈 안에서만 되돌아간다)을
 * 라이팅에도 그대로 연다. 새 규칙을 만들지 않는다: 엔진의 backable() 은 손대지 않았고,
 * 셸(exam-shell.js syncActions)이 Back 을 세우는 섹션 목록에 writing 을 더한 것뿐이다.
 *
 * 여기서 고정하는 성질 세 가지.
 *  [1] 컴파일된 라이팅 문항 화면은 allowBack 을 달고 같은 모듈(W1)끼리 이어져 있다.
 *  [2] 엔진에서 실제로 canBack/back 이 열리고, 돌아간 뒤 next 로 다시 앞으로 나온다.
 *      모듈이 바뀌는 자리(W1→W2)에서는 여전히 막힌다 — 그 태스크의 시계는 이미 닫혔다.
 *  [3] 셸이 Back 을 reading 뿐 아니라 writing 화면에도 세우고, Next(btn-advance)는
 *      오디오 잠금에만 걸린다(라이팅에는 오디오가 없으므로 늘 활성).
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set9.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-engine.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET9, timing, { profile: 'toefl' });

var fails = [];
function check(name, actual, expected) {
  var okv = actual === expected;
  console.log((okv ? '  ok   ' : '  FAIL ') + name + ': ' + actual + (okv ? '' : ' (expected ' + expected + ')'));
  if (!okv) fails.push(name);
}
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}

console.log('\n[1] 라이팅 문항 화면의 되돌아가기 표식');
var wq = res.screens.filter(function (s) {
  return s.section === 'writing' && s.screenType === 'question';
});
check('라이팅 문항 화면 (W1 10 + W2 1 + W3 1)', wq.length, 12);
check('allowBack 아닌 화면', wq.filter(function (s) { return !s.allowBack; }).length, 0);
var w1 = wq.filter(function (s) { return String(s.moduleId) === 'W1'; });
check('W1 화면', w1.length, 10);
check('W1 블록 종류', w1[0].blockKind, 'build-set');
check('W2·W3 는 화면 하나씩', wq.length - w1.length, 2);

console.log('\n[2] 엔진 — 같은 태스크 안에서만 열린다');
var full = res.screens;
function idxOf(id) {
  for (var i = 0; i < full.length; i++) { if (full[i].id === id) return i; }
  return -1;
}
var i2 = idxOf(w1[1].id);          // W1 두 번째 문항
var m = window.SG_EXAM.create(full, { mode: 'exam' });
m.restoreTo(i2, 0);
m.start(i2);
ok('W1 2번째에서 Back 열림', m.canBack() === true);
ok('back() 성공', m.back('manual') === true);
check('돌아간 화면', m.current().id, w1[0].id);
ok('W1 첫 문항에서는 Back 닫힘', m.canBack() === false);
ok('next() 로 다시 앞으로', m.next('manual') === true);
check('되돌아온 화면', m.current().id, w1[1].id);

/* 태스크 경계 — W2 는 W1 과 moduleId 가 다르므로 backable() 이 거짓이다.
   화면 사이에 taskEnd(moduleEnd) 화면도 끼어 있어 이중으로 막힌다. */
var w2 = wq.filter(function (s) { return String(s.moduleId) === 'W2'; })[0];
var m2 = window.SG_EXAM.create(full, { mode: 'exam' });
m2.restoreTo(idxOf(w2.id), 0);
m2.start(idxOf(w2.id));
ok('W2 에서 W1 로는 못 넘어간다', m2.canBack() === false);

console.log('\n[3] 셸 배선 (소스 확인 — DOM 없이)');
var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
var backLine = shell.match(/var showBack = [^;]*;/);
ok('showBack 줄 존재', !!backLine, backLine ? backLine[0] : 'none');
ok('Back 이 writing 에도 선다', !!backLine && backLine[0].indexOf("'writing'") >= 0, backLine ? backLine[0] : '');
ok('Back 이 reading 에서 사라지지 않았다', !!backLine && backLine[0].indexOf("'reading'") >= 0);
ok('Back 은 문항 화면에서만', !!backLine && backLine[0].indexOf("t === 'question'") >= 0);
/* Next 는 라이팅에서 따로 막는 조건이 없어야 한다. 셸에서 Next 를 비활성으로 만드는
   자리는 오디오 잠금 하나뿐이고(리스닝), showAdvance 는 스피킹 녹음·안내 방송만 뺀다. */
ok('Next 비활성 조건은 오디오 잠금 하나뿐',
  /adv\.disabled = gated;/.test(shell) && (shell.match(/adv\.disabled\s*=/g) || []).length === 1);
ok('showAdvance 는 스피킹 녹음·안내 방송만 제외',
  /var showAdvance = !speakingLive && !announcement;/.test(shell));

console.log('');
if (fails.length) { console.log('FAILED ' + fails.length + ': ' + fails.join(', ')); process.exit(1); }
console.log('ALL PASS');
