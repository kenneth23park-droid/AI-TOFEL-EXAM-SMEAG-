/* IELTS 프로파일 컴파일 검증 — Epic 6 (6.1 / 6.2 / 6.3).
 * 실행: node studyground/tests/test_compile_ielts.js
 * 브라우저 없이 sg2 런타임 모듈을 window 섀도우 위에 얹어 순수 컴파일만 돌린다.
 *
 * 검증 대상
 *   [1] IELTS 콘텐츠 팩이 컴파일되고 모든 화면이 SG_TYPES.validateScreen 을 통과한다
 *   [2] Listening 30분 단일 카운트다운 + transfer 10분 화면(moduleEnd + transfer.editable)
 *   [3] Reading 3지문 60분 단일 카운트다운(timer.scope === 'section')
 *   [4] Writing Task1 1200초 / Task2 2400초 (timer.scope === 'task')
 *   [5] Speaking Part2 phases === [read, prep(60), record(120)]  ← §3.3 핵심 검증점
 *   [6] TOEFL 무회귀: S1 phases === [listen, prep(3), record(20)], transfer 화면 0개
 *   [7] timing.ielts.json ↔ SG_TIMING 내장 폴백 값 동일 + 두 프로파일 키 구조 동일
 *   [8] 프로파일 폴백: 알 수 없는 프로파일 → toefl + warn
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;               // 오프라인 폴백 경로를 타게 한다

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('config/ielts-sample.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');

var fails = [];
function check(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : ' (expected ' + e + ')'));
  if (!ok) fails.push(name);
}
function ok(name, cond, note) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (note ? ': ' + note : ''));
  if (!cond) fails.push(name);
}

var ielts = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.ielts.json'), 'utf8'));
var toefl = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var set = window.SMEAG_IELTS_SAMPLE;
var res = window.SG_COMPILE.compileScreens(set, ielts, { profile: 'ielts', lang: 'en' });

function byId(id) {
  for (var i = 0; i < res.screens.length; i++) { if (res.screens[i].id === id) return res.screens[i]; }
  return null;
}
function inSection(sec, type) {
  var out = [];
  for (var i = 0; i < res.screens.length; i++) {
    var s = res.screens[i];
    if (s.section === sec && (!type || s.screenType === type)) out.push(s);
  }
  return out;
}

console.log('\n[1] 화면 생성 · 계약 검증');
ok('화면이 생성됨', res.screens.length > 0, res.screens.length + ' screens');
var bad = 0;
res.screens.forEach(function (s) {
  var errs = window.SG_TYPES.validateScreen(s);
  if (errs && errs.length) { bad++; if (bad <= 5) console.log('       ' + s.id + ' → ' + errs.join('; ')); }
});
check('validateScreen 위반 화면', bad, 0);
var seen = {}, dup = 0;
res.screens.forEach(function (s) { if (seen[s.id]) dup++; seen[s.id] = 1; });
check('중복 screen id', dup, 0);
var qcount = 0;
res.screens.forEach(function (s) { qcount += (s.questionIds || []).length; });
check('총 문항(L8 + R6 + W2 + S5)', qcount, 21);
check('섹션 순서', ielts.sectionOrder, ['listening', 'reading', 'writing', 'speaking']);

console.log('\n[2] Listening — 30분 단일 카운트다운 + transfer 10분');
var lq = inSection('listening', 'question');
ok('listening 문항 화면 8개', lq.length === 8, lq.length + '');
check('listening timer.scope', lq[0].timer.scope, 'section');
check('listening timer.seconds', lq[0].timer.seconds, 1800);
check('listening timer.visible', lq[0].timer.visible, true);
check('listening timer.sharedDeadline', lq[0].timer.sharedDeadline, true);
var sameClock = true;
for (var i = 1; i < lq.length; i++) {
  if (lq[i].timer.scope !== 'section' || lq[i].timer.seconds !== 1800) sameClock = false;
}
ok('4파트가 하나의 섹션 시계를 공유', sameClock);

var tr = byId('listening.transfer.transferTime');
ok('transfer 화면 생성', !!tr, tr ? tr.id : 'MISSING');
check('transfer screenType', tr && tr.screenType, 'moduleEnd');
check('transfer timer', tr && [tr.timer.mode, tr.timer.scope, tr.timer.seconds, tr.timer.format, tr.timer.onExpire, tr.timer.visible],
  ['countdown', 'screen', 600, 'MM:SS', 'autoAdvance', true]);
check('transfer.enabled/editable', tr && [tr.transfer.enabled, tr.transfer.editable], [true, true]);
check('transfer 편집 대상 = listening 문항 화면 8개', tr && tr.transfer.targetScreenIds.length, 8);
ok('transfer 편집 대상이 전부 listening 문항 화면', (function () {
  for (var k = 0; k < tr.transfer.targetScreenIds.length; k++) {
    var s = byId(tr.transfer.targetScreenIds[k]);
    if (!s || s.section !== 'listening' || s.screenType !== 'question') return false;
  }
  return true;
})());
ok('transfer 화면에 오디오 없음(AC6)', !tr.audio);
var trIdx = res.screens.indexOf(tr), lastLq = res.screens.indexOf(lq[lq.length - 1]);
ok('transfer 는 listening 마지막 문항 뒤', trIdx > lastLq, trIdx + ' > ' + lastLq);

console.log('\n[3] Reading — 3지문 60분 단일 카운트다운');
var rq = inSection('reading', 'question');
ok('reading 문항 화면 3개(지문당 1화면)', rq.length === 3, rq.length + '');
check('reading timer.scope', rq[0].timer.scope, 'section');
check('reading timer.seconds', rq[0].timer.seconds, 3600);
check('reading timer.visible', rq[0].timer.visible, true);
check('reading 화면당 시계 1개', rq[0].timers.length, 1);

console.log('\n[4] Writing — Task1 20분 / Task2 40분 (scope=task)');
var wq = inSection('writing', 'question');
ok('writing 문항 화면 2개', wq.length === 2, wq.length + '');
check('Task1 timer', [wq[0].timer.scope, wq[0].timer.seconds], ['task', 1200]);
check('Task2 timer', [wq[1].timer.scope, wq[1].timer.seconds], ['task', 2400]);
ok('writing 섹션 시계는 숨김(표시 시계는 task)', wq[0].timers.length === 2 && wq[0].timers[1].scope === 'section' && wq[0].timers[1].visible === false);
check('Task1 minWords(config)', window.SG_TIMING.get(ielts, 'sections.writing.tasks[id=TASK1].minWords'), 150);
check('Task2 minWords(config)', window.SG_TIMING.get(ielts, 'sections.writing.tasks[id=TASK2].minWords'), 250);

console.log('\n[5] Speaking — Part2 = [read, prep(60), record(120)]');
var sq = inSection('speaking', 'speaking');
ok('speaking 화면 5개', sq.length === 5, sq.length + '');
var p2 = null;
for (i = 0; i < sq.length; i++) { if (sq[i].moduleId === 'SP2') p2 = sq[i]; }
ok('Part 2 화면 존재', !!p2, p2 ? p2.id : 'MISSING');
check('Part2 phase 이름', p2.phases.map(function (p) { return p.name; }), ['read', 'prep', 'record']);
check('Part2 phase 초', p2.phases.map(function (p) { return p.seconds; }), [0, 60, 120]);
check('Part2 prep.onExpire', p2.phases[1].onExpire, 'startRecord');
check('Part2 record.onExpire', p2.phases[2].onExpire, 'stopRecord');
check('Part2 timer', [p2.timer.mode, p2.timer.seconds, p2.timer.format], ['response', 120, 'HH:MM:SS']);
ok('Part2 read phase 에 cue card', !!(p2.phases[0].cue && p2.phases[0].cue.topicEn), p2.phases[0].cue && p2.phases[0].cue.topicEn);
check('Part2 cue bullets 4개', p2.phases[0].cue.bullets.length, 4);
ok('Part2 prep phase 에도 cue card 유지', !!(p2.phases[1].cue && p2.phases[1].cue.bullets.length === 4));
var p1 = null, p3 = null;
for (i = 0; i < sq.length; i++) {
  if (sq[i].moduleId === 'SP1' && !p1) p1 = sq[i];
  if (sq[i].moduleId === 'SP3' && !p3) p3 = sq[i];
}
check('Part1 phase(prep 0초)', p1.phases.map(function (p) { return p.name + ':' + p.seconds; }), ['prep:0', 'record:30']);
check('Part3 phase(prep 0초)', p3.phases.map(function (p) { return p.name + ':' + p.seconds; }), ['prep:0', 'record:45']);
ok('Part1/3 에는 cue card 없음', !p1.phases[0].cue && !p3.phases[0].cue);

console.log('\n[6] TOEFL 무회귀');
var t = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, toefl, { profile: 'toefl', lang: 'en' });
/* 78 → 97: Listening 오디오 화면/답변 화면 분리(2026-08-07 녹화 실측).
 * 근거와 19화면의 산술 유도는 studyground/tests/test_compile_screens.js [1] 주석 참조. */
