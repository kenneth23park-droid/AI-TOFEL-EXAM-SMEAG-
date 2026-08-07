/* 스크린 컴파일러 검산 — architecture.md §4.3 기준값 대조.
 * 실행: node studyground/tests/test_compile_screens.js
 * 브라우저 없이 sg2 런타임 모듈을 window 섀도우 위에 얹어 순수 컴파일만 돌린다. */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;               // 오프라인 폴백 경로를 타게 한다

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var set = window.SMEAG_SET1;
var res = window.SG_COMPILE.compileScreens(set, timing, { profile: 'toefl', lang: 'en' });

var fails = [];
function check(name, actual, expected) {
  var ok = actual === expected;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
  if (!ok) fails.push(name);
}

console.log('\n[1] 화면 수 검산 (architecture.md §4.3)');
// §4.3 표는 intro.volume / review.submit 을 "공통 2" 행으로 따로 셌지만, 컴파일러는
// 이 둘을 각각 첫 섹션(listening) · 마지막 섹션(writing)에 귀속시킨다. 그래서 섹션별
// 기대값은 표의 값 +1 이 된다.
//
// ── 기대값 갱신 (2026-08-07, 37→56 / 78→97) ─────────────────────────────────
// 근거: 녹화 실측 두 프레임 비교(docs/reference/screens/listening-audio-700s.png vs
// listening-question-900s.png). 오디오 재생 화면에는 선택지도 타이머도 없고, 답변 화면에만
// 선택지 4개 + 00:13 타이머가 있다 → StudyGround 는 둘을 별개 화면으로 다룬다.
// exam-compile.js 의 audioSetBlock 이 오디오가 붙는 자리마다 blockKind 'audio-play'
// 화면을 하나 앞세운다. SET 1 Listening 의 오디오 자리 수:
//   L1 = perQuestionAudio 문항 7 + 블록오디오 블록 5 = 12
//   L2 = perQuestionAudio 문항 3 + 블록오디오 블록 4 =  7   → 합 19
// 따라서 listening 37+19=56, 총계 78+19=97. 문항 수(91)는 변하지 않는다
// — audio-play 화면은 questionIds 를 갖지 않기 때문이다.
var bySec = {};
res.screens.forEach(function (s) { bySec[s.section] = (bySec[s.section] || 0) + 1; });
// 2026-08-07: 레퍼런스 test-nt 화면 'Adjusting the Microphone'(intro.microphone) 추가 → 섹션·총계 +1.
check('listening (36 + intro.volume + intro.microphone + audio-play 19)', bySec.listening || 0, 57);
check('speaking',                      bySec.speaking  || 0, 15);
check('reading',                       bySec.reading   || 0, 9);
check('writing (16 + review.submit)',  bySec.writing   || 0, 17);
check('총 화면',                        res.screens.length, 98);

console.log('\n[1b] 오디오/답변 화면 분리 + 타이머 부여 규칙 (실측)');
var play = res.screens.filter(function (s) { return s.blockKind === 'audio-play'; });
var ans = res.screens.filter(function (s) { return s.blockKind === 'audio-set'; });
check('audio-play 화면', play.length, 19);
check('audio-set(답변) 화면', ans.length, 33);
check('audio-play 에 타이머 없음', play.filter(function (s) { return s.timer !== null; }).length, 0);
check('audio-play 에 questionIds 없음', play.filter(function (s) { return s.questionIds; }).length, 0);
check('audio-play 이 오디오를 갖는다', play.filter(function (s) { return s.audio && s.audio.src; }).length, 19);
check('답변 화면에는 오디오 없음', ans.filter(function (s) { return s.audio; }).length, 0);
/* 답변 화면 타이머 = {countdown, question, 20}.
 * 녹화 실측은 30초였으나(Q29 884s→00:29), 발주처 확정 규격서
 * (_compare/TOEFL Test set up-최종수정사항.docx — "given the 20 secs time limit")가
 * 이를 20초로 덮어쓴다. provenance level 'spec' 이 'observed' 를 이긴다. */
