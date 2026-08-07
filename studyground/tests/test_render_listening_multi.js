/* 복수 선택 리스닝 화면(mcq-multi) 렌더러 검증 — node 전용.
 * 실행: node "studyground/tests/test_render_listening_multi.js"
 *
 * 목적: SET 9 리스닝 블록(L1 "Questions 13-14" — 실측 스크린샷과 같은 화면)을 그대로
 *       가져와 두 번째 문항만 "Choose 2 answers." 유형으로 바꾼 픽스처를 만들고,
 *       컴파일러를 손대지 않아도 audio-set 화면이 복수 선택으로 렌더되는지 확인한다.
 *       DOM 은 최소 스텁으로 대체한다(test_render_instruction_listening.js 와 동일 방식).
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

/* ── 최소 DOM 스텁 ─────────────────────────────────────────── */
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
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function (t, fn) { (n._ev[t] = n._ev[t] || []).push(fn); },
    _ev: {},
    load: function () {},
    play: function () { return { 'catch': function () { return this; } }; },
    pause: function () {},
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
    if (sel === 'input[type="radio"]' && n.tagName === 'INPUT' && n.type === 'radio') out.push(n);
    else if (sel === 'input[type="checkbox"]' && n.tagName === 'INPUT' && n.type === 'checkbox') out.push(n);
    else if (sel === 'label.opt' && n.tagName === 'LABEL' && String(n.className).indexOf('opt') >= 0) out.push(n);
  }
  return out;
}
var docRoot = makeNode('body');
global.document = {
  createElement: makeNode,
  createElementNS: function (ns, tag) { return makeNode(tag); },
  createDocumentFragment: function () { return makeNode('#fragment'); },
  createTextNode: function (t) { var n = makeNode('#text'); n.textContent = String(t); return n; },
  getElementById: function () { return null; },
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
function check(name, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : ' (expected ' + e + ')'));
  if (!ok) fails.push(name);
}
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

var L = window.SG_LISTEN;

/* ── [1] 순수 헬퍼 ─────────────────────────────────────────── */
console.log('\n[1] 순수 헬퍼');
check('selectCount 명시', L.selectCountOf({ selectCount: 3 }), 3);
check('selectCount 미지정 → answers 길이', L.selectCountOf({ answers: [0, 2] }), 2);
check('둘 다 없으면 기본 2', L.selectCountOf({ kind: 'mcq-multi' }), 2);
ok('kind 로 판정', L.isMultiQuestion({ kind: 'mcq-multi' }));
ok('selectCount 로 판정', L.isMultiQuestion({ kind: 'mcq', selectCount: 2 }));
ok('단일선택은 false', !L.isMultiQuestion({ kind: 'mcq', answer: 1 }));
ok('null 안전', !L.isMultiQuestion(null));

check('빈 상태에서 선택', L.toggleSelection([], 2, 2), [2]);
check('선택 순서 유지(오름차순 아님)', L.toggleSelection([3], 0, 2), [3, 0]);
check('같은 항목 재클릭 → 해제', L.toggleSelection([0, 3], 0, 2), [3]);
check('원본 배열 불변', (function () { var p = [0]; L.toggleSelection(p, 3, 2); return p; })(), [0]);
check('저장 값은 오름차순', L.sortedPicks([3, 0]), [0, 3]);

/* 상한 정책 — CAP_POLICY 상수 하나로 갈린다. */
console.log('       CAP_POLICY = ' + L.capPolicy());
check('기본 정책', L.capPolicy(), 'replace');
check("replace: 가장 먼저 고른 답이 밀려난다", L.toggleSelection([0, 3], 1, 2, 'replace'), [3, 1]);
check("replace: 저장 값은 정렬", L.sortedPicks(L.toggleSelection([0, 3], 1, 2, 'replace')), [1, 3]);
check("replace: 두 번 밀어내기", L.toggleSelection(L.toggleSelection([0, 3], 1, 2, 'replace'), 2, 2, 'replace'), [1, 2]);
check("lock: 상한 초과는 무시", L.toggleSelection([0, 3], 1, 2, 'lock'), [0, 3]);
check("lock: 해제는 여전히 가능", L.toggleSelection([0, 3], 3, 2, 'lock'), [0]);

check('힌트 0/2', L.selectHintPair(0, 2, 'replace').en, 'Choose 2 answers.  0 of 2 selected');
check('힌트 2/2 · lock', L.selectHintPair(2, 2, 'lock').en, 'Choose 2 answers.  2 of 2 selected');
ok('힌트 2/2 · replace 는 교체 안내 동반',
  /a new pick replaces your first/.test(L.selectHintPair(2, 2, 'replace').en),
  L.selectHintPair(2, 2, 'replace').en);
