/* 리뷰 열람 창 — 문항과 정답에는 기한이 있고, 다시 여는 것은 관리자뿐이다.
 *
 * 경계는 화면이 아니라 서버가 쥔다. 그래서 이 테스트가 붙잡는 것은 "화면이 잘
 * 감추는가" 가 아니라 **화면이 서버 없이는 아무것도 그리지 못하는가** 다.
 *
 *   1) scores.html 은 정답을 스스로 들고 있지 않다 — 공개 팩(packBase)으로 가는
 *      길이 남아 있으면 기한이 무슨 소용인가.
 *   2) 문항은 sg-review 가 준 것만 쓴다. 빈 배열이 오면 그릴 것이 없다.
 *   3) 닫혔을 때는 CSV 로도 새어 나가지 않는다.
 *   4) 기한 계산 규칙(응시일과 교사 리뷰일 중 늦은 쪽 + 7일)이 SQL 한 곳에만 있다.
 *
 * 실행: node studyground/tests/test_review_window.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'smeag-com', 'scores.html'), 'utf8');
var SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'review_window.sql'), 'utf8');
var FN = fs.readFileSync(
  path.join(ROOT, '..', 'supabase', 'functions', 'sg-review', 'index.ts'), 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  var same = JSON.stringify(got) === JSON.stringify(want);
  ok(same, msg + ' → ' + JSON.stringify(got) + (same ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

console.log('화면은 정답으로 가는 옆길을 갖고 있지 않다');
ok(!/packBase\s*:/.test(HTML), 'packBase 설정이 남아 있지 않다');
ok(!/SMEAG_'\s*\+\s*code/.test(HTML), '팩을 window 에서 집어 오지 않는다');
ok(!/createElement\('script'\)/.test(HTML), '팩 스크립트를 심지 않는다');
ok(!/set9\.js|set1\.js/.test(HTML), '팩 파일 이름이 화면에 없다');
ok(/reviewFn\s*:\s*'sg-review'/.test(HTML), '문항은 sg-review 에게 묻는다');

console.log('문항은 서버가 준 것만 쓴다');
/* GRADE 블록만 잘라 화면 밖에서 돌린다(test_report_link.js 와 같은 방식). */
var a = HTML.indexOf('var GRADE = (function () {');
var b = HTML.indexOf('\n/* ─────', a + 1);
if (a < 0 || b < 0) { console.error('GRADE 블록을 찾지 못했습니다.'); process.exit(1); }
var GRADE = new Function(HTML.slice(a, b) + '\nreturn GRADE;')();

var QS = [
  { question_id: 'R1-1', ord: 1, section: 'reading', prompt: '', answer: 'populations' },
  { question_id: 'R1-2', ord: 2, section: 'reading', prompt: 'Why?', answer: ['a', 'A '] },
  { question_id: 'W-1', ord: 3, section: 'writing', prompt: '', answer: null }
];
var ANS = { 'R1-1': 'Populations.', 'R1-2': 'b', 'W-1': 'my essay' };

var rows = GRADE.rows(QS, ANS);
eq(rows.length, 3, '문항 수는 서버가 준 만큼');
eq(rows[0].ok, true, '대소문자·끝 마침표는 무시하고 채점한다');
eq(rows[1].ok, false, '틀리면 X');
eq(rows[2].ok, null, '채점 기준이 없는 문항은 O/X 를 매기지 않는다');
eq(rows[0].no, 1, '문항 번호는 세트 전체를 꿰는 ord 를 쓴다');
eq(rows[2].section, 'writing', '영역은 서버가 준 값을 따른다');

var shut = GRADE.rows([], ANS);
eq(shut.length, 0, '서버가 빈 배열을 주면 그릴 문항이 없다 — 내 답만으로는 못 만든다');

console.log('닫힌 리뷰는 화면에서도 CSV 에서도 막힌다');
ok(/if\s*\(!q\.open\)\s*return\s*lockNote\(q\)/.test(HTML), '문항 표는 닫히면 안내로 바뀐다');
ok(/if \(!q\.open \|\| !q\.rows\.length\)/.test(HTML), 'CSV 도 닫히면 내려받지 않는다');
ok(/ask an administrator to reopen/i.test(HTML), '다시 보려면 관리자에게 요청하라고 말한다');

console.log('기한 규칙은 SQL 한 곳에만 있다');
ok(/interval '7 days'/.test(SQL), '7일');
ok(/greatest\(r\.submitted_at, coalesce\(t\.at, r\.submitted_at\)\)/.test(SQL),
   '응시일과 교사 리뷰일 중 늦은 쪽이 기준이다');
ok(/source = 'teacher'/.test(SQL), '교사 리뷰만 기준일을 밀어 준다(AI 코멘트는 아니다)');
ok(!/7\s*\*\s*86400000/.test(HTML), '화면이 기한을 따로 계산하지 않는다');
/* 관리자 화면의 '7일 열기' 는 해제 기간이라 별개다 — 열람 창을 다시 계산하지는 않는다. */
var ADMIN = fs.readFileSync(path.join(ROOT, 'sg2', 'admin-results.html'), 'utf8');
ok(/sg_review_windows/.test(ADMIN), '관리자 화면도 날짜를 서버에게 묻는다');
ok(/GRANT_DAYS\s*=\s*7/.test(ADMIN), '관리자 해제는 7일');

console.log('정답 표는 service_role 말고는 아무도 못 읽는다');
ok(/create table if not exists public\.sg_set_questions/.test(SQL), '문항 표가 있다');
ok(/alter table public\.sg_set_questions enable row level security/.test(SQL), 'RLS 를 켠다');
/* RLS 를 켜 놓고 정책을 하나라도 두면 그 순간 학생이 읽는다. 정책이 없어야 맞다. */
ok(!/create policy[^;]*on public\.sg_set_questions/.test(SQL),
   'sg_set_questions 에는 정책이 하나도 없다 (= service_role 전용)');
ok(/sg_is_admin\(\)/.test(SQL) && /sg_review_grants_admin_write/.test(SQL),
   '해제를 쓸 수 있는 것은 관리자뿐이다');

console.log('문지기는 스스로 판단하지 않고 서버 정책에 묻는다');
ok(/sg_results\?session=eq\./.test(FN), '학생 토큰으로 응시를 읽어 자격을 확인한다');
ok(/p_owner=/.test(FN), '창 계산에 소유자를 함께 넘긴다(같은 session 이 여럿일 수 있다)');
ok(/if \(!open\) return json\(\{ \.\.\.shell, questions: \[\] \}\)/.test(FN),
   '닫혔으면 문항을 아예 싣지 않는다');
ok(FN.indexOf('SERVICE') > 0 && /sg_set_questions/.test(FN),
   '정답은 service_role 통로로만 읽는다');

console.log('');
if (fails) { console.error(fails + ' FAIL'); process.exit(1); }
console.log('ALL OK');