var badQ = ans.filter(function (s) {
  return !s.timer || s.timer.mode !== 'countdown' || s.timer.scope !== 'question' || s.timer.seconds !== 20;
});
check('답변 화면 타이머 규격 위반', badQ.length, 0);

console.log('\n[1c] moduleEnd 화면에는 타이머가 없다 (녹화 2910s 실측)');
var mend = res.screens.filter(function (s) { return s.screenType === 'moduleEnd'; });
check('moduleEnd 화면 수 (L1,L2,R1,R2,W1,W2,W3)', mend.length, 7);
check('타이머 달린 moduleEnd', mend.filter(function (s) { return s.timer !== null; }).length, 0);

console.log('\n[1d] progress 범위 표기 (Reading = "Questions 1-10 of 35")');
// 실측: Listening/Speaking 서브바는 "Question 25 of 32"(단일), Reading 은 범위.
var rFirst = null;
res.screens.forEach(function (s) { if (!rFirst && s.section === 'reading' && s.screenType === 'question') rFirst = s; });
check('reading 첫 화면 style', rFirst.progress.style, 'range');
check('reading 첫 화면 first-last', rFirst.progress.first + '-' + rFirst.progress.last, '1-10');
check('reading total = 섹션 전체 문항', rFirst.progress.total, 35);
var lAns = ans[0];
check('listening style', lAns.progress.style, 'single');
check('listening first===last', lAns.progress.first === lAns.progress.last, true);
check('listening total', lAns.progress.total, 33);
var spk = res.screens.filter(function (s) { return s.screenType === 'speaking'; })[0];
check('speaking style', spk.progress.style, 'single');
check('speaking total', spk.progress.total, 11);
// 하위호환: index === first
check('index === first 전수', res.screens.filter(function (s) {
  return s.progress && s.progress.index !== s.progress.first;
}).length, 0);

console.log('\n[2] 문항 수 검산');
var qids = {};
res.screens.forEach(function (s) { (s.questionIds || []).forEach(function (q) { qids[q] = 1; }); });
check('고유 문항', Object.keys(qids).length, 91);
var perSec = {};
res.screens.forEach(function (s) { (s.questionIds || []).forEach(function () { perSec[s.section] = (perSec[s.section] || 0) + 1; }); });
check('reading 문항',   perSec.reading   || 0, 35);
check('listening 문항', perSec.listening || 0, 33);
check('writing 문항',   perSec.writing   || 0, 12);
check('speaking 문항',  perSec.speaking  || 0, 11);

console.log('\n[3] validateScreen 전수 통과');
var bad = 0;
res.screens.forEach(function (s) {
  var errs = window.SG_TYPES.validateScreen(s);
  if (errs && errs.length) { bad++; if (bad <= 5) console.log('       ' + s.id + ' → ' + errs.join('; ')); }
});
check('위반 화면', bad, 0);

console.log('\n[4] id 중복 없음');
var seen = {}, dup = 0;
res.screens.forEach(function (s) { if (seen[s.id]) dup++; seen[s.id] = 1; });
check('중복 id', dup, 0);

console.log('\n[5] 미디어 경로 실재 확인');
var missing = [];
res.screens.forEach(function (s) {
  [s.audio, s.image].concat(s.phases ? s.phases.map(function (p) { return p.media; }) : [])
    .forEach(function (m) {
      if (!m || !m.src) return;
      var p = path.join(SG2, decodeURI(m.src));
      if (!fs.existsSync(p)) missing.push(s.id + ' → ' + m.src);
    });
});
if (missing.length) { console.log('       ' + missing.slice(0, 8).join('\n       ')); }
check('미해석 미디어', missing.length, 0);

console.log('\n[6] 결정성 (2회 컴파일 동일)');
var res2 = window.SG_COMPILE.compileScreens(set, timing, { profile: 'toefl', lang: 'en' });
check('출력 동일', JSON.stringify(res2.screens) === JSON.stringify(res.screens), true);

if (res.warnings.length) {
  console.log('\n[warnings] ' + res.warnings.length + '건');
  res.warnings.slice(0, 15).forEach(function (w) { console.log('       - ' + w); });
}

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
