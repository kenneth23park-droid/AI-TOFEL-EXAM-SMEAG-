/* SET 9 스크린 컴파일러 검산.
 * 실행: node studyground/tests/test_compile_set9.js
 * test_compile_screens.js(SET 1) 와 같은 방식으로 브라우저 없이 sg2 런타임 모듈을
 * window 섀도우 위에 얹어 순수 컴파일만 돌린다. 콘텐츠만 set9.js 로 바꾼다.
 *
 * ── 기대값의 근거 (SET 1 의 78/91 을 그대로 쓰지 않는다) ──────────────────
 * 문항 수는 SET 9 ANSWER KEY.docx 실측(R 35+15=50, L 32+15=47)과
 * NEW TOEFL MOCK TEST SET  9.docx 의 Writing/Speaking 실측(W 10+1+1=12, S 7+4=11).
 * 총 120문항.
 *
 * 화면 수는 timing.toefl.json 의 삽입 규칙 + exam-compile.js 의 block.kind 매핑에서
 * 산술적으로 유도된다(BLOCK_COMPILERS: cloze/passage/chat/free-write = 블록당 1화면,
 * build-set/audio-set = 문항당 1화면, record-set = introAudio 1 + 문항당 1):
 *
 *   listening 78 = adjustVolume 1 + listeningDirections 1
 *                + audio-set 47문항 × 1 답변화면 + audio-play 27 + moduleEnd(L1,L2) 2
 *   speaking  15 = hardwareCheck 1 + speakingDirections 1
 *                + S1(intro 1 + 7) + S2(intro 1 + 4)         (moduleEndScreen: null)
 *   reading   12 = readingDirections 1
 *                + R1 블록 7 (cloze2 + passage5) + R2 블록 2 (cloze1 + passage1)
 *                + moduleEnd(R1,R2) 2
 *   writing   17 = writingDirections 1 + W1 build-set 10문항 × 1화면
 *                + W2 free-write 1 + W3 free-write 1
 *                + taskEnd(W1,W2,W3) 3 + submitConfirm 1
 *   총합 122
 *
 * SET 1 과 달라지는 이유: SET 9 은 Reading 이 35 → 50문항(블록 9개), Listening 이
 * 33 → 47문항이라 문항당 1화면인 audio-set 이 14화면 늘어난다.
 *
 * ── 기대값 갱신 (2026-08-07, 51→78 / 95→122) ───────────────────────────────
 * 녹화 실측 두 프레임 비교(docs/reference/screens/listening-audio-700s.png vs
 * listening-question-900s.png)에서 오디오 재생과 답변이 별개 화면임이 확인되어,
 * exam-compile.js 의 audioSetBlock 이 오디오가 붙는 자리마다 blockKind 'audio-play'
 * 화면(타이머 없음 · questionIds 없음)을 하나 앞세우게 바뀌었다. SET 9 의 오디오 자리 수:
 *   L1 = perQuestionAudio 문항 12 + 블록오디오 블록 8 = 20
 *   L2 = perQuestionAudio 문항  3 + 블록오디오 블록 4 =  7   → 합 27
 * listening 51+27=78, 총계 95+27=122. 문항 수 120 은 불변(audio-play 는 문항을 안 담는다).
 *
 * ── 결손 해소 이력 (2026-08-07) ────────────────────────────────────────
 * 이전 버전의 [7] 은 "audioMissing 블록 4개 / buildWarnings 4건"을 고정하고 있었다.
 * 근거는 Listening Module 2 의 Q4-15(4블록)에 대해 SET 9 SCRIPT.docx 가 문항 질문문만
 * 싣고 대화/강의 본문 전사를 담고 있지 않다는 사실이었고, 오디오를 만들 수 없으니
 * build_set9.py 가 audio 필드를 떼고 block.audioMissing 을 세웠다.
 *
 * 그 4개 본문은 이제 정답키 제약에 맞춰 집필되어 sg2/config/_set9_l2/L2-B{2,3,4,5}.json
 * 에 origin:"authored" 로 들어 있고, tts_set9.py 가 그 JSON 으로
 * media/audio/set9/set9-L2-{04-05,06-07,08-11,12-15}.mp3 를 생성하며,
 * build_set9.py 가 블록에 audio + script + scriptOrigin:"authored" 를 배선한다.
 * 따라서 기대값을 4 → 0 으로 갱신했다. 원본 SMEAG 전사가 아니라 보충 지문이라는 사실은
 * 팩의 scriptOrigin 필드, tts-manifest.set9.json 의 authored_scripts,
 * docs/bmad/set9-authored-passages.md 세 곳에 남아 있다.
 *
 * [7] 은 이제 반대 방향을 고정한다: 리스닝 블록/문항 중 오디오 없는 것이 하나도 없어야 하고,
 * L2 의 집필 4블록은 반드시 출처 표시(scriptOrigin)를 달고 있어야 한다. */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;               // 오프라인 폴백 경로를 타게 한다

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set9.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
var set = window.SMEAG_SET9;
var res = window.SG_COMPILE.compileScreens(set, timing, { profile: 'toefl', lang: 'en' });

