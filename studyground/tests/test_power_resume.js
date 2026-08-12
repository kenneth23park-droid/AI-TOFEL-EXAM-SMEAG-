/* 정전 복구 — 답안 실시간 저장과 되감기 다섯 갈래. node 전용.
 * 실행: node "studyground/tests/test_power_resume.js"
 *
 * 발주 요구(2026-08-12): "시험 답안은 실시간으로 항상 저장, 수파베이스와 로컬
 * 데이터베이스에도. 정전을 대비해서, 리쥼의 네 가지 경우가 필요하다 — 꺼지기 직전,
 * 2스텝 전, 3스텝 전, 아예 코스 다시, 전체 다시."
 *
 * 여기서 고정하는 성질.
 *  [1] 답안은 클릭 즉시 디스크에 있다 — debounce 타이머가 돌기 전에 새로고침해도 남는다.
 *      (정전은 flush 할 기회를 주지 않으므로 "나갈 때 저장"에 기댈 수 없다.)
 *  [2] 화면 전환마다 체크포인트가 한 벌씩 쌓이고, 각 벌은 그 순간의 답안·남은시간을 담는다.
 *  [3] 선택지는 남은 체크포인트 수에 맞춰 열린다 — 없는 '3스텝 전'은 내지 않는다.
 *  [4] 되감으면 답안이 그 시점으로 돌아가고, 시계는 남아 있던 시간으로 다시 걸린다
 *      (정전으로 흘러간 시간은 돌려준다).
 *  [5] '이 코스 처음부터'는 그 영역 답안만 지운다 — 다른 영역은 건드리지 않는다.
 *  [6] 클라우드 전송은 멱등한 upsert 로 나간다(같은 문항 두 번 보내도 한 줄).
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }

var fails = [];
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}
function eq(name, actual, expected) {
  ok(name + ': ' + JSON.stringify(actual), actual === expected,
     actual === expected ? '' : 'expected ' + JSON.stringify(expected));
}

load('assets/exam-store.js');
load('assets/exam-resume.js');

var STORE = window.SG_STORE;
var RESUME = window.SG_RESUME;

/* ── [1] 클릭 답안은 debounce 를 기다리지 않는다 ─────────────── */
console.log('\n[1] 정전 대비 — 객관식 답은 즉시 디스크로');

var backend = STORE.memoryBackend();
STORE.setBackend(backend);
STORE.open('sess-A');
STORE.upsertAnswer('R1-1', 'B');

// 타이머를 한 번도 돌리지 않은 채로 백엔드를 직접 읽는다 = 전원이 끊긴 상황.
var rawNow = JSON.parse(backend.getItem('sg2_attempt::sess-A::answers') || '{}');
ok('타이머 전에 이미 디스크에 있다', !!(rawNow['R1-1'] && rawNow['R1-1'].v === 'B'),
   JSON.stringify(rawNow['R1-1'] || null));

// 긴 글(Writing)만 모아 쓴다 — 그래야 타이핑 한 글자마다 5MB 를 다시 쓰지 않는다.
var longText = new Array(200).join('x');
STORE.upsertAnswer('W1-1', longText);
var rawLong = JSON.parse(backend.getItem('sg2_attempt::sess-A::answers') || '{}');
ok('긴 원고는 200ms 로 모은다', !rawLong['W1-1'] || rawLong['W1-1'].v !== longText,
   '즉시 쓰기 대상이 아니다');
STORE.flushAnswers();
var rawFlushed = JSON.parse(backend.getItem('sg2_attempt::sess-A::answers') || '{}');
ok('flush 하면 원고도 디스크에', rawFlushed['W1-1'] && rawFlushed['W1-1'].v === longText);

/* 쓰기 관찰자 — 로컬 DB·클라우드 미러링이 여기에 붙는다. */
var seen = [];
STORE.onWrite(function (ev) { seen.push(ev.type); });
STORE.upsertAnswer('R1-2', 'C');
ok('쓰기 알림이 나간다(answer·answers)',
   seen.indexOf('answer') >= 0 && seen.indexOf('answers') >= 0, seen.join(','));

/* ── [2] 체크포인트 ──────────────────────────────────────────── */
console.log('\n[2] 화면 전환마다 한 벌');

var NOW = 1000000;
var screens = [
  { id: 'R-intro', section: 'reading', questionIds: [] },
  { id: 'R1-q1', section: 'reading', questionIds: ['R1-1'] },
  { id: 'R1-q2', section: 'reading', questionIds: ['R1-2'] },
  { id: 'L-intro', section: 'listening', questionIds: [] },
  { id: 'L1-q1', section: 'listening', questionIds: ['L1-1'] }
];

function fakeMachine(index) {
  return {
    current: function () { return screens[index]; },
    currentIndex: function () { return index; },
    phaseIndex: function () { return 0; }
  };
}

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-B');
RESUME.attach('sess-B', 0);

var cps = [];
// 다섯 화면을 지나며, 화면마다 답을 하나씩 남긴다.
for (var i = 0; i < screens.length; i++) {
  var qids = screens[i].questionIds;
  if (qids.length) STORE.upsertAnswer(qids[0], 'ans-' + i);
  var cl = { 'section:reading': NOW + 600000 };
  cl['screen:' + screens[i].id] = NOW + 60000;
  STORE.saveClocks(cl);
  cps.push(RESUME.capture(fakeMachine(i), STORE, NOW + i * 1000));
}

