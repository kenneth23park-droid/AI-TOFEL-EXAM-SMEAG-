/* 리스닝 — 오디오가 끝나기 전에는 Next 를 누를 수 없다. node 전용.
 * 실행: node "studyground/tests/test_listening_next_lock.js"
 *
 * 발주 요구(2026-08-12): "listening 에서 질문 오디오가 끝나기 전까지는 next 버튼이
 * 클릭이 안 되도록". 재생은 1회뿐이라(FR8) 재생 중에 넘기면 그 문항의 음성을 다시는
 * 듣지 못한다.
 *
 * 계약은 전역 window.SG_AUDIO_GATE = { screenId, done } 하나다.
 *  - 리스닝 렌더러가 재생을 시작할 화면에서 올리고(done:false), ended/error 에 done 을 세운다.
 *  - 셸(exam-shell.js audioLocked)이 screenId 가 지금 화면과 같을 때만 인정해
 *    상단바 Next 를 비활성화하고 클릭 핸들러에서도 한 번 더 막는다.
 * 여기서는 [1~3] 렌더러 쪽 계약을 실제 렌더로, [4] 셸 쪽 배선을 소스로 확인한다.
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
window.SG_STORE.open({ id: 'test-next-lock', setCode: 'SET9', profile: 'toefl', mode: 'offline' });

/* 셸의 audioLocked() 와 같은 판정 — 화면 id 가 같을 때만 잠금으로 본다. */
function locked(screenId) {
  var g = window.SG_AUDIO_GATE;
  if (!g || g.screenId !== screenId) return false;
  return !g.done;
}

/* 셸 대역 — 렌더러가 잠금을 올리고 내릴 때마다 syncNav() 로 다시 칠하는지 센다. */
var syncs = 0;
window.SG_RUNTIME = {
  timing: function () { return timing; },
  syncNav: function () { syncs++; return true; }
};

var res = window.SG_COMPILE.compileScreens(pack, timing, { profile: 'toefl' });
var listening = res.screens.filter(function (s) { return s.section === 'listening'; });
var engine = { answer: function () { return true; }, startDeferredClocks: function () { return true; } };

/* ── [1] 문항 화면(audio-set) ──────────────────────────────── */
console.log('\n[1] 답변 화면 — 재생 중 Next 잠금');

var qScreen = listening.filter(function (s) {
  return s.blockKind === 'audio-set' && s.audio && s.audio.src && s.questionIds;
})[0];
ok('오디오를 든 답변 화면 존재', !!qScreen, qScreen && qScreen.id);

syncs = 0;
var qNode = L.renderListeningQuestion(qScreen, { engine: engine });
ok('렌더 직후 잠김', locked(qScreen.id) === true, JSON.stringify(window.SG_AUDIO_GATE));
ok('잠글 때 셸을 다시 칠했다', syncs >= 1, 'syncNav=' + syncs);

var qAudio = collect(qNode, 'audio, video')[0];
ok('오디오 엘리먼트 존재', !!qAudio, qAudio && qAudio.src);
qAudio.play();
ok('재생 중에도 잠김', locked(qScreen.id) === true);

syncs = 0;
qAudio.ended = true;
qAudio.emit('ended');
ok('재생이 끝나면 풀린다', locked(qScreen.id) === false, JSON.stringify(window.SG_AUDIO_GATE));
ok('풀 때도 셸을 다시 칠했다', syncs >= 1, 'syncNav=' + syncs);

/* ── [2] 오디오 전용 화면(audio-play) ──────────────────────── */
console.log('\n[2] 오디오 재생 화면 — 재생 중 Next 잠금');

/* SET 9(TOEFL)는 오디오를 답변 화면에 두므로 audio-play 는 컴파일되지 않는다
   (timerScope 'question' 프로필에서만 떨어져 나온다 — exam-compile.js audioSetBlock).
   그 화면 종류도 같은 계약을 지키는지 최소 화면으로 확인한다. */
var pScreen = {
  id: 'listening.play.T1', section: 'listening', screenType: 'question',
  blockKind: 'audio-play', advance: 'auto',
  copy: { titleEn: 'Conversation' }, audio: { src: 'media/audio/set9/l1-q13-14.mp3' }
};
ok('audio-play 화면 존재', !!pScreen, pScreen && pScreen.id);