var fails = [];
function check(name, actual, expected) {
  var ok = actual === expected;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
  if (!ok) fails.push(name);
}

console.log('\n[0] 콘텐츠 팩 형태 (set1.js 와 동일 계약)');
check('code', set.code, 'SET9');
check('sections', set.sections.length, 4);
check('allQuestions()', set.allQuestions().length, 120);
check('findQuestion("L1-13") 존재', !!set.findQuestion('L1-13'), true);
check('findQuestion("nope") null', set.findQuestion('nope'), null);

console.log('\n[1] 화면 수 검산 (위 주석의 산술 유도)');
var bySec = {};
res.screens.forEach(function (s) { bySec[s.section] = (bySec[s.section] || 0) + 1; });
// 2026-08-07: intro.microphone(Adjusting the Microphone) 추가 → 섹션·총계 +1.
check('listening (47 + intro.volume + intro.microphone + directions + moduleEnd×2 + audio-play 27)', bySec.listening || 0, 79);
check('speaking  (11 + hardware + directions + intro×2)',          bySec.speaking  || 0, 15);
check('reading   (블록 9 + directions + moduleEnd×2)',              bySec.reading   || 0, 12);
check('writing   (12 + directions + taskEnd×3 + review.submit)',   bySec.writing   || 0, 17);
check('총 화면',                                                    res.screens.length, 123);

console.log('\n[1b] 오디오/답변 화면 분리 + 타이머 규칙 (SET 1 과 동일 계약)');
var play = res.screens.filter(function (s) { return s.blockKind === 'audio-play'; });
var ansS = res.screens.filter(function (s) { return s.blockKind === 'audio-set'; });
check('audio-play 화면 (L1 20 + L2 7)', play.length, 27);
check('audio-set(답변) 화면', ansS.length, 47);
check('audio-play 에 타이머 없음', play.filter(function (s) { return s.timer !== null; }).length, 0);
check('audio-play 에 questionIds 없음', play.filter(function (s) { return s.questionIds; }).length, 0);
check('audio-play 이 오디오를 갖는다', play.filter(function (s) { return s.audio && s.audio.src; }).length, 27);
// 30 → 20: 최종수정사항.docx "given the 20 secs time limit" 이 녹화 실측 30초를 대체한다.
check('답변 화면 타이머 {countdown,question,20} 위반', ansS.filter(function (s) {
  return !s.timer || s.timer.mode !== 'countdown' || s.timer.scope !== 'question' || s.timer.seconds !== 20;
}).length, 0);
check('타이머 달린 moduleEnd', res.screens.filter(function (s) {
  return s.screenType === 'moduleEnd' && s.timer !== null;
}).length, 0);

console.log('\n[1c] progress 범위 표기 (Reading = "Questions 1-10 of 50")');
var rFirst = null;
res.screens.forEach(function (s) { if (!rFirst && s.section === 'reading' && s.screenType === 'question') rFirst = s; });
check('reading style', rFirst.progress.style, 'range');
check('reading first-last', rFirst.progress.first + '-' + rFirst.progress.last, '1-10');
check('reading total (섹션 전체 문항)', rFirst.progress.total, 50);
check('listening style', ansS[0].progress.style, 'single');
check('listening total', ansS[0].progress.total, 47);
check('progress.last <= total 위반', res.screens.filter(function (s) {
  return s.progress && s.progress.last > s.progress.total;
}).length, 0);

