/* 스피킹 녹음 실시간 업로드 — node 전용.
 * 실행: node "studyground/tests/test_live_media_upload.js"
 *
 * 발주 요구(2026-08-13): "학생 시험보는 동안 한 문제당 수파베이스에 바로 정보
 * 업데이트 한다. 스피킹 오디오 파일도 바로."
 *
 * 그전까지 녹음은 IndexedDB 에만 있다가 제출이 끝난 뒤 성적 화면에서 올라갔다.
 * 시험 중에 기기가 죽으면 그 녹음은 아무 데도 없었다. 여기서 고정하는 성질.
 *  [1] 녹음이 저장되면 SG_STORE 가 'media' 쓰기 알림을 낸다 — 배선 지점은 한 곳이다.
 *  [2] 그 즉시 Storage 로 올라간다. 경로는 제출 후 업로더·채점기와 같은 규칙이고
 *      x-upsert 라 두 경로가 겹쳐도 파일은 하나다.
 *  [3] 올린 뒤 toefl_submissions 에 자리(경로·길이)를 남긴다 — 채점이 찾아갈 곳.
 *  [4] 이미 올린 문항은 제출 후 업로더가 건너뛴다(sg2_media_up:: 목록을 공유한다).
 *  [5] 실패한 녹음은 큐 머리에 눌러앉지 않는다 — 꼬리로 돌아가고 답안이 먼저 나간다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

var fails = [];
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}
function eq(name, actual, expected) {
  ok(name + ': ' + JSON.stringify(actual), actual === expected,
     actual === expected ? '' : 'expected ' + JSON.stringify(expected));
}
function settle() { return new Promise(function (r) { setImmediate(r); }); }

/* ── 가짜 브라우저 ───────────────────────────────────────────── */

var store = {};
global.localStorage = {
  getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; },
  key: function (i) { return Object.keys(store)[i]; },
  get length() { return Object.keys(store).length; }
};
global.navigator = { onLine: true };
global.document = { addEventListener: function () {}, visibilityState: 'visible' };
global.addEventListener = function () {};

global.SG_AUTH = {
  token: function () { return Promise.resolve('tok-1'); },
  user: function () { return { id: 'u-1' }; }
};

var calls = [];
var nextStatus = 200;
global.fetch = function (url, opts) {
  calls.push({ url: url, opts: opts || {} });
  var st = typeof nextStatus === 'function' ? nextStatus(url) : nextStatus;
  return Promise.resolve({
    ok: st >= 200 && st < 300,
    status: st,
    text: function () { return Promise.resolve(''); },
    json: function () { return Promise.resolve([]); }
  });
};
function storageCalls() {
  return calls.filter(function (c) { return c.url.indexOf('/storage/v1/object/') > 0; });
}
function restCalls(table) {
  return calls.filter(function (c) { return c.url.indexOf('/rest/v1/' + table) > 0; });
}

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/exam-cloud.js');
var CLOUD = window.SG_CLOUD;

function blobOf(size, type) { return { size: size, type: type }; }

/* ── [1] 배선 지점: SG_STORE 가 녹음 저장을 알린다 ───────────── */
console.log('\n[1] 녹음 저장 → 쓰기 알림 → 클라우드');

var storeSrc = fs.readFileSync(path.join(SG2, 'assets/exam-store.js'), 'utf8');
ok('putMedia 가 media 알림을 낸다', storeSrc.indexOf("notifyWrite('media'") > 0);
var liveSrc = fs.readFileSync(path.join(SG2, 'assets/exam-live-boot.js'), 'utf8');
ok('live-boot 이 그 알림을 클라우드로 잇는다',
   liveSrc.indexOf("ev.type === 'media'") > 0 && liveSrc.indexOf('SG_CLOUD.uploadMedia') > 0);
var resultsSrc = fs.readFileSync(path.join(SG2, 'assets/sg-results.js'), 'utf8');
ok('제출 후 업로더도 같은 목록을 본다(sg2_media_up::)',
   resultsSrc.indexOf('sg2_media_up::') > 0);

/* ── [2] 녹음이 끝난 자리에서 곧장 올라간다 ─────────────────── */

