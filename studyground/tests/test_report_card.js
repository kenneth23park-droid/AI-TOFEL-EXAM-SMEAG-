/* smeag-com/scores.html 의 성적표 한 장 — 파트로 펴는 자리.
 *
 * 성적표는 영역(R·L·W·S)이 아니라 파트로 펴진다. 라이팅 3.0 은 문장 만들기·이메일·
 * 토론 글 셋의 결과라, 무엇을 더 해야 하는지는 파트를 펴야 보이기 때문이다. 그
 * 펴는 일에서 사람이 틀리기 쉬운 것만 여기서 붙잡는다.
 *
 *   1) 산출형 한 줄이 어느 파트인지는 task_kind 가 정한다. 그 칸이 비어 있는 옛
 *      행에서는 문항 번호로 짐작한다 — 짐작이 어긋나면 이메일 점수가 토론 글 칸에
 *      찍힌다.
 *   2) 파트의 환산점수와 영역의 평균 칸은 **다른 곳에서 온다**. 평균 칸은 언제나
 *      앱의 공식 밴드(BAND.of)여야 한다. 성적표만 따로 계산하면 대시보드의 4.0 과
 *      종이의 4.5 가 갈린다.
 *   3) Build a Sentence 는 by_section.writing(자동채점)에서 오고, 이메일·토론 글은
 *      sg_task_scores 에서 온다. 한 영역인데 출처가 둘이다.
 *   4) 이메일·토론 글에는 '문항 수' 가 없다 — 한 편을 써서 루브릭으로 받는다.
 *
 * 페이지는 파일 하나짜리 자립형이라 import 할 수 없다. test_report_link.js 와 같은
 * 방식으로 필요한 블록만 잘라 내 화면 밖에서 실행시킨다.
 *
 * 실행: node studyground/tests/test_report_card.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'smeag-com', 'scores.html');
var src = fs.readFileSync(HTML, 'utf8');

var START = '  var PARTS = {';
var END = '  /* 반원 눈금';
var a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('성적표 블록을 찾지 못했습니다 — scores.html 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

/* 밴드 계산은 스텁으로 흉내 내지 않는다 — sg2/assets/sg-band.js 를 그대로 끌어와야
   "평균 칸은 공식 밴드" 라는 주장이 시험대에 오른다. */
var SG_BAND = require(path.join(__dirname, '..', 'sg2', 'assets', 'sg-band.js'));
var STUB = [
  "var BAND = __BAND;",
  "var SHORT = { reading: 'R', listening: 'L', writing: 'W', speaking: 'S' };",
  "var TASKS = __TASKS;",
  "function viewOf(r) { return BAND.of(r, TASKS[r.session] || []); }"
].join('\n');