ok('힌트 KO 동반', /2개를 고르세요/.test(L.selectHintPair(1, 2).ko));

/* ── [2] SET 9 기반 픽스처 ─────────────────────────────────── */
console.log('\n[2] SET 9 픽스처 컴파일');
var pack = JSON.parse(JSON.stringify({
  code: window.SMEAG_SET9.code,
  title: window.SMEAG_SET9.title,
  sections: window.SMEAG_SET9.sections
}));
var listening = pack.sections.filter(function (s) { return s.id === 'listening'; })[0];
var block = listening.modules[0].blocks.filter(function (b) { return b.heading === 'Questions 13-14'; })[0];
ok('SET 9 L1 "Questions 13-14" 블록 존재', !!block);
ok('블록 오디오(1회 재생) 유지', !!(block && block.audio), block && block.audio);

/* 두 번째 문항만 복수 선택으로 바꾼다 — 스크린샷과 같은 2열 답변 화면 위치다. */
var target = block.questions[1];
target.kind = 'mcq-multi';
target.selectCount = 2;
target.answers = [0, 3];
delete target.answer;
target.prompt = 'What two things does the man offer to do? Choose 2 answers.';

// findQuestion — set9.js 와 같은 계약을 픽스처에도 붙인다.
pack.findQuestion = function (qid) {
  for (var i = 0; i < pack.sections.length; i++) {
    var ms = pack.sections[i].modules || [];
    for (var j = 0; j < ms.length; j++) {
      var bs = ms[j].blocks || [];
      for (var k = 0; k < bs.length; k++) {
        var qs = bs[k].questions || [];
        for (var m = 0; m < qs.length; m++) {
          if (qs[m].id === qid) return { q: qs[m], block: bs[k], module: ms[j], section: pack.sections[i] };
        }
      }
    }
  }
  return null;
};
window.SG_CONTENT_PACK = pack;

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
window.SG_RUNTIME = { timing: function () { return timing; } };
var res = window.SG_COMPILE.compileScreens(pack, timing, { profile: 'toefl' });
var screen = res.screens.filter(function (s) {
  return s.blockKind === 'audio-set' && s.questionIds && s.questionIds[0] === 'L1-14';
})[0];
ok('L1-14 답변 화면 컴파일됨', !!screen, screen && screen.id);
check('blockKind 는 그대로 audio-set (컴파일러 무변경)', screen.blockKind, 'audio-set');
check('진행 표기', L.progressPair(screen).en, 'Question 14 of ' + screen.progress.total);

/* ── [3] 렌더 결과 ─────────────────────────────────────────── */
console.log('\n[3] 렌더 결과');
var answered = [];
var ctx = { engine: { answer: function (qid, v) { answered.push([qid, v]); window.SG_STORE.upsertAnswer(qid, v); return true; } } };
window.SG_STORE.open({ id: 'test-multi', setCode: 'SET9', profile: 'toefl', mode: 'offline' });

var root = L.renderListeningQuestion(screen, ctx);
ok('루트에 lst-multi', /lst-multi/.test(root.className), root.className);
var box = walk(root, []).filter(function (n) { return String(n.className).indexOf('lst-opts') === 0; })[0];
ok('lst-opts is-multi', !!box && /is-multi/.test(box.className), box && box.className);

var boxes = collect(root, 'input[type="checkbox"]');
var radios = collect(root, 'input[type="radio"]');
check('체크박스 4개', boxes.length, 4);
check('라디오 0개', radios.length, 0);

var labels = collect(root, 'label.opt');
check('A/B/C/D 배지', labels.map(function (l) { return l.children[1].textContent; }), ['A', 'B', 'C', 'D']);

var hint = walk(root, []).filter(function (n) { return String(n.className).indexOf('lst-selecthint') === 0; })[0];
ok('힌트 초기값', /Choose 2 answers\.\s+0 of 2 selected/.test(hint.textContent), hint.textContent);

/* ── [4] 선택 상호작용 ─────────────────────────────────────── */
console.log('\n[4] 선택 상호작용');
boxes[0].onchange();
check('A 선택 → 엔진 전달', answered[answered.length - 1], ['L1-14', [0]]);
ok('힌트 1/2', /1 of 2 selected/.test(hint.textContent), hint.textContent);

boxes[3].onchange();
check('D 추가 → 오름차순 배열', answered[answered.length - 1], ['L1-14', [0, 3]]);
ok('힌트 2/2 · is-full', /2 of 2 selected/.test(hint.textContent) && /is-full/.test(hint.className), hint.className);
ok('교체 안내 노출', /replaces your first/.test(hint.textContent), hint.textContent);
check('상한에서도 전부 클릭 가능', [boxes[0].disabled, boxes[1].disabled, boxes[2].disabled, boxes[3].disabled],
  [false, false, false, false]);
