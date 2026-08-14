/* 전체화면 자동 진입 · 화면 맞춤 검증 — node 전용.
 * 실행: node "studyground/tests/test_fullscreen_fit.js"
 *
 * 확인하는 것 넷.
 *   1) 로그인 버튼을 누른 그 순간 전체화면을 요청하고, 학생 표시를 남긴다.
 *   2) 관리자·로그아웃은 표시를 지우고 창을 돌려준다.
 *   3) 본문이 화면보다 길면 한 화면에 들어올 때까지 확대율을 낮춘다(최저 60%).
 *   4) 짧으면 손대지 않는다.
 *   5) login.html 이 실제로 그 순간(submit)에 armAndEnter 를 부르고,
 *      학생 셸 HTML 들이 이 스크립트를 싣는다.
 */
var fs = require('fs');
var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');

var fails = [];
function ok(cond, what) { if (!cond) fails.push(what); }

/* ── DOM 스텁 ───────────────────────────────────────────── */
var calls = { request: 0, exit: 0 };
var store = {};

// 본문 콘텐츠는 900px. 화면은 800px 이고 셸은 innerHeight/zoom 만큼 늘려 주므로
// 본문이 쓸 수 있는 높이는 600/zoom 이다 — 확대율이 낮아질수록 더 담긴다.
var CONTENT = 900, BOX = 600;
function zoomNow() {
  var z = parseFloat(document.body.style.zoom);
  return z > 0 ? z : 1;
}
var main = {
  clientWidth: 1000, scrollWidth: 1000,
  get clientHeight() { return Math.round(BOX / zoomNow()); },
  get scrollHeight() { return Math.max(CONTENT, this.clientHeight); }
};
var shell = { style: {}, querySelector: function (s) { return s === '.exam-main' ? main : null; } };

global.window = global;
global.location = { pathname: '/sg2/exam-runtime.html' };
global.document = {
  readyState: 'complete',
  documentElement: { requestFullscreen: function () { calls.request++; return { catch: function () {} }; } },
  body: { style: {} },
  fullscreenElement: null,
  exitFullscreen: function () { calls.exit++; document.fullscreenElement = null; return { catch: function () {} }; },
  querySelector: function (s) { return s === '.exam-shell' ? shell : null; },
  addEventListener: function () {},
  removeEventListener: function () {}
};
global.sessionStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
global.innerHeight = 800;
global.addEventListener = function () {};
global.MutationObserver = null;

eval(fs.readFileSync(path.join(SG2, 'assets', 'sg-fullscreen.js'), 'utf8'));

/* 1) 로그인 순간 ─ 요청 + 표시 */
SG_FS.armAndEnter();
ok(calls.request === 1, '로그인 순간 requestFullscreen 을 부르지 않았다');
ok(SG_FS.armed(), '학생 표시(sessionStorage)가 남지 않았다');

/* 2) 관리자·로그아웃 ─ 표시 삭제 + 창 복귀 */
document.fullscreenElement = shell;
SG_FS.release();
ok(!SG_FS.armed(), 'release 후에도 학생 표시가 남아 있다');
ok(calls.exit === 1, 'release 가 전체화면을 나가지 않았다');

/* 3) 본문이 길면 줄인다 */
SG_FS.fit();
var z = SG_FS.zoom();
ok(z < 1, '본문이 화면보다 긴데 확대율을 낮추지 않았다 (zoom=' + z + ')');
ok(z >= 0.6, '확대율이 하한(60%) 아래로 내려갔다 (zoom=' + z + ')');
ok(main.scrollHeight <= main.clientHeight + 1,
   '줄인 뒤에도 본문이 넘친다 (' + main.scrollHeight + ' > ' + main.clientHeight + ')');
ok(shell.style.height === (800 / z) + 'px', '셸 높이를 확대율만큼 되돌려 주지 않았다');

/* 4) 짧으면 손대지 않는다 */
CONTENT = 400;
SG_FS.fit();
ok(SG_FS.zoom() === 1, '한 화면에 들어오는데도 확대율을 건드렸다 (zoom=' + SG_FS.zoom() + ')');
ok(document.body.style.zoom === '', '확대율 1 인데 body 에 zoom 이 남았다');

/* 5) 배선 */
var login = fs.readFileSync(path.join(SG2, 'login.html'), 'utf8');
ok(/submit[\s\S]{0,200}SG_FS\.armAndEnter\(\)/.test(login),
   'login.html 의 submit 핸들러가 armAndEnter 를 부르지 않는다');
/* 선생님·관리자는 창을 여러 개 쓰므로 전체화면을 돌려준다. 이걸 어떻게 묻는지는
   화면이 바꿔 왔다 — isStaff() 한 번이었다가, 지금은 role() 을 받아 'teacher'·'admin'
   을 가른다(관리자는 admin.html 로 보내야 해서 역할 이름 자체가 필요해졌다).
   묻는 방법이 아니라 **역할을 보고 release 를 부르는가**만 붙잡는다. */
ok(/(isStaff\(\)|role\s*===\s*'teacher'|'teacher'\s*\|\|)[\s\S]{0,200}SG_FS\.release\(\)/.test(login),
   'login.html 이 선생님·관리자에게 전체화면을 돌려주지 않는다');

['login.html', 'tests.html', 'exam-runtime.html', 'exam.html', 'dashboard.html',
 'set9.html', 'review.html', 'en/test-nt/reading/index.html'].forEach(function (f) {
  var t = fs.readFileSync(path.join(SG2, f), 'utf8');
  ok(t.indexOf('assets/sg-fullscreen.js') >= 0, f + ' 가 sg-fullscreen.js 를 싣지 않는다');
});

var sw = fs.readFileSync(path.join(SG2, 'sw.js'), 'utf8');
ok(/SHELL_ASSETS[\s\S]*'assets\/sg-fullscreen\.js'/.test(sw), 'sw.js 프리캐시에 sg-fullscreen.js 가 없다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (f) { console.error(' · ' + f); });
  process.exit(1);
}
console.log('OK — 전체화면 자동 진입 · 화면 맞춤');