eq('체크포인트 다섯 벌', cps.length, 5);
eq('스텝은 1부터 오름차순', cps[0].step + '/' + cps[4].step, '1/5');
eq('마지막 벌의 화면', cps[4].screenId, 'L1-q1');
ok('벌마다 그 순간 답안이 담긴다',
   Object.keys(cps[1].answers).length === 1 && Object.keys(cps[4].answers).length === 3,
   Object.keys(cps[4].answers).join(','));
ok('남은 시간이 함께 담긴다(remain)',
   cps[4].remain['section:reading'] === 600000 - 4000,
   String(cps[4].remain['section:reading']));

/* ── [3] 선택지 ─────────────────────────────────────────────── */
console.log('\n[3] 다섯 갈래 — 있는 것만 연다');

var opts = RESUME.optionsFor(cps, { section: 'listening' });
var kinds = opts.map(function (o) { return o.kind + (o.back ? o.back : ''); });
eq('다섯 줄', kinds.join(' '), 'last back2 back3 course fresh');
eq('꺼지기 직전은 마지막 스텝', RESUME.pick(cps, opts[0]).step, 5);
eq('2스텝 전', RESUME.pick(cps, opts[1]).step, 4);
eq('3스텝 전', RESUME.pick(cps, opts[2]).step, 3);

var few = RESUME.optionsFor(cps.slice(0, 2), { section: 'reading' });
eq('두 벌뿐이면 3스텝 전은 없다',
   few.map(function (o) { return o.kind + (o.back || ''); }).join(' '),
   'last back2 course fresh');

var none = RESUME.optionsFor([], {});
eq('한 벌도 없으면 전체 다시만', none.map(function (o) { return o.kind; }).join(' '), 'fresh');

/* ── [4] 되감기 ─────────────────────────────────────────────── */
console.log('\n[4] 3스텝 전으로 — 답안은 그때로, 시간은 돌려받는다');

var LATER = NOW + 30 * 60 * 1000;      // 정전으로 30분이 흘렀다
var target = RESUME.pick(cps, opts[2]); // 3스텝 전 = step 3 (R1-q2)
var applied = RESUME.applyCheckpoint(STORE, target, LATER);

eq('돌아간 화면', STORE.cursor().screenId, 'R1-q2');
eq('돌아간 화면 index', applied.screenIndex, 2);
var after = STORE.answers();
ok('그 뒤에 쓴 답은 사라진다', !after['L1-1'], JSON.stringify(Object.keys(after)));
ok('그 전에 쓴 답은 남는다', !!after['R1-1'] && !!after['R1-2'], Object.keys(after).join(','));

var clocksNow = STORE.clocks();
eq('시계는 남아 있던 시간으로 다시 걸린다',
   clocksNow['section:reading'] - LATER, 600000 - 2000);
ok('정전 30분은 소모되지 않았다', clocksNow['section:reading'] > LATER);

/* ── [5] 이 코스 처음부터 ───────────────────────────────────── */
console.log('\n[5] 코스 다시 — 그 영역만 지운다');

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-C');
STORE.upsertAnswer('R1-1', 'a');
STORE.upsertAnswer('R1-2', 'b');
STORE.upsertAnswer('L1-1', 'c');
STORE.saveClocks({ 'section:reading': NOW + 600000, 'section:listening': NOW + 900000 });

var course = RESUME.applyCourseRestart(STORE, screens, 'reading');
eq('리딩 첫 화면으로', course.screenIndex, 0);
var left = Object.keys(STORE.answers()).sort().join(',');
eq('리딩 답안만 지워진다', left, 'L1-1');
var cl = STORE.clocks();
ok('리딩 시계는 새로 건다', cl['section:reading'] === undefined);
ok('리스닝 시계는 그대로', cl['section:listening'] === NOW + 900000);

/* ── [6] 클라우드 경로 ──────────────────────────────────────── */
console.log('\n[6] 클라우드 — 멱등 upsert 로 나간다');

var cloudSrc = fs.readFileSync(path.join(SG2, 'assets/exam-cloud.js'), 'utf8');
ok('답안은 (attempt_id, question_id) 로 upsert',
   cloudSrc.indexOf('toefl_answers?on_conflict=attempt_id,question_id') > 0);
ok('체크포인트는 (attempt_id, step) 으로 upsert',
   cloudSrc.indexOf('toefl_checkpoints?on_conflict=attempt_id,step') > 0);
ok('merge-duplicates 를 지시한다', cloudSrc.indexOf('resolution=merge-duplicates') > 0);
ok('미전송분은 로컬 DB 큐에 남는다', cloudSrc.indexOf('SG_LDB.queuePush') > 0);
ok('탭이 숨거나 닫힐 때 밀어 넣는다',
   cloudSrc.indexOf("'pagehide'") > 0 && cloudSrc.indexOf("'visibilitychange'") > 0);

var shellSrc = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
ok('셸이 되감기 선택지를 그린다', shellSrc.indexOf('buildResumeChoices') > 0);
ok('옛 두 칸(btn-resume/btn-restart)은 더 부르지 않는다',
   shellSrc.indexOf("getElementById('btn-resume')") < 0);

var liveSrc = fs.readFileSync(path.join(SG2, 'assets/exam-live-boot.js'), 'utf8');
ok('로컬 DB 미러링이 답안 쓰기에 붙는다', liveSrc.indexOf('SG_LDB.saveAnswers') > 0);
ok('화면 전환마다 체크포인트', liveSrc.indexOf('machine.onTransition') > 0);

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all passed');
