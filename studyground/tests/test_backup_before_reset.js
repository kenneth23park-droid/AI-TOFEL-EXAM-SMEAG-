/* 백업본 — 되감기·다시 시작 전에 한 벌 뜬다. node 전용.
 * 실행: node "studyground/tests/test_backup_before_reset.js"
 *
 * 발주 요구(2026-08-12): "resume 이나 다시 시작하더라도 기존 데이터는 백업본을 저장."
 *
 * 여기서 고정하는 성질.
 *  [1] 되감기 직전의 답안·시계·커서가 백업본(SG_LDB.arch)에 남는다.
 *  [2] '이 코스 처음부터'도 지우기 전에 한 벌 남긴다.
 *  [3] 백업본은 지우기 "전"의 값이다 — 지운 뒤를 다시 읽지 않는다.
 *  [4] dropSession(전체 다시)은 백업본을 건드리지 않는다.
 *  [5] 셸의 '전체 다시'는 백업이 끝난 뒤에만 지운다.
 *
 * node 에는 IndexedDB 가 없어 SG_LDB 는 메모리로 degrade 한다 — 그 경로도 함께 본다.
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
load('assets/exam-localdb.js');
load('assets/exam-resume.js');

var STORE = window.SG_STORE;
var LDB = window.SG_LDB;
var RESUME = window.SG_RESUME;

var NOW = 1000000;
var screens = [
  { id: 'R-intro', section: 'reading', questionIds: [] },
  { id: 'R1-q1', section: 'reading', questionIds: ['R1-1'] },
  { id: 'R1-q2', section: 'reading', questionIds: ['R1-2'] },
  { id: 'L1-q1', section: 'listening', questionIds: ['L1-1'] }
];

function fakeMachine(index) {
  return {
    current: function () { return screens[index]; },
    currentIndex: function () { return index; },
    phaseIndex: function () { return 0; }
  };
}

function archivesSync() {
  var out = null;
  LDB.archives(function (err, list) { out = list; });
  return out || [];
}

/* ── [1] 되감기 ─────────────────────────────────────────────── */
console.log('\n[1] 되감기 — 그 뒤에 쓴 답도 백업본에는 남는다');

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-A');
RESUME.attach('sess-A', 0);

var cps = [];
for (var i = 0; i < screens.length; i++) {
  var qids = screens[i].questionIds;
  if (qids.length) STORE.upsertAnswer(qids[0], 'ans-' + i);
  STORE.saveClocks({ 'section:reading': NOW + 600000 });
  STORE.saveCursor(screens[i].id, i, 0);
  cps.push(RESUME.capture(fakeMachine(i), STORE, NOW + i * 1000));
}

var before = Object.keys(STORE.answers()).sort().join(',');
eq('되감기 전 답안 세 벌', before, 'L1-1,R1-1,R1-2');

RESUME.applyCheckpoint(STORE, cps[1], NOW + 5000);   // step 2 = R1-q1 로
eq('되감으면 답안은 그때로', Object.keys(STORE.answers()).sort().join(','), 'R1-1');

var arch = archivesSync();
eq('백업본이 한 벌 생겼다', arch.length, 1);
eq('사유가 적힌다', arch[0].rec.reason.indexOf('rewind_step_') === 0, true);
eq('[3] 백업본은 지우기 전의 답안이다',
   Object.keys(arch[0].rec.answers).sort().join(','), 'L1-1,R1-1,R1-2');
ok('시계도 함께 뜬다', arch[0].rec.clocks['section:reading'] === NOW + 600000,
   JSON.stringify(arch[0].rec.clocks));
ok('커서도 함께 뜬다', !!arch[0].rec.cursor, JSON.stringify(arch[0].rec.cursor));
ok('localStorage 한 벌(local)도 담긴다',
   !!arch[0].rec.local && !!arch[0].rec.local['sg2_attempt::sess-A::answers']);

/* ── [2] 코스 다시 ──────────────────────────────────────────── */
console.log('\n[2] 이 코스 처음부터 — 지우기 전에 한 벌');

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-B');
RESUME.attach('sess-B', 0);
STORE.upsertAnswer('R1-1', 'a');
STORE.upsertAnswer('L1-1', 'c');

RESUME.applyCourseRestart(STORE, screens, 'reading');
eq('리딩 답안은 지워진다', Object.keys(STORE.answers()).sort().join(','), 'L1-1');

var arch2 = archivesSync();
eq('백업본이 두 벌', arch2.length, 2);
eq('최신이 앞에 온다', arch2[0].rec.session, 'sess-B');
eq('사유', arch2[0].rec.reason, 'course_restart_reading');
eq('지우기 전 리딩 답안이 백업본에 있다',
   Object.keys(arch2[0].rec.answers).sort().join(','), 'L1-1,R1-1');

/* ── [4] 전체 다시 ──────────────────────────────────────────── */
console.log('\n[4] 전체 다시 — 세션을 지워도 백업본은 남는다');

var kept = null;
LDB.dropSession('sess-B', function () {});
kept = archivesSync();
eq('백업본 수는 그대로', kept.length, 2);
ok('세션 상태는 지워졌다', (function () {
  var v = 'unset';
  LDB.getState('sess-B', 'answers', function (e, x) { v = x; });
  return v === null || v === undefined || (v && Object.keys(v).length === 0);
})());

/* ── [5] 셸 배선 ────────────────────────────────────────────── */
console.log('\n[5] 셸 — 백업이 끝난 뒤에 지운다');

var shellSrc = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
ok('전체 다시는 archiveThen 안에서 지운다',
   /archiveThen\([^)]*,\s*function[\s\S]{0,200}dropSession/.test(shellSrc));
ok('백업이 늦어도 시험은 진행한다(타임아웃 우회)', shellSrc.indexOf('setTimeout(once') > 0);

var ldbSrc = fs.readFileSync(path.join(SG2, 'assets/exam-localdb.js'), 'utf8');
ok('dropSession 은 arch 를 지우지 않는다',
   ldbSrc.indexOf('S_ARCH') > 0 && !/dropSession[\s\S]*?S_ARCH/.test(ldbSrc.slice(ldbSrc.indexOf('function dropSession'))));

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all passed');
