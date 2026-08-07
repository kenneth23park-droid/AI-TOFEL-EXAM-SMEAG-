/* Reading 렌더러(Story 2.3) 필드 계약 검증.
 * 실행: node studyground/tests/test_render_reading.js
 * 컴파일러를 실제로 돌려 reading/question 화면을 뽑고, exam-render-reading.js 의
 * 렌더 함수가 참조하는 필드가 전부 실재하는지 확인한다. DOM 없이 순수 헬퍼만 쓴다. */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-engine.js');
load('assets/exam-render-reading.js');   // document 없음 → install() 은 no-op 경로

var RD = window.SG_RENDER_READING;
var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, timing, { profile: 'toefl' });

var fails = [];
function check(name, actual, expected) {
  var ok = actual === expected;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
  if (!ok) fails.push(name);
}
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}

var screens = res.screens.filter(function (s) { return RD.isReadingScreen(s); });

console.log('\n[1] 담당 화면 수집');
check('reading question 화면', screens.length, 6);
var kinds = {};
screens.forEach(function (s) { kinds[s.blockKind] = (kinds[s.blockKind] || 0) + 1; });
check('cloze 화면', kinds.cloze || 0, 2);
check('passage 화면', kinds.passage || 0, 3);
check('chat 화면', kinds.chat || 0, 1);

console.log('\n[2] 화면→블록 역참조와 렌더 필드 실재');
var totalQ = 0, blanks = 0, mcq = 0, inserts = 0;
screens.forEach(function (s) {
  var blk = RD.blockOf(s);
  ok('blockOf ' + s.id, !!blk);
  if (!blk) return;
  ok(s.id + ' heading', typeof blk.heading === 'string' && blk.heading.length > 0);
  ok(s.id + ' instruction', typeof blk.instruction === 'string');
  var qs = RD.questionsOf(blk, s.questionIds);
  ok(s.id + ' questionIds ↔ questions', qs.length === s.questionIds.length,
     qs.length + '/' + s.questionIds.length);
  totalQ += qs.length;

  if (s.blockKind === 'cloze') {
    ok(s.id + ' template 존재', typeof blk.template === 'string' && blk.template.length > 0);
    var toks = RD.clozeTokens(blk.template);
    var nums = toks.filter(function (t) { return t.token !== undefined; });
    ok(s.id + ' blank 10개', nums.length === 10, 'tokens=' + nums.length);
    // 렌더러는 question.no 로 {{n}} ↔ 문항을 잇는다. 짝이 맞아야 입력칸이 저장된다.
    var byNo = {};
    qs.forEach(function (q) { byNo[String(q.no)] = q; blanks += (q.kind === 'blank' ? 1 : 0); });
    var missing = nums.filter(function (t) { return !byNo[t.token]; });
    ok(s.id + ' {{n}} ↔ question.no 전수 매칭', missing.length === 0,
       missing.map(function (t) { return t.token; }).join(','));
    ok(s.id + ' hint(placeholder) 전수 존재', qs.every(function (q) { return typeof q.hint === 'string'; }));
    ok(s.id + ' TTS/지문 텍스트는 cloze 에서 미사용', RD.passageText(blk) === '');
  }

  if (s.blockKind === 'chat') {
    ok(s.id + ' messages[] 존재', (blk.messages || []).length > 0);
    ok(s.id + ' 말풍선 필드(text/side/name)', blk.messages.every(function (m) {
      return typeof m.text === 'string' && (m.side === 'left' || m.side === 'right') && typeof m.name === 'string';
    }));
  }

  if (s.blockKind === 'passage') {
    ok(s.id + ' paragraphs[] 존재', (blk.paragraphs || []).length > 0);
    ok(s.id + ' title 존재', typeof blk.title === 'string' && blk.title.length > 0);
  }

  if (s.blockKind !== 'cloze') {
    ok(s.id + ' passageText 비어있지 않음', RD.passageText(blk).length > 0);
    var id = RD.ttsIdOf(s.moduleId, blk);
    ok(s.id + ' ttsId 형식', /^read-R[12]-[a-z0-9-]+$/.test(id), id);
    qs.forEach(function (q) {
      if (q.kind === 'insert') { inserts++; return; }
      mcq++;
      ok(q.id + ' choices 4개', (q.choices || []).length === 4);
      ok(q.id + ' prompt 존재', typeof q.prompt === 'string' && q.prompt.length > 0);
    });
  }

  var iq = RD.insertQuestionOf(blk, qs);
  if (iq) {
    ok(iq.id + ' sentence 존재', typeof iq.sentence === 'string' && iq.sentence.length > 0);
    ok(iq.id + ' choices 4개(Position A~D)', (iq.choices || []).length === 4);
    ok(iq.id + ' 지문에 {{A}}~{{D}} 마커 존재', RD.hasMarkers(blk));
    var found = {};
    (blk.paragraphs || []).forEach(function (p) {
      RD.markerTokens(p).forEach(function (t) { if (t.token) found[t.token] = 1; });
    });
    check(iq.id + ' 마커 개수', Object.keys(found).length, 4);
  }
});
check('reading 문항 합계', totalQ, 35);
check('blank 문항', blanks, 20);
check('mcq 문항', mcq, 14);
check('insert 문항', inserts, 1);

