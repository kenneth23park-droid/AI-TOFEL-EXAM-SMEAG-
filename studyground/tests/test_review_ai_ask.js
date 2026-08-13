/* review.html 요약줄의 ✎ — 선생님이 그 자리에서 AI 리뷰를 부르는 버튼.
 *
 * 왜 필요한가
 *   채점과 코멘트(AI 리뷰)는 따로 만들어진다. 제출 직후 점수만 생기고 리뷰는 없는
 *   답안지가 흔하다. 그때 선생님이 화면을 옮기지 않고 그 자리에서 리뷰를 부를 수
 *   있어야 한다 — 그 입구가 요약줄의 연필이다.
 *
 * 지켜야 할 두 가지
 *   1. 학생 화면에는 이 줄 자체가 없다. /api/feedback 은 교사·관리자 전용이라,
 *      학생에게 누를 수 있게 보여 주면 401 만 돌려받는 버튼이 된다. 학생 쪽 리뷰는
 *      autoReview() 가 알아서 부른다.
 *   2. 생성 경로는 하나다. 선생님 줄의 Generate 와 연필이 각자 저장 코드를 들고
 *      있으면 한쪽만 고친 날 두 입구가 다르게 동작한다.
 *
 * 페이지가 파일 하나짜리라 paintSummary 만 잘라 내 화면 밖에서 실행시킨다.
 *
 * 실행: node studyground/tests/test_review_ai_ask.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'sg2', 'review.html');
var src = fs.readFileSync(HTML, 'utf8');

var fails = 0;
function ok(cond, what) {
  if (cond) return;
  fails++;
  console.error('FAIL — ' + what);
}

/* ── paintSummary 를 떼어 낸다 ────────────────────────────────────────── */
var START = '  function paintSummary(res, det, who) {';
var END = '\n  /* 연필에서 부르는 AI 리뷰';
var a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('paintSummary 블록을 찾지 못했습니다 — review.html 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

var RES = { set_code: 'SET 9', mode: 'full', submitted_at: '2026-08-10T00:00:00Z' };
var DET = { score: 30, total: 40 };

/* paintSummary 가 기대는 이웃만 최소로 세운다. */
function run(staff) {
  var slot = { innerHTML: '' };
  var nodes = {};                                   // id → 가짜 노드
  var STUB = [
    "var VIEW = { overall: 4.5, cefr: 'B2', sections: {} };",
    "var STAFF = __staff;",
    "function esc(s) { return String(s == null ? '' : s); }",
    "function bi(en) { return en; }",
    "function when(iso) { return String(iso).slice(0, 10); }",
    "function show() {}",
    "function askAiReview() { __called.push(1); }",
    "function $(id) { return id === 'summary' ? __slot : __find(id); }",
    "var SG_BAND = { of: function () { return VIEW; }, fmt: function (n) { return n.toFixed(1); } };",
    ""
  ].join('\n');

  var called = [];
  /* 그려진 HTML 안에 그 id 가 있을 때만 노드가 있는 셈 친다 — 브라우저와 같은 순서다. */
  function find(id) {
    if (slot.innerHTML.indexOf('id="' + id + '"') < 0) return null;
    return (nodes[id] = nodes[id] || { id: id, onclick: null });
  }

  new Function('__slot', '__find', '__called', '__staff', 'window',
               STUB + src.slice(a, b) + '\npaintSummary(' + JSON.stringify(RES) + ', ' +
               JSON.stringify(DET) + ', null);')(slot, find, called, staff, {});

  return { html: slot.innerHTML, nodes: nodes, called: called };
}

/* A. 학생 — 요청 줄이 아예 없다 */
var student = run(false);
ok(student.html.indexOf('id="ai-ask"') < 0, 'A: 학생 화면에는 요청 버튼이 없어야 한다');
ok(student.html.indexOf('<button') < 0, 'A: 학생 요약줄에는 버튼이 없어야 한다');
ok(student.html.indexOf('AI draft') < 0 && student.html.indexOf('초안') < 0,
   'A: 학생에게 초안이라고 말하지 않는다 — AI 점수가 곧 점수다');

/* B. 선생님 — 연필이 버튼이고, 누르면 AI 리뷰를 부른다 */
var staff = run(true);
ok(staff.html.indexOf('id="ai-ask"') >= 0, 'B: 선생님에게는 요청 버튼이 있어야 한다');
ok(staff.html.indexOf('aria-label="Request an AI review"') >= 0,
   'B: 버튼이 무엇을 하는지 이름표가 있어야 한다(아이콘 하나뿐이므로)');
ok(staff.html.indexOf('id="ai-ask-say"') >= 0, 'B: 진행·오류를 적을 자리가 있어야 한다');
ok(staff.nodes['ai-ask'] && typeof staff.nodes['ai-ask'].onclick === 'function',
   'B: 버튼에 클릭이 걸려 있어야 한다');
if (staff.nodes['ai-ask'] && staff.nodes['ai-ask'].onclick) staff.nodes['ai-ask'].onclick();
ok(staff.called.length === 1, 'B: 누르면 AI 리뷰 요청이 한 번 불려야 한다');

/* C. 생성 경로는 하나다 — 저장 코드가 두 벌이면 한쪽만 고치게 된다 */
var gens = src.split('SG_COMMENTS.generate(').length - 1;
ok(gens === 1, 'C: SG_COMMENTS.generate 호출은 한 군데뿐이어야 한다 (지금 ' + gens + ')');
ok(src.indexOf('runAiComments(pick[0], pick[1]') >= 0,
   'C: 선생님 줄의 Generate 도 같은 함수를 지나야 한다');

/* D. 아직 아무것도 채점되지 않아 밴드 관점이 없으면 요청 줄도 없다 */
var noView = (function () {
  var slot = { innerHTML: '' };
  new Function('__slot', '__find', '__called', '__staff', 'window',
    [
      "var VIEW = null;",
      "var STAFF = true;",
      "function esc(s) { return String(s == null ? '' : s); }",
      "function bi(en) { return en; }",
      "function when(iso) { return String(iso).slice(0, 10); }",
      "function show() {}",
      "function askAiReview() {}",
      "function $(id) { return id === 'summary' ? __slot : null; }",
      "var SG_BAND = { of: function () { return VIEW; }, fmt: function (n) { return n.toFixed(1); } };"
    ].join('\n') + src.slice(a, b) + '\npaintSummary(' + JSON.stringify(RES) + ', ' +
    JSON.stringify(DET) + ', null);')(slot, function () { return null; }, [], true, {});
  return slot.innerHTML;
})();
ok(noView.indexOf('id="ai-ask"') < 0, 'D: 밴드 관점이 없으면 요청 버튼도 없어야 한다');

if (fails) { console.error('\n' + fails + '개 실패'); process.exit(1); }
console.log('OK — 리뷰 요약의 ✎ : 선생님 전용 버튼 · 단일 생성 경로');
