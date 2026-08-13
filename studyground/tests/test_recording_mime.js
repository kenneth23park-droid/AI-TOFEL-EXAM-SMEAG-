/* 녹음 업로드의 Content-Type — node 전용.
 * 실행: node "studyground/tests/test_recording_mime.js"
 *
 * 2026-08-12 시험에서 스피킹 녹음 61건이 전부 Storage 에 400(InvalidMimeType)으로
 * 거절당했다. 파일은 한 장도 올라가지 않았고, 학생 화면에는 "계정에 저장되었습니다"
 * 만 떴다. 원인은 한 줄이다 — MediaRecorder 가 주는 타입은 'audio/webm;codecs=opus'
 * 인데 버킷의 allowed_mime_types 는 'audio/webm' 만 알고 있었다.
 *
 * 여기서 고정하는 성질.
 *  [1] 두 업로드 경로(시험 중 exam-cloud · 제출 후 sg-results)가 보내는 Content-Type 에
 *      코덱 파라미터가 없다. 확장자는 여전히 전체 문자열로 고른다(webm/m4a/ogg).
 *  [2] 실패는 조용하지 않다 — 이유가 호출자에게 돌아오고, 제출 화면이 그것을 말한다.
 *  [3] 회수 페이지(recover-recordings.html)도 같은 규칙으로 보낸다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
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

global.window = global;
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

var calls = [];
var storageStatus = 200;
global.fetch = function (url, opts) {
  calls.push({ url: url, opts: opts || {} });
  var isStorage = String(url).indexOf('/storage/v1/object/') > 0;
  var st = isStorage ? storageStatus : 200;
  return Promise.resolve({
    ok: st >= 200 && st < 300,
    status: st,
    text: function () {
      return Promise.resolve(st === 400
        ? '{"error":"invalid_mime_type","message":"mime type audio/webm;codecs=opus is not supported"}'
        : '');
    },
    json: function () { return Promise.resolve([]); }
  });
};
function storageCalls() {
  return calls.filter(function (c) { return String(c.url).indexOf('/storage/v1/object/') > 0; });
}
function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
function blobOf(size, type) { return { size: size, type: type }; }

var OPUS = 'audio/webm;codecs=opus';

/* ── [1] 시험 중 업로드 (exam-cloud.js) ─────────────────────── */

