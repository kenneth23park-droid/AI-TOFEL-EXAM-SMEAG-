/* 스피킹 진행 규칙 두 가지 — node 전용.
 * 실행: node "studyground/tests/test_speaking_beep_announcement.js"
 *
 *  1) 안내 방송이 끝나면 응시자를 기다리지 않고 다음 화면으로 간다.
 *     (실패하면 응시자가 Begin 을 누를 때까지 시험이 멈춘다)
 *  2) 녹음 시작 신호음이 울리는 시간만큼 응답 시계가 늦게 걸린다.
 *     (실패하면 8초짜리 문항에서 아직 마이크가 열리기도 전에 시간이 깎인다)
 *
 * DOM 은 이 검증에 필요 없다 — 두 규칙 다 렌더 결과가 아니라 "언제 무엇을 부르는가"다.
 */
var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');

global.window = global;
global.document = null;          // 두 파일 모두 document 없이도 로드된다
var timers = [];
global.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
global.clearTimeout = function (id) { if (timers[id - 1]) timers[id - 1].fn = null; };

require(path.join(SG2, 'assets', 'exam-render-instruction.js'));
require(path.join(SG2, 'assets', 'exam-render-speaking.js'));

var fails = 0;
function ok(label, got, want) {
  var pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails += 1;
  console.log((pass ? '  ok   ' : '  FAIL ') + label + ': ' + JSON.stringify(got) +
              (pass ? '' : ' (expected ' + JSON.stringify(want) + ')'));
}

function fakeEngine(currentId) {
  var calls = [];
  return {
    calls: calls,
    next: function (how) { calls.push(how); },
    current: function () { return { id: currentId }; }
  };
}

/* ── 1) 안내 방송 ────────────────────────────────────────── */
console.log('\n[1] 안내 방송이 끝나면 자동으로 다음 화면');

var A = window.SG_INSTRUCTION.autoAdvanceOnAnnouncement;
var speaking = { id: 'speaking.intro.S1', section: 'speaking' };

ok('리스닝 안내 화면에는 붙지 않는다',
   A({ id: 'listening.directions', section: 'listening' }, { engine: fakeEngine('x') }), null);
ok('엔진이 없으면 붙지 않는다', A(speaking, {}), null);

var eng = fakeEngine('speaking.intro.S1');
var onEnded = A(speaking, { engine: eng });
ok('스피킹 안내 화면에는 붙는다', typeof onEnded, 'function');

timers = [];
onEnded('error');
ok('오디오를 못 틀었으면 넘기지 않는다 (상단바 진행 버튼이 되살아난다)', timers.length, 0);

onEnded('ended');
ok('방송이 끝나면 한 박자 뒤 넘긴다', timers.length, 1);
ok('한 박자 = 700ms', timers[0].ms, 700);
timers[0].fn();
ok('엔진에 자동 전진을 시킨다', eng.calls, ['auto']);

// 늦게 도착한 ended 가 이미 넘어간 화면을 한 칸 더 밀면 안 된다.
var late = fakeEngine('speaking.q.S1.01');       // 이미 첫 문항으로 넘어간 상태
var lateEnded = A(speaking, { engine: late });
timers = [];
lateEnded('ended');
timers[0].fn();
ok('화면이 이미 바뀌었으면 넘기지 않는다', late.calls, []);

/* 안내 방송 화면에는 진행 버튼을 두지 않는다 — 카드 안 CTA 도, 상단바 버튼도.
   exam-shell.js 의 syncActions 가 이 판정을 그대로 쓰므로, 여기가 정본이다. */
console.log('\n[1c] 안내 방송 화면 판정 (= 진행 버튼을 감출 화면)');
var IS = window.SG_INSTRUCTION.isAnnouncement;
ok('스피킹 Task 안내(방송 있음)',
   IS({ screenType: 'instruction', section: 'speaking', audio: { src: 's2-instructions.mp3' } }), true);
ok('스피킹 섹션 Directions(방송 없음)',
   IS({ screenType: 'instruction', section: 'speaking' }), false);
ok('리스닝 안내는 방송이 있어도 아니다',
   IS({ screenType: 'instruction', section: 'listening', audio: { src: 'a.mp3' } }), false);
ok('문항 화면은 아니다',
   IS({ screenType: 'speaking', section: 'speaking', audio: { src: 'a.mp3' } }), false);
ok('빈 값에 터지지 않는다', IS(null), false);

/* 렌더러가 부르는 것은 fake 가 아니라 진짜 엔진이다. 엔진이 'auto' 를 거절하면
   위의 [1] 이 전부 통과해도 화면은 그대로 서 있는다 — 실제로 한 번 밟은 함정이다. */
console.log('\n[1b] 엔진이 auto 전진을 받는다 (advance:"manual" 안내 화면에서도)');
require(path.join(SG2, 'assets', 'exam-engine.js'));
var m = window.SG_EXAM.create([
  { id: 'speaking.intro.S1', screenType: 'instruction', section: 'speaking', advance: 'manual', timer: null },
  { id: 'speaking.q.S1.01', screenType: 'speaking', section: 'speaking', advance: 'auto', timer: null, phases: [] }
], { mode: 'practice' });
m.start(0);
ok('auto 전진을 받아들인다', m.next('auto'), true);
ok('다음 화면으로 갔다', m.current().id, 'speaking.q.S1.01');

var m2 = window.SG_EXAM.create([
  { id: 'speaking.intro.S1', screenType: 'instruction', section: 'speaking', advance: 'manual', timer: null },
  { id: 'speaking.q.S1.01', screenType: 'speaking', section: 'speaking', advance: 'auto', timer: null, phases: [] }
], { mode: 'practice' });
m2.start(0);
ok('시간 만료로는 여전히 안 넘어간다 (안내 화면 보호)', m2.next('expire'), false);
ok('아무 뜻 없는 사유는 거절한다', m2.next('nonsense'), false);

/* ── 2) 녹음 신호음 ──────────────────────────────────────── */
console.log('\n[2] 녹음 시작 신호음');

var S = window.SG_SPEAKING;
ok('신호음은 880Hz', S.BEEP_HZ, 880);
ok('신호음 길이 0.28초', S.BEEP_SEC, 0.28);
ok('마이크는 신호음이 끝나고 열린다 (소리+여유 400ms)', S.beepMs(), 400);
ok('신호음이 응답 시간보다 훨씬 짧다 (가장 짧은 문항 8초)', S.beepMs() < 8000, true);

/* 신호음을 넣어도 phase 전이 자체는 한 줄도 달라지지 않는다 —
   달라졌다면 phases 루프에 분기가 생긴 것이고, 그건 이 설계의 실패다. */
var phases = [
  { name: 'listen', seconds: 0, media: { kind: 'audio', src: 'a.mp3' } },
  { name: 'prep', seconds: 3 },
  { name: 'record', seconds: 8 }
];
var st = S.initialState({ phases: phases }, 0);
var out = S.nextPhase(st, { type: 'start' });
ok('start → listen', out.phases[out.phaseIndex].name, 'listen');
out = S.nextPhase(out, { type: 'mediaEnded' });
out = S.nextPhase(out, { type: 'expire' });
ok('prep 만료 → record 진입 액션', out.actions, ['startRecord']);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
