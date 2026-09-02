/* 스피킹 마이크 강제 규칙 검증 — node 전용.
 * 실행: node "studyground/tests/test_speaking_mic_gate.js"
 *
 * 관찰된 사고(2026-09-02): 녹음 phase 에 들어가서야 브라우저 권한 창이 떴고,
 * 학생이 Allow 를 누르는 동안 RESPONSE TIME 은 그대로 흘렀다.
 * 여기서 못 박는 규칙은 둘이다.
 *   1) 권한은 화면에 들어서자마자(record 이전 phase 에서) 미리 요청한다.
 *   2) 응답 시계는 마이크가 실제로 열린 뒤에 건다. 끝내 안 열리면 8초 뒤 그냥 걸어
 *      시험을 세우지 않는다(그 문항은 이미 NOT SUBMIT 이다).
 */
var fs = require('fs');
var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

/* ── DOM 스텁(렌더러가 쓰는 만큼만) ─────────────────────── */
function makeNode(tag) {
  var n = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {},
    className: '', style: {}, _text: '', disabled: false, hidden: false, firstChild: null,
    appendChild: function (c) { c.parentNode = n; n.children.push(c); n.firstChild = n.children[0]; return c; },
    removeChild: function (c) {
      for (var i = 0; i < n.children.length; i++) { if (n.children[i] === c) { n.children.splice(i, 1); break; } }
      n.firstChild = n.children.length ? n.children[0] : null; c.parentNode = null; return c;
    },
    setAttribute: function (k, v) { n.attrs[k] = String(v); },
    getAttribute: function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; },
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function () {}, removeEventListener: function () {},
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text || flatten(n); },
    set: function (v) { n._text = String(v); n.children = []; n.firstChild = null; }
  });
  return n;
}
function flatten(n) { var s = n._text || ''; for (var i = 0; i < n.children.length; i++) s += flatten(n.children[i]); return s; }
function walk(n, out) { out.push(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], out); return out; }
function find(root, cls) {
  return walk(root, []).filter(function (x) { return String(x.className).indexOf(cls) >= 0; })[0] || null;
}

global.document = {
  createElement: makeNode,
  createElementNS: function (ns, tag) { return makeNode(tag); },
  createDocumentFragment: function () { return makeNode('#fragment'); },
  createTextNode: function (t) { var n = makeNode('#text'); n.textContent = String(t); return n; },
  getElementById: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: makeNode('body')
};
global.requestAnimationFrame = null;
global.AudioContext = null;              // 신호음 없음 — 순서와 타이밍은 그대로여야 한다

/* ── 타이머 스텁 — 시간을 손으로 민다 ───────────────────── */
var timers = [];
var now = 0;
global.setTimeout = function (fn, ms) { timers.push({ fn: fn, at: now + (ms || 0), dead: false }); return timers.length; };
global.clearTimeout = function (id) { if (timers[id - 1]) timers[id - 1].dead = true; };
function advanceMs(ms) {
  var target = now + ms;
  for (var guard = 0; guard < 500; guard++) {
    var next = null, idx = -1;
    for (var i = 0; i < timers.length; i++) {
      if (!timers[i].dead && timers[i].fn && timers[i].at <= target && (!next || timers[i].at < next.at)) { next = timers[i]; idx = i; }
    }
    if (!next) break;
    now = next.at;
    timers[idx].dead = true;
    next.fn();
  }
  now = target;
}

/* ── 마이크·시계 스텁 ───────────────────────────────────── */
/* granted = 브라우저가 허용해 줄 것인가, held = 지금 스트림을 손에 쥐고 있는가.
   둘은 다르다 — 허용돼 있어도 스트림은 getUserMedia 를 한 번 통과해야 생긴다. */
var mic = { granted: false, held: false, permissionCalls: 0, startCalls: 0 };
var fakeStream = { getAudioTracks: function () { return [{ readyState: 'live', muted: false }]; } };
window.SG_RECORDER = {
  NOT_SUBMIT: 'NOT SUBMIT',
  isSupported: function () { return true; },
  isRecording: function () { return false; },
  level: function () { return 0; },
  requestPermission: function (cb) {
    mic.permissionCalls += 1;
    if (mic.granted) { mic.held = true; cb(null, fakeStream); return; }
    var e = new Error('denied'); e.code = 'denied';
    cb(e, null);
  },
  start: function (qid, cb) {
    mic.startCalls += 1;
    if (mic.granted) { mic.held = true; cb(null); return; }
    var e = new Error('denied'); e.code = 'denied';
    cb(e);
  },
  getStream: function () { return mic.held ? fakeStream : null; },
  stop: function (cb) { cb(null, { durationMs: 0, mime: '', peak: 0 }); },
  abort: function () {}
};

var armed = [];
window.SG_CLOCK = {
  armClock: function (key, sec, opts) { armed.push({ key: key, sec: sec, opts: opts || {} }); },
  clearClock: function () {},
  hasClock: function () { return false; },
  remainingSec: function () { return 0; },
  formatSec: function (s) { return String(s); },
  subscribe: function () { return function () {}; }
};
window.SG_STORE = {
  pushEvent: function () {}, events: function () { return []; },
  getAnswer: function () { return null; }, upsertAnswer: function () {}, flushAnswers: function () {},
  saveCursor: function () {}
};

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/exam-render-speaking.js');

var fails = 0;
function ok(label, got, want) {
  var pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails += 1;
  console.log((pass ? '  ok   ' : '  FAIL ') + label + ': ' + JSON.stringify(got) +
              (pass ? '' : ' (expected ' + JSON.stringify(want) + ')'));
}