console.log('\n[2] 문항 수 검산 (ANSWER KEY 실측)');
var qids = {};
res.screens.forEach(function (s) { (s.questionIds || []).forEach(function (q) { qids[q] = 1; }); });
check('고유 문항', Object.keys(qids).length, 120);
var perSec = {};
res.screens.forEach(function (s) { (s.questionIds || []).forEach(function () { perSec[s.section] = (perSec[s.section] || 0) + 1; }); });
check('reading 문항   (R1 35 + R2 15)', perSec.reading   || 0, 50);
check('listening 문항 (L1 32 + L2 15)', perSec.listening || 0, 47);
check('writing 문항   (W1 10 + W2 1 + W3 1)', perSec.writing || 0, 12);
check('speaking 문항  (S1 7 + S2 4)',  perSec.speaking  || 0, 11);

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
check('중복 화면 id', dup, 0);
var qseen = {}, qdup = 0;
set.allQuestions().forEach(function (e) { if (qseen[e.q.id]) qdup++; qseen[e.q.id] = 1; });
check('중복 문항 id', qdup, 0);

console.log('\n[5] 미디어 경로 실재 확인 (fs.existsSync)');
var missing = [], mediaCount = 0;
res.screens.forEach(function (s) {
  [s.audio, s.image].concat(s.phases ? s.phases.map(function (p) { return p.media; }) : [])
    .forEach(function (m) {
      if (!m || !m.src) return;
      mediaCount++;
      var p = path.join(SG2, decodeURI(m.src));
      if (!fs.existsSync(p)) missing.push(s.id + ' → ' + m.src);
    });
});
if (missing.length) { console.log('       ' + missing.slice(0, 8).join('\n       ')); }
console.log('       (검사한 media src ' + mediaCount + '개)');
check('미해석 미디어', missing.length, 0);

console.log('\n[6] 정답키 배선 (R 50 + L 47 = 97)');
var akIds = Object.keys(set.answerKey);
check('answerKey 항목', akIds.length, 97);
var unwired = 0, badRange = 0;
akIds.forEach(function (id) {
  var e = set.findQuestion(id);
  if (!e) { unwired++; return; }
  var a = set.answerKey[id];
  if (e.q.choices) { if (!(typeof a === 'number' && a >= 0 && a < e.q.choices.length)) badRange++; }
  else if (typeof a !== 'string' || !a.length) badRange++;
});
check('정답키 ↔ 문항 미연결', unwired, 0);
check('정답 범위/형식 위반', badRange, 0);

console.log('\n[7] 오디오 결손 0 + 집필 지문 출처 표시 (구 기대값 4 → 0, 위 주석 참조)');
var noAudio = 0, listeningNoAudio = 0, authored = 0, authoredNoScript = 0;
set.sections.forEach(function (sec) {
  sec.modules.forEach(function (mod) {
    mod.blocks.forEach(function (blk) {
      if (blk.audioMissing) noAudio++;
      if (sec.id === 'listening' && !blk.perQuestionAudio && !blk.audio) listeningNoAudio++;
      if (sec.id === 'listening' && blk.perQuestionAudio) {
        (blk.questions || []).forEach(function (q) { if (!q.audio) listeningNoAudio++; });
      }
      if (blk.scriptOrigin === 'authored') {
        authored++;
        if (!blk.script || !blk.script.length) authoredNoScript++;
      }
    });
  });
});
check('audioMissing 블록', noAudio, 0);
check('오디오 없는 리스닝 블록/문항', listeningNoAudio, 0);
check('buildWarnings', set.buildWarnings.length, 0);
check('scriptOrigin=authored 블록 (L2 Q4-5/6-7/8-11/12-15)', authored, 4);
check('집필 블록인데 script 본문 없음', authoredNoScript, 0);

console.log('\n[8] 결정성 (2회 컴파일 동일)');
var res2 = window.SG_COMPILE.compileScreens(set, timing, { profile: 'toefl', lang: 'en' });
check('출력 동일', JSON.stringify(res2.screens) === JSON.stringify(res.screens), true);

console.log('\n[9] SET 1 을 오염시키지 않는다');
check('window.SMEAG_SET1 미정의', typeof window.SMEAG_SET1, 'undefined');

