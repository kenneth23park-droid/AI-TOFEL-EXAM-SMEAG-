/* smeag-com/scores.html — 대시보드와 리뷰가 갈리는 세 가지 판단.
 *
 * 화면은 studyground.ai 의 두 장면을 따라간다. 최고 점수 줄 · 전체/영역 시험
 * 목록 · 한 응시의 리뷰. 그 안에서 사람이 틀리기 쉬운 판단만 여기서 붙잡는다.
 *
 *   1) /120(옛 눈금)은 네 영역이 **모두** 채점된 응시에서만 말이 된다.
 *   2) '내 최고 종합' 은 완결된 응시에서 고른다 — 리딩만 본 시험의 종합은
 *      리딩 점수일 뿐이라, 그대로 두면 총점이 부풀어 보인다.
 *   3) 전체 시험과 영역별 시험은 sg_results.mode 로 갈리지 않는다(그건 채점
 *      방식이다). 몇 영역을 건드렸는지로 가른다.
 *   4) 리뷰의 탭은 주소에 실린다 — 뒤로 가기가 요약으로 돌아와야 한다.
 *
 * 페이지는 파일 하나짜리 자립형이라 import 할 수 없다. test_report_link.js 와
 * 같은 방식으로 필요한 블록만 잘라 내 화면 밖에서 실행시킨다.
 *
 * 실행: node studyground/tests/test_scores_dashboard.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'smeag-com', 'scores.html');
var src = fs.readFileSync(HTML, 'utf8');

function slice(startMark, endMark, what) {
  var a = src.indexOf(startMark), b = src.indexOf(endMark, a + 1);
  if (a < 0 || b < 0 || b < a) {
    console.error(what + ' 블록을 찾지 못했습니다 — scores.html 구조가 바뀌었는지 확인하세요.');
    process.exit(1);
  }
  return src.slice(a, b);
}

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  var same = JSON.stringify(got) === JSON.stringify(want);
  ok(same, msg + ' → ' + JSON.stringify(got) + (same ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

/* ── 페이지의 BAND 모듈을 그대로 세운다 ─────────────────────────────── */
var BAND = new Function(slice('var BAND = (function () {', '\n/* ─────', 'BAND') +
                        '\nreturn BAND;')();

/* 응시 한 건을 짓는 도우미. r·l 은 [맞은 수, 전체], w·s 는 과제 점수 목록. */
function attempt(by, tasks) { return { by_section: by, session: 's', scale: 'toefl6' }; }
function taskRows(w, s) {
  var out = [];
  (w || []).forEach(function (v, i) { out.push({ skill: 'writing', question_id: 'W' + i, ai_score: v, confirmed_at: '2026-08-01' }); });
  (s || []).forEach(function (v, i) { out.push({ skill: 'speaking', question_id: 'S' + i, ai_score: v, confirmed_at: '2026-08-01' }); });
  return out;
}

console.log('옛 눈금(/120)은 네 영역이 다 채점됐을 때만 나온다');
var full = BAND.of(attempt({ reading: { score: 40, total: 50 }, listening: { score: 40, total: 47 } }),
                   taskRows([4, 4], [4, 4]));
eq(full.sections.reading.detail.scaled, 24, 'R 40/50 → 24/30');
eq(full.sections.listening.detail.scaled, 26, 'L 40/47 → 26/30');
eq(full.sections.writing.detail.scaled, 24, 'W 8/10 → 24/30');
eq(full.conventional, 24 + 26 + 24 + 24, '네 영역의 환산점수 합이 /120 이다');

var half = BAND.of(attempt({ reading: { score: 40, total: 50 } }), []);
eq(half.conventional, null, '리딩만 채점된 응시에는 /120 이 없다');
eq(half.overall, 5, '그래도 밴드 평균은 낸다 (리딩 하나)');

console.log('산출형의 원점수는 받은 점수 / 만점이다');
var ws = BAND.of(attempt({}), taskRows([3, 3, 3, 2.75], []));
eq(ws.sections.writing.detail.got, 11.75, 'W 과제 4개 합');
eq(ws.sections.writing.detail.top, 20, 'W 만점은 과제당 5점');

