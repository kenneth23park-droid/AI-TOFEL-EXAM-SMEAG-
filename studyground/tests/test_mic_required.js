/* 마이크 점검 필수 규칙 검증 — node 전용.
 * 실행: node "studyground/tests/test_mic_required.js"
 *
 * 렌더러가 부르는 타이머·마이크·오디오를 전부 스텁으로 바꿔, 실제 초를 기다리지 않고
 * 카운트다운 → 녹음 → 판정까지 밀어 본다. 확인하는 것은 하나다:
 * 소리가 잡힌 녹음을 마치기 전에는 진행(Continue·상단바)이 열리지 않는다.
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
    className: '', style: {}, _text: '', disabled: false, firstChild: null,
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
global.requestAnimationFrame = null;   // rAF 없음 — 1초 틱의 샘플링만으로 판정돼야 한다

/* ── 마이크·오디오 스텁 ─────────────────────────────────── */
var LEVEL = 0;                          // 이 테스트가 흉내내는 입력 세기(0..1)
var micMode = 'grant';                  // grant | deny
var fakeStream = { getTracks: function () { return []; } };
/* node 21+ 의 navigator 는 getter 전용 전역이다 — 대입으로는 스텁이 걸리지 않는다.
 * defineProperty 로 갈아끼워야 렌더러가 우리 마이크를 본다. */
Object.defineProperty(global, 'navigator', {
  configurable: true, writable: true,
  value: {
    mediaDevices: {
      getUserMedia: function () {
        if (micMode === 'hang') return new Promise(function () {});   // 영원히 대기하는 요청
        if (micMode === 'deny') {
          var e = new Error('blocked'); e.name = 'NotAllowedError';
          return Promise.reject(e);
        }
        return Promise.resolve(fakeStream);
      }
    }
  }
});
global.AudioContext = function () {
  this.createAnalyser = function () {
    return {
      fftSize: 1024,
      // RMS→level 은 min(1, rms*3.2) 이다. 원하는 level 이 나오도록 진폭을 역산한다.
      getByteTimeDomainData: function (buf) {
        var amp = Math.round(Math.min(1, LEVEL / 3.2) * 128);
        for (var i = 0; i < buf.length; i++) buf[i] = 128 + amp;
      }
    };
  };
  this.createMediaStreamSource = function () { return { connect: function () {} }; };
  this.close = function () {};
};

/* ── 타이머 스텁 — 수동으로 틱을 돌린다 ─────────────────── */
var intervals = [];
global.setInterval = function (fn) { intervals.push(fn); return intervals.length; };
global.clearInterval = function (id) { if (id) intervals[id - 1] = null; };
var timeouts = [];
global.setTimeout = function (fn) { timeouts.push(fn); return timeouts.length; };
global.clearTimeout = function () {};
function tick(n) {
  for (var i = 0; i < n; i++) {
    var live = intervals.slice();
    for (var j = 0; j < live.length; j++) { if (live[j]) live[j](); }
  }
}
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

var SCREEN = { id: 'intro.microphone', screenType: 'hardwareCheck', copy: {} };
function render() {
  intervals.length = 0; timeouts.length = 0;
  advance.disabled = false;
  var ctx = { engine: { next: function () {} }, onLeave: function () {} };
  return window.SG_INSTRUCTION.renderMicAdjust(SCREEN, ctx);
}
function texts(node) { return node.textContent; }
function contBtn(node) {
  var actions = find(node, 'instr-mic-actions');
  return actions ? actions.children[0] : null;
}

function main() {
  return Promise.resolve()
    /* [1] 건너뛰기가 없다 — 진입하자마자 상단바가 잠긴다 */
    .then(function () {
      console.log('\n[1] 점검 필수');
      var node = render();
      ok('Skip 버튼 없음', texts(node).indexOf('Skip microphone check') < 0);
      ok('필수 안내', texts(node).indexOf('This check is required') >= 0);
      ok('상단바 잠금', advance.disabled === true);
      ok('Continue 숨김', contBtn(node).style.display === 'none');
    })
    /* [2] 권한 거부 — 잠긴 채로 재시도만 열린다 */
    .then(function () {
      console.log('\n[2] 권한 거부');
      micMode = 'deny';
      var node = render();
      drainTimeouts();
      return settle().then(function () {
        ok('거부 안내', texts(node).indexOf('Microphone access was blocked') >= 0);
        ok('재시도 버튼 노출', find(node, 'instr-mic-retry').style.display === '');
        ok('상단바 잠금 유지', advance.disabled === true);
        ok('Continue 숨김 유지', contBtn(node).style.display === 'none');
      });
    })
    /* [3] 무음 녹음 — 판정 silent 면 계속 잠근다 */
    .then(function () {
      console.log('\n[3] 무음 녹음');
      micMode = 'grant'; LEVEL = 0;
      var node = render();
      drainTimeouts();
      return settle().then(function () {
        find(node, 'instr-mic-record').onclick();
        tick(3 + 10);                       // 카운트다운 3 + 녹음 10
        ok('무음 안내', texts(node).indexOf('No sound was detected') >= 0);
        ok('상단바 잠금 유지', advance.disabled === true);
        ok('Continue 숨김 유지', contBtn(node).style.display === 'none');
      });
    })
    /* [4] 소리가 잡힌 녹음 — rAF 가 없어도 1초 틱 샘플링으로 통과한다 */
    .then(function () {
      console.log('\n[4] 정상 녹음');
      micMode = 'grant'; LEVEL = 0.4;
      var node = render();
      drainTimeouts();
      return settle().then(function () {
        find(node, 'instr-mic-record').onclick();
        tick(3 + 10);
        ok('적정 안내', texts(node).indexOf('Your microphone level is good') >= 0);
        ok('상단바 해제', advance.disabled === false);
        ok('Continue 노출', contBtn(node).style.display === '');
      });
    })
    /* [5] 응답 없는 요청 — 감시 타이머가 막다른 길을 연다 */
    .then(function () {
      console.log('\n[5] 무응답 요청');
      micMode = 'hang';
      var node = render();
      drainTimeouts();                       // 최초 요청
      return settle().then(function () {
        ok('대기 중에는 재시도 숨김', find(node, 'instr-mic-retry').style.display === 'none');
        drainTimeouts();                     // 감시 타이머 만료
        return settle();
      }).then(function () {
        ok('대기 안내', texts(node).indexOf('Still waiting for microphone permission') >= 0);
        ok('재시도 버튼 노출', find(node, 'instr-mic-retry').style.display === '');
        ok('상단바 잠금 유지', advance.disabled === true);
        micMode = 'grant';
      });
    })
    .then(function () {
      if (fails.length) { console.log('\nFAILED ' + fails.length + '건: ' + fails.join(' / ')); process.exit(1); }
      console.log('\nALL PASS');
    });
}
main();