async function main() {
  console.log('\n[1] 시험 중 업로드 — 코덱을 떼고 보낸다');

  global.SG_AUTH = {
    token: function () { return Promise.resolve('tok-1'); },
    user: function () { return { id: 'u-1' }; },
    url: 'https://x.supabase.co',
    anonKey: 'anon'
  };
  load('assets/exam-cloud.js');
  var CLOUD = window.SG_CLOUD;

  CLOUD.start({ session: 'sess-A', setCode: 'SET9' });
  await settle();
  calls.length = 0;

  CLOUD.uploadMedia('S1-1', { blob: blobOf(120000, OPUS), mime: OPUS, durationMs: 45000 });
  await settle(); await settle();

  var up = storageCalls();
  eq('스토리지로 한 번 나간다', up.length, 1);
  eq('Content-Type 에 코덱이 없다', up[0].opts.headers['Content-Type'], 'audio/webm');
  ok('경로 확장자는 그대로 webm',
     String(up[0].url).indexOf('/sess-A/S1-1.webm') > 0, up[0].url);
  eq('사파리(mp4) 도 파라미터를 떼고 m4a 로', CLOUD._extOf('audio/mp4;codecs=mp4a.40.2'), 'm4a');

  /* ── [2] 제출 후 업로드 (sg-results.js) ───────────────────── */
  console.log('\n[2] 제출 후 업로드 — 같은 규칙, 그리고 실패는 말이 된다');

  // sg-results.js 가 기대하는 이웃들.
  global.SG_STORE = {
    current: function () { return 'sess-B'; },
    open: function () { return this; },
    getMedia: function (qid, cb) {
      cb(null, { questionKey: qid, blob: blobOf(90000, OPUS), mime: OPUS });
    }
  };
  global.SG_BAND = null;
  load('assets/sg-results.js');
  var R = window.SG_RESULTS;

  var row = {
    session: 'sess-B',
    answers: {
      'set9-S1-q01': { v: 'idb:set9-S1-q01', media: 'idb:set9-S1-q01', recorded: true },
      'set9-S1-q02': { v: 'idb:set9-S1-q02', media: 'idb:set9-S1-q02', recorded: true }
    }
  };

  calls.length = 0;
  var out = await R.uploadRecordings(row);
  var up2 = storageCalls();
  eq('두 문항이 올라간다', up2.length, 2);
  eq('Content-Type 에 코덱이 없다', up2[0].opts.headers['Content-Type'], 'audio/webm');
  eq('sent', out.sent, 2);
  eq('failed', out.failed, 0);

  // 400 이 돌아오는 세상 — 조용히 성공한 척하지 않는다.
  console.log('\n[3] 400 이 돌아오면 이유를 들고 나온다');
  delete store['sg2_media_up::sess-B'];      // 이미 올렸다는 표시를 지운다
  storageStatus = 400;
  calls.length = 0;
  var bad = await R.uploadRecordings(row);
  eq('sent', bad.sent, 0);
  eq('failed', bad.failed, 2);
  ok('이유가 남는다', /400/.test(bad.error || ''), bad.error);
  storageStatus = 200;

  /* ── [4] 제출 화면이 그 실패를 말한다 ─────────────────────── */
  console.log('\n[4] 제출 화면 · 회수 페이지');

  var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
  ok('exam-shell 이 push() 의 media 결과를 본다', /r\.media/.test(shell));
  ok('녹음이 실패한 제출을 "저장되었습니다" 로 끝내지 않는다',
     /could not be uploaded/.test(shell) && /올리지 못했습니다/.test(shell));

  var results = fs.readFileSync(path.join(SG2, 'assets/sg-results.js'), 'utf8');
  ok('push 가 media 를 돌려준다', /media: media/.test(results));

  var page = fs.readFileSync(path.join(SG2, 'recover-recordings.html'), 'utf8');
  ok('회수 페이지가 있다', page.length > 0);
  ok('회수 페이지도 코덱을 뗀다', /baseMime/.test(page));
  ok('회수 페이지는 기기의 녹음 저장소를 연다',
     /sg2-media/.test(page) && /recordings/.test(page));
  ok('owner 를 짐작하지 않고 sg_results 에서 찾는다',
     /sg_results\?select=session,owner/.test(page));
  ok('로그인 없이도 파일로 내려받을 수 있다', /download = name/.test(page));

  var sw = fs.readFileSync(path.join(SG2, 'sw.js'), 'utf8');
  ok('회수 페이지가 셸에 들어 있다', /'recover-recordings\.html'/.test(sw));

  /* 밀린 녹음을 다시 올리는 자리는 대시보드 하나뿐이다. 거기에 SG_STORE 가 없으면
     uploadRecordings 는 첫 줄에서 돌아서고, 요청은 나가지도 않는다 — 화면만 보면
     "올렸는데 안 올라간다" 로 보이는 그 상태다. */
  var dash = fs.readFileSync(path.join(SG2, 'dashboard.html'), 'utf8');
  ok('대시보드가 녹음 저장소(exam-store.js)를 싣는다',
     /assets\/exam-store\.js/.test(dash));
  ok('대시보드가 sg-results.js 도 싣는다', /assets\/sg-results\.js/.test(dash));
  ok('대시보드가 녹음 업로드 결과를 화면에 적는다',
     /sayMedia/.test(dash) && /r\.media/.test(dash));

  console.log('');
  if (fails.length) {
    console.log('FAILED (' + fails.length + '): ' + fails.join(', '));
    process.exit(1);
  }
  console.log('all ok');
}

main().catch(function (e) { console.error(e); process.exit(1); });
