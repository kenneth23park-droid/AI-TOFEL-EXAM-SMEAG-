/* 섹션별 응시 — 범위를 바꿔 들어와도 앞서 친 시험은 지워지지 않고 같은 응시에 얹힌다.
 * 실행: node "studyground/tests/test_section_rescope.js"
 *
 * 발주 요구(2026-08-14): "문제가 생겨 어드민 허가를 얻고 시험을 나가더라도 기존 시험
 * 내용은 지우지 말고 반영해야 한다. 섹션별로 시험을 치를 수 있도록 기존 시험 데이터를
 * 유지하라."
 *
 * 이전 동작 — 전체로 치던 세션에 리딩만(mode=section) 들어오면 timingHash 가 어긋나
 * 셸이 새 세션을 열었다. 옛 세션은 지워지지는 않지만 submittedAt 이 없어 성적표에도
 * 리뷰에도 뜨지 않는다. 학생 눈에는 이미 친 영역이 사라진 것이다.
 *
 * 여기서 고정하는 성질.
 *  [1] 범위를 바꿔도 세션 id 는 그대로고, 다른 영역 답안은 한 글자도 지워지지 않는다.
 *  [2] 남은 시간이 있는 시계는 그대로. 새 범위에서 이미 만료된 시계만 지운다.
 *  [3] 만료된 시계를 지웠으면 그 영역의 첫 화면부터, 아니면 나가던 자리 그대로.
 *  [4] 지우기 전에 백업본이 한 벌 뜬다. 제출 시각은 여전히 비어 있다(계속 칠 수 있다).
 *  [5] 셸은 범위만 달라진 미제출 응시에 새 세션을 열지 않는다(rescopable 배선).
 *  [6] 제출하면 네 영역이 한 응시로 함께 채점된다 — 채점은 세션의 답안 전체를 읽는다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

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

load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-engine.js');
load('assets/exam-store.js');
load('assets/exam-localdb.js');
load('assets/exam-resume.js');

var STORE = window.SG_STORE;
var LDB = window.SG_LDB;
var RESUME = window.SG_RESUME;
var EXAM = window.SG_EXAM;

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var ALL = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, timing, { profile: 'toefl' }).screens;

/* 셸의 scopeScreens 와 같은 자르기 — 그 섹션 화면 + 제출 화면. */
function scoped(section) {
  var only = [], submit = null, i;
  for (i = 0; i < ALL.length; i++) {
    if (ALL[i].section === section) only.push(ALL[i]);
    else if (ALL[i].screenType === 'review') submit = ALL[i];
  }
  if (submit && only.length && only[only.length - 1].screenType !== 'review') only.push(submit);
  return only;
}

function firstQuestionId(list, section) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].section === section && list[i].questionIds && list[i].questionIds.length) {
      return list[i].questionIds[0];
    }
  }
  return null;
}

var NOW = 1700000000000;
var LISTEN = scoped('listening');
ok('리스닝만 자른 화면열이 있다', LISTEN.length > 1, LISTEN.length + ' screens');

/* ── [1] 답안 보존 ──────────────────────────────────────────── */
console.log('\n[1] 범위를 바꿔도 같은 응시다 — 앞서 친 영역은 그대로');

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-full');
RESUME.attach('sess-full', 0);
STORE.saveMeta({
  session: 'sess-full', contentHash: 'C1', timingHash: 'T-full',
  startedAt: NOW - 3600000, submittedAt: null, screenCount: ALL.length
});

var rq = firstQuestionId(ALL, 'reading');
var lq = firstQuestionId(ALL, 'listening');
STORE.upsertAnswer(rq, 'B');
STORE.upsertAnswer('W1-1', '어제 쓴 에세이');
STORE.flushAnswers();
STORE.saveCursor(ALL[3].id, 3, 0);

var before = Object.keys(STORE.answers()).sort().join(',');

var res1 = RESUME.applyRescope(STORE, LISTEN, 'listening', 'T-listening', NOW);

eq('세션은 그대로', STORE.current(), 'sess-full');
eq('답안은 한 글자도 안 지워졌다', Object.keys(STORE.answers()).sort().join(','), before);
eq('리딩 답', STORE.getAnswer(rq).v, 'B');
eq('라이팅 원고', STORE.getAnswer('W1-1').v, '어제 쓴 에세이');
eq('timingHash 는 새 범위 것으로', STORE.meta().timingHash, 'T-listening');
eq('contentHash 는 그대로', STORE.meta().contentHash, 'C1');
eq('[4] 제출 시각은 아직 없다', STORE.meta().submittedAt, null);
eq('screenCount 는 새 범위', STORE.meta().screenCount, LISTEN.length);

/* ── [2] 시계 ───────────────────────────────────────────────── */
console.log('\n[2] 시계 — 남은 것은 두고, 이 범위에서 끝난 것만 지운다');