console.log('\n[3] insert 마커가 있는 블록은 정확히 1개(R1-20)');
var withMarkers = screens.filter(function (s) { var b = RD.blockOf(s); return b && RD.hasMarkers(b); });
check('마커 보유 화면', withMarkers.length, 1);
check('그 화면의 insert 문항 id', RD.insertQuestionOf(RD.blockOf(withMarkers[0])).id, 'R1-20');

console.log('\n[4] module sharedDeadline — 화면을 오가도 clock key 가 같다');
var keys = {};
screens.forEach(function (s) {
  ok(s.id + ' timer.scope=module', s.timer && s.timer.scope === 'module', s.timer ? s.timer.scope : 'null');
  ok(s.id + ' sharedDeadline', !!(s.timer && s.timer.sharedDeadline));
  ok(s.id + ' allowBack', s.allowBack === true);
  var k = window.SG_EXAM.clockKeyFor(s, s.timer);
  keys[s.moduleId] = keys[s.moduleId] || {};
  keys[s.moduleId][k] = 1;
});
check('R1 clock key 종류', Object.keys(keys.R1).length, 1);
check('R2 clock key 종류', Object.keys(keys.R2).length, 1);
check('R1 key', Object.keys(keys.R1)[0], 'module:R1');
check('R2 key', Object.keys(keys.R2)[0], 'module:R2');
var alloc = timing.sections.reading.modules;
/* 2026-08-07 실측으로 교체 (구값 R1 1080 / R2 1020 은 2100 을 반씩 나눈 가설이었다).
 * R1 = 1200s(20:00): recording 2730s→19:22, 2745s→19:08.
 * R2 =  540s(09:00): recording 2930s→08:43, 2960s→08:13, 3000s→07:33, 3030s→07:04.
 * 측정 절차는 docs/bmad/timing-spec.md §8.
 * 2026-08-07 재수정: R2 는 최종수정사항.docx "MODULE 2: 10 mins. (Time limit)" 로 600s 확정 —
 * 발주처 규격서(spec)가 녹화 실측(observed)을 대체한다. R1 20:00 은 양쪽이 일치. */
check('R1 allocatedSec', alloc[0].allocatedSec, 1200);
check('R2 allocatedSec', alloc[1].allocatedSec, 600);