check('TOEFL 총 화면', t.screens.length, 98);
var s1 = null, trCount = 0;
t.screens.forEach(function (s) {
  if (!s1 && s.screenType === 'speaking' && s.moduleId === 'S1') s1 = s;
  if (s.transfer) trCount += 1;
});
check('TOEFL S1 phase', s1.phases.map(function (p) { return p.name + ':' + p.seconds; }), ['listen:0', 'prep:3', 'record:20']);
check('TOEFL transfer 화면 수', trCount, 0);
var tRead = null;
t.screens.forEach(function (s) { if (!tRead && s.section === 'reading' && s.screenType === 'question') tRead = s; });
// 1080 → 1200: R1 실측(recording 2730s→19:22, 2745s→19:08 → 시작값 20:00).
check('TOEFL reading 표시 시계는 module', [tRead.timer.scope, tRead.timer.seconds, tRead.timer.visible], ['module', 1200, true]);
check('TOEFL reading 섹션 시계는 숨김 유지', [tRead.timers[1].scope, tRead.timers[1].visible], ['section', false]);
ok('TOEFL 컴파일 경고 없음', t.warnings.length === 0, t.warnings.join(' | '));

console.log('\n[7] config ↔ 내장 폴백 · 키 구조 드리프트');
function keyPaths(o, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  if (!o || typeof o !== 'object' || o instanceof Array) return out;
  var ks = Object.keys(o).sort();
  for (var j = 0; j < ks.length; j++) {
    var p = prefix ? prefix + '.' + ks[j] : ks[j];
    out.push(p);
    keyPaths(o[ks[j]], p, out);
  }
  return out;
}
function stripProvenance(cfg) {
  var c = JSON.parse(JSON.stringify(cfg));
  if (c.provenance) c.provenance.entries = [];
  return c;
}
check('내장 IELTS 폴백 == timing.ielts.json (provenance.entries 제외)',
  JSON.stringify(stripProvenance(window.SG_TIMING.FALLBACK_IELTS)) === JSON.stringify(stripProvenance(ielts)), true);
