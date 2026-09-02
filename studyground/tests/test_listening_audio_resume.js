/* 리스닝 — 끊긴 오디오는 "다 들었다"가 아니다. node 전용.
 * 실행: node "studyground/tests/test_listening_audio_resume.js"
 *
 * 2026-09-02 SET 11 Listening Module 2 (Q12-15). 강의 음성이 앞부분에서 끊겼고, 앱은
 * 그것을 정상 종료로 처리해 답변 시계를 걸었다. 20초씩 네 화면이 지나갔고 학생은
 * 강의를 듣지도 못한 채 12·13·14 를 잃었다(응답 기록에 그 셋만 비어 있다).
 *
 * 그래서 계약을 셋으로 못박는다.
 *   [1] 길이를 아는데 한참 앞에서 ended → 끝이 아니다. 멈춘 자리부터 이어 붙인다.
 *       소진으로도 적지 않고, 답변 시계도 걸지 않는다.
 *   [2] 끝까지 들은 재생만 소진으로 적고 답변 시계를 건다(종전 그대로).
 *   [3] 이어 붙이기를 다 써도 안 되면 진행시킨다 — 학생을 죽은 화면에 가둘 수는 없다.
 *       단 소진으로 적지 않고(새로 고쳐 되살릴 길을 남긴다) 기록을 남긴다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

/* ── 최소 DOM 스텁 (다른 렌더러 테스트와 같은 방식) ───────── */
function makeNode(tag) {
  var n = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    className: '',
    style: {},
    _text: '',
    disabled: false,
    checked: false,
    paused: true,
    ended: false,
    duration: NaN,
    currentTime: 0,
    firstChild: null,
    appendChild: function (c) { c.parentNode = n; n.children.push(c); n.firstChild = n.children[0]; return c; },
    removeChild: function (c) {
      for (var i = 0; i < n.children.length; i++) {
        if (n.children[i] === c) { n.children.splice(i, 1); break; }
      }
      n.firstChild = n.children.length ? n.children[0] : null;
      c.parentNode = null;
      return c;
    },
    setAttribute: function (k, v) { n.attrs[k] = String(v); },
    getAttribute: function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; },
    hasAttribute: function (k) { return n.attrs.hasOwnProperty(k); },
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function (t, fn) { (n._ev[t] = n._ev[t] || []).push(fn); },
    removeEventListener: function (t, fn) {
      var fns = n._ev[t] || [];
      for (var i = 0; i < fns.length; i++) { if (fns[i] === fn) { fns.splice(i, 1); return; } }
    },
    emit: function (t) {
      var fns = n._ev[t] || [];
      for (var i = 0; i < fns.length; i++) fns[i].call(n, { type: t });
    },
    _ev: {},
    load: function () {},
    play: function () { n.paused = false; n.playCount = (n.playCount || 0) + 1; n.emit('play'); return { 'catch': function () { return this; } }; },
    pause: function () { n.paused = true; n.emit('pause'); },
    querySelectorAll: function (sel) { return collect(n, sel); }
  };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text || flatten(n); },
    set: function (v) { n._text = String(v); n.children = []; n.firstChild = null; }
  });
  return n;
}
function flatten(n) {
  var s = n._text || '';
  for (var i = 0; i < n.children.length; i++) s += flatten(n.children[i]);
  return s;
}
function walk(n, out) { out.push(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], out); return out; }
function collect(root, sel) {
  var all = walk(root, []), out = [], i;
  for (i = 0; i < all.length; i++) {
    var n = all[i];
    if (sel === 'audio, video' && (n.tagName === 'AUDIO' || n.tagName === 'VIDEO')) out.push(n);
    else if (sel === 'input[type="radio"]' && n.tagName === 'INPUT' && n.type === 'radio') out.push(n);
    else if (sel === 'input[type="checkbox"]' && n.tagName === 'INPUT' && n.type === 'checkbox') out.push(n);
    else if (sel === 'label.opt' && n.tagName === 'LABEL' && String(n.className).indexOf('opt') >= 0) out.push(n);
  }
  return out;
}
var docRoot = makeNode('body');
var mountNode = makeNode('div');
docRoot.appendChild(mountNode);
global.document = {
  createElement: makeNode,
  createElementNS: function (ns, tag) { return makeNode(tag); },
  createDocumentFragment: function () { return makeNode('#fragment'); },
  createTextNode: function (t) { var n = makeNode('#text'); n.textContent = String(t); return n; },
  getElementById: function (id) { return id === 'screen-mount' ? mountNode : null; },
  querySelectorAll: function (sel) { return collect(docRoot, sel); },
  addEventListener: function () {},
  body: docRoot
};
global.navigator = {};
global.localStorage = (function () {
  var m = {};
  return {
    getItem: function (k) { return m.hasOwnProperty(k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    key: function (i) { return Object.keys(m)[i]; },
    get length() { return Object.keys(m).length; }
  };
})();
global.requestAnimationFrame = null;
global.AudioContext = null;

/* 시계를 손에 쥔다 — 이어 붙이기는 setTimeout 뒤에 일어난다. */
var timers = [];
global.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
global.clearTimeout = function () {};
function flushTimers() {
  var due = timers; timers = [];
  for (var i = 0; i < due.length; i++) due[i].fn();
  return due.length;
}

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set9.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-store.js');
load('assets/exam-render.js');
load('assets/exam-render-listening.js');


var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

var L = window.SG_LISTEN;
var pack = window.SMEAG_SET9;
var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
window.SG_CONTENT_PACK = pack;
window.SG_STORE.open({ id: 'test-audio-resume', setCode: 'SET9', profile: 'toefl', mode: 'offline' });
window.SG_RUNTIME = { timing: function () { return timing; }, syncNav: function () { return true; } };

var res = window.SG_COMPILE.compileScreens(pack, timing, { profile: 'toefl' });
var withAudio = res.screens.filter(function (s) {
  return s.section === 'listening' && s.blockKind === 'audio-set' && s.audio && s.audio.src && s.questionIds;
});

/* 답변 시계는 재생이 끝난 뒤에만 걸린다 — 그것이 걸렸는지로 "끝났다고 봤는지"를 센다. */
function mount(screen) {
  var armed = 0;
  var node = L.renderListeningQuestion(screen, {
    engine: { answer: function () { return true; },
              startDeferredClocks: function () { armed++; return true; } }
  });
  return { node: node, audio: collect(node, 'audio, video')[0], armed: function () { return armed; } };
}
function spent(screen) { return L.isAudioSpent(L.spentKey(screen.id, screen.audio.src)); }
function events(type) {
  return (window.SG_STORE.events() || []).filter(function (e) { return e.type === type; });
}

/* ── [1] 앞에서 끊긴 재생 ─────────────────────────────────── */
console.log('\n[1] 길이를 아는데 한참 앞에서 ended');

var s1 = withAudio[0];
var m1 = mount(s1);
m1.audio.duration = 72;          // 실제 강의 길이
m1.audio.play();
m1.audio.currentTime = 20; m1.audio.emit('timeupdate');   // 20초까지 들었다
m1.audio.ended = true; m1.audio.emit('ended');

ok('답변 시계를 걸지 않았다', m1.armed() === 0, 'armed=' + m1.armed());
ok('소진으로 적지 않았다', spent(s1) === false);
ok('끊김을 기록했다', events('audio_interrupted').length === 1,
   JSON.stringify(events('audio_interrupted')[0] && events('audio_interrupted')[0].detail));
ok('오디오를 화면에서 떼지 않았다', !!m1.audio.parentNode);

var plays = m1.audio.playCount || 0;
flushTimers();                    // 이어 붙이기 대기
m1.audio.emit('loadedmetadata');  // 다시 실린다
ok('멈춘 자리에서 이어 붙였다', m1.audio.currentTime === 20, 'currentTime=' + m1.audio.currentTime);
ok('다시 재생했다', (m1.audio.playCount || 0) > plays, 'playCount=' + m1.audio.playCount);

/* 이어서 끝까지 들으면 그때 정상 종료다. */
m1.audio.currentTime = 72; m1.audio.emit('timeupdate');
m1.audio.emit('ended');
ok('끝까지 들은 뒤에는 답변 시계가 걸린다', m1.armed() === 1, 'armed=' + m1.armed());
ok('그때 소진으로 적는다', spent(s1) === true);

/* ── [2] 정상 재생은 종전 그대로 ──────────────────────────── */
console.log('\n[2] 끝까지 들은 재생');

var s2 = withAudio[1];
var m2 = mount(s2);
m2.audio.duration = 38.3;
m2.audio.play();
m2.audio.currentTime = 38.3; m2.audio.emit('timeupdate');
m2.audio.emit('ended');
ok('답변 시계가 걸린다', m2.armed() === 1, 'armed=' + m2.armed());
ok('소진으로 적는다', spent(s2) === true);
ok('끊김으로 기록하지 않는다', events('audio_interrupted').length === 1);

/* 길이를 모르는 재생(duration NaN)은 판단하지 않는다 — 멀쩡한 재생을 되돌리면 안 된다. */
var s2b = withAudio[2];
var m2b = mount(s2b);
m2b.audio.play();
m2b.audio.emit('ended');
ok('길이를 모르면 끝으로 본다', m2b.armed() === 1, 'armed=' + m2b.armed());

/* ── [3] 이어 붙이기가 다 실패하면 ────────────────────────── */
console.log('\n[3] 회선이 아주 죽었을 때');

var s3 = withAudio[3];
var m3 = mount(s3);
m3.audio.duration = 94;
m3.audio.play();
m3.audio.currentTime = 5; m3.audio.emit('timeupdate');
for (var i = 0; i < 6; i++) { m3.audio.emit('error'); }

ok('결국은 진행시킨다 — 갇히지 않는다', m3.armed() === 1, 'armed=' + m3.armed());
ok('실패한 재생을 소진으로 적지 않는다', spent(s3) === false);
ok('실패를 기록했다', events('audio_failed').length === 1,
   JSON.stringify(events('audio_failed')[0] && events('audio_failed')[0].detail));
ok('시도 횟수가 무한하지 않다', events('audio_interrupted').length <= 1 + 1 + 4,
   'interrupted=' + events('audio_interrupted').length);

console.log('');
if (fails.length) { console.log('FAIL ' + fails.length + '건'); process.exit(1); }
console.log('ALL PASS (listening audio resume)');
