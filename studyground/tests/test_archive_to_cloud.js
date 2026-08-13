/* 백업본은 기기 밖에도 남는다, 그리고 회차로 구분된다. node 전용.
 * 실행: node "studyground/tests/test_archive_to_cloud.js"
 *
 * 발주 요구(2026-08-13): "다시 시작하더라도 기존 데이타도 저장해줘 구분해서."
 *
 * 앞선 test_backup_before_reset.js 는 "지우기 전에 한 벌 뜬다"까지를 붙잡는다.
 * 그 백업본은 학생 기기의 IndexedDB(SG_LDB.arch)에만 있었다 — 기기를 초기화하면
 * 사라지고, 선생님은 애초에 볼 수 없었다. 여기서 붙잡는 것은 그다음이다.
 *
 *  [1] 백업본은 클라우드(sg_archives)로도 간다 — 같은 스냅샷, 같은 사유.
 *  [2] 로컬 DB 가 없어도 클라우드로는 간다(그 반대도 마찬가지다).
 *  [3] 백업본은 attempt 없이도 올라간다 — 전체 다시 시작이면 그 attempt 자체가
 *      버려지는데, 백업본은 그것을 넘어 남아야 한다.
 *  [4] 전체 다시 시작은 클라우드 attempt 를 'abandoned' 로 적는다(지우지 않는다).
 *  [5] 성적 목록은 숨긴 응시를 세지 않는다 — 다만 다시 올리지도 않는다.
 *
 * 오프라인 계약은 그대로다: 큐에 쌓일 뿐 지우기를 붙잡지 않는다.
 */
'use strict';

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

/* ── 이웃 세우기 ─────────────────────────────────────────────
 * SG_CLOUD 가 기대는 바깥은 둘뿐이다: 토큰(SG_AUTH)과 fetch. 둘 다 손으로 세워
 * 주고, 오간 요청을 그대로 모아 둔다 — 이 테스트가 보는 것은 "무엇을 어디로
 * 보냈는가" 이지 서버의 대답이 아니다. */
var SENT = [];
global.SG_AUTH = {
  token: function () { return Promise.resolve('tok'); },
  user: function () { return { id: 'user-1' }; }
};
global.fetch = function (url, opts) {
  SENT.push({ url: String(url), method: (opts && opts.method) || 'GET',
              body: opts && opts.body ? JSON.parse(opts.body) : null });
  return Promise.resolve({
    ok: true, status: 200,
    text: function () { return Promise.resolve(''); },
    json: function () { return Promise.resolve([]); }
  });
};

function sentTo(fragment) {
  return SENT.filter(function (s) { return s.url.indexOf(fragment) >= 0; });
}

/* 큐는 제 시계(scheduleRetry)로 빠진다. 테스트가 그 시계를 기다리고 있을 이유는
   없으므로 flush() 를 직접 부르고, 토큰·fetch 의 프라미스가 풀릴 짬만 준다. */
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function settle() {
  return delay(20)
    .then(function () { CLOUD.flush(); return delay(20); })
    .then(function () { CLOUD.flush(); return delay(20); })
    .then(function () { CLOUD.flush(); return delay(20); });
}

load('assets/exam-store.js');
load('assets/exam-localdb.js');
load('assets/exam-cloud.js');
load('assets/exam-resume.js');

var STORE = window.SG_STORE;
var CLOUD = window.SG_CLOUD;
var RESUME = window.SG_RESUME;

/* node 에는 IndexedDB 가 없다. SG_LDB 의 상태·백업본은 메모리로 degrade 하지만
   미전송 큐는 그 폴백이 없어(브라우저에서만 도는 길) 여기서 서 준다 — 이 테스트가
   보려는 것은 큐의 저장소가 아니라 "무엇이 어디로 가는가" 다. */
(function memoryQueue() {
  var q = [], seq = 0;
  window.SG_LDB.queuePush = function (item, cb) {
    var rec = { id: (seq += 1), at: Date.now(), item: item };
    q.push(rec);
    if (cb) cb(null, rec);
    return rec;
  };
  window.SG_LDB.queueAll = function (cb) { cb(null, q.slice()); };
  window.SG_LDB.queueDrop = function (ids, cb) {
    q = q.filter(function (r) { return (ids || []).indexOf(r.id) < 0; });
    if (cb) cb(null);
  };
})();

function archivesSync() {
  var out = null;
  window.SG_LDB.archives(function (err, list) { out = list; });
  return out || [];
}

/* ── [1] 백업본이 클라우드로 간다 ───────────────────────────── */
console.log('\n[1] 되감기 직전의 한 벌 — 기기와 클라우드 두 곳으로');

STORE.setBackend(STORE.memoryBackend());
STORE.open('sess-A');
RESUME.attach('sess-A', 0);
STORE.upsertAnswer('R1-1', 'alpha');
STORE.upsertAnswer('R1-2', 'beta');
STORE.saveClocks({ 'section:reading': 1700000000000 });
STORE.saveCursor('R1-q2', 2, 0);

CLOUD.start({ session: 'sess-A', setCode: 'SET9', mode: 'exam' });

RESUME.backup(STORE, 'rewind_step_2');