var TASKS = {};
var api = new Function('__BAND', '__TASKS',
  STUB + src.slice(a, b) + '\nreturn { partOf: partOf, cardRows: cardRows, PARTS: PARTS };'
)(SG_BAND, TASKS);

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  var same = JSON.stringify(got) === JSON.stringify(want);
  ok(same, msg + ' → ' + JSON.stringify(got) + (same ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

/* 응시 한 건. by 는 자동채점(리딩·리스닝·Build a Sentence), tasks 는 산출형이다. */
function attempt(by, tasks) {
  TASKS.s1 = tasks || [];
  return { session: 's1', set_code: 'SET 9', scale: 'toefl6', by_section: by || {} };
}
function task(qid, skill, kind, score) {
  var t = { session: 's1', question_id: qid, skill: skill, ai_score: score,
            teacher_score: null, confirmed_at: null };
  if (kind !== null) t.task_kind = kind;
  return t;
}
function rowOf(rows, skill) {
  for (var i = 0; i < rows.length; i++) if (rows[i].skill === skill) return rows[i];
  return null;
}

console.log('\n1) 산출형 한 줄이 어느 파트인지');
eq(api.partOf({ task_kind: 'discussion', question_id: 'set9-W2-email' }), 'discussion',
   'task_kind 가 문항 번호를 이긴다');
eq(api.partOf({ question_id: 'set9-W2-email' }), 'email', 'task_kind 가 없으면 W2 → 이메일');
eq(api.partOf({ question_id: 'set9-W3-disc' }), 'discussion', 'W3 → 토론 글');
eq(api.partOf({ question_id: 'set9-S1-q03' }), 'repeat', 'S1 → 복창');
eq(api.partOf({ question_id: 'set9-S2-q02' }), 'interview', 'S2 → 인터뷰');
eq(api.partOf({ question_id: 'set9-R1-q01' }), '', '알 수 없으면 빈 문자열 — 아무 파트에도 넣지 않는다');

console.log('\n2) 라이팅 한 영역, 출처는 둘');
var r = attempt(
  { reading: { score: 48, total: 50 }, listening: { score: 30, total: 47 },
    writing: { score: 3, total: 10 } },
  [task('set9-W2-email', 'writing', 'email', 3.5),
   task('set9-W3-disc', 'writing', 'discussion', 3.0)]
);
var rows = api.cardRows(r);
var w = rowOf(rows, 'writing');
eq(w.parts.map(function (p) { return p.label; }),
   ['Build a Sentence', 'Write an Email', 'Write for an Academic Discussion'],
   '라이팅은 파트 셋으로 펴진다');
eq([w.parts[0].correct, w.parts[0].items], [3, 10],
   'Build a Sentence 의 원점수는 by_section.writing 에서 온다');
eq(w.parts[0].band, SG_BAND.sectionBand(3, 10, 'writing'), 'Build a Sentence 는 그 파트만 놓고 환산한다');
ok(w.parts[1].band !== null && w.parts[2].band !== null, '이메일·토론 글에도 각자의 밴드가 붙는다');

console.log('\n3) 평균 칸은 언제나 앱의 공식 밴드');
var official = SG_BAND.of(r, TASKS.s1);
BANDS_MATCH();
function BANDS_MATCH() {
  ['reading', 'listening', 'writing', 'speaking'].forEach(function (s) {
    eq(rowOf(rows, s).band, official.sections[s].band, s + ' 평균 = BAND.of 의 밴드');
  });
}
eq(rowOf(rows, 'reading').band, rowOf(rows, 'reading').parts[0].band,
   '리딩은 영역이 곧 파트라 둘이 같다');

console.log('\n4) 문항 수가 없는 과제');
eq([w.parts[1].items, w.parts[2].items], [null, null],
   '이메일·토론 글의 문항 수는 비운다 — 1 을 찍으면 한 문제짜리 시험처럼 읽힌다');
var s = rowOf(rows, 'speaking');
eq([s.parts[0].items, s.parts[1].items], [null, null], '채점된 스피킹이 없으면 문항 수도 없다');

var spoken = attempt({}, []
  .concat([1, 2, 3, 4, 5, 6, 7].map(function (i) {
    return task('set9-S1-q0' + i, 'speaking', 'repeat', 2.5); }))
  .concat([1, 2, 3, 4].map(function (i) {
    return task('set9-S2-q0' + i, 'speaking', 'interview', 2.0); })));
var s2 = rowOf(api.cardRows(spoken), 'speaking');
eq([s2.parts[0].items, s2.parts[1].items], [7, 4], '복창 7 · 인터뷰 4 — 채점된 과제 수가 문항 수다');
ok(s2.parts[0].band > s2.parts[1].band, '2.5 를 받은 복창이 2.0 을 받은 인터뷰보다 높다');

console.log('\n5) 채점 전');
var bare = attempt({ reading: { score: 40, total: 50 } }, []);
var rows2 = api.cardRows(bare);
eq(rowOf(rows2, 'writing').parts.map(function (p) { return p.band; }), [null, null, null],
   '라이팅이 통째로 비면 파트도 전부 비어 있다 — 0.0 이 아니다');
eq(rowOf(rows2, 'reading').parts[0].correct, 40, '리딩만 본 시험도 리딩 줄은 그대로 선다');

console.log('');
if (fails) { console.error(fails + ' 건 실패'); process.exit(1); }
console.log('모두 통과');
