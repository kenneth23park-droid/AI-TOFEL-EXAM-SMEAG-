/* smeag-com/scores.html — 성적 보고서 조회는 (아이디, 응시일)로 연다.
 *
 * 학생아이디 smeag### 는 시험일마다 다른 사람에게 다시 나간다. 아이디 하나만
 * 들고 가면 서버(sg-auth)는 오늘 → 가까운 과거 → 가까운 미래 순으로 어느 응시인지
 * 짐작하고, 그 짐작은 같은 번호를 쓴 **다른 사람의 성적**으로 이어질 수 있다.
 * 조회 화면은 짐작하지 않는다 — 응시일을 함께 받아 그 자리 하나만 연다.
 *
 * 페이지는 파일 하나짜리 자립형이라 import 할 수 없다. AUTH 블록만 잘라 내
 * 화면 밖에서 세우고, fetch 를 가로채 무엇을 실어 보내는지 본다.
 *
 * 실행: node studyground/tests/test_report_lookup_by_date.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'smeag-com', 'scores.html');
var src = fs.readFileSync(HTML, 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function eq(got, want, msg) {
  var same = JSON.stringify(got) === JSON.stringify(want);
  ok(same, msg + ' → ' + JSON.stringify(got) + (same ? '' : ' (기대 ' + JSON.stringify(want) + ')'));
}

/* ── 로그인 화면에 응시일 칸이 있다 ─────────────────────────── */

console.log('로그인 화면이 응시일을 묻는다');
ok(/id="login-date"[^>]*type="date"/.test(src) || /type="date"[^>]*id="login-date"/.test(src),
   '응시일 입력 칸(login-date)이 날짜 입력으로 서 있다');
ok(src.indexOf('<span data-en>Exam date</span>') >= 0,
   '칸 이름이 화면에 영어로 붙어 있다');

/* ── AUTH.signIn 이 응시일을 서버로 넘긴다 ──────────────────── */

var START = 'var AUTH = (function () {';
var END = '\n})();';
var a = src.indexOf(START);
var b = src.indexOf(END, a);
if (a < 0 || b < 0) {
  console.error('AUTH 블록을 찾지 못했습니다 — scores.html 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

/* 페이지에서 AUTH 가 기대는 최소한의 이웃만 세워 준다. */
var STUB = [
  "var CFG = { url: 'https://db.test', anon: 'anon-key' };",
  "var localStorage = { getItem: function () { return null; },",
  "                     setItem: function () {}, removeItem: function () {} };"
].join('\n');

var sent = null;
function fakeFetch(url, init) {
  sent = { url: url, body: JSON.parse(init.body) };
  return Promise.resolve({
    ok: true,
    json: function () {
      return Promise.resolve({
        access_token: 't', refresh_token: 'r', expires_in: 3600,
        user: { id: 'u1', student_id: 'smeag007' }
      });
    }
  });
}

var AUTH = new Function('fetch',
  STUB + '\nreturn ' + src.slice(a + 'var AUTH = '.length, b + END.length))(fakeFetch);

console.log('signIn 은 응시일을 함께 보낸다');
AUTH.signIn('smeag007', '2222', '2026-09-01');
eq(sent.body.action, 'signin', 'action');
eq(sent.body.login, 'smeag007', '아이디는 그대로 간다 — 서버가 시험일과 묶어 이메일을 만든다');
eq(sent.body.exam_date, '2026-09-01', '응시일이 실린다');

AUTH.signIn('teacher01', 'smeag2222', '');
eq(sent.body.login, 'teacher01@smeagstudyground.com',
   '선생님 아이디는 상주 이메일이 된다');
eq(sent.body.exam_date, '', '시험일이 없는 계정은 빈 값으로 간다 — 서버가 그대로 로그인시킨다');

/* ── 응시일 없이 학생 아이디로는 보내지 않는다 ──────────────── */

console.log('학생 아이디는 응시일 없이 넘어가지 않는다');
var guard = src.slice(src.indexOf("$('login').onsubmit"), src.indexOf("$('out').onclick"));
ok(/if \(\/\^smeag\\d\{3\}\$\/\.test\(who\) && !when\)/.test(guard),
   '수험생 아이디 + 빈 응시일이면 요청 전에 막는다');
ok(guard.indexOf('AUTH.signIn(') > guard.indexOf('&& !when'),
   '막는 자리가 signIn 앞에 있다 — 서버까지 가지 않는다');
ok(guard.indexOf("bi('Enter the date you sat the test.'") >= 0,
   '왜 막혔는지 학생에게 말해 준다');
ok(guard.indexOf("err.code === 'bad_credentials' && when") >= 0,
   '아이디·응시일·비밀번호 중 무엇이든 어긋나면 셋을 함께 짚어 준다');

console.log(fails ? '\n' + fails + ' 개 실패' : '\nALL OK');
process.exit(fails ? 1 : 0);
