/* 장치 점검 화면(hardwareCheck)의 마이크 선택 강제 검증 — node 전용.
 * 실행: node "studyground/tests/test_mic_device_pick.js"
 *
 * 확인하는 것 세 가지:
 *  1) 권한 응답을 기다리는 동안에도 "Allow microphone" 버튼이 보인다(팝업이 접힌 경우의 유일한 길).
 *  2) 입력 장치가 둘 이상이면 학생이 직접 고르기 전까지 Continue·상단바가 잠긴 채로 있다.
 *  3) 장치를 고르면 그 deviceId 로 스트림을 다시 열고 진행이 열린다.
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
    className: '', style: {}, _text: '', disabled: false, firstChild: null, value: '', id: '',
    appendChild: function (c) { c.parentNode = n; n.children.push(c); n.firstChild = n.children[0]; return c; },
    removeChild: function (c) {
      for (var i = 0; i < n.children.length; i++) { if (n.children[i] === c) { n.children.splice(i, 1); break; } }
      n.firstChild = n.children.length ? n.children[0] : null; c.parentNode = null; return c;
    },
    setAttribute: function (k, v) { n.attrs[k] = String(v); },
    getAttribute: function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; },
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function () {},
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

var advance = makeNode('button');
global.document = {
  createElement: makeNode,
  createElementNS: function (ns, tag) { return makeNode(tag); },
  createDocumentFragment: function () { return makeNode('#fragment'); },
  createTextNode: function (t) { var n = makeNode('#text'); n.textContent = String(t); return n; },
  getElementById: function (id) { return id === 'btn-advance' ? advance : null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: makeNode('body')
};
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

/* ── 마이크 스텁 ────────────────────────────────────────── */
var micMode = 'grant';       // grant | hang
var DEVICES = [];
var opened = [];             // getUserMedia 에 넘어온 제약을 기록한다
function fakeStream(label) {
  return {
    getTracks: function () { return []; },
    getAudioTracks: function () { return [{ label: label || '' }]; }
  };
}
Object.defineProperty(global, 'navigator', {
  configurable: true, writable: true,
  value: {
    mediaDevices: {
      getUserMedia: function (c) {
        opened.push(c);
        if (micMode === 'hang') return new Promise(function () {});
        var id = c && c.audio && c.audio.deviceId ? c.audio.deviceId.exact : '';
        var hit = DEVICES.filter(function (d) { return d.deviceId === id; })[0];
        return Promise.resolve(fakeStream(hit ? hit.label : (DEVICES[0] ? DEVICES[0].label : '')));
      },
      enumerateDevices: function () { return Promise.resolve(DEVICES.slice()); },
      addEventListener: function () {},
      removeEventListener: function () {}
    }
  }
});
global.AudioContext = function () {
  this.sampleRate = 48000;
  this.createAnalyser = function () {
    return {
      fftSize: 1024, frequencyBinCount: 512,
      getByteTimeDomainData: function (buf) { for (var i = 0; i < buf.length; i++) buf[i] = 128; },
      getByteFrequencyData: function (buf) { for (var i = 0; i < buf.length; i++) buf[i] = 0; }
    };
  };
  this.createMediaStreamSource = function () { return { connect: function () {} }; };
  this.close = function () {};
};

var timeouts = [];
global.setTimeout = function (fn) { timeouts.push(fn); return timeouts.length; };
global.clearTimeout = function () {};
function drainTimeouts() { var t = timeouts.slice(); timeouts.length = 0; t.forEach(function (fn) { fn(); }); }
function settle() { return new Promise(function (r) { setImmediate(function () { setImmediate(r); }); }); }

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-store.js');
load('assets/exam-render.js');
load('assets/exam-render-instruction.js');

var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

/* 'intro.microphone' 은 renderMicAdjust 로 빠진다 — 장치 점검 화면은 다른 id 를 쓴다. */
var SCREEN = { id: 'intro.hardware', screenType: 'hardwareCheck', copy: {} };
function render() {
  timeouts.length = 0; opened.length = 0;
  advance.disabled = false;
  var ctx = { engine: { next: function () {} }, onLeave: function () {} };
  return window.SG_INSTRUCTION.renderHardwareCheck(SCREEN, ctx);
}
function cont(node) { var a = find(node, 'instr-actions'); return a ? a.children[0] : null; }
function allowBtn(node) {
  var row = walk(node, []).filter(function (x) {
    return String(x.className).indexOf('exam-btn') >= 0 && x.textContent.indexOf('Allow microphone') >= 0;
  });
  return row[0] || null;
}

function main() {
  return Promise.resolve()
    /* [1] 응답을 기다리는 동안 — 허용 버튼은 보이고 진행은 잠긴다 */
    .then(function () {
      console.log('\n[1] 권한 대기');
      micMode = 'hang'; DEVICES = [];
      var node = render();
      return settle().then(function () {
        ok('허용 버튼 노출', allowBtn(node) && allowBtn(node).style.display === '');
        ok('주소창 안내', node.textContent.indexOf('address bar') >= 0);
        ok('Continue 잠금', cont(node).disabled === true);
        ok('상단바 잠금', advance.disabled === true);
        ok('레벨·피치 표시', find(node, 'instr-hw-readout').textContent.indexOf('Level') >= 0);
      });
    })
    /* [2] 장치가 둘 — 권한만으로는 열리지 않는다 */
    .then(function () {
      console.log('\n[2] 장치 둘, 선택 전');
      micMode = 'grant';
      DEVICES = [
        { kind: 'audioinput', deviceId: 'aaa', label: 'MacBook Pro Microphone' },
        { kind: 'audioinput', deviceId: 'bbb', label: 'USB Headset' }
      ];
      var node = render();
      return settle().then(function () {
        var sel = find(node, 'instr-hw-select');
        ok('선택 목록 노출', find(node, 'instr-hw-pick').style.display === '');
        ok('플레이스홀더 선택됨', sel.value === '');
        ok('장치 두 개 + 안내 항목', sel.children.length === 3);
        ok('선택 요구 안내', node.textContent.indexOf('select which microphone') >= 0);
        ok('Continue 잠금 유지', cont(node).disabled === true);
        ok('상단바 잠금 유지', advance.disabled === true);

        /* [3] 고르면 그 장치로 다시 열고 진행이 열린다 */
        console.log('\n[3] 장치 선택');
        sel.value = 'bbb';
        sel.onchange();
        return settle().then(function () {
          var last = opened[opened.length - 1];
          ok('선택한 deviceId 로 재요청', last && last.audio && last.audio.deviceId.exact === 'bbb');
          ok('장치 이름 표시', node.textContent.indexOf('USB Headset') >= 0);
          ok('Continue 해제', cont(node).disabled === false);
          ok('상단바 해제', advance.disabled === false);
        });
      });
    })
    /* [4] 장치가 하나면 고를 것이 없다 — 그대로 확정 */
    .then(function () {
      console.log('\n[4] 장치 하나');
      DEVICES = [{ kind: 'audioinput', deviceId: 'only', label: 'Built-in Microphone' }];
      var node = render();
      return settle().then(function () {
        ok('목록은 여전히 보인다', find(node, 'instr-hw-pick').style.display === '');
        ok('자동 확정', find(node, 'instr-hw-select').value === 'only');
        ok('Continue 해제', cont(node).disabled === false);
        ok('상단바 해제', advance.disabled === false);
      });
    })
    .then(function () {
      console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nALL PASS');
      process.exit(fails.length ? 1 : 0);
    });
}
main();
