/* 제출한 뒤 다시 응시한다 — 전체 한 벌 또는 한 영역만. node 전용.
 * 실행: node "studyground/tests/test_retake_after_submit.js"
 *
 * 발주 요구(2026-08-12): "after exam. can retake full exam / can choose each
 * reading, listening, writing, speaking section". 시험이 끝난 화면에서 곧바로
 * 다시 들어갈 수 있어야 하고, 그 문은 tests.html 과 같은 URL 계약을 써야 한다.
 *
 * 여기서 붙잡는 것은 셋이다.
 *  [1] 링크가 만들어지는 규칙 — exam-shell.js 의 retakeUrl/retakeHtml 을 잘라 내
 *      화면 밖에서 돌린다(test_report_link.js 와 같은 방식).
 *  [2] 제출 화면 배선 — 채점·업로드가 끝난 뒤에야 문이 열린다. 열어 두면 학생이
 *      진행 중에 떠나 채점 요청이 끊긴다(test_submit_scores_now.js 의 waitScore 와 같은 취지).
 *  [3] 다시 들어갔을 때 새 세션이 열린다 — 제출된 세션은 이어보지 못한다는 계약에 기댄다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
var css = fs.readFileSync(path.join(SG2, 'assets/exam.css'), 'utf8');
var store = fs.readFileSync(path.join(SG2, 'assets/exam-store.js'), 'utf8');

var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

/* ── [1] 링크 규칙 ─────────────────────────────────────────── */
console.log('[1] 다시 응시 링크');

var START = '  var RETAKE_SECTIONS = [';
var END = '  /* ── 제출 직후';
var a = shell.indexOf(START), b = shell.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('RETAKE 블록을 찾지 못했습니다 — exam-shell.js 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

/* 셸이 기대는 이웃만 세운다: 쿼리스트링 한 줄과 이 페이지가 실은 팩의 id. */
function build(search, setId) {
  var stub =
    'function query(name) {' +
    '  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(SEARCH);' +
    '  return m ? decodeURIComponent(m[1]) : "";' +
    '}\n' +
    'var SET_ID = SETID;\n';
  return new Function('SEARCH', 'SETID',
    stub + shell.slice(a, b) +
    '\nreturn { retakeUrl: retakeUrl, retakeHtml: retakeHtml, sections: RETAKE_SECTIONS };'
  )(search, setId);
}

var R = build('?mode=exam&profile=toefl&set=set9', 'set9');

ok('영역은 시험을 치르는 순서다',
   R.sections.map(function (s) { return s.id; }).join(',') === 'reading,listening,speaking,writing',
   R.sections.map(function (s) { return s.id; }).join(','));

var full = R.retakeUrl(null);
ok('전체 한 벌은 mode=exam', /(^|[?&])mode=exam($|&)/.test(full), full);
ok('전체 링크에 section 이 없다', full.indexOf('section=') < 0, full);

var reading = R.retakeUrl('reading');
ok('한 영역은 mode=section', /(^|[?&])mode=section($|&)/.test(reading), reading);
ok('영역이 붙는다', /(^|[?&])section=reading($|&)/.test(reading), reading);

/* 라우트 페이지(en/test-nt/{section}/)에는 <base> 가 있다 — 경로를 앞에 붙이면
   거기서 두 번 풀려 시험 밖으로 나간다. 위의 review.html 링크와 같은 이유다. */
R.sections.concat([{ id: null }]).forEach(function (s) {
  var u = R.retakeUrl(s.id);
  ok('상대경로 그대로다 (' + (s.id || 'full') + ')', u.indexOf('exam-runtime.html?') === 0, u);
});

ok('세트는 지금 실은 팩을 넘긴다', /(^|[?&])set=set9($|&)/.test(full), full);
ok('프로필을 잃지 않는다', /(^|[?&])profile=toefl($|&)/.test(full), full);

/* set9.html 은 쿼리 없이 들어온다 — 그래도 같은 세트로 다시 쳐야 한다. */
var bare = build('', 'set9');
ok('쿼리가 없어도 세트는 남는다', /(^|[?&])set=set9($|&)/.test(bare.retakeUrl(null)), bare.retakeUrl(null));
ok('프로필이 없으면 toefl', /(^|[?&])profile=toefl($|&)/.test(bare.retakeUrl(null)), bare.retakeUrl(null));

var withId = build('?testId=NT-016&profile=toefl', 'set1');
ok('시험 코드를 잃지 않는다', /(^|[?&])testId=NT-016($|&)/.test(withId.retakeUrl('writing')),
   withId.retakeUrl('writing'));

/* 세션은 넘기지 않는다 — 넘기면 boot() 가 그 세션을 그대로 열어 방금 낸 답안 위에 덧쓴다. */
R.sections.concat([{ id: null }]).forEach(function (s) {
  ok('세션을 물려주지 않는다 (' + (s.id || 'full') + ')', R.retakeUrl(s.id).indexOf('sessionId=') < 0);
});

var html = R.retakeHtml();
ok('네 영역이 모두 서 있다',
   R.sections.every(function (s) { return html.indexOf('>' + s.label + '</a>') >= 0; }));
ok('전체 한 벌이 서 있다', html.indexOf('Full test') >= 0);
ok('처음에는 접혀 있다', /id="done-retake" hidden/.test(html));

/* ── [2] 제출 화면 배선 ────────────────────────────────────── */
console.log('\n[2] 제출 화면 배선');

ok('제출 화면에 붙는다', /retakeHtml\(\) \+/.test(shell));
ok('여는 함수가 있다', /function openRetake\s*\(/.test(shell));
ok('로그인 전이면 바로 연다', /say\('Saved on this device\.'[^)]*\);\s*\n\s*openRetake\(\);/.test(shell));
ok('업로드·채점이 끝난 뒤에 연다', /\.then\(openRetake, openRetake\);/.test(shell));
ok('채점 실패해도 열린다 — 갇히지 않는다',
   shell.indexOf('.catch(function () {') >= 0 && /\.then\(openRetake, openRetake\);/.test(shell));
ok('숨은 상태가 CSS 에도 있다', css.indexOf('.exam-retake[hidden]') >= 0);
ok('흰 배경 위에서 버튼이 보인다', css.indexOf('.exam-done .exam-btn') >= 0);

/* ── [3] 다시 들어가면 새 세션 ─────────────────────────────── */
console.log('\n[3] 새 세션');

ok('제출된 세션은 이어볼 수 없다',
   /if \(m\.submittedAt\) return \{ ok: false, reason: 'submitted' \}/.test(store));
ok('이어볼 수 없으면 셸이 새 세션을 연다',
   /if \(!can\.ok && can\.reason !== 'no_meta'[\s\S]{0,200}offlineSessionId\(\)/.test(shell));
/* 방금 친 응시를 지우지는 않는다 — 리뷰·성적이 그 기록을 읽는다. */
ok('제출 화면은 세션을 지우지 않는다',
   shell.slice(shell.indexOf('function finishScreen')).indexOf('dropSession') < 0);

console.log('');
if (fails.length) { console.log('FAIL ' + fails.length + '건'); process.exit(1); }
console.log('ALL PASS (retake after submit)');
