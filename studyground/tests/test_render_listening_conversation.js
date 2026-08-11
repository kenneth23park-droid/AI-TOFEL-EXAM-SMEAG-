/* 리스닝 대화형 화면 레이아웃 + 화면 전환 시 오디오 정지 — node 전용.
 * 실행: node "studyground/tests/test_render_listening_conversation.js"
 *
 * 검증 두 가지(발주 요구, 2026-08-11):
 *  [A] 대화·강의 답변 화면은 **왼쪽에 사진 · 오른쪽에 4지 선택지** 2열이어야 한다.
 *      SET 9 리스닝 전 블록을 컴파일해 답변 화면마다 삽화와 선택지를 확인한다.
 *      (M1 Q13-32 는 docx 에 삽화가 없어 왼쪽 칸이 비어 있었다 — 그 회귀를 막는다.)
 *  [B] 다음 화면으로 넘어가면 앞 화면의 mp3 는 그 자리에서 멈춘다.
 *      SG_RENDER.clear()/render() 가 문서의 audio 를 pause 하고, 리스닝 렌더러의
 *      "일시정지하면 다시 재생" 규칙이 그 정지를 되살리지 않아야 한다.
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
function check(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name + ': ' + a + (a === e ? '' : ' (expected ' + e + ')'), a === e);
}

var L = window.SG_LISTEN;
var pack = window.SMEAG_SET9;
var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
window.SG_CONTENT_PACK = pack;
window.SG_RUNTIME = { timing: function () { return timing; } };
window.SG_STORE.open({ id: 'test-conv', setCode: 'SET9', profile: 'toefl', mode: 'offline' });

var res = window.SG_COMPILE.compileScreens(pack, timing, { profile: 'toefl' });
var qScreens = res.screens.filter(function (s) {
  return s.section === 'listening' && s.blockKind === 'audio-set' && s.questionIds;
});

/* ── [A] 답변 화면은 사진(좌) · 선택지(우) ─────────────────── */
console.log('\n[A] 리스닝 답변 화면 레이아웃 — 대상 ' + qScreens.length + '개');

var noImage = [], noSplit = [], badChoices = [];
for (var i = 0; i < qScreens.length; i++) {
  var scr = qScreens[i];
  var node = L.renderListeningQuestion(scr, { engine: { answer: function () { return true; } } });
  var nodes = walk(node, []);
  var card = nodes.filter(function (n) { return String(n.className).indexOf('lst-card') >= 0; })[0];
  var img = nodes.filter(function (n) { return n.tagName === 'IMG'; })[0];
  var radios = collect(node, 'input[type="radio"]');
  var checks = collect(node, 'input[type="checkbox"]');

  if (!img) noImage.push(scr.questionIds[0]);
  if (!card || String(card.className).indexOf('lst-split') < 0) noSplit.push(scr.questionIds[0]);
  if (radios.length + checks.length < 3) badChoices.push(scr.questionIds[0] + '(' + (radios.length + checks.length) + ')');

  // 좌 사진 · 우 문항: 카드의 첫 자식이 삽화(또는 삽화를 품은 오디오 유닛), 마지막이 문항.
  if (card && img) {
    var firstCol = card.children[0];
    var lastCol = card.children[card.children.length - 1];
    var imgInFirst = walk(firstCol, []).indexOf(img) >= 0;
    if (!imgInFirst || String(lastCol.className).indexOf('lst-q') < 0) {
      badChoices.push(scr.questionIds[0] + '(순서)');
    }
  }
}
check('삽화 없는 답변 화면', noImage, []);
check('2열이 아닌 답변 화면', noSplit, []);
check('선택지가 모자란 화면', badChoices, []);

/* 대화 블록 표본 하나를 눈으로 확인할 수 있게 찍는다. */
var conv = qScreens.filter(function (s) { return s.questionIds[0] === 'L1-13'; })[0];
ok('L1-13(대화) 화면 존재', !!conv, conv && conv.id);
ok('L1-13 삽화 경로', !!(conv && conv.image && conv.image.src), conv && conv.image && conv.image.src);

/* 삽화도 오디오도 없는 화면은 2열을 걸지 않는다(왼쪽 칸이 비지 않게). */
var bare = JSON.parse(JSON.stringify(conv));
delete bare.image; delete bare.audio; delete bare.timerStartsOnAudioEnd;
var bareNode = L.renderListeningQuestion(bare, {});
var bareCard = walk(bareNode, []).filter(function (n) { return String(n.className).indexOf('lst-card') >= 0; })[0];
ok('삽화·오디오 없는 화면은 한 열', String(bareCard.className).indexOf('lst-split') < 0, bareCard.className);

/* ── [B] 화면 전환 → 앞 화면 오디오 정지 ───────────────────── */
console.log('\n[B] 화면 전환 시 오디오 정지');

window.SG_RENDER.setMount(mountNode);
var first = qScreens.filter(function (s) { return s.audio && s.audio.src; })[0];
ok('오디오를 든 답변 화면 존재', !!first, first && first.id);

window.SG_RENDER.register('question', function (s, c) { return L.renderListeningQuestion(s, c); });
window.SG_RENDER.render(first, { engine: { answer: function () { return true; } } });
var audio = collect(docRoot, 'audio, video')[0];
ok('오디오 엘리먼트 마운트됨', !!audio, audio && audio.src);
audio.play();
ok('재생 중', audio.paused === false);

var playsBefore = audio.playCount;
window.SG_RENDER.render(qScreens[qScreens.length - 1], { engine: { answer: function () { return true; } } });
ok('앞 화면 오디오가 멈췄다', audio.paused === true);
ok('멈춘 뒤 자동 재개 없음', audio.playCount === playsBefore, 'playCount=' + audio.playCount);
ok('정지 표시가 남는다', audio.hasAttribute('data-sg-stopped'));

// 지연 도착한 error 이벤트가 다음 화면을 또 넘기지 않는다.
audio.emit('error');
ok('정지된 오디오의 error 는 무시된다', audio.paused === true);

console.log('');
if (fails.length) {
  console.log('FAILED ' + fails.length + '건: ' + fails.join(' / '));
  process.exit(1);
}
console.log('ALL PASS (listening conversation layout · audio stop)');