var archived = null;
settle().then(function () {
  var arch = sentTo('sg_archives');
  eq('sg_archives 로 한 번 갔다', arch.length, 1);
  archived = arch.length ? arch[0] : null;
  if (!archived) return;

  eq('POST 다', archived.method, 'POST');
  ok('겹쳐 써도 한 벌이다(on_conflict)',
     archived.url.indexOf('on_conflict=owner,session,reason,client_ts') > 0, archived.url);

  var row = archived.body[0];
  eq('세션이 적힌다', row.session, 'sess-A');
  eq('사유가 적힌다', row.reason, 'rewind_step_2');
  eq('지우기 전 답안이 실린다', Object.keys(row.answers).sort().join(','), 'R1-1,R1-2');
  ok('시계도 실린다', row.clocks['section:reading'] === 1700000000000, JSON.stringify(row.clocks));
  ok('커서도 실린다', !!(row.cursor && row.cursor.screenId), JSON.stringify(row.cursor));
  ok('기기 시계가 붙는다(같은 사유를 두 번 눌러도 두 벌)', typeof row.client_ts === 'number' && row.client_ts > 0);

  /* owner 는 싣지 않는다 — 서버가 auth.uid() 로 채운다. 클라이언트가 정하면
     남의 이름으로 백업본을 남길 수 있다. */
  ok('owner 는 클라이언트가 정하지 않는다', !('owner' in row), JSON.stringify(Object.keys(row)));

  /* 기기 쪽 백업본은 그대로다 — 클라우드는 그 사본이지 대체가 아니다. */
  var local = archivesSync();
  eq('기기에도 한 벌 남는다', local.length, 1);
  eq('같은 사유다', local[0].rec.reason, row.reason);

  /* ── [2] 로컬 DB 가 없어도 간다 ───────────────────────────── */
  console.log('\n[2] 한쪽이 없어도 다른 쪽은 간다');

  var keepLdb = window.SG_LDB;
  window.SG_LDB = null;
  SENT.length = 0;
  var called = false;
  RESUME.backup(STORE, 'course_restart_reading', function () { called = true; });
  return settle().then(function () {
    eq('로컬 DB 가 없어도 클라우드로는 갔다', sentTo('sg_archives').length, 1);
    ok('콜백은 그래도 불린다 — 지우기가 멈추지 않는다', called === true);
    window.SG_LDB = keepLdb;
  });
}).then(function () {
  /* ── [3] attempt 없이도 올라간다 ──────────────────────────── */
  console.log('\n[3] 버려진 attempt 를 넘어 남는다');

  SENT.length = 0;
  CLOUD.reset('sess-A');                    // attempt 를 놓는다 = 전체 다시 시작 직후
  eq('attempt 가 없다', CLOUD.stats().attemptId, null);

  STORE.open('sess-B');
  RESUME.attach('sess-B', 0);
  STORE.upsertAnswer('L1-1', 'gamma');
  RESUME.backup(STORE, 'restart_all');
  return settle().then(function () {
    eq('그래도 백업본은 올라간다', sentTo('sg_archives').length, 1);
    var row = sentTo('sg_archives')[0].body[0];
    eq('세션은 그 세션이다', row.session, 'sess-B');
  });
}).then(function () {
  /* ── [4] · [5] 배선 ──────────────────────────────────────── */
  console.log('\n[4] 전체 다시 시작 — attempt 는 버려진 것으로 적힌다');

  var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
  var after = shell.slice(shell.indexOf("archiveThen('restart_all'"));
  ok('markAbandoned 를 부른다', after.indexOf('markAbandoned') > 0);
  ok('지우기 전에 부른다',
     after.indexOf('markAbandoned') < after.indexOf('STORE.dropSession'),
     'markAbandoned=' + after.indexOf('markAbandoned') + ' drop=' + after.indexOf('STORE.dropSession'));

  var cloud = fs.readFileSync(path.join(SG2, 'assets/exam-cloud.js'), 'utf8');
  ok("상태는 'abandoned' 다", /status:\s*'abandoned'/.test(cloud));
  ok('attempt 를 지우지는 않는다',
     cloud.slice(cloud.indexOf('function markAbandoned')).indexOf('DELETE') < 0);

  console.log('\n[5] 성적 목록 — 숨긴 응시는 세지 않되, 다시 올리지도 않는다');

  var res = fs.readFileSync(path.join(SG2, 'assets/sg-results.js'), 'utf8');
  ok('회차와 숨김을 읽어 온다', /attempt_no,hidden,hidden_reason/.test(res));
  ok('기본은 숨긴 응시를 뺀다', /hidden=is\.false/.test(res));
  ok('includeHidden 으로 켤 수 있다', /includeHidden/.test(res));
  /* push() 가 숨긴 응시를 못 보면 "서버에 없다"고 판단해 다시 올린다 —
     가려 둔 응시가 그대로 성적 목록으로 되돌아오는 자리다. */
  ok('올릴 것을 고를 때는 숨긴 응시까지 본다',
     /remote\(\{ includeHidden: true \}\)/.test(res));
  ok('가리는 길은 있고 지우는 길은 없다',
     /function setHidden/.test(res) && !/method: 'DELETE'/.test(res));
  ok('백업본을 읽는 길이 있다', /function archives/.test(res) && /sg_archives\?select=/.test(res));

  var admin = fs.readFileSync(path.join(SG2, 'admin-results.html'), 'utf8');
  ok('관리자 화면이 회차를 적는다', /attemptCell/.test(admin) && /attempt_no/.test(admin));
  ok('관리자 화면이 백업본을 편다', /loadArchives/.test(admin) && /SG_RESULTS\.archives/.test(admin));
  ok('숨긴 응시를 켜고 끌 수 있다', /show-hidden/.test(admin));
  ok('가릴 때 까닭을 적게 한다', /prompt\('왜 가립니까/.test(admin));

  console.log('');
  if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  console.log('all passed');
})['catch'](function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