check('먼저 고른 A 에 교체 예고', labels[0].className, 'opt is-selected is-next-out');
check('나중에 고른 D 는 표시 없음', labels[3].className, 'opt is-selected');
check('미선택 항목은 잠기지 않음', [labels[1].className, labels[2].className], ['opt', 'opt']);

boxes[1].onchange();
check('상한에서 B 클릭 → A 가 자동 해제', answered[answered.length - 1], ['L1-14', [1, 3]]);
check('A 는 선택 해제됨', labels[0].className, 'opt');
check('이제 D 가 다음 교체 대상', labels[3].className, 'opt is-selected is-next-out');

boxes[2].onchange();
check('C 클릭 → D 가 자동 해제', answered[answered.length - 1], ['L1-14', [1, 2]]);

boxes[1].onchange();
check('B 재클릭 → 해제', answered[answered.length - 1], ['L1-14', [2]]);
ok('힌트 1/2 로 복귀', /1 of 2 selected/.test(hint.textContent) && !/replaces/.test(hint.textContent), hint.textContent);

/* ── [5] 새로고침 복원 ─────────────────────────────────────── */
console.log('\n[5] 새로고침 복원');
window.SG_STORE.upsertAnswer('L1-14', [1, 2]);
var again = L.renderListeningQuestion(screen, ctx);
var b2 = collect(again, 'input[type="checkbox"]');
var l2 = collect(again, 'label.opt');
check('저장된 선택 복원', b2.map(function (b) { return !!b.checked; }), [false, true, true, false]);
/* 복원 시점에는 원래 고른 순서를 알 수 없다(저장 값이 오름차순이라). 낮은 인덱스를
   "가장 먼저 고른 것" 으로 보고 교체 예고를 붙인다 — 결정적이고 되돌릴 수 있다. */
check('복원 후 교체 예고', l2.map(function (l) { return l.className; }),
  ['opt', 'opt is-selected is-next-out', 'opt is-selected', 'opt']);
check('복원 후에도 전부 클릭 가능', b2.map(function (b) { return b.disabled; }),
  [false, false, false, false]);
b2[0].onchange();
check('복원 후 교체 동작', answered[answered.length - 1], ['L1-14', [0, 2]]);

/* ── [6] 단일선택 회귀 ─────────────────────────────────────── */
console.log('\n[6] 단일선택 회귀(L1-13)');
var single = res.screens.filter(function (s) {
  return s.blockKind === 'audio-set' && s.questionIds && s.questionIds[0] === 'L1-13';
})[0];
var sroot = L.renderListeningQuestion(single, ctx);
check('라디오 4개', collect(sroot, 'input[type="radio"]').length, 4);
check('체크박스 0개', collect(sroot, 'input[type="checkbox"]').length, 0);
ok('lst-multi 없음', !/lst-multi/.test(sroot.className), sroot.className);

/* ── [7] 문항 문구 표시 규칙 (최종수정사항.docx) ─────────────
 * Task 1(자체 음성 + 그림, block.perQuestionAudio:true) → 문구를 화면에 그리지 않는다.
 * Task 2(대화·강의형, prompt 가 곧 질문) → 그대로 그린다. 둘을 한 번에 확인한다. */
console.log('\n[7] 문항 문구 표시 규칙 — 음성이 질문을 대신하는 문항만 숨긴다');
function screenFor(qid) {
  return res.screens.filter(function (s) {
    return s.blockKind === 'audio-set' && s.questionIds && s.questionIds[0] === qid;
  })[0];
}
// L1-1: "Questions 1-12" 블록 = perQuestionAudio:true (Task 1)
var t1blk = listening.modules[0].blocks.filter(function (b) { return b.perQuestionAudio; })[0];
ok('Task 1 블록(perQuestionAudio) 존재', !!t1blk, t1blk && t1blk.heading);
var t1q = t1blk.questions[0];
var t1root = L.renderListeningQuestion(screenFor(t1q.id), ctx);
ok('Task 1 문항 문구는 화면에 없다',
  flatten(t1root).indexOf(t1q.prompt) < 0, JSON.stringify(flatten(t1root).slice(0, 80)));
check('Task 1 선택지는 그대로 4개', collect(t1root, 'input[type="radio"]').length, 4);

// L1-13: 블록 오디오형 (Task 2) — prompt 가 질문 그 자체다
var t2q = block.questions[0];
ok('Task 2 문항 문구는 화면에 남는다',
  flatten(sroot).indexOf(t2q.prompt) >= 0, JSON.stringify(t2q.prompt));

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
