/* 시험장에서 난 일이 메일함까지 간다 — node 전용.
 * 실행: node "studyground/tests/test_exam_notify.js"
 *
 * 발주 요구(2026-08-13): "시험중 문제가 있거나 완료 및 채점등을 이메일로 받아볼수
 * 있도록 해줘 — jitnet57@gmail.com · ai@smeagschool.com".
 *
 * 왜 이 성질들인가. 알림은 두 번 실패할 수 있다. 안 가서 실패하거나(2026-08-12 의
 * 녹음 61건처럼 아무도 그날 모른다), 너무 가서 실패한다(한 회차가 메일 60통이 되면
 * 그 메일함은 곧 안 읽힌다). 그리고 절대로 시험을 멈춰서는 안 된다.
 *
 *  [1] 사고가 나면 /api/notify 로 한 통 간다 — 세션·세트·코드가 실려서.
 *  [2] 같은 사고는 한 번만 간다(session, kind, code 하나당 한 통).
 *  [3] 오프라인·비로그인이면 던지지 않고 기기 큐에 눌러 둔다. 온라인이 되면 나간다.
 *  [4] 녹음을 끝내 못 올리면 exam-cloud 가 그 사실을 밖으로 낸다('dropped').
 *  [5] 제출 화면은 사고를 그 자리에서 알리고, 끝에 완료 메일 한 통을 보낸다.
 *  [6] 서버는 학생이 보낸 글을 믿지 않는다 — 제목에 개행이 없고, 본문은 이스케이프된다.
 *  [7] 기본 수신자는 발주에 적힌 두 주소다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var fails = [];
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}
function settle() { return new Promise(function (r) { setImmediate(r); }); }

/* ── 가짜 브라우저 ───────────────────────────────────────────── */

global.window = global;
var store = {};
global.localStorage = {
  getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
// node 22 의 global.navigator 는 getter 라 덮어쓸 수 없다 — 자리를 새로 만든다.
var net = { onLine: true };
Object.defineProperty(global, 'navigator', { value: net, configurable: true, writable: true });
global.document = { addEventListener: function () {}, visibilityState: 'visible' };
global.addEventListener = function () {};

var posts = [];
var httpStatus = 200;
global.fetch = function (url, opts) {
  posts.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null,
               auth: opts && opts.headers && opts.headers.Authorization });
  var st = httpStatus;
  return Promise.resolve({
    ok: st >= 200 && st < 300, status: st,
    text: function () { return Promise.resolve(''); },
    json: function () { return Promise.resolve({ sent: true }); }
  });
};

var token = 'tok';
global.SG_AUTH = {
  token: function () { return Promise.resolve(token); },
  user: function () { return { id: 'user-1' }; }
};

require(path.join(SG2, 'assets', 'sg-notify.js'));
var N = global.SG_NOTIFY;

function notifyPosts() {
  return posts.filter(function (p) { return p.url.indexOf('/api/notify') >= 0; });
}

