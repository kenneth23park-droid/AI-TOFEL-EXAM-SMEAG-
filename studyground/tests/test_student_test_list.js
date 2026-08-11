/* sg2/tests.html — 수험생 계정에게 보이는 목록 검증.
 *
 * 로그인한 학생에게 이 화면은 고를 자리가 아니라 들어갈 문이다. 지금 치는 시험
 * (SET 9) 전체 과정 하나만 남고, 영역별 응시·연습지·다른 SET·관리자 도구는
 * `data-staff-only` 로 접힌다. 카드를 하나 더 붙이면서 표시를 빠뜨리면 학생 화면에
 * 엉뚱한 시험이 다시 나타나기 때문에, 여기서 붙잡는다.
 *
 * 판정은 두 갈래로 한다.
 *   1) 학생 화면에 남는 시험 진입 링크는 SET 9 전체 과정 하나뿐인가
 *   2) 머리의 동기 판정과 CSS 규칙이 그대로 있는가 (하나만 빠져도 전부 보인다)
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
          href.indexOf('set9') === 0) out.push(href.replace(/&amp;/g, '&'));
    }
    if (!selfClose) { stack.push({ tag: tag, staff: staff }); if (staff) hidden++; }
  }
  return out;
}

var links = studentVisibleLinks();
check(links.length === 1,
  '학생 화면에 남은 시험 링크가 ' + links.length + '개입니다 — 하나여야 합니다:\n  ' + links.join('\n  '));
check(links[0] === 'exam-runtime.html?mode=exam&profile=toefl&set=set9',
  '남은 링크가 SET 9 전체 과정이 아닙니다: ' + links[0]);

/* 접는 장치 자체 — 둘 중 하나만 빠져도 표시는 그대로인 채 전부 보인다. */
check(/localStorage\.getItem\('sg2_auth_v1'\)/.test(src),
  '머리의 동기 판정이 sg2_auth_v1 을 읽지 않습니다 — 카드가 한 번 보였다 사라집니다.');
check(/\.sg-student \[data-staff-only\]\{display:none!important\}/.test(src),
  '.sg-student [data-staff-only] 숨김 규칙이 없습니다.');
check(/A\.isStaff\(\)/.test(src),
  '서버 사본으로 role 을 되짚는 부분이 없습니다 — 선생님 화면까지 접힙니다.');

if (fails.length) {
  console.error('FAIL — sg2/tests.html 학생 목록\n' + fails.map(function (s) { return ' · ' + s; }).join('\n'));
  process.exit(1);
}
console.log('ok — 학생 화면에는 SET 9 전체 과정 하나만 남는다');
