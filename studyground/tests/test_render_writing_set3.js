/* SET 3 Writing Task 3(학술 토론) 화면 — 화자 사진이 실제로 붙는지 본다.
 * 실행: node studyground/tests/test_render_writing_set3.js
 *
 * 왜 따로 두는가. test_render_writing.js 는 document 없이 순수부만 검사한다.
 * 사진은 DOM 을 그려야만 보이고, 2026-09-23 의 세트 발행 한 번에 아바타 렌더가
 * 통째로 사라진 적이 있다 — 그 되돌림을 여기서 잡는다. 최소 DOM 셰임으로 그린다.
 */
var fs = require('fs'), path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');

function Node(tag) {
  this.tagName = String(tag || '').toUpperCase();
  this.children = []; this.attrs = {}; this.style = {}; this._text = '';
  this.className = ''; this.firstChild = null;
}
Node.prototype.appendChild = function (c) {
  this.children.push(c); this.firstChild = this.children[0]; return c;
};
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.getAttribute = function (k) { return this.attrs[k]; };
Node.prototype.addEventListener = function () {};
Node.prototype.removeEventListener = function () {};
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () { return this._text + this.children.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this._text = String(v); this.children = []; this.firstChild = null; }
});

var doc = {
  createElement: function (t) { return new Node(t); },
  createTextNode: function (t) { var n = new Node('#text'); n._text = String(t); return n; },
  addEventListener: function () {}, removeEventListener: function () {},
  body: new Node('body'), documentElement: new Node('html')
};

global.window = global;
global.document = doc;
global.fetch = undefined;
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set3.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-engine.js');
load('assets/exam-render-writing.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET3, timing, { profile: 'toefl' });
var W = window.SG_WRITING;
var w3 = res.screens.filter(function (s) {
  return W.handles(s) && s.blockKind === 'free-write' && s.moduleId === 'W3';
})[0];
if (!w3) { console.error('W3 free-write 화면을 못 찾았습니다'); process.exit(1); }

var node = W.renderScreen(w3, { content: window.SMEAG_SET3, engine: null });

function walk(n, out) {
  out.push(n);
  n.children.forEach(function (c) { walk(c, out); });
  return out;
}
var all = walk(node, []);
var imgs = all.filter(function (n) { return n.tagName === 'IMG'; });
var avatars = all.filter(function (n) { return /(^| )wr-avatar( |$)/.test(n.className); });
var inis = all.filter(function (n) { return /wr-avatar-ini/.test(n.className); });
var cols = all.filter(function (n) { return /wr-cols/.test(n.className); });
var names = all.filter(function (n) { return /wr-post-name/.test(n.className); }).map(function (n) { return n.textContent; });

console.log('wr-cols (2단 배치):', cols.length);
console.log('아바타 칸:', avatars.length, '/ 사진 <img>:', imgs.length, '/ 이니셜 대체:', inis.length);
console.log('이름:', JSON.stringify(names));
console.log('사진 주소:', JSON.stringify(imgs.map(function (n) { return n.src || n.attrs.src; })));
/* 주소만 맞고 파일이 없으면 학생 화면에는 깨진 사진이 뜬다 — 디스크까지 확인한다. */
var srcs = imgs.map(function (n) { return n.src || n.attrs.src; });
var missing = srcs.filter(function (u) { return !u || !fs.existsSync(path.join(SG2, u)); });
console.log('없는 사진 파일:', missing.length ? JSON.stringify(missing) : '없음');

var ok = cols.length === 1 && avatars.length === 3 && imgs.length === 3 && inis.length === 0
  && names.length === 3 && missing.length === 0;
console.log(ok ? '\nPASS — 세 화자 모두 사진이 붙었습니다.' : '\nFAIL');
process.exit(ok ? 0 : 1);
