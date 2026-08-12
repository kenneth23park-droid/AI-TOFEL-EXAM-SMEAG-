/* sg2/tests.html — 수험생 계정에게 보이는 목록 검증.
 *
 * 로그인한 학생에게 이 화면은 고를 자리가 아니라 들어갈 문이다. 지금 치는 시험
 * (SET 9) 만 남고, 연습지·다른 SET·관리자 도구는 `data-staff-only` 로 접힌다.
 * 카드를 하나 더 붙이면서 표시를 빠뜨리면 학생 화면에 엉뚱한 시험이 다시 나타나기
 * 때문에, 여기서 붙잡는다.
 *
 * 2026-08-12: 학생이 치는 것은 리딩 한 영역이다. 로그인하면 곧장 그 시험으로
 * 떨어지고(assets/student-landing.js), 이 목록에 들르더라도 큰 버튼은 같은 문이다.
 * 전체 과정(4영역)은 `data-staff-only` 로 접혀 선생님·관리자만 연다.
 *
 * 영역 네 칸은 학생에게도 보이지만 학생 혼자 열지는 못한다 — 누르면 관리자 승인
 * 칸이 뜬다(assets/admin-approve.js). 그 장치가 빠지면 학생이 감독 없이 한 영역씩
 * 치게 되므로, 링크 목록과 함께 승인 배선도 같이 본다. 리딩 진입만은 승인을 묻지
 * 않는다 — 로그인이 이미 학생을 그 화면에 떨어뜨리므로, 여기서만 막아도 소용이 없다.
 *
 * 판정은 네 갈래로 한다.
 *   1) 학생 화면에 남는 시험 진입 링크는 리딩 진입 + 네 영역뿐인가
 *   2) exam-runtime 영역 링크는 모두 승인 배선(data-sec)을 달고 있고, 승인 스크립트가 실려 있는가
 *   3) 머리의 동기 판정과 CSS 규칙이 그대로 있는가 (하나만 빠져도 전부 보인다)
 *   4) 리딩 진입 주소가 student-landing.js · index.html · login.html 과 한 몸인가
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
var LANDING_HREF = 'set9-reading.html?mode=section';
var ALLOWED = [
  LANDING_HREF,
  'exam-runtime.html?mode=section&section=reading&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=listening&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=speaking&profile=toefl&set=set9',
  'exam-runtime.html?mode=section&section=writing&profile=toefl&set=set9'
];

var extra = hrefs.filter(function (h) { return ALLOWED.indexOf(h) < 0; });
check(!extra.length, '학생 화면에 있으면 안 되는 시험 링크가 남았습니다:\n  ' + extra.join('\n  '));
var missing = ALLOWED.filter(function (h) { return hrefs.indexOf(h) < 0; });
check(!missing.length, '학생 화면에서 사라진 진입이 있습니다:\n  ' + missing.join('\n  '));

/* 영역 진입은 하나도 빠짐없이 관리자 승인 배선을 달고 있어야 한다. 하나만 맨몸으로
   남아도 그 영역은 학생이 감독 없이 시작할 수 있다. 학생의 큰 버튼(리딩 시작)도
   영역 진입이라 예외가 아니다 — 로그인해서 도착한 그 자리에서 문이 열린다. */
var bare = links.filter(function (l) {
  return /mode=section/.test(l.href) && !l.gated;
});
check(!bare.length, '승인 배선(data-sec) 없이 열리는 영역 링크가 있습니다:\n  ' +
  bare.map(function (l) { return l.href; }).join('\n  '));
check(/assets\/admin-approve\.js/.test(src),
  '승인 스크립트(assets/admin-approve.js)가 실려 있지 않습니다 — 영역 문이 그냥 열립니다.');
check(/SG_APPROVE/.test(src) && /e\.preventDefault\(\)/.test(src),
  '영역 버튼 클릭을 가로채 승인을 받는 부분이 없습니다.');

/* 접는 장치 자체 — 둘 중 하나만 빠져도 표시는 그대로인 채 전부 보인다. */
check(/localStorage\.getItem\('sg2_auth_v1'\)/.test(src),
  '머리의 동기 판정이 sg2_auth_v1 을 읽지 않습니다 — 카드가 한 번 보였다 사라집니다.');
check(/\.sg-student \[data-staff-only\]\{display:none!important\}/.test(src),
  '.sg-student [data-staff-only] 숨김 규칙이 없습니다.');
check(/A\.isStaff\(\)/.test(src),
  '서버 사본으로 role 을 되짚는 부분이 없습니다 — 선생님 화면까지 접힙니다.');

/* ── 리딩 진입 주소는 한 곳에서 나온다 ────────────────────────────────────
 * 로그인 뒤 행선지(login.html)·랜딩에서의 되돌림(index.html)·이 목록의 큰 버튼이
 * 서로 다른 주소를 가리키면, 셋 중 하나만 고치고 나머지를 잊는 순간 학생이 다른
 * 시험으로 떨어진다. 값은 assets/student-landing.js 하나가 갖는다. */
var SG2 = path.join(__dirname, '..', 'sg2');
var landingSrc = fs.readFileSync(path.join(SG2, 'assets', 'student-landing.js'), 'utf8');
var declared = (landingSrc.match(/SG_STUDENT_LANDING\s*=\s*'([^']+)'/) || [])[1] || '';
check(declared === LANDING_HREF,
  'assets/student-landing.js 의 행선지가 목록의 버튼과 다릅니다: ' + declared + ' ≠ ' + LANDING_HREF);

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

if (fails.length) {
  console.error('FAIL — sg2/tests.html 학생 목록\n' + fails.map(function (s) { return ' · ' + s; }).join('\n'));
  process.exit(1);
}
console.log("ok — 학생 화면에는 SET 9 리딩 진입만 큰 버튼으로 남고, 나머지 영역 문은 관리자 승인으로 열린다");