/* ── 전체 시험 / 영역별 시험 판별 ───────────────────────────────────── */
var kindSrc = slice('  function touched(r) {', '  /* ── 점수 눈금 한 칸', 'touched/isFull');
var KIND = new Function('__BAND', '__VIEW',
  'var BAND = __BAND;\n' +
  'function viewOf(r) { return __VIEW(r); }\n' +
  kindSrc + '\nreturn { touched: touched, isFull: isFull };');

function kindOf(by, tasks) {
  var view = BAND.of({ by_section: by }, tasks);
  var api = KIND(BAND, function () { return view; });
  return { n: api.touched({ by_section: by }), full: api.isFull({ by_section: by }) };
}

console.log('전체 시험과 영역별 시험을 가른다');
eq(kindOf({ reading: { score: 1, total: 2 }, listening: { score: 1, total: 2 } },
          taskRows([3], [3])).full, true, '네 영역을 다 치렀으면 전체 시험');
eq(kindOf({ reading: { score: 1, total: 2 } }, []).full, false, '리딩만 치렀으면 영역별 시험');
eq(kindOf({ reading: { score: 1, total: 2 } }, []).n, 1, '건드린 영역 수');
eq(kindOf({ reading: { score: 1, total: 2 }, listening: { score: 1, total: 2 } },
          taskRows([3], [])).full, true, '세 영역이면 전체 시험으로 본다');
eq(kindOf({ reading: { score: 1, total: 2 }, listening: { score: 1, total: 2 } }, []).full, false,
   '두 영역이면 아직 전체 시험이 아니다');
/* 채점 방식(mode)으로 가르지 않는다 — offline/online 은 자동채점이냐 LLM 이냐일 뿐. */
ok(!/isFull[\s\S]{0,200}r\.mode/.test(src), "isFull 은 sg_results.mode 를 보지 않는다");

console.log('최고 종합은 완결된 응시에서 고른다');
/* paintBest 는 DOM 을 만지므로, 여기서는 그 규칙만 같은 식으로 다시 세워 본다.
   화면이 이 규칙을 잃지 않았는지는 소스로 확인한다. */
ok(/완결된 응시가 하나도 없을 때만/.test(src), '규칙이 주석으로 남아 있다');
ok(/var done = !v\.pending\.length;/.test(src), '완결 여부를 pending 으로 가른다');
ok(/\(done && !bestTotal\.done\)/.test(src), '완결된 응시가 반쪽 응시를 이긴다');

/* ── 주소(해시)와 탭 ────────────────────────────────────────────────── */
var routeSrc = slice('  var TABS = {', '  function rowOf(', 'route');
var LOC = { hash: '' };
var R = new Function('location', routeSrc + '\nreturn { route: route, goTab: goTab };')(LOC);

console.log('리뷰의 탭은 주소에 실린다');
LOC.hash = '';                 eq(R.route().view, 'dash', '해시가 없으면 대시보드');
LOC.hash = '#/';               eq(R.route().view, 'dash', '#/ 는 대시보드');
LOC.hash = '#/review/abc';     eq(R.route(), { view: 'review', session: 'abc', tab: 'summary' }, '기본 탭은 요약');
LOC.hash = '#/review/abc/listening';
eq(R.route().tab, 'listening', '영역 탭을 주소에서 읽는다');
LOC.hash = '#/review/abc/bogus';
eq(R.route().tab, 'summary', '모르는 탭은 요약으로 떨어진다');
LOC.hash = '#/review/a%2Fb';   eq(R.route().session, 'a/b', '세션 아이디의 / 는 인코딩된 채로 읽는다');

R.goTab({ session: 'abc' }, 'writing');
eq(LOC.hash, '#/review/abc/writing', '탭을 고르면 주소가 바뀐다');
R.goTab({ session: 'abc' }, 'summary');
eq(LOC.hash, '#/review/abc', '요약은 탭 조각을 남기지 않는다 — 뒤로 가기가 여기로 돌아온다');

console.log('');
if (fails) { console.error(fails + ' FAIL'); process.exit(1); }
console.log('ALL OK');