/* [10] 렌더러가 활성 콘텐츠 팩을 본다 (SET 9 통합 검증에서 잡힌 회귀).
 * 렌더러들은 컴파일된 화면(문항 id 만 있음)에서 본문을 되찾을 때 콘텐츠 팩을 조회한다.
 * 그 조회가 root.SMEAG_SET1 로 하드코딩되어 있으면 ?set=set9 로 열었을 때
 * listening 47화면 전부와 writing 12화면이 "Renderer not loaded" placeholder 로 떨어진다
 * (헤드리스 실측: placeholders 12 + [SG_LISTEN] question not found 47건).
 * node 에는 DOM 이 없어 렌더를 돌릴 수 없으므로 소스 수준에서 계약을 고정한다. */
console.log('\n[10] 렌더러의 콘텐츠 팩 조회가 활성 팩(SG_CONTENT_PACK)을 우선한다');
var RENDERERS = ['exam-render-instruction.js', 'exam-render-listening.js',
                 'exam-render-reading.js', 'exam-render-writing.js', 'exam-render-speaking.js'];
var hardcoded = [];
RENDERERS.forEach(function (f) {
  var p = path.join(SG2, 'assets', f);
  if (!fs.existsSync(p)) return;
  var lines = fs.readFileSync(p, 'utf8').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    if (L.indexOf('*') === (L.length - L.replace(/^\s*/, '').length)) continue; // 주석 줄 건너뜀
    if (/root\.SMEAG_SET1/.test(L) && !/SG_CONTENT_PACK/.test(L)) {
      hardcoded.push(f + ':' + (i + 1) + '  ' + L.trim());
    }
  }
});
check('SMEAG_SET1 하드코딩 조회', hardcoded.length, 0);
hardcoded.forEach(function (h) { console.log('       ! ' + h); });

/* [11] insert 문항의 삽입 지점 마커.
 * exam-render-reading.js 의 markerTokens 는 /\{\{([A-D])\}\}/ 로 본문을 쪼개 클릭 가능한
 * rd-marker 버튼을 만든다. 마커가 0개면 본문 어디에도 A~D 가 없는 채 "Position A~D" 라디오
 * 4개만 뜨고 그 문항은 풀 수 없다(SET 9 R2-15 에서 실제로 그랬다).
 * 계약: insert 문항이 있는 passage 블록은 본문 전체에 {{A}},{{B}},{{C}},{{D}} 가 정확히
 * 하나씩 있어야 하고, insert 문항의 answer index 에 대응하는 마커가 존재해야 한다. */
console.log('\n[11] insert 문항 지문의 {{A}}~{{D}} 마커');
var MK = ['A', 'B', 'C', 'D'];
var insertBlocks = 0, markerBad = 0, answerMarkerBad = 0, insertQs = 0;
set.sections.forEach(function (sec) {
  sec.modules.forEach(function (mod) {
    mod.blocks.forEach(function (blk) {
      var ins = (blk.questions || []).filter(function (q) { return q.kind === 'insert'; });
      if (!ins.length) return;
      insertBlocks++;
      insertQs += ins.length;
      var body = (blk.paragraphs || []).join('\n');
      MK.forEach(function (L) {
        var n = body.split('{{' + L + '}}').length - 1;
        if (n !== 1) {
          markerBad++;
          console.log('       ! ' + (blk.title || mod.id) + ' : {{' + L + '}} ' + n + '개 (기대 1)');
        }
      });
      ins.forEach(function (q) {
        var a = q.answer;
        if (typeof a !== 'number' || a < 0 || a >= MK.length ||
            body.indexOf('{{' + MK[a] + '}}') < 0) {
          answerMarkerBad++;
          console.log('       ! ' + q.id + ' : answer=' + a + ' 에 대응하는 마커가 본문에 없다');
        }
      });
    });
  });
});
console.log('       (insert 문항 ' + insertQs + '개 / 블록 ' + insertBlocks + '개)');
check('insert 문항이 있는 블록', insertBlocks, 1);
check('마커 개수 위반', markerBad, 0);
check('정답 마커 결손', answerMarkerBad, 0);

if (res.warnings.length) {
  console.log('\n[compile warnings] ' + res.warnings.length + '건');
  res.warnings.slice(0, 15).forEach(function (w) { console.log('       - ' + w); });
}
if (set.buildWarnings.length) {
  console.log('\n[build warnings] ' + set.buildWarnings.length + '건');
  set.buildWarnings.forEach(function (w) { console.log('       - ' + w); });
}

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