if (pScreen) {
  var advanced = 0;
  var pNode = L.renderAudioPlay(pScreen, {
    engine: { audioEnded: function () { advanced++; return true; } }
  });
  ok('렌더 직후 잠김', locked(pScreen.id) === true, JSON.stringify(window.SG_AUDIO_GATE));

  var pAudio = collect(pNode, 'audio, video')[0];
  pAudio.play();
  ok('재생 중에도 잠김', locked(pScreen.id) === true);

  pAudio.ended = true;
  pAudio.emit('ended');
  ok('재생이 끝나면 풀린다', locked(pScreen.id) === false, JSON.stringify(window.SG_AUDIO_GATE));
  ok('자동 전진은 그대로', advanced === 1, 'audioEnded=' + advanced);
}

/* ── [3] 잠금이 다른 화면으로 새지 않는다 ──────────────────── */
console.log('\n[3] 잠금 범위');

var other = listening.filter(function (s) {
  return s.blockKind === 'audio-set' && s.questionIds && !(s.audio && s.audio.src);
})[0];
ok('오디오 없는 후속 문항 존재', !!other, other && other.id);

/* 잠긴 화면을 떠난 직후 상태를 만든다 — 앞 화면 잠금은 남아 있어도 뒤 화면은 열려야 한다. */
window.SG_AUDIO_GATE = { screenId: qScreen.id, done: false };
if (other) {
  L.renderListeningQuestion(other, { engine: engine });
  ok('오디오 없는 화면은 열려 있다', locked(other.id) === false, JSON.stringify(window.SG_AUDIO_GATE));
}

/* 재생이 소진된 화면(새로고침 후 재진입)도 잠기지 않는다 — ended 가 다시 오지 않으므로. */
var spentScreen = listening.filter(function (s) {
  return s.blockKind === 'audio-set' && s.audio && s.audio.src && s.id !== qScreen.id;
})[0];
if (spentScreen) {
  L.markAudioSpent(L.spentKey(spentScreen.id, spentScreen.audio.src));
  window.SG_AUDIO_GATE = null;
  L.renderListeningQuestion(spentScreen, { engine: engine });
  ok('소진된 오디오 화면은 잠그지 않는다', locked(spentScreen.id) === false, JSON.stringify(window.SG_AUDIO_GATE));
}

/* 오디오가 끊기면 먼저 이어 붙이고, 그래도 안 되면 풀어 준다 — 어느 쪽이든
   학생이 그 화면에 갇히지는 않는다. 이어 붙이기 자체는 별도 테스트에서 본다
   (test_listening_audio_resume.js). */
window.SG_AUDIO_GATE = null;
var errScreen = listening.filter(function (s) {
  return s.blockKind === 'audio-set' && s.audio && s.audio.src && s.id !== qScreen.id && s.id !== (spentScreen && spentScreen.id);
})[0];
if (errScreen) {
  var eNode = L.renderListeningQuestion(errScreen, { engine: engine });
  ok('렌더 직후 잠김', locked(errScreen.id) === true);
  var eAudio = collect(eNode, 'audio, video')[0];
  eAudio.emit('error');
  ok('첫 실패에는 곧장 넘기지 않는다 — 이어 붙이기를 먼저 한다', locked(errScreen.id) === true,
     JSON.stringify(window.SG_AUDIO_GATE));
  for (var t = 0; t <= 4; t++) { eAudio.emit('error'); }   // 시도를 다 써 버린다
  ok('시도를 다 쓰면 풀린다(갇히지 않는다)', locked(errScreen.id) === false, JSON.stringify(window.SG_AUDIO_GATE));
}

/* ── [4] 셸 배선 ───────────────────────────────────────────── */
console.log('\n[4] 셸(exam-shell.js) 배선');

var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
ok('audioLocked() 판정 존재', /function audioLocked\s*\(/.test(shell));
ok('SG_AUDIO_GATE 를 읽는다', shell.indexOf('window.SG_AUDIO_GATE') >= 0);
ok('화면 id 가 같을 때만 인정', /g\.screenId !== sc\.id/.test(shell));
ok('Next 버튼을 비활성화한다', /adv\.disabled = gated/.test(shell));
ok('클릭 핸들러에서도 막는다', /if \(!adminOn\(\) && audioLocked\(\)\) return;/.test(shell));
ok('관리자 검수는 통과', /!admin && audioLocked\(\)/.test(shell));

var css = fs.readFileSync(path.join(SG2, 'assets/exam.css'), 'utf8');
ok('잠긴 Next 가 눌리지 않는 것처럼 보인다', css.indexOf('.exam-btn.is-audio-locked') >= 0);

console.log('');
if (fails.length) { console.log('FAIL ' + fails.length + '건'); process.exit(1); }
console.log('ALL PASS (listening next lock)');