function screenOf() {
  return {
    id: 'speaking.q.S1.01', screenType: 'speaking', section: 'speaking',
    questionIds: ['S1-01'],
    phases: [{ name: 'prep', seconds: 3 }, { name: 'record', seconds: 45 }]
  };
}
function run() {
  armed = [];
  mic.permissionCalls = 0; mic.startCalls = 0;
  var node = window.SG_SPEAKING.render(screenOf(), { engine: null });
  advanceMs(0);            // render 가 건 setTimeout(…,0) 으로 첫 phase 시작
  return node;
}
/* prep 만료는 시계가 알려 준다 — 스텁이므로 손으로 울린다. */
function expirePrep() {
  var a = armed.filter(function (x) { return x.sec === 3; })[0];
  if (a && a.opts && typeof a.opts.onExpire === 'function') a.opts.onExpire();
}
function recordArmed() { return armed.filter(function (a) { return /\|1$/.test(a.key) || a.sec === 45; }).length; }

/* ── [1] 권한은 record 이전에 미리 묻는다 ───────────────── */
console.log('\n[1] 화면에 들어서자마자 마이크를 미리 연다');
mic.granted = true; mic.held = false;
run();
ok('record 에 닿기 전에 권한을 요청했다', mic.permissionCalls > 0, true);
ok('아직 녹음을 시작하지는 않았다', mic.startCalls, 0);
ok('응답 시계도 아직 안 걸렸다', recordArmed(), 0);

console.log('\n[1b] 이미 쥐고 있으면 권한 창을 두 번 띄우지 않는다');
mic.granted = true; mic.held = true;
run();
ok('다시 묻지 않는다', mic.permissionCalls, 0);
ok('그래도 문항은 시작된다 (prep 시계)', armed.length > 0, true);

/* ── [2] 마이크가 열리면 그때 시계를 건다 ───────────────── */
console.log('\n[2] 마이크가 열린 뒤에 응답 시계');
expirePrep();              // prep 만료 → record 진입
advanceMs(500);            // 신호음 대기(AudioContext 없어도 같은 타이밍)
ok('녹음을 시작했다', mic.startCalls > 0, true);
ok('응답 시계가 걸렸다', recordArmed(), 1);

/* ── [3] 도중에 마이크를 잃으면 시계를 걸지 않고 기다린다 ── */
console.log('\n[3] 녹음 직전에 마이크를 잃으면 응답 시간이 흐르지 않는다');
mic.granted = true; mic.held = true;
var node3 = run();                 // 권한이 있는 채로 문항 시작 (게이트 통과)
mic.granted = false; mic.held = false;   // prep 도중 장치를 잃었다
expirePrep();
advanceMs(500);
ok('마이크를 열려고 시도는 했다', mic.startCalls > 0, true);
ok('열리지 않았으므로 시계를 걸지 않는다', recordArmed(), 0);
ok('학생에게 마이크를 허용하라고 말한다',
   find(node3, 'speaking-banner').textContent.toLowerCase().indexOf('microphone') >= 0, true);

console.log('\n[3b] 늦게 되살아나면 그 순간부터 응답 시간이 시작된다');
mic.granted = true;
advanceMs(1200);                   // 재시도(1초 간격)가 성공한다
ok('시계가 그제서야 걸렸다', recordArmed(), 1);
ok('잃은 응답 시간은 없다 (45초 그대로)', armed[armed.length - 1].sec, 45);

/* ── [4] 끝내 안 열려도 시험은 세우지 않는다 ────────────── */
console.log('\n[4] 끝내 안 열리면 시험을 세우지 않는다');
mic.granted = true; mic.held = true;
run();
mic.granted = false; mic.held = false;
expirePrep();
advanceMs(500);
ok('아직은 기다린다', recordArmed(), 0);
advanceMs(9000);
ok('8초를 넘기면 시계를 걸고 진행한다', recordArmed(), 1);

/* ── [5] 권한 없이 착지하면 문항 자체가 시작되지 않는다 ── */
/* 이어보기(planResume)·?screen=·?goq= 는 마이크 점검 화면을 지나치지 않고
   스피킹 문항에 곧장 착지한다. 오늘 사고의 실제 경로다. */
console.log('\n[5] 권한 없이 스피킹 문항에 착지 — 게이트가 막는다');
mic.granted = false; mic.held = false;
var node5 = run();
ok('phase 를 시작하지 않는다 (prep 시계조차 안 걸린다)', armed.length, 0);
ok('마이크 허용 버튼을 세운다',
   find(node5, 'speaking-btn').textContent.indexOf('Allow microphone') >= 0, true);
ok('응답 시간이 시작되지 않았다고 알린다',
   find(node5, 'speaking-banner').textContent.indexOf('response time has not started') >= 0, true);
ok('녹음 시도조차 하지 않는다', mic.startCalls, 0);
advanceMs(30000);
ok('30초를 기다려도 그냥 흘려보내지 않는다', armed.length, 0);

console.log('\n[5b] 학생이 허용하면 그때 문항이 처음부터 시작된다');
mic.granted = true;
advanceMs(2500);                   // 게이트 폴링이 다시 잡는다
ok('이제 phase 가 시작됐다', armed.length > 0, true);
ok('prep 시간은 3초 그대로', armed[0].sec, 3);
expirePrep();
advanceMs(500);
ok('응답 시계도 45초 그대로', recordArmed(), 1);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