check('내장 TOEFL 폴백 == timing.toefl.json (provenance.entries 제외)',
  JSON.stringify(stripProvenance(window.SG_TIMING.FALLBACK)) === JSON.stringify(stripProvenance(toefl)), true);

/* 두 프로파일의 키 집합 비교. speaking.taskTypes.* 는 시험별 유형 이름이 다르므로 제외한다
 * (Story 6.1 AC1 이 명시한 유일한 허용 차이). modules/tasks 는 배열이라 경로에 안 잡힌다. */
function keySet(cfg) {
  var c = stripProvenance(cfg);
  delete c.sections.speaking.taskTypes;
  var m = {};
  keyPaths(c).forEach(function (p) { m[p] = 1; });
  return m;
}
var ka = keySet(toefl), kb = keySet(ielts), diff = [];
Object.keys(ka).forEach(function (k) { if (!kb[k]) diff.push('toefl only: ' + k); });
Object.keys(kb).forEach(function (k) { if (!ka[k]) diff.push('ielts only: ' + k); });
if (diff.length) diff.slice(0, 10).forEach(function (d) { console.log('       ' + d); });
check('두 프로파일 키 집합 차이(speaking.taskTypes 제외)', diff.length, 0);

/* taskTypes 항목의 **내부** 키 구조는 동일해야 한다. */
function ttKeys(cfg) {
  var tt = cfg.sections.speaking.taskTypes, first = Object.keys(tt)[0];
  return Object.keys(tt[first]).sort().join(',');
}
check('taskTypes 항목 키 동일', ttKeys(ielts), ttKeys(toefl));