var lKeys = RESUME.clockKeysOfScreens(LISTEN, EXAM.clockKeyFor);
var lKeyList = Object.keys(lKeys);
ok('리스닝 화면열의 clock key 를 뽑았다', lKeyList.length > 0, lKeyList.join(' '));

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-clock');
STORE.saveMeta({ session: 'sess-clock', contentHash: 'C1', timingHash: 'T-full', submittedAt: null });
STORE.upsertAnswer(rq, 'A');
STORE.flushAnswers();
STORE.saveCursor(ALL[3].id, 3, 0);

var clocks = { 'section:reading': NOW + 600000 };   // 리딩은 10분 남았다
clocks[lKeyList[0]] = NOW + 300000;                 // 리스닝도 5분 남았다
STORE.saveClocks(clocks);

var res2 = RESUME.applyRescope(STORE, LISTEN, 'listening', 'T-listening', NOW);
eq('아무 시계도 안 지웠다', res2.clearedClocks.length, 0);
eq('다른 영역(리딩) 시계는 그대로', STORE.clocks()['section:reading'], NOW + 600000);
eq('이 영역 남은 시간도 그대로', STORE.clocks()[lKeyList[0]], NOW + 300000);

// 이번엔 리스닝 시계가 이미 끝나 있다.
var dead = { 'section:reading': NOW + 600000 };
dead[lKeyList[0]] = NOW - 1000;
STORE.saveClocks(dead);
var res3 = RESUME.applyRescope(STORE, LISTEN, 'listening', 'T-listening', NOW);
eq('끝난 시계는 지운다', res3.clearedClocks.join(','), lKeyList[0]);
ok('지운 뒤에는 그 key 가 없다', !STORE.clocks().hasOwnProperty(lKeyList[0]),
   JSON.stringify(STORE.clocks()));
eq('다른 영역 시계는 여전히 그대로', STORE.clocks()['section:reading'], NOW + 600000);
eq('답안은 여전히 남는다', STORE.getAnswer(rq).v, 'A');

/* ── [3] 안착 자리 ──────────────────────────────────────────── */
console.log('\n[3] 어디서 여는가');

eq('[3] 시계를 지웠으면 그 영역 첫 화면', res3.screenIndex, 0);
eq('커서가 이 범위 밖이면 첫 화면', res2.screenIndex, 0);

// 나가던 자리가 이 범위 안이면 그 자리에서 연다.
STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-mid');
STORE.saveMeta({ session: 'sess-mid', contentHash: 'C1', timingHash: 'T-full', submittedAt: null });
STORE.saveCursor(LISTEN[2].id, 999, 0);            // 저장된 숫자는 엉뚱해도 된다
STORE.saveClocks({});
var res4 = RESUME.applyRescope(STORE, LISTEN, 'listening', 'T-listening', NOW);
eq('나가던 화면 그대로', res4.screenIndex, 2);
eq('커서도 그 화면을 가리킨다', STORE.cursor().screenId, LISTEN[2].id);

/* ── [4] 백업본 ─────────────────────────────────────────────── */
console.log('\n[4] 손대기 전에 한 벌 뜬다');

var arch = null;
LDB.archives(function (err, list) { arch = list || []; });
ok('백업본이 쌓였다', arch.length > 0, arch.length + '벌');
ok('사유가 rescope_ 로 적힌다', String(arch[0].rec.reason).indexOf('rescope_') === 0,
   arch[0].rec.reason);

/* ── [5] 셸 배선 ────────────────────────────────────────────── */
console.log('\n[5] 셸 — 범위만 바뀐 미제출 응시에 새 세션을 열지 않는다');

var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
ok('rescopable 을 판단한다', /rescopable\s*=[\s\S]{0,200}timing_changed/.test(shell));
ok('rescopable 이면 새 세션을 열지 않는다',
   /offlineSessionId\(\);?[\s\S]{0,0}/.test(shell) &&
   /session === active && !rescopable\)\s*\{/.test(shell));
ok('rescopable 이면 선택 화면을 띄운다', shell.indexOf('buildScopeChoices') > 0);
ok('이어 가기는 applyRescope 를 부른다', /applyRescope\(STORE, screens, section/.test(shell));
ok('세트·문항이 바뀐 경우는 제외한다(sameContent)', /sameContent\(contentHash\)/.test(shell));

/* ── [6] 함께 채점 ──────────────────────────────────────────── */
console.log('\n[6] 제출하면 한 응시로 함께 채점된다');

ok('채점은 화면열이 아니라 세션의 답안 전체를 읽는다',
   /SG_RESULTS\.score\([\s\S]{0,120}?STORE\.answers\(\)\)/.test(shell));

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all passed');