console.log('\n[5] 순수 헬퍼 단위 확인');
var t = RD.clozeTokens('a {{1}} b {{2}}');
check('clozeTokens 길이', t.length, 4);
check('clozeTokens[1].token', t[1].token, '1');
var mt = RD.markerTokens('{{A}}x{{B}}');
check('markerTokens 첫 토큰', mt[0].token, 'A');
check('markerTokens 텍스트', mt[1].text, 'x');
check('slug', RD.slug('Subject: Community Garden Opening'), 'subject-community-garden-opening');
check('passageText(messages)', RD.passageText({ messages: [{ name: 'A', text: 'hi' }] }), 'A: hi');
check('blockOf(콘텐츠 없음)', RD.blockOf({ questionIds: [] }), null);
/* cloze 어간/밑줄 — 관찰된 fo__ / she____ 표기를 만드는 계산. */
var qFood = { hint: 'fo', answer: 'food' };
check('missingCount(fo|food)', RD.missingCount(qFood), 2);
check('railText 미입력', RD.railText(2, 0), '__');
check('railText 1글자 입력', RD.railText(2, 1), ' _');
check('railText 완료', RD.railText(2, 2), '  ');
check('composeAnswer', RD.composeAnswer(qFood, 'od'), 'food');
check('composeAnswer(미입력은 빈칸)', RD.composeAnswer(qFood, ''), '');
check('typedFrom', RD.typedFrom(qFood, 'food'), 'od');
check('typedFrom(미응답)', RD.typedFrom(qFood, null), '');
// hint 가 answer 의 접두사가 아니면 글자 수를 알 수 없다 → 자유 입력
check('missingCount(어긋난 콘텐츠)', RD.missingCount({ hint: 'zz', answer: 'food' }), 0);
check('missingCount(정답 없음)', RD.missingCount({ hint: 'fo' }), 0);

console.log('\n[6] 번들 TTS id 가 media/tts/index.json 에 실재');
var idx = JSON.parse(fs.readFileSync(path.join(SG2, 'media/tts/index.json'), 'utf8'));
screens.forEach(function (s) {
  if (s.blockKind === 'cloze') return;
  var blk = RD.blockOf(s);
  var id = RD.ttsIdOf(s.moduleId, blk);
  ok('tts ' + id, !!idx[id], idx[id] ? idx[id].file : 'missing (browser voice fallback)');
});

/* ── [7] 실제 render() 스모크 — 최소 DOM 스텁 위에서 돌린다 ──────────────
 * jsdom 등 신규 의존성은 금지이므로(P1) 렌더러가 실제로 쓰는 DOM 표면만 흉내낸다:
 * createElement/createTextNode/appendChild/textContent/setAttribute/className/
 * querySelector(All)/getElementById. 그 외 API 는 렌더러가 존재 확인 후 호출한다. */