console.log('\n[8] 프로파일 폴백 (AC5)');
var warned = [];
var realWarn = console.warn;
console.warn = function (m) { warned.push(String(m)); };
window.SG_TIMING._reset();
window.SG_TIMING.load('nonsense', function () {});
console.warn = realWarn;
check('알 수 없는 프로파일 → toefl', window.SG_TIMING.profile(), 'toefl');
check('scoreScale', window.SG_TIMING.scoreScale(), 'toefl120');
ok('폴백 경고 로그', warned.join(' | ').indexOf('unknown exam profile') >= 0, warned.slice(0, 2).join(' | '));
window.SG_TIMING._reset();
window.SG_TIMING.load('ielts', function () {});
check('ielts 프로파일 로드', window.SG_TIMING.profile(), 'ielts');
check('ielts scoreScale', window.SG_TIMING.scoreScale(), 'ielts9');
check('ielts reading sectionSec', window.SG_TIMING.get('sections.reading.sectionSec'), 3600);
check('Band 표기', window.SG_TIMING.formatScore(7.25), 'Band 7.5');
window.SG_TIMING._reset();
window.SG_TIMING.loadBuiltin('toefl');
check('TOEFL 총점 표기', window.SG_TIMING.formatScore(98, 'B2'), '98/120 · B2');

console.log('\n[9] 렌더러 — cue card(6.2) / transfer time(6.3)');
/* 최소 DOM 스텁. 렌더러가 실제로 쓰는 API 만 구현한다(test_render_instruction_listening.js 와 동형). */
function makeNode(tag) {
  var n = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {},
    className: '', style: {}, _text: '', hidden: false, disabled: false, firstChild: null, _ev: {},
    appendChild: function (c) { c.parentNode = n; n.children.push(c); n.firstChild = n.children[0]; return c; },
    insertBefore: function (c, ref) {
      var at = n.children.length;
      for (var i = 0; i < n.children.length; i++) { if (n.children[i] === ref) { at = i; break; } }
      n.children.splice(at, 0, c); c.parentNode = n; n.firstChild = n.children[0]; return c;
    },
    removeChild: function (c) {
      for (var i = 0; i < n.children.length; i++) { if (n.children[i] === c) { n.children.splice(i, 1); break; } }
      n.firstChild = n.children.length ? n.children[0] : null; c.parentNode = null; return c;
    },
    setAttribute: function (k, v) { n.attrs[k] = String(v); },
    getAttribute: function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; },
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function (t, fn) { (n._ev[t] = n._ev[t] || []).push(fn); },
    classList: { add: function () {}, remove: function () {} },
    load: function () {}, pause: function () {},
    play: function () { return { 'catch': function () { return this; } }; },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text || flat(n); },
    set: function (v) { n._text = String(v); n.children = []; n.firstChild = null; }
  });
  return n;
}
function flat(n) {
  var s = n._text || '';
  for (var i = 0; i < n.children.length; i++) s += flat(n.children[i]);
  return s;
}
function walkAll(n, out) { out.push(n); for (var i = 0; i < n.children.length; i++) walkAll(n.children[i], out); return out; }
function findTag(n, tag) {
  var all = walkAll(n, []), out = [];
  for (var i = 0; i < all.length; i++) { if (all[i].tagName === tag) out.push(all[i]); }
  return out;
}
function findText(n, needle) { return flat(n).indexOf(needle) >= 0; }

var bodyNode = makeNode('body');
global.document = {
  createElement: makeNode, getElementById: function () { return null; },
  querySelectorAll: function () { return []; }, addEventListener: function () {}, body: bodyNode
};
global.navigator = {};
global.localStorage = { _m: {}, getItem: function (k) { return this._m.hasOwnProperty(k) ? this._m[k] : null; },
  setItem: function (k, v) { this._m[k] = String(v); }, removeItem: function (k) { delete this._m[k]; } };
global.requestAnimationFrame = undefined;

load('assets/exam-render.js');
load('assets/exam-render-instruction.js');
load('assets/exam-render-speaking.js');
window.SMEAG_IELTS_SAMPLE.install();   // 렌더러가 콘텐츠를 SMEAG_SET1 에서 읽는다

