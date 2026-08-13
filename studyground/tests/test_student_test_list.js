/* sg2/tests.html — 수험생 계정에게 보이는 목록 검증.
 *
 * 로그인한 학생에게 이 화면은 고를 자리가 아니라 들어갈 문이다. 지금 치는 시험
 * (SET 9) 만 남고, 연습지·다른 SET·관리자 도구는 `data-staff-only` 로 접힌다.
 * 카드를 하나 더 붙이면서 표시를 빠뜨리면 학생 화면에 엉뚱한 시험이 다시 나타나기
 * 때문에, 여기서 붙잡는다.
 *
 * 2026-08-13: 학생이 치는 것은 SET 9 전체 한 벌이다. 로그인하면 자기 화면
 * (dashboard.html)에 서고, 시험은 거기 큰 버튼 하나로 들어간다. 이 목록에 들르더라도
 * 학생에게 남는 것은 같은 전체 과정과 그 네 영역뿐이다. 다른 SET·연습지·관리자
 * 도구는 `data-staff-only` 로 접힌다. 학생 앞의 관리자 승인 칸은 v56 에서 없앴다 —
 * 영역 네 칸도 학생이 그대로 연다.
 *
 * 판정은 세 갈래로 한다.
 *   1) 학생 화면에 남는 시험 진입 링크는 SET 9 전체 + 네 영역뿐인가
 *   2) 머리의 동기 판정과 CSS 규칙이 그대로 있는가 (하나만 빠져도 전부 보인다)
 *   3) 행선지(대시보드)와 시험 주소가 student-landing.js · index.html · login.html
 *      · dashboard.html 과 한 몸인가
 *
 * 실행: node studyground/tests/test_student_test_list.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HTML = path.join(__dirname, '..', 'sg2', 'tests.html');
var src = fs.readFileSync(HTML, 'utf8');

var fails = [];
function check(ok, msg) { if (!ok) fails.push(msg); }

/* ── 태그를 훑으며 data-staff-only 조상 깊이를 센다 ────────────────────────
 * 정규식 하나로는 "접힌 상자 안에 있는가"를 알 수 없다. 여는 태그/닫는 태그만
 * 세어 깊이를 유지하는 최소한의 스캐너면 충분하다(주석·void 요소는 건너뛴다). */
var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;

function studentVisibleLinks() {
  var out = [];
  var stack = [], hidden = 0;
  var re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)([^>]*)>/g, m;
  while ((m = re.exec(src))) {
    if (m[0].indexOf('<!--') === 0) continue;
    var tag = m[1].toLowerCase(), attrs = m[2] || '';
    if (m[0].indexOf('</') === 0) {
      // 짝이 맞지 않는 닫는 태그(인라인 <p> 등)는 스택에 없으면 무시한다.
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          if (stack[i].staff) hidden--;
          stack.length = i;
          break;
        }
      }
      continue;
    }
    var selfClose = /\/\s*$/.test(attrs) || VOID.test(tag);
    var staff = /\sdata-staff-only(\s|=|$)/.test(' ' + attrs);
    if (tag === 'a' && !hidden && !staff) {
      var href = (attrs.match(/href="([^"]*)"/) || [])[1] || '';
      if (href.indexOf('exam-runtime.html') === 0 || href.indexOf('exam.html') === 0 ||
          href.indexOf('set9') === 0) {
        out.push({ href: href.replace(/&amp;/g, '&'), gated: /\sdata-sec(\s|=)/.test(' ' + attrs) });
      }
    }
    if (!selfClose) { stack.push({ tag: tag, staff: staff }); if (staff) hidden++; }
  }
  return out;
}

var links = studentVisibleLinks();
var hrefs = links.map(function (l) { return l.href; });

/* 남아도 되는 것 — SET 9 전체 한 벌과 그 네 영역. 그 밖의 진입은 학생 화면에
   있으면 안 된다(다른 SET·연습지·관리자 도구는 data-staff-only 로 접힌다). */
var LANDING_HREF = 'dashboard.html';                                   // 로그인 뒤 도착하는 자리
var EXAM_HREF = 'exam-runtime.html?mode=exam&profile=toefl&set=set9';  // 그 자리의 큰 버튼
var ALLOWED = [
  EXAM_HREF,
  'exam-runtime.html?mode=section&section=reading&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=listening&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=speaking&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=writing&profile=toefl&set=set9'
];

var extra = hrefs.filter(function (h) { return ALLOWED.indexOf(h) < 0; });
check(!extra.length, '학생 화면에 있으면 안 되는 시험 링크가 남았습니다:\n  ' + extra.join('\n  '));
var missing = ALLOWED.filter(function (h) { return hrefs.indexOf(h) < 0; });
check(!missing.length, '학생 화면에서 사라진 진입이 있습니다:\n  ' + missing.join('\n  '));