var FOCUSED = null;   // cloze 포커스 이동 검증용([10]) — 스텁이 focus() 를 기록한다.
function makeDom() {
  var all = [];
  function Node(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._text = '';
    all.push(this);
  }
  Node.prototype.appendChild = function (c) { this.children.push(c); return c; };
  Node.prototype.removeChild = function (c) {
    for (var i = 0; i < this.children.length; i++) { if (this.children[i] === c) { this.children.splice(i, 1); return c; } }
    return c;
  };
  Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  Node.prototype.focus = function () { FOCUSED = this; if (this.onfocus) this.onfocus(); };
  Node.prototype.setSelectionRange = function (a) { this.selectionStart = a; };
  Node.prototype.getAttribute = function (k) { return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
  Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
  Object.defineProperty(Node.prototype, 'textContent', {
    get: function () {
      if (this.children.length) {
        return this.children.map(function (c) { return c.textContent; }).join('');
      }
      return this._text;
    },
    set: function (v) { this.children = []; this._text = String(v); }
  });
  function walk(n, out) {
    for (var i = 0; i < n.children.length; i++) { out.push(n.children[i]); walk(n.children[i], out); }
    return out;
  }
  function matches(n, sel) {
    var m = sel.match(/^([a-z]+)?(?:\.([\w-]+))?(?:\[([\w-]+)="([^"]*)"\])?$/i);
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && (' ' + n.className + ' ').indexOf(' ' + m[2] + ' ') < 0) return false;
    if (m[3] && n.getAttribute(m[3]) !== m[4]) return false;
    return true;
  }
  Node.prototype.querySelectorAll = function (sel) {
    return walk(this, []).filter(function (n) { return matches(n, sel); });
  };
  Node.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  return {
    createElement: function (t) { return new Node(t); },
    createTextNode: function (t) { var n = new Node('#text'); n._text = String(t); return n; },
    getElementById: function (id) {
      for (var i = 0; i < all.length; i++) { if (all[i].id === id) return all[i]; }
      return null;
    },
    _all: all
  };
}

console.log('\n[7] render() 스모크 (엔진·스토어 연결 상태)');
global.document = makeDom();
load('assets/exam-store.js');
load('assets/exam-render.js');
load('assets/exam-render-reading.js');   // document 가 생긴 뒤 다시 로드 → install() 실행
RD = window.SG_RENDER_READING;
window.SG_STORE.setBackend(window.SG_STORE.memoryBackend());
window.SG_STORE.open('test-reading-session');

function countIn(node, sel) { return node.querySelectorAll(sel).length; }

screens.forEach(function (s) {
  var full = res.screens;
  var i = window.SG_STORE.findScreenIndex(full, s.id);
  var machine = window.SG_EXAM.create(full, { mode: 'exam' });
  machine.restoreTo(i, 0);
  machine.start(i);
  var node = null;
  try { node = RD.render(s, { engine: machine, mode: 'exam', phaseIndex: 0 }); }
  catch (e) { ok('render ' + s.id + ' 예외 없음', false, e.message); return; }
  ok('render ' + s.id + ' 노드 생성', !!node);
  var blk = RD.blockOf(s);
  var qs = RD.questionsOf(blk, s.questionIds);

  if (s.blockKind === 'cloze') {
    check(s.id + ' 입력칸 수', countIn(node, 'input.blank-in'), 10);
    /* 2026-08-07 계약 갱신 — 근거: docs/reference/screens/reading-cloze-2760s.png.
     * 실제 화면의 빈칸은 빈 입력상자가 아니라 '어간 + 남은 글자 수만큼의 밑줄'(fo__ / she____)이다.
     * 따라서 입력칸은 어간을 뺀 나머지 글자만 받고(R1-1: hint 'br' → 'ain'),
     * 저장되는 답안은 여전히 완성 단어('brain')다 — autoscore 의 CLOZE/WORD_FILLING 는 정답 텍스트 비교라
     * 저장 정본을 바꾸면 채점이 깨진다. 구값 'brain' 을 그대로 치면 maxLength 3 에 잘려 'bra' 가 된다. */
    var inputs = node.querySelectorAll('input.blank-in');
    var q0 = qs[0];
    check(s.id + ' 빠진 글자 수', RD.missingCount(q0), String(q0.answer).length - String(q0.hint).length);
    inputs[0].value = RD.typedFrom(q0, q0.answer);
    inputs[0].oninput();
    var rec = window.SG_STORE.getAnswer(q0.id);
    ok(s.id + ' 입력이 완성 단어로 저장', !!rec && rec.v === q0.answer, rec ? String(rec.v) : 'none');
    /* cloze 에는 그리드 내비게이션이 없다(관찰 화면의 카드 아래는 비어 있고, 빈칸이 지문 안에 인라인이라
     * 자동 이동·화살표 이동이 그 역할을 한다). 대신 채워진 칸이 강조되는지를 본다. */
    check(s.id + ' cloze 그리드 없음', countIn(node, 'button'), 0);
    ok(s.id + ' 채워진 칸 강조', node.querySelectorAll('span.rd-blank')[0].className.indexOf('is-filled') > 0,
       node.querySelectorAll('span.rd-blank')[0].className);
    ok(s.id + ' 밑줄 레일 소진', node.querySelectorAll('span.rd-blank-rail')[0].textContent.indexOf('_') < 0,
       JSON.stringify(node.querySelectorAll('span.rd-blank-rail')[0].textContent));
  } else {
    check(s.id + ' 선택지 라벨 수', countIn(node, 'label.opt'), qs.reduce(function (a, q) { return a + (q.choices || []).length; }, 0));
    check(s.id + ' 그리드 버튼 수', node.querySelectorAll('button').length - countIn(node, 'button.rd-marker') - (window.SG_TTS ? 1 : 0), qs.length);
    if (s.blockKind === 'chat') {
      check(s.id + ' 말풍선 수', countIn(node, 'div.rd-chat-bubble'), blk.messages.length);
    } else {
      check(s.id + ' 문단 수', countIn(node, 'p.rd-para'), blk.paragraphs.length);
    }
    // mcq 선택 → 인덱스로 저장
    var radios = node.querySelectorAll('input');
    var mcqQ = qs.filter(function (q) { return q.kind === 'mcq'; })[0];
    if (mcqQ) {
      var rs = node.querySelectorAll('label[data-q="' + mcqQ.id + '"]').map(function (l) { return l.children[0]; });
      rs[2].checked = true; rs[2].onchange();
      var r2 = window.SG_STORE.getAnswer(mcqQ.id);
      ok(mcqQ.id + ' mcq 선택 저장(index)', !!r2 && r2.v === 2, r2 ? String(r2.v) : 'none');
    }
    // insert 양방향 동기화
    var iq = RD.insertQuestionOf(blk, qs);
    if (iq) {
      check(s.id + ' 마커 버튼 수', countIn(node, 'button.rd-marker'), 4);
      var markers = node.querySelectorAll('button.rd-marker');
      markers[1].onclick();                       // 마커 B 클릭
      var r3 = window.SG_STORE.getAnswer(iq.id);
      ok(iq.id + ' 마커 클릭 → 답안 1(Position B)', !!r3 && r3.v === 1, r3 ? String(r3.v) : 'none');
      var iradios = node.querySelectorAll('label[data-q="' + iq.id + '"]').map(function (l) { return l.children[0]; });
      ok(iq.id + ' 마커 → 라디오 동기화', iradios[1].checked === true && iradios[0].checked === false);
      ok(iq.id + ' 문장 미리보기 삽입', markers[1].querySelector('span.rd-marker-preview').textContent.indexOf('Completing each road') > 0);
      iradios[3].checked = true; iradios[3].onchange();   // 라디오 D 선택
      var r4 = window.SG_STORE.getAnswer(iq.id);
      ok(iq.id + ' 라디오 → 답안 3(Position D)', !!r4 && r4.v === 3, r4 ? String(r4.v) : 'none');
      ok(iq.id + ' 라디오 → 마커 동기화', markers[3].className.indexOf('is-chosen') > 0 && markers[1].className.indexOf('is-chosen') < 0);
    }
  }
});

console.log('\n[8] 답안 복원(새로고침 시뮬레이션) 및 화면 밖 문항 거부');
var clozeScreen = screens.filter(function (s) { return s.blockKind === 'cloze'; })[0];
var again = RD.render(clozeScreen, {});   // 엔진 없이 렌더 → 저장된 값이 복원돼야 한다
// 저장 정본은 완성 단어 'brain', 입력칸에 되돌아가는 것은 어간을 뺀 'ain' 이다(위 [7] 주석 참조).
check('복원된 답안(저장 정본)', window.SG_STORE.getAnswer('R1-1').v, 'brain');
check('복원된 첫 입력칸 값', again.querySelectorAll('input.blank-in')[0].value, 'ain');
var m2 = window.SG_EXAM.create(res.screens, { mode: 'exam' });
m2.restoreTo(window.SG_STORE.findScreenIndex(res.screens, clozeScreen.id), 0);
m2.start(window.SG_STORE.findScreenIndex(res.screens, clozeScreen.id));
var rejected = false;
try { m2.answer('R2-11', 0); } catch (e) { rejected = true; }
ok('다른 화면 문항은 엔진이 거부', rejected);

console.log('\n[9] 등록 계약 — 다른 섹션의 register("question") 를 덮어쓰지 않는다');
var calls = [];
window.SG_RENDER.register('question', function (sc) { calls.push(sc.id); return document.createElement('div'); });
window.SG_RENDER.setMount(document.createElement('div'));
window.SG_RENDER.render({ id: 'listening.q.L1.01', screenType: 'question', section: 'listening' }, {});
check('listening 화면은 기존 렌더러로', calls.length, 1);
var rdNode = window.SG_RENDER.render(clozeScreen, {});
ok('reading 화면은 reading 렌더러로', calls.length === 1 && rdNode.className === 'rd-screen', rdNode.className);
ok('별칭 등록 존재', window.SG_RENDER.has(RD.ALIAS));

/* ── [10] cloze 빈칸 이동 ────────────────────────────────────────────────
 * 관찰 화면의 안내문이 약속하는 동작 그대로:
 * "Focus automatically moves to the next blank when filled. Use arrow keys to navigate." */
console.log('\n[10] cloze 자동 이동 · 화살표 이동 · 글자 수 제한');
var navScreen = RD.render(clozeScreen, {});
var ins = navScreen.querySelectorAll('input.blank-in');
var navBlanks = navScreen.querySelectorAll('span.rd-blank');
check('빈칸 maxLength(= answer - hint)', ins.map(function (x) { return x.maxLength; }).join(','), '3,2,3,4,2,6,3,4,7,4');

FOCUSED = null;
ins[0].value = 'ai'; ins[0].oninput();
ok('부분 입력에서는 이동하지 않는다', FOCUSED === null);
check('부분 입력 레일', navScreen.querySelectorAll('span.rd-blank-rail')[0].textContent, '  _');
ins[0].value = 'ain'; ins[0].oninput();
ok('가득 차면 다음 칸으로 자동 이동', FOCUSED === ins[1]);
ins[0].value = 'ainXXXX'; ins[0].oninput();
check('maxLength 초과 입력은 잘린다', ins[0].value, 'ain');

var prevented = 0;
function key(inp, k, caret) { inp.selectionStart = caret; inp.onkeydown({ key: k, preventDefault: function () { prevented++; } }); }
FOCUSED = null; key(ins[1], 'ArrowRight', (ins[1].value || '').length);
ok('칸 끝에서 → 다음 칸', FOCUSED === ins[2]);
FOCUSED = null; ins[2].value = 'age'; key(ins[2], 'ArrowRight', 1); ins[2].value = '';
ok('칸 안에서 → 는 이동하지 않는다(기본 커서 이동 유지)', FOCUSED === null);
FOCUSED = null; key(ins[2], 'ArrowLeft', 0);
ok('칸 처음에서 ← 이전 칸', FOCUSED === ins[1]);
FOCUSED = null; key(ins[3], 'ArrowUp', 0);
ok('↑ 이전 칸', FOCUSED === ins[2]);
FOCUSED = null; key(ins[3], 'ArrowDown', 0);
ok('↓ 다음 칸', FOCUSED === ins[4]);
FOCUSED = null; ins[5].value = ''; key(ins[5], 'Backspace', 0);
ok('빈 칸에서 Backspace → 이전 칸', FOCUSED === ins[4]);
FOCUSED = null; ins[5].value = 'x'; key(ins[5], 'Backspace', 1);
ok('내용 있는 칸의 Backspace 는 삭제만', FOCUSED === null);
FOCUSED = null; key(ins[0], 'ArrowLeft', 0);
ok('첫 칸에서 ← 는 경계에서 멈춘다', FOCUSED === null);
FOCUSED = null; key(ins[9], 'ArrowRight', (ins[9].value || '').length);
ok('마지막 칸에서 → 는 경계에서 멈춘다', FOCUSED === null);
check('이동한 경우에만 preventDefault', prevented, 5);

ins[0].onfocus();
ok('포커스 칸 강조', navBlanks[0].className.indexOf('is-focus') > 0, navBlanks[0].className);
ins[0].onblur();
ok('블러 시 강조 해제', navBlanks[0].className.indexOf('is-focus') < 0, navBlanks[0].className);

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