/* (a) Speaking Part 2 — cue card + 메모 + 조기 시작 */
var realSetTimeout = global.setTimeout;
global.setTimeout = undefined;         // renderSpeaking 이 동기로 start() 하게 한다
var p2node = window.SG_SPEAKING.render(p2, {});
global.setTimeout = realSetTimeout;
ok('Part2 렌더 노드 생성', !!p2node);
ok('cue card 주제 표시', findText(p2node, 'Describe a skill you learned outside school'));
ok('cue card 불릿 4개', findTag(p2node, 'LI').length === 4, findTag(p2node, 'LI').length + '');
var memo = findTag(p2node, 'TEXTAREA');
ok('메모 textarea 1개', memo.length === 1, memo.length + '');
ok('메모는 답안이 아님(안내 문구)', findText(p2node, 'Notes are not submitted'));
memo[0].value = 'my notes';
if (memo[0].oninput) memo[0].oninput();
ok('read phase 에 Continue 버튼', findText(p2node, 'Continue'));
/* read(selfPaced) → 버튼 클릭 → prep(60초) */
var btns = findTag(p2node, 'BUTTON');
if (btns.length && btns[0].onclick) btns[0].onclick();
ok('prep phase 에 조기 시작 버튼(AC6)', findText(p2node, 'Start speaking now'));
ok('prep 에서도 cue card 유지', findText(p2node, 'Describe a skill you learned outside school'));
ok('prep 에서 메모 값 유지', findTag(p2node, 'TEXTAREA')[0].value === 'my notes');

/* (b) TOEFL S1 회귀 — cue 없음, prep 조기시작 버튼 없음 */
global.setTimeout = undefined;
var s1node = window.SG_SPEAKING.render(s1, {});
global.setTimeout = realSetTimeout;
ok('TOEFL S1 에 cue card 없음', !findText(s1node, 'CUE CARD'));
ok('TOEFL S1 에 메모창 없음', findTag(s1node, 'TEXTAREA').length === 0);
ok('TOEFL S1 에 조기 시작 버튼 없음', !findText(s1node, 'Start speaking now'));
check('SG_SPEAKING.firstCue(TOEFL S1)', window.SG_SPEAKING.firstCue(s1.phases), null);

/* (c) transfer 화면 — 카운트다운 + 편집 패널 + Finish early 2단계 확인 */
var fakeEngine = { screens: function () { return res.screens; }, next: function () { fakeEngine._next = (fakeEngine._next || 0) + 1; },
  onTransition: function () { return function () {}; }, currentIndex: function () { return 0; } };
var trNode = window.SG_INSTRUCTION.renderModuleEnd(tr, { engine: fakeEngine });
ok('transfer 카운트다운 라벨', findText(trNode, 'Time remaining'));
ok('transfer 편집 패널', findText(trNode, 'Your answers'));
ok('transfer 편집 항목 8개', findTag(trNode, 'LI').length === 8, findTag(trNode, 'LI').length + '');
ok('Finish early 버튼', findText(trNode, 'Finish early'));
ok('확인 문구가 처음에는 숨김', (function () {
  var all = walkAll(trNode, []);
  for (var i = 0; i < all.length; i++) {
    if (findText(all[i], 'Finish the transfer time now?') && all[i].style.display === 'none') return true;
  }
  return false;
})());
var trBtns = findTag(trNode, 'BUTTON');
ok('버튼 3개(Finish early / Yes / Cancel)', trBtns.length === 3, trBtns.length + '');
trBtns[0].onclick();
ok('확인 단계 노출', (function () {
  var all = walkAll(trNode, []);
  for (var i = 0; i < all.length; i++) {
    if (findText(all[i], 'Finish the transfer time now?') && all[i].style.display === '') return true;
  }
  return false;
})());
ok('확인 전에는 전진하지 않음', !fakeEngine._next);
trBtns[1].onclick();
check('확인 후 engine.next 1회', fakeEngine._next, 1);

console.log('\n[note] IELTS 컴파일 경고 ' + res.warnings.length + '건');
res.warnings.slice(0, 10).forEach(function (w) { console.log('       - ' + w); });

/* 미디어는 아직 제작 전이다(콘텐츠 팩 헤더 주석 참조). 실재 여부는 정보성으로만 출력한다. */
var pending = [];
res.screens.forEach(function (s) {
  [s.audio, s.image].concat(s.phases ? s.phases.map(function (p) { return p.media; }) : [])
    .forEach(function (m) {
      if (!m || !m.src) return;
      if (!fs.existsSync(path.join(SG2, decodeURI(m.src)))) pending.push(m.src);
    });
});
console.log('[note] 아직 없는 미디어 자산 ' + pending.length + '건 (제작 대기)');

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