/* 접는 장치 자체 — 둘 중 하나만 빠져도 표시는 그대로인 채 전부 보인다. */
check(/localStorage\.getItem\('sg2_auth_v1'\)/.test(src),
  '머리의 동기 판정이 sg2_auth_v1 을 읽지 않습니다 — 카드가 한 번 보였다 사라집니다.');
check(/\.sg-student \[data-staff-only\]\{display:none!important\}/.test(src),
  '.sg-student [data-staff-only] 숨김 규칙이 없습니다.');
check(/A\.isStaff\(\)/.test(src),
  '서버 사본으로 role 을 되짚는 부분이 없습니다 — 선생님 화면까지 접힙니다.');

/* ── 행선지와 시험 주소는 한 곳에서 나온다 ────────────────────────────────
 * 로그인 뒤 행선지(login.html)·랜딩에서의 되돌림(index.html)·대시보드의 큰 버튼·
 * 이 목록의 큰 버튼이 서로 다른 주소를 가리키면, 하나만 고치고 나머지를 잊는 순간
 * 학생이 엉뚱한 데로 떨어진다. 값은 assets/student-landing.js 하나가 갖는다. */
var SG2 = path.join(__dirname, '..', 'sg2');
var landingSrc = fs.readFileSync(path.join(SG2, 'assets', 'student-landing.js'), 'utf8');
var declared = (landingSrc.match(/SG_STUDENT_LANDING\s*=\s*'([^']+)'/) || [])[1] || '';
check(declared === LANDING_HREF,
  'assets/student-landing.js 의 행선지가 대시보드가 아닙니다: ' + declared + ' ≠ ' + LANDING_HREF);
var declaredExam = (landingSrc.match(/SG_STUDENT_EXAM\s*=\s*'([^']+)'/) || [])[1] || '';
check(declaredExam === EXAM_HREF,
  'assets/student-landing.js 의 시험 주소가 목록의 버튼과 다릅니다: ' + declaredExam + ' ≠ ' + EXAM_HREF);

['index.html', 'login.html'].forEach(function (f) {
  var t = fs.readFileSync(path.join(SG2, f), 'utf8');
  check(/assets\/student-landing\.js/.test(t), f + ' 이 assets/student-landing.js 를 싣지 않습니다.');
  check(/SG_STUDENT_LANDING/.test(t), f + ' 이 SG_STUDENT_LANDING 을 쓰지 않습니다 — 행선지가 갈립니다.');
});

/* 선생님·관리자는 학생 버튼을 보지 않는다(그 반대도 마찬가지). */
check(/\[data-student-only\]\{display:none!important\}/.test(src),
  '[data-student-only] 기본 숨김 규칙이 없습니다 — 선생님 화면에 학생 버튼이 보입니다.');
check(/\.sg-student \[data-student-only\]\{display:inline-flex!important\}/.test(src),
  '.sg-student [data-student-only] 노출 규칙이 없습니다 — 학생에게 시작 버튼이 없습니다.');

/* ── 도착하는 자리(dashboard.html) ────────────────────────────────────────
 * 학생은 이제 목록이 아니라 대시보드에 선다. 거기에 시험 문이 없으면 학생은
 * 로그인해 놓고 아무 데도 못 간다. 성적도 SET 9 만 세야 한다 — 다른 세트 기록이
 * 섞이면 학생이 자기 밴드를 잘못 읽는다. */
var dash = fs.readFileSync(path.join(SG2, 'dashboard.html'), 'utf8');
check(/assets\/student-landing\.js/.test(dash),
  'dashboard.html 이 assets/student-landing.js 를 싣지 않습니다 — 주소가 갈립니다.');
check(dash.indexOf(EXAM_HREF.replace(/&/g, '&amp;')) >= 0,
  'dashboard.html 에 SET 9 시험 버튼이 없습니다 — 학생이 응시할 문이 사라집니다.');
check(/localStorage\.getItem\('sg2_auth_v1'\)/.test(dash),
  'dashboard.html 의 머리 판정이 sg2_auth_v1 을 읽지 않습니다 — 카드가 한 번 보였다 사라집니다.');
check(/\[data-student-only\]\{display:none!important\}/.test(dash),
  'dashboard.html 에 [data-student-only] 기본 숨김 규칙이 없습니다 — 선생님 화면에 학생 버튼이 보입니다.');
check(/SG_STUDENT_SET/.test(dash) && /set_code/.test(dash),
  'dashboard.html 이 세트로 성적을 거르지 않습니다 — 학생 화면에 다른 SET 기록이 섞입니다.');
check(/isStaff\(\)/.test(dash),
  'dashboard.html 이 서버 사본으로 role 을 되짚지 않습니다 — 선생님 성적까지 한 세트로 접힙니다.');

if (fails.length) {
  console.error('FAIL — sg2 학생 화면(tests.html · dashboard.html)\n' +
    fails.map(function (s) { return ' · ' + s; }).join('\n'));
  process.exit(1);
}
console.log('ok — 학생은 대시보드에 서고, 거기서 SET 9 한 벌만 보이고 SET 9 성적만 센다');
