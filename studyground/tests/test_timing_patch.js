/* 시간 조정(패치) 계층 검증 — exam.html 의 시간 편집기가 기대는 계약.
 * 실행: node studyground/tests/test_timing_patch.js
 *
 * 규칙: config/timing.<exam>.json 은 정본이고 절대 바뀌지 않는다. 강사가 화면에서 바꾼 초는
 * localStorage 패치로만 남고, 로드 때 config 사본 위에 얹힌다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

// exam-timing.js 는 localStorage 를 try/catch 로 감싸 읽는다. 테스트에서는 메모리 구현을 끼운다.
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-timing.js');

var T = window.SG_TIMING;
var S = window.SMEAG_SET1;
var fails = [];

function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

function reload(profile) { T._reset(); T.loadBuiltin(profile || 'toefl'); }

var IV = 'sections.speaking.taskTypes.interview.responseSec';
var BY = 'sections.speaking.taskTypes.listenAndRepeat.responseSecByIndex';
var R1 = 'sections.reading.modules[id=R1].allocatedSec';

console.log('\n[1] 패치 없으면 규격 그대로');
store = {};
reload();
check('Interview 응답', T.get(IV), 45);
check('Listen & Repeat 문항별', T.get(BY), [8, 8, 10, 10, 10, 12, 12]);
check('적용된 조정 수', T.patched(), 0);

console.log('\n[2] 저장된 패치가 로드 때 얹힌다');
store['sg2_timing_patch'] = JSON.stringify({
  toefl: { 'sections.speaking.taskTypes.interview.responseSec': 60, 'sections.reading.modules[id=R1].allocatedSec': 1500 }
});
reload();
check('Interview 응답', T.get(IV), 60);
check('R1 제한', T.get(R1), 1500);
check('적용된 조정 수', T.patched(), 2);

console.log('\n[3] 정본(내장 폴백 리터럴)은 오염되지 않는다 — 되돌리기 기준이 살아 있어야 한다');
check('FALLBACK Interview', T.FALLBACK.sections.speaking.taskTypes.interview.responseSec, 45);
check('FALLBACK R1', T.FALLBACK.sections.reading.modules[0].allocatedSec, 1200);
check('specOf 기준값 조회', T.get(T.BUILTINS.toefl, IV), 45);

console.log('\n[4] 없는 경로는 무시하고 나머지는 적용한다 (F12 — 예외로 시험을 멈추지 않는다)');
store['sg2_timing_patch'] = JSON.stringify({ toefl: { 'sections.nope.bogus': 1, 'sections.speaking.taskTypes.interview.responseSec': 50 } });
reload();
check('적용된 조정 수', T.patched(), 1);
check('Interview 응답', T.get(IV), 50);

console.log('\n[5] setPatchValue — 저장 + 세션 config 즉시 반영(새로고침 없이 다시 그린다)');
store = {};
reload();
T.setPatchValue(IV, 30);
check('세션 값', T.get(IV), 30);
check('저장된 패치', JSON.parse(store['sg2_timing_patch']).toefl[IV], 30);

console.log('\n[6] 배열 원소 조정 — Listen & Repeat 은 문항별로 따로 잡힌다');
T.setPatchValue(BY + '[2]', 20);
check('Q3 만 바뀐다', T.get(BY), [8, 8, 20, 10, 10, 12, 12]);
T.setPatchValue(BY + '[99]', 20);
check('범위 밖 인덱스는 무시', T.get(BY), [8, 8, 20, 10, 10, 12, 12]);

console.log('\n[7] 되돌리기 — 규격값을 쓴 뒤 기록 삭제(exam.html 의 ↺ 순서)');
T.setPatchValue(IV, 45);
T.setPatchValue(IV, null);
check('세션 값이 규격으로', T.get(IV), 45);
check('기록에서 사라짐', JSON.parse(store['sg2_timing_patch']).toefl[IV], undefined);
T.clearPatch();
check('전체 삭제 후 남은 프로파일', JSON.parse(store['sg2_timing_patch']).toefl, undefined);

console.log('\n[8] 프로파일 격리 — IELTS 패치가 TOEFL 로 새지 않는다');
store['sg2_timing_patch'] = JSON.stringify({ ielts: { 'sections.speaking.taskTypes.part3.responseSec': 99 } });
reload('toefl');
check('TOEFL 적용 수', T.patched(), 0);
reload('ielts');
check('IELTS Part 3', T.get('sections.speaking.taskTypes.part3.responseSec'), 99);

console.log('\n[9] exam.html 이 만드는 조정 경로가 전부 해석된다');
store = {};
reload();
S.sections.forEach(function (section) {
  var secId = section.id;
  var sec = T.get('sections.' + secId);
  if (!sec) return;
  section.modules.forEach(function (mod) {
    var coll = (sec.modules || []).filter(function (x) { return x.id === mod.id; }).length ? 'modules' : 'tasks';
    var u = ((sec[coll] || []).filter(function (x) { return x.id === mod.id; }))[0];
    if (!u) return;
    var field = (typeof u.allocatedSec === 'number') ? 'allocatedSec'
      : (typeof u.perTaskSec === 'number') ? 'perTaskSec' : null;
    if (!field || !u[field]) return;   // speaking 은 모듈 제한이 없다 — 배지 자체가 안 뜬다
    var p = 'sections.' + secId + '.' + coll + '[id=' + mod.id + '].' + field;
    T.setPatchValue(p, 999);
    check(p, T.get(p), 999);
  });
});
var sp = T.get('sections.speaking');
[['S1', 7], ['S2', 4]].forEach(function (pair) {
  var m = (sp.modules || []).filter(function (x) { return x.id === pair[0]; })[0];
  var tt = sp.taskTypes[m.taskType];
  for (var i = 0; i < pair[1]; i++) {
    var by = tt.responseSecByIndex;
    var hasIdx = !!(by && i < by.length);
    var p = 'sections.speaking.taskTypes.' + m.taskType + (hasIdx ? '.responseSecByIndex[' + i + ']' : '.responseSec');
    T.setPatchValue(p, 33);
    check(pair[0] + ' Q' + (i + 1) + ' → ' + p, T.get(p), 33);
  }
});

console.log(fails.length ? '\n' + fails.length + ' FAIL: ' + fails.join(', ') : '\nALL PASS (시간 조정 계층)');
process.exit(fails.length ? 1 : 0);