async function main() {
  console.log('\n[2] 올라가는 자리 — {uid}/{session}/{qid}.{ext}');

  CLOUD.start({ session: 'sess-A', setCode: 'SET9' });
  await settle();
  var attemptId = CLOUD.id();
  ok('응시 행이 먼저 열린다', restCalls('toefl_attempts').length === 1 && !!attemptId, attemptId);

  calls.length = 0;
  CLOUD.uploadMedia('S1-1', { blob: blobOf(120000, 'audio/webm;codecs=opus'),
                              mime: 'audio/webm;codecs=opus', durationMs: 45000 });
  await settle(); await settle();

  var up = storageCalls();
  eq('스토리지로 한 번 나간다', up.length, 1);
  ok('경로가 규칙대로다',
     up[0].url.indexOf('/storage/v1/object/toefl-recordings/u-1/sess-A/S1-1.webm') > 0, up[0].url);
  eq('덮어쓰기를 지시한다', up[0].opts.headers['x-upsert'], 'true');
  eq('본문은 Blob 그대로', up[0].opts.body.size, 120000);
  eq('mp4 는 m4a 로 떨어진다', CLOUD._extOf('audio/mp4;codecs=mp4a.40.2'), 'm4a');

  /* ── [3] 채점이 찾아갈 자리 ──────────────────────────────── */
  console.log('\n[3] toefl_submissions — 경로와 길이를 같은 순간에');

  CLOUD.flush();
  await settle(); await settle();
  var subs = restCalls('toefl_submissions');
  eq('제출행이 나간다', subs.length, 1);
  var row = JSON.parse(subs[0].opts.body)[0];
  eq('kind', row.kind, 'speaking');
  eq('storage_path', row.storage_path, 'u-1/sess-A/S1-1.webm');
  eq('duration_ms', row.duration_ms, 45000);
  eq('attempt 에 묶인다', row.attempt_id, attemptId);
  ok('(attempt_id, question_id) 로 upsert',
     subs[0].url.indexOf('on_conflict=attempt_id,question_id') > 0, subs[0].url);

  /* ── [4] 두 번 올리지 않는다 ─────────────────────────────── */
  console.log('\n[4] 제출 후 업로더는 건너뛴다');

  var done = JSON.parse(localStorage.getItem('sg2_media_up::sess-A') || '[]');
  ok('올린 문항이 목록에 남는다', done.indexOf('S1-1') >= 0, done.join(','));

  /* ── [5] 실패한 녹음이 답안을 막지 않는다 ───────────────── */
  console.log('\n[5] 큐 — 녹음이 실패해도 답안은 먼저 나간다');

  calls.length = 0;
  nextStatus = function (url) { return url.indexOf('/storage/v1/') > 0 ? 500 : 200; };
  CLOUD.uploadMedia('S1-2', { blob: blobOf(900000, 'audio/webm'), mime: 'audio/webm', durationMs: 60000 });
  await settle(); await settle();
  eq('실패한 녹음은 큐로 내려간다', CLOUD.stats().queued > 0, true);

  // 뒤이어 답안이 들어온다. 큐 머리의 녹음이 계속 실패해도 답안은 나가야 한다.
  CLOUD.pushAnswers({ 'R1-1': { v: 'B', skill: 'reading', no: 1, qtype: 'mc' } });
  // pushAnswers 는 dirty 표시가 있어야 실으므로 markAnswer 로 알린 뒤 다시 부른다.
  CLOUD.markAnswer('R1-1');
  CLOUD.pushAnswers({ 'R1-1': { v: 'B', skill: 'reading', no: 1, qtype: 'mc' } });
  for (var i = 0; i < 8; i++) { CLOUD.flush(); await settle(); await settle(); }

  var ans = restCalls('toefl_answers');
  ok('답안은 막히지 않고 나갔다', ans.length >= 1, String(ans.length));
  var retried = storageCalls().length;
  ok('녹음도 다시 시도된다', retried >= 2, String(retried));

  nextStatus = 200;
  console.log('');
  if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  console.log('all passed');
}

main().catch(function (e) { console.error(e); process.exit(1); });
