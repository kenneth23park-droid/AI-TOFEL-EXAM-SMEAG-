/* smeag-com/scores.html 의 REPORT 모듈 검증 — 성적 보고서 연동.
 *
 * 조회 화면이 쥔 것은 원점수(맞은 개수)뿐이고, 리포트 생성기는 시험 눈금 위의
 * 점수를 원한다. 그 사이의 환산이 app/scoring/scale.py 와 어긋나면 학생에게
 * 틀린 점수가 인쇄돼 나간다 — 그래서 여기서 붙잡는다.
 *
 * 페이지는 파일 하나짜리 자립형이라 모듈을 import 할 수 없다. 인라인 스크립트에서
 * REPORT 블록만 잘라 내 화면 밖에서 실행시킨다.
 *
 * 실행: node studyground/tests/test_report_link.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'smeag-com', 'scores.html');
var src = fs.readFileSync(HTML, 'utf8');

var START = '  var REPORT = (function () {';
var END = '  /* ── 내려받기 ── */';
var a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('REPORT 블록을 찾지 못했습니다 — scores.html 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

/* 페이지에서 REPORT 가 기대는 최소한의 이웃만 세워 준다.
 *
 * BAND 는 페이지의 최상위 모듈이고 TASKS 는 화면 IIFE 의 변수다. REPORT 는 둘 다
 * 본다 — 성적표에 TOEFL 1~6 밴드를 함께 싣기 때문이다. 여기서는 sg-band.js 를
 * 그대로 끌어와 스텁으로 세운다(밴드 계산이 두 벌이 되지 않게).
 */
var SG_BAND = require(path.join(__dirname, '..', 'sg2', 'assets', 'sg-band.js'));
var STUB = [
  "var CFG = { reportUrl: 'https://report.test/' };",
  "var LAB = { reading: ['Reading','읽기'], listening: ['Listening','듣기'],",
  "            writing: ['Writing','쓰기'], speaking: ['Speaking','말하기'] };",
  "function when(iso) { return String(iso).slice(0, 10); }",
  "var BAND = __BAND, TASKS = {};"
].join('\n');

var REPORT = new Function('__BAND', STUB + src.slice(a, b) + '\nreturn REPORT;')(SG_BAND);

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  ok(JSON.stringify(got) === JSON.stringify(want),
     msg + ' → ' + JSON.stringify(got) +
     (JSON.stringify(got) === JSON.stringify(want) ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

var ME = { name: '박광섭', student_id: 'smeag001' };
function row(code, by) {
  return { set_code: code, submitted_at: '2026-08-10T02:00:00Z', by_section: by };
}

console.log('시험 판별');
eq(REPORT.profileOf('SET9'), 'toefl', 'SET9 는 TOEFL');
eq(REPORT.profileOf('IELTS-SAMPLE'), 'ielts', 'IELTS-SAMPLE 은 IELTS');
eq(REPORT.profileOf(''), 'toefl', '세트 코드가 없으면 TOEFL 로 본다');

console.log('TOEFL 환산 (영역 /30 · 총점 합 /120)');
var t = REPORT.build(row('SET9', {
  reading: { score: 26, total: 35 }, listening: { score: 26, total: 33 },
  writing: { score: 8, total: 12 }, speaking: { score: 7, total: 11 }
}), ME);
eq(t.profile, 'toefl', '프로파일');
eq(t.scores[0].points, 22, 'Reading 26/35 → 22');        // 0.7429×30 = 22.29
eq(t.scores[1].points, 24, 'Listening 26/33 → 24');      // 0.7879×30 = 23.64, .5 는 올림
eq(t.total, 85, '총점은 영역의 합');
eq(t.average, 21.25, '영역 평균');
eq(t.grade, 'B2', '등급은 총점의 CEFR');
eq(t.scores.map(function (s) { return s.level; }), ['B2', 'B2+', 'B2', 'B1+'], '영역 CEFR');
eq(t.student.name, '박광섭', '학생 이름');
eq(t.student.date, '2026-08-10', '시험일');

console.log('IELTS 환산 (밴드표 · 총점은 평균)');
var i = REPORT.build(row('IELTS-SAMPLE', {
  reading: { score: 30, total: 40 }, listening: { score: 26, total: 40 },
  writing: { score: 6, total: 9 }, speaking: { score: 7, total: 9 }
}), ME);
eq(i.profile, 'ielts', '프로파일');
eq(i.scores[0].points, 7, 'Reading 30/40 → band 7.0');
eq(i.scores[1].points, 6.5, 'Listening 26/40 → band 6.5');
eq(i.total, 6.5, '종합 밴드는 4영역 평균을 0.5 단위로');
eq(i.grade, 'Band 6.5', '등급');
ok(i.scores.every(function (s) { return s.level === null; }), 'IELTS 는 CEFR 을 매기지 않는다');

console.log('밴드표가 없는 영역은 비율 환산으로 떨어진다');
var w = REPORT.build(row('IELTS-SAMPLE', { writing: { score: 9, total: 9 } }), ME);
eq(w.scores[0].points, 9, 'Writing 만점 → band 9.0');

console.log('아직 채점되지 않은 영역');
var p = REPORT.build(row('SET9', {
  reading: { score: 26, total: 35 }, listening: { score: 26, total: 33 },
  writing: { score: 0, total: 0 }
}), ME);
eq(p.scores.map(function (s) { return s.points; }), [22, 24, null], '선생님 채점 영역은 점수 칸을 비운다');
eq(p.total, 46, '총점에서도 뺀다');
eq(p.grade, '', '반쪽 총점에 등급을 매기지 않는다');
ok(p.warnings.length === 1 && /Writing/.test(p.warnings[0]) && /Speaking/.test(p.warnings[0]),
   '빠진 영역을 경고로 알린다');

console.log('TOEFL 1~6 밴드 (ETS 2026 눈금) — 옛 눈금과 병기한다');
var band6 = REPORT.build(row('SET9', {
  reading: { score: 40, total: 50 }, listening: { score: 40, total: 47 },
  writing: { score: 0, total: 0 }, speaking: { score: 0, total: 0 }
}), ME);
eq(band6.scale, 'toefl6', '어느 눈금으로 보고하는지 함께 넘긴다');
eq(band6.band.sections.map(function (s) { return s.band; }), [5, 5.5, null, null],
   'R 40/50 → 5.0 · L 40/47 → 5.5 · 채점 전은 null');
eq(band6.band.overall, 5.5, '종합은 채점된 영역의 평균 (5.0+5.5)/2 = 5.25 → 5.5');
eq(band6.band.cefr, 'C1', 'CEFR');
eq(band6.band.pending, ['writing', 'speaking'], '채점 전 영역을 알린다');
eq(band6.band.draft, false, '확정 전 AI 초안이 없으면 draft 아님');
ok(band6.total !== null && band6.total !== undefined,
   '옛 0~120 값은 그대로 남는다 (전환기 병기) → ' + band6.total);

var bi2 = REPORT.build(row('IELTS-SAMPLE', { reading: { score: 30, total: 40 } }), ME);
eq(bi2.band, null, 'IELTS 응시에는 TOEFL 밴드를 붙이지 않는다');

console.log('전달 통로 (URL 조각)');
var opened = null;
global.window = { open: function (u) { opened = u; } };
global.btoa = function (bin) { return Buffer.from(bin, 'binary').toString('base64'); };
REPORT.open(row('SET9', { reading: { score: 26, total: 35 } }), ME);
ok(/^https:\/\/report\.test\/#d=/.test(opened || ''), '조각(#d=)에 실어 새 창으로 넘긴다');
ok(opened.indexOf('?') < 0, '질의 문자열로는 보내지 않는다 — 서버 로그에 남는다');
var frag = /#d=(.+)$/.exec(opened)[1].replace(/-/g, '+').replace(/_/g, '/');
var back = JSON.parse(Buffer.from(frag, 'base64').toString('utf8'));
eq(back.student.name, '박광섭', 'base64url 왕복 후에도 한글 이름이 살아 있다');
eq(back.profile, 'toefl', '프로파일도 함께 건너간다');

/* reportUrl 이 비면 아무 창도 열지 않는다 — 조회·CSV 만 쓰는 배포를 위한 안전장치. */
var before = opened;
new Function('__BAND',
  "var CFG = { reportUrl: '' };" +
  "var LAB = { reading: ['Reading','읽기'], listening: ['Listening','듣기']," +
  "            writing: ['Writing','쓰기'], speaking: ['Speaking','말하기'] };" +
  "function when(s){ return String(s).slice(0,10); }" +
  "var BAND = __BAND, TASKS = {};" +
  src.slice(a, b) +
  "REPORT.open({ set_code: 'SET9', submitted_at: '2026-08-10T00:00:00Z'," +
  "  by_section: { reading: { score: 1, total: 2 } } }, {});")(SG_BAND);
ok(opened === before, 'reportUrl 이 비어 있으면 열지 않는다');

console.log(fails ? '\nFAILED: ' + fails : '\nALL OK');
process.exit(fails ? 1 : 0);
