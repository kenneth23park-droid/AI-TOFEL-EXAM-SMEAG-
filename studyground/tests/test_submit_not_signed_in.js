/* 미로그인 제출은 조용히 끝나지 않는다.
 *
 * 2026-08-12 시험에서 smeag007(PAI JUN YUAN)의 답안이 세상 어디에도 남지 않았다.
 * 계정은 있었고, 같은 시험장의 다른 8명은 전부 sg_results 에 들어갔고, 그 학생만
 * 없었다. auth.sessions 를 보면 제출 시각대에 그 계정의 브라우저 세션이 없고
 * 시험이 끝난 25분 뒤에야 첫 로그인이 찍힌다 — 제출 순간 그 기기는 로그인 상태가
 * 아니었다는 뜻이다.
 *
 * 그때 화면은 "이 기기에 저장되었습니다" 한 줄만 말했다. 그 말은 사실이었지만
 * 위험을 담지 못했다: 로그인이 없으면 sg_results 도 녹음 버킷도 열리지 않아서,
 * 그 PC 를 떠나는 순간 답안이 사라진다. 학생도 감독 선생님도 그걸 몰랐다.
 *
 * 이 파일이 지키는 계약 — 로그인 없이 제출한 자리에서는
 *   1. 붉은 막이 서고(안심시키는 문구로 끝내지 않는다),
 *   2. 녹음은 토큰 없이도 파일 한 장으로 손에 쥐여 주고,
 *   3. 지금 로그인해 올릴 문이 그 자리에 열리고,
 *   4. 그래도 학생이 화면에 갇히지는 않는다(재응시 문은 그대로 열린다).
 */
var fs = require('fs');
var path = require('path');

var shell = fs.readFileSync(
  path.join(__dirname, '..', 'sg2', 'assets', 'exam-shell.js'), 'utf8');

var fails = 0;
function ok(name, cond, got) {
  if (cond) { console.log('  ok   ' + name); return; }
  fails += 1;
  console.log('  FAIL ' + name + (got === undefined ? '' : '  — 얻은 값: ' + got));
}

console.log('\n[1] 미로그인 분기가 경고로 간다');

ok('로그인이 없으면 경고 함수를 부른다',
   /if \(!window\.SG_RESULTS \|\| !window\.SG_AUTH \|\| !SG_AUTH\.user\(\)\) \{\s*\n\s*warnNotUploaded\(\);/.test(shell));

ok('경고 함수가 있다', /function warnNotUploaded\s*\(\s*\)/.test(shell));

/* "이 기기에 저장되었습니다" 로 끝내면 안 된다 — 사실이지만 위험을 감춘다.
   push() 가 실패했을 때의 같은 문구(온라인이 되면 올라갑니다)는 사정이 다르다:
   그쪽은 로그인이 있어서 다음 대시보드에서 실제로 올라간다. */
var warnBody = (shell.match(/function warnNotUploaded[\s\S]*?\n    \}\n/) || [''])[0];
ok('경고 본문을 찾았다', warnBody.length > 0, warnBody.length);
ok('안심시키는 문구로 끝내지 않는다', warnBody.indexOf("Saved on this device") < 0);
ok('저장되지 않았다고 말한다', /NOT saved to your account/.test(warnBody));
ok('이 컴퓨터에만 있다고 말한다', /THIS COMPUTER ONLY/.test(warnBody));
ok('선생님을 부르라고 한다', /Call your teacher/.test(warnBody));

console.log('\n[2] 할 수 있는 일을 준다');

ok('붉은 막이다', /border:2px solid #c0392b/.test(warnBody));
ok('지금 로그인해 올릴 문을 연다',
   /login\.html\?next=/.test(warnBody) && /dashboard\.html/.test(warnBody));
ok('녹음을 이 기기에서 훑는다', /SG_REC\.scan\(session\)/.test(warnBody));
ok('녹음을 파일 한 장으로 내려받는다', /SG_REC\.saveLocal\(/.test(warnBody));
ok('SG_REC 가 없어도 터지지 않는다', /if \(!window\.SG_REC\) return;/.test(warnBody));
ok('파일 저장이 실패해도 말은 남긴다', /\['catch'\]\(function \(\) \{/.test(warnBody));

console.log('\n[3] 학생을 화면에 가두지 않는다');

ok('재응시 문은 그대로 열린다',
   /warnNotUploaded\(\);\s*\n\s*openRetake\(\);\s*\n\s*return;/.test(shell));

/* 로그인이 있는 길은 건드리지 않았다 — 업로드·채점을 끝까지 기다리는 그 흐름은
   c481ece 에서 세운 그대로다. */
console.log('\n[4] 로그인한 길은 그대로다');
ok('업로드·채점을 기다린다', /waitScore: true/.test(shell));
ok('녹음 회수가 push 보다 먼저다',
   shell.indexOf('SG_REC.ensure') < shell.indexOf('SG_RESULTS.push({'));

console.log(fails ? '\nFAIL ' + fails + '건' : '\nALL PASS (submit while not signed in)');
process.exit(fails ? 1 : 0);
