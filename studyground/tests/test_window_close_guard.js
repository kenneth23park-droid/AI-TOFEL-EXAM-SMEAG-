/* 시험 중 창 닫기 막기 검증 — node 전용.
 * 실행: node "studyground/tests/test_window_close_guard.js"
 *
 * 창 오른쪽 위의 X 는 운영체제 것이라 웹이 지울 수 없다. 웹이 할 수 있는 건 하나,
 * 닫으려는 순간 브라우저가 되묻게 만드는 것뿐이다. 그 문이 제대로 서는지 본다.
 *
 * 확인하는 것 다섯.
 *   1) 시험 화면이 아니면(hold 를 켜지 않았으면) 붙잡지 않는다.
 *   2) 시험이 돌면 붙잡는다 — beforeunload 를 preventDefault 한다.
 *   3) 감독관이 풀어 준 뒤(release)에는 붙잡지 않는다.
 *   4) 우리가 옮기는 한 번(allow)은 조용히 지나가고, 그다음부터는 다시 붙잡는다.
 *   5) 배선 — 시험 셸이 hold 를 켜고, 승인받은 두 이동(Exit·재응시)이 allow 를 부른다.
 */
var fs = require('fs');
var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');

var fails = [];
function ok(cond, what) { if (!cond) fails.push(what); }

/* ── DOM 스텁 ───────────────────────────────────────────── */
var store = {};
var handlers = {};

global.window = global;
global.location = { pathname: '/sg2/exam-runtime.html' };
global.document = {
  readyState: 'complete',
  documentElement: { requestFullscreen: function () { return { catch: function () {} }; } },
  body: { style: {} },
  fullscreenElement: null,
  exitFullscreen: function () { document.fullscreenElement = null; return { catch: function () {} }; },
  querySelector: function () { return null; },
  addEventListener: function () {},
  removeEventListener: function () {}
};
global.sessionStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
global.innerHeight = 800;
global.addEventListener = function (t, f) { (handlers[t] = handlers[t] || []).push(f); };
global.MutationObserver = null;

eval(fs.readFileSync(path.join(SG2, 'assets', 'sg-fullscreen.js'), 'utf8'));

ok((handlers.beforeunload || []).length === 1, 'beforeunload 를 창에 걸지 않았다');

/** 창을 닫으려 한 셈 치고, 브라우저가 되묻게 되는지 본다. */
function close_() {
  var e = { prevented: false, returnValue: undefined, preventDefault: function () { this.prevented = true; } };
  handlers.beforeunload.forEach(function (f) { f(e); });
  return e.prevented;
}

/* 1) 시험 화면이 아니면 그냥 닫힌다 */
SG_FS.arm();
ok(!close_(), '시험이 돌지 않는데 창 닫기를 붙잡았다');

/* 2) 시험이 도는 동안에는 붙잡는다 */
SG_FS.hold(true);
ok(close_(), '시험 중인데 창 닫기를 붙잡지 않았다');

/* 3) 감독관이 풀어 준 뒤에는 붙잡지 않는다 */
SG_FS.release();
ok(!close_(), 'release 뒤에도 창 닫기를 붙잡는다');

/* 4) 우리가 옮기는 한 번만 지나간다 */
SG_FS.arm();
SG_FS.allow();
ok(!close_(), 'allow 한 이동을 붙잡았다');
ok(close_(), 'allow 가 한 번으로 끝나지 않고 계속 열려 있다');

/* 5) 배선 */
var shell = fs.readFileSync(path.join(SG2, 'assets', 'exam-shell.js'), 'utf8');
ok(/SG_FS\.hold\(true\)/.test(shell), 'exam-shell.js 가 창 닫기 문을 켜지 않는다');
ok(/SG_FS\.allow\(\)[\s\S]{0,120}location\.href = BASE \+ 'tests\.html'/.test(shell),
   'Exit 승인 이동이 allow 를 부르지 않는다');
ok(/SG_FS\.allow\(\)[\s\S]{0,120}location\.href = target/.test(shell),
   '재응시 이동이 allow 를 부르지 않는다');
ok(/holdWindow\(\);/.test(shell), 'boot 이 holdWindow 를 부르지 않는다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (f) { console.error(' · ' + f); });
  process.exit(1);
}
console.log('OK — 시험 중 창 닫기 막기');