async function main() {
  N.setContext({ session: 'S-1', setCode: 'SET9', mode: 'full' });

  /* [1] 사고 한 건 → 한 통. */
  await N.issue('media_upload_failed', {
    message: '녹음 3개를 올리지 못했습니다.', detail: { failed: 3, error: 'HTTP 400' }
  });
  await settle();
  var sent = notifyPosts();
  ok('사고가 /api/notify 로 나간다', sent.length === 1, '보낸 수: ' + sent.length);
  var b = sent[0] && sent[0].body;
  ok('무엇이 어디서 났는지 함께 실린다',
     !!b && b.kind === 'issue' && b.code === 'media_upload_failed' &&
     b.session === 'S-1' && b.set_code === 'SET9' && b.mode === 'full');
  ok('학생 토큰으로 보낸다 — 누구인지는 서버가 토큰에서 읽는다',
     sent[0].auth === 'Bearer tok');
  ok('본문에 이름을 싣지 않는다 — 남의 이름으로 사고를 보고할 수 없어야 한다',
     !b.name && !b.owner && !b.student_id);

  /* [2] 같은 사고는 한 번만. */
  await N.issue('media_upload_failed', { message: '또' });
  await settle();
  ok('같은 사고를 두 번 보내지 않는다', notifyPosts().length === 1,
     '보낸 수: ' + notifyPosts().length);

  /* 다른 코드는 다른 사고다. */
  await N.issue('offline', { message: '회선이 끊겼습니다' });
  await settle();
  ok('다른 사고는 따로 간다', notifyPosts().length === 2);

  /* [3] 오프라인이면 큐로. 던지지 않는다. */
  net.onLine = false;
  var threw = false;
  try { await N.issue('scoring_unavailable', { message: '채점 거절' }); }
  catch (e) { threw = true; }
  ok('오프라인에서도 던지지 않는다(시험을 멈추지 않는다)', !threw);
  ok('보내지 못한 알림은 기기 큐에 남는다', N._queue().length === 1,
     JSON.stringify(N._queue()));
  ok('오프라인에서는 요청이 나가지 않는다', notifyPosts().length === 2);

  net.onLine = true;
  await N.flush();
  await settle();
  ok('온라인이 되면 큐에 남은 것이 나간다', notifyPosts().length === 3);
  ok('보낸 것은 큐에서 빠진다', N._queue().length === 0);

  /* 로그인 전이면 보내지 않고 남겨 둔다 — 토큰이 생긴 뒤에 간다. */
  token = null;
  await N.issue('storage_blocked', { message: '저장소를 못 쓴다' });
  await settle();
  ok('로그인 전에는 큐에 눌러 둔다', N._queue().length === 1 && notifyPosts().length === 3);
  token = 'tok';
  await N.flush();
  await settle();
  ok('토큰이 생기면 그때 나간다', notifyPosts().length === 4 && N._queue().length === 0);

  /* [4] exam-cloud 는 녹음을 포기한 사실을 밖으로 낸다. */
  var cloud = fs.readFileSync(path.join(SG2, 'assets', 'exam-cloud.js'), 'utf8');
  var drops = cloud.match(/emit\('dropped'/g) || [];
  ok('녹음을 버릴 때 그 사실을 알린다(즉시 실패·재시도 소진 두 자리)',
     drops.length === 2, '자리 수: ' + drops.length);
  ok('sg-notify 가 그 이벤트를 듣는다',
     /ev\.type === 'dropped'/.test(fs.readFileSync(path.join(SG2, 'assets', 'sg-notify.js'), 'utf8')));

  /* [5] 제출 화면 — 사고는 그 자리에서, 완료는 한 통. */
  var shell = fs.readFileSync(path.join(SG2, 'assets', 'exam-shell.js'), 'utf8');
  ok('녹음이 못 올라간 제출을 알린다', /tell\('media_upload_failed'/.test(shell));
  ok('답안이 기기에만 남은 제출을 알린다', /tell\('answers_not_uploaded'/.test(shell));
  ok('채점이 거절당한 제출을 알린다', /tell\('scoring_unavailable'/.test(shell));
  ok('처음부터 다시 시작한 것을 알린다', /SG_NOTIFY\.issue\('attempt_abandoned'/.test(shell));
  ok('완료 메일을 보내는 자리가 하나다', /function tellDone/.test(shell) &&
     (shell.match(/finishing\.then\(tellDone/g) || []).length === 1);
  ok('완료 메일에 화면과 같은 밴드 점수를 싣는다',
     /report\.bands = \{ overall: b\.overall/.test(shell));
  ok('제출 성공·실패 어느 쪽으로 끝나도 완료 메일은 간다',
     /finishing\.then\(tellDone, tellDone\);/.test(shell));
  ok('메일이 어떻게 되든 다시 응시하는 문은 열린다',
     /finishing\.then\(openRetake, openRetake\);/.test(shell));

  /* [6] 서버 — 남이 쓴 글로 취급한다. */
  var API = require(path.join(SG2, 'api', 'notify.js'));
  var mail = API.compose({
    kind: 'issue', code: 'media_upload_failed', now: new Date(0),
    name: 'Kim\r\nBcc: attacker@evil.com', studentId: 'smeag001', role: 'student',
    session: 'S-1', setCode: 'SET9',
    message: '<img src=x onerror=alert(1)>', detail: { note: '<b>hi</b>' }
  });
  ok('제목에 개행이 없다(헤더 주입)', mail.subject.indexOf('\n') < 0 && mail.subject.indexOf('\r') < 0);
  ok('본문의 태그는 이스케이프된다',
     mail.html.indexOf('<img src=x') < 0 && mail.html.indexOf('&lt;img src=x') > 0);
  ok('detail 의 태그도 이스케이프된다',
     mail.html.indexOf('<b>hi</b>') < 0 && mail.html.indexOf('&lt;b&gt;hi') > 0);
  ok('코드를 사람 말로 옮긴다', mail.subject.indexOf('녹음을 올리지 못했다') > 0);
  ok('제목에 누구인지가 있다', mail.subject.indexOf('smeag001') > 0);
  /* 텍스트 본문에는 마크업이 남지 않는다. 학생이 쓴 글자로 되돌아온 '<' 는 남는다 —
     텍스트에서 그것은 태그가 아니라 글자다. 걸러야 하는 것은 우리가 만든 마크업이다. */
  ok('텍스트 본문도 함께 만든다',
     mail.text.length > 0 && !/<(div|table|tr|td|p|span)\b/i.test(mail.text) &&
     mail.text.indexOf('smeag001') > 0);

  var done = API.compose({
    kind: 'done', now: new Date(0), name: '홍길동', studentId: 'smeag002',
    session: 'S-2', setCode: 'SET9', bands: { reading: 5, listening: 4.5, overall: 5, cefr: 'B2' }
  });
  ok('완료 메일 제목에 총점이 있다', done.subject.indexOf('Overall 5') > 0);
  ok('완료 메일에 영역별 점수가 있다',
     done.html.indexOf('Reading') > 0 && done.html.indexOf('Listening') > 0);

  /* [7] 기본 수신자. */
  var src = fs.readFileSync(path.join(SG2, 'api', 'notify.js'), 'utf8');
  ok('기본 수신자는 발주에 적힌 두 주소다',
     /jitnet57@gmail\.com/.test(src) && /ai@smeagschool\.com/.test(src));
  ok('수신자는 환경변수로 바꿀 수 있다', /NOTIFY_TO/.test(src));
  ok('키가 없으면 조용히 물러난다(4xx 가 아니라 200)',
     /reason: 'not_configured'/.test(src));

  /* 셸이 이 파일을 싣는가. 안 실으면 위의 어느 것도 돌지 않는다. */
  var runtime = fs.readFileSync(path.join(SG2, 'exam-runtime.html'), 'utf8');
  ok('시험 셸이 sg-notify.js 를 싣는다', /assets\/sg-notify\.js/.test(runtime));
  ok('파생 페이지도 함께 싣는다',
     /assets\/sg-notify\.js/.test(fs.readFileSync(path.join(SG2, 'set9.html'), 'utf8')));
  ok('서비스워커가 프리캐시한다',
     /'assets\/sg-notify\.js'/.test(fs.readFileSync(path.join(SG2, 'sw.js'), 'utf8')));

  console.log('');
  if (fails.length) {
    console.log('FAILED (' + fails.length + '): ' + fails.join(', '));
    process.exit(1);
  }
  console.log('all ok');
  // 큐 재시도 타이머가 남아 있다 — 검사는 끝났으니 여기서 끊는다.
  process.exit(0);
}

main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
