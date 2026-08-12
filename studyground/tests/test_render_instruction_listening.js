/* Story 2.1 / 2.2 렌더러 계약 검증 — node 전용.
 * 실행: node "studyground/tests/test_render_instruction_listening.js"
 *
 * 목적: 컴파일러가 실제로 만들어내는 화면들 중 내가 담당하는
 *       screenType(instruction/moduleEnd/hardwareCheck/review) 와
 *       blockKind(audio-set) 화면을 뽑아, 렌더 함수가 참조하는 필드가
 *       전부 존재하는지 assert 한다. DOM 은 최소 스텁으로 대체한다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;
global.fetch = undefined;

/* ── 최소 DOM 스텁 ─────────────────────────────────────────
 * 렌더러가 쓰는 API 만 구현한다: createElement / textContent / className /
 * appendChild / removeChild / setAttribute / querySelectorAll / addEventListener. */
function makeNode(tag) {
  var n = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    className: '',
    style: {},
    _text: '',
    disabled: false,
    firstChild: null,
    appendChild: function (c) { c.parentNode = n; n.children.push(c); n.firstChild = n.children[0]; return c; },
    insertBefore: function (c, ref) {
      var at = n.children.indexOf(ref);
      if (at < 0) at = n.children.length;
      c.parentNode = n; n.children.splice(at, 0, c); n.firstChild = n.children[0]; return c;
    },
    removeChild: function (c) {
      for (var i = 0; i < n.children.length; i++) {
        if (n.children[i] === c) { n.children.splice(i, 1); break; }
      }
      n.firstChild = n.children.length ? n.children[0] : null;
      c.parentNode = null;
      return c;
    },
    setAttribute: function (k, v) { n.attrs[k] = String(v); },
    getAttribute: function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; },
    removeAttribute: function (k) { delete n.attrs[k]; },
    addEventListener: function (t, fn) { (n._ev[t] = n._ev[t] || []).push(fn); },
    _ev: {},
    load: function () {},
    play: function () { return { 'catch': function () { return this; } }; },
    pause: function () {},
    querySelectorAll: function (sel) { return collect(n, sel); }
  };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text || flatten(n); },
    set: function (v) { n._text = String(v); n.children = []; n.firstChild = null; }
  });
  return n;
}
function flatten(n) {
  var s = n._text || '';
  for (var i = 0; i < n.children.length; i++) s += flatten(n.children[i]);
  return s;
}
function walk(n, out) { out.push(n); for (var i = 0; i < n.children.length; i++) walk(n.children[i], out); return out; }
function collect(root, sel) {
  var all = walk(root, []), out = [], i;
  for (i = 0; i < all.length; i++) {
    var n = all[i];
    if (sel === 'audio, video' && (n.tagName === 'AUDIO' || n.tagName === 'VIDEO')) out.push(n);
    else if (sel === 'input[type="radio"]' && n.tagName === 'INPUT' && n.type === 'radio') out.push(n);
    else if (sel === 'label.opt' && n.tagName === 'LABEL' && String(n.className).indexOf('opt') >= 0) out.push(n);
  }
  return out;
}
var docRoot = makeNode('body');
global.document = {
  createElement: makeNode,
  // 렌더러가 쓰는 만큼만 추가한 스텁 — 프래그먼트는 그냥 컨테이너 노드로 둔다.
  createElementNS: function (ns, tag) { return makeNode(tag); },
  createDocumentFragment: function () { return makeNode('#fragment'); },
  createTextNode: function (t) { var n = makeNode('#text'); n.textContent = String(t); return n; },
  getElementById: function () { return null; },
  querySelectorAll: function (sel) { return collect(docRoot, sel); },
  addEventListener: function () {},
  body: docRoot
};
global.navigator = {};                    // getUserMedia 없음 → 폴백 경로를 타게 한다
global.localStorage = (function () {
  var m = {};
  return {
    getItem: function (k) { return m.hasOwnProperty(k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    key: function (i) { return Object.keys(m)[i]; },
    get length() { return Object.keys(m).length; }
  };
})();
global.requestAnimationFrame = null;
global.AudioContext = null;

function load(rel) { eval(fs.readFileSync(path.join(SG2, rel), 'utf8')); }
load('assets/set1.js');
load('assets/exam-types.js');
load('assets/exam-media.js');
load('assets/exam-timing.js');
load('assets/exam-compile.js');
load('assets/exam-store.js');
load('assets/exam-render.js');
load('assets/exam-engine.js');
load('assets/exam-render-instruction.js');
load('assets/exam-render-listening.js');

var timing = JSON.parse(fs.readFileSync(path.join(SG2, 'config/timing.toefl.json'), 'utf8'));
window.SG_RUNTIME = { timing: function () { return timing; } };

var res = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, timing, { profile: 'toefl' });
var screens = res.screens;

/* intro.volume(Adjusting the Volume) · intro.microphone(Adjusting the Microphone) 은
 * 2026-08-12 에 TOEFL 리딩 앞에서 내려갔다(config/timing.toefl.json 의 directions).
 * 렌더러는 그대로 남는다 — IELTS(config/timing.ielts.json)가 리스닝 앞에서 여전히 두
 * 화면을 쓰고, 그 레이아웃은 계속 검사해야 한다. 그래서 아래 [8]·[9] 는 TOEFL 컴파일
 * 결과에서 두 화면을 찾지 않고, 같은 directions 를 되붙인 timing 으로 한 번 더 컴파일해
 * 렌더러만 검사한다. TOEFL 화면열 자체의 기대값은 위 screens 가 그대로 맡는다. */
var prepTiming = JSON.parse(JSON.stringify(timing));
prepTiming.directions = [
  { id: 'adjustVolume', label: 'Adjusting the Volume', screenType: 'instruction',
    insertAt: { position: 'beforeSection', section: 'reading', module: null },
    maxSec: null, advance: 'manual', controls: ['playTestAudio', 'volume', 'continue'] },
  { id: 'adjustMic', label: 'Adjusting the Microphone', labelKo: '마이크 조절', screenType: 'hardwareCheck',
    insertAt: { position: 'beforeSection', section: 'reading', module: null },
    maxSec: null, advance: 'manual', controls: ['micTest', 'continue'] }
].concat(prepTiming.directions);
var prepScreens = window.SG_COMPILE.compileScreens(window.SMEAG_SET1, prepTiming, { profile: 'toefl' }).screens;
function prepById(id) { return prepScreens.filter(function (s) { return s.id === id; })[0]; }

var fails = [];
function check(name, actual, expected) {
  var ok = actual === expected;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'));
  if (!ok) fails.push(name);
}
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

function by(fn) { return screens.filter(fn); }

/* ── [1] 담당 화면이 실제로 컴파일 결과에 존재하는가 ────── */
console.log('\n[1] 담당 화면 존재 확인');
var instr = by(function (s) { return s.screenType === 'instruction'; });
var mend = by(function (s) { return s.screenType === 'moduleEnd'; });
var hw = by(function (s) { return s.screenType === 'hardwareCheck'; });
var rev = by(function (s) { return s.screenType === 'review'; });
var audioSet = by(function (s) { return s.blockKind === 'audio-set'; });
console.log('       instruction ids: ' + instr.map(function (s) { return s.id; }).join(', '));
ok('instruction >= 5', instr.length >= 5, String(instr.length));
ok('moduleEnd >= 1', mend.length >= 1, String(mend.length));
check('hardwareCheck (speaking.hardware)', hw.length, 1);
check('review', rev.length, 1);
check('audio-set 화면', audioSet.length, 33);

/* ── [2] 렌더 함수가 참조하는 필드가 전부 존재하는가 ────── */
console.log('\n[2] 참조 필드 전수 확인');
var missing = [];
instr.concat(mend, hw, rev).forEach(function (s) {
  if (!s.copy) missing.push(s.id + '.copy');
  else {
    if (typeof s.copy.titleEn !== 'string') missing.push(s.id + '.copy.titleEn');
    if (typeof s.copy.bodyEn !== 'string') missing.push(s.id + '.copy.bodyEn');
    if (typeof s.copy.ctaEn !== 'string') missing.push(s.id + '.copy.ctaEn');
  }
});
mend.forEach(function (s) { if (typeof s.module !== 'number') missing.push(s.id + '.module'); });
audioSet.forEach(function (s) {
  if (!s.questionIds || !s.questionIds.length) missing.push(s.id + '.questionIds');
  if (!s.progress || typeof s.progress.total !== 'number') missing.push(s.id + '.progress.total');
  if (s.blockKind !== 'audio-set') missing.push(s.id + '.blockKind');
  if (s.audio && (typeof s.audio.src !== 'string' || !s.audio.src)) missing.push(s.id + '.audio.src');
  if (s.image && (typeof s.image.src !== 'string' || !s.image.src)) missing.push(s.id + '.image.src');
  var hit = window.SMEAG_SET1.findQuestion(s.questionIds[0]);
  if (!hit || !hit.q) missing.push(s.id + ' → content for ' + s.questionIds[0]);
  else if (!hit.q.choices || !hit.q.choices.length) missing.push(s.id + ' → choices for ' + s.questionIds[0]);
});
if (missing.length) console.log('       ' + missing.slice(0, 10).join('\n       '));
check('누락 필드', missing.length, 0);

/* ── [3] instruction 은 self-paced (타이머 없음) ─────────── */
console.log('\n[3] instruction self-paced');
var withTimer = instr.filter(function (s) { return s.timer !== null; });
check('타이머 달린 instruction', withTimer.length, 0);

/* ── [4] FR29 — 한국어 하드코딩 prompt 의 EN 우선 표시 ───── */
console.log('\n[4] FR29 prompt EN 우선');
var koCount = 0, remapped = 0;
audioSet.forEach(function (s) {
  var q = window.SMEAG_SET1.findQuestion(s.questionIds[0]).q;
  if (/[가-힣]/.test(q.prompt || '')) {
    koCount++;
    var pair = window.SG_LISTEN.promptPair(q);
    if (pair && pair.remapped && !/[가-힣]/.test(pair.en) && pair.ko === q.prompt) remapped++;
  }
});
ok('한국어 prompt 문항 존재', koCount > 0, koCount + '건');
check('EN 으로 remap 된 수', remapped, koCount);
check('정확 매핑 문구', window.SG_LISTEN.promptPair({ prompt: '오디오를 듣고 가장 알맞은 응답을 고르세요.' }).en, 'Choose the best response.');

/* ── [5] progress "Question n of N" ──────────────────────── */
console.log('\n[5] progress 표기');
var first = audioSet[0], last = audioSet[audioSet.length - 1];
// total 은 섹션 전체 문항 수다(AC4: "Question n of 33"). 모듈 단위가 아니다.
check('첫 화면', window.SG_LISTEN.progressPair(first).en, 'Question 1 of 33');
check('마지막 화면', window.SG_LISTEN.progressPair(last).en, 'Question 33 of 33');
var contentTotal = (function () {
  var n = 0, s = window.SMEAG_SET1.sections.filter(function (x) { return x.id === 'listening'; })[0];
  s.modules.forEach(function (m) { m.blocks.forEach(function (b) { n += (b.questions || []).length; }); });
  return n;
})();
ok('total 은 콘텐츠에서 산출(하드코딩 아님)', first.progress.total === contentTotal,
   first.progress.total + ' === content ' + contentTotal);

/* ── [6] 재생 소진 플래그가 새로고침을 넘어 유지되는가 ──── */
console.log('\n[6] FR8 오디오 소진 플래그 지속');
window.SG_STORE.setBackend(window.SG_STORE.memoryBackend());
window.SG_STORE.open('test-session');
window.SG_STORE.saveMeta({ session: 'test-session' });
/* 2026-08-07: 오디오는 이제 답변 화면(blockKind 'audio-set')이 아니라 그 앞의
 * 재생 전용 화면(blockKind 'audio-play')에 실린다 — 녹화 실측
 * (listening-audio-700s.png 에는 선택지도 타이머도 없다). 소진 플래그 검사 대상도
 * 그 화면으로 옮긴다. 플래그 로직 자체는 그대로다. */
var withAudio = by(function (s) { return !!(s.audio && s.audio.src) && s.section === 'listening'; })[0];
var key = window.SG_LISTEN.spentKey(withAudio.id, withAudio.audio.src);
check('초기 소진 여부', window.SG_LISTEN.isAudioSpent(key), false);
window.SG_LISTEN.markAudioSpent(key);
check('마킹 후', window.SG_LISTEN.isAudioSpent(key), true);
var snap = window.SG_STORE.serialize();
window.SG_STORE.restore(snap);                  // 새로고침 시뮬레이션
window.SG_STORE.open('test-session');
check('새로고침 후에도 소진 유지', window.SG_LISTEN.isAudioSpent(key), true);
check('다른 화면은 영향 없음', window.SG_LISTEN.isAudioSpent(window.SG_LISTEN.spentKey('other', 'x.mp3')), false);

/* ── [7] 실제 렌더 호출 (스텁 DOM) ──────────────────────── */
console.log('\n[7] 렌더 스모크 (예외 없이 노드 반환)');
window.SG_RENDER.setMount(makeNode('div'));
var engine = window.SG_EXAM.create(screens, { mode: 'exam' });
var ctx = { engine: engine, mode: 'exam', phaseIndex: 0 };
var rendered = 0, errors = [];
instr.concat(mend, hw, rev, audioSet).forEach(function (s) {
  try {
    var node = window.SG_RENDER.render(s, ctx);
    if (!node) errors.push(s.id + ' → null');
    else if (String(node.className).indexOf('screen-placeholder') >= 0) errors.push(s.id + ' → placeholder (렌더러 미등록/실패)');
    else rendered++;
  } catch (e) { errors.push(s.id + ' → threw ' + e.message); }
});
if (errors.length) console.log('       ' + errors.slice(0, 10).join('\n       '));
check('렌더 실패', errors.length, 0);
check('렌더 성공 화면 수', rendered, instr.length + mend.length + hw.length + rev.length + audioSet.length);

/* ── [8] 렌더 산출물 내용 확인 ──────────────────────────── */
console.log('\n[8] 렌더 산출물 내용');
function textOf(node) { return flatten(node); }

var volScreen = prepById('intro.volume');
var volNode = window.SG_INSTRUCTION.renderInstruction(volScreen, ctx);
var volText = textOf(volNode);
ok('Adjusting the Volume 에 Play Test Audio', volText.indexOf('Play Test Audio') >= 0);
/* 이 화면에는 슬라이더가 없다 — 녹화 실측(영상 165s, docs/reference/screens 참조).
   실제 문구가 "select the Volume icon at the top of the screen. The volume control
   will appear" 이므로 음량 조절은 상단바 Volume 팝오버가 담당한다. 화면 안에 슬라이더를
   두던 초기 구현은 잘못된 명세를 따른 것이었다. */
ok('Adjusting the Volume 에 인라인 슬라이더 없음', collectRange(volNode).length === 0, String(collectRange(volNode).length));
ok('Adjusting the Volume 이 상단 Volume 아이콘을 안내', volText.indexOf('Volume') >= 0);
function collectRange(n) {
  return walk(n, []).filter(function (x) { return x.tagName === 'INPUT' && x.type === 'range'; });
}

var spkDir = instr.filter(function (s) { return s.id === 'speaking.directions'; })[0];
var spkNode = window.SG_INSTRUCTION.renderInstruction(spkDir, ctx);
var spkText = textOf(spkNode);
var rows = window.SG_INSTRUCTION.speakingRows();
check('speaking 유형 수', rows.length, 2);
check('speaking 문항 합계', rows[0].count + rows[1].count, 11);
// Task 1 은 문항별 8/10/12초라 단일 숫자가 아니라 범위로 적는다(최종수정사항.docx).
ok('directions 표에 응답시간(8–12s/45s)', spkText.indexOf('8\u201312 s') >= 0 && spkText.indexOf('45 s') >= 0);
ok('directions 표에 유형 라벨', spkText.indexOf('Listen and Repeat') >= 0 && spkText.indexOf('Take an Interview') >= 0);

/* 안내 방송 화면(speaking.intro.*)에는 진행 버튼이 없다 — 방송이 끝나면 저절로 넘어간다.
   섹션 Directions(방송 없음)에는 그대로 버튼이 있어야 한다. 둘을 짝지어 고정한다. */
function buttonsIn(node) {
  return walk(node, []).filter(function (x) { return x.tagName === 'BUTTON'; });
}
ok('speaking.directions 에는 진행 버튼이 있다', buttonsIn(spkNode).length >= 1, String(buttonsIn(spkNode).length));
var annScreens = instr.filter(function (s) { return window.SG_INSTRUCTION.isAnnouncement(s); });
ok('안내 방송 화면 존재', annScreens.length >= 1, annScreens.map(function (s) { return s.id; }).join(', '));
annScreens.forEach(function (s) {
  var n = window.SG_INSTRUCTION.renderInstruction(s, ctx);
  var btns = buttonsIn(n).filter(function (b) { return String(b.className).indexOf('lst-au-play') < 0; });
  ok(s.id + ' 에 진행 버튼 없음', btns.length === 0, String(btns.length));
  ok(s.id + ' 에 안내 오디오 있음',
     walk(n, []).filter(function (x) { return x.tagName === 'AUDIO'; }).length === 1);
});

var me = mend.filter(function (s) { return s.section === 'listening' && s.module === 1; })[0];
var meCopy = window.SG_INSTRUCTION.moduleEndCopy(me, ctx);
/* 기대값 갱신 근거(2026-08, 담당 E): 녹화 프레임
   docs/reference/screens/reading-module-end-2910s.png 에서 moduleEnd 문구를 직접 읽었다.
     제목 "End of Module 1"
     1행  "Your time for Module 1 of the reading section has ended."
     2행  "Select Continue to go to Module 2."
   이전 기대값("Your time for Module 1 has ended. Continue to Module 2.")은 두 문장을
   한 줄로 이어 붙였고 섹션명이 빠져 있었다. 관찰값에 맞춰 bodyEn(1행)/body2En(2행)으로 나눈다. */
check('moduleEnd 제목', meCopy.titleEn, 'End of Module 1');
check('moduleEnd 본문 1행', meCopy.bodyEn, 'Your time for Module 1 of the listening section has ended.');
check('moduleEnd 본문 2행', meCopy.body2En, 'Select Continue to go to Module 2.');
var meLast = mend.filter(function (s) { return s.section === 'listening' && s.module === 2; })[0];
ok('마지막 모듈은 다음 섹션 안내',
   window.SG_INSTRUCTION.moduleEndCopy(meLast, ctx).body2En.indexOf('next section') >= 0,
   window.SG_INSTRUCTION.moduleEndCopy(meLast, ctx).body2En);

/* transfer.editable 분기 (IELTS transfer time 겸용) */
var transferScreen = {
  id: 'listening.moduleEnd.transfer', screenType: 'moduleEnd', section: 'listening', module: 2,
  advance: 'auto', timer: null,
  transfer: { enabled: true, editable: true, targetScreenIds: [audioSet[0].id, audioSet[1].id] },
  copy: { titleEn: 'Transfer your answers', titleKo: '답안 옮겨 적기',
          bodyEn: 'You now have 10 minutes.', bodyKo: '10분이 주어집니다.', ctaEn: 'Finish transfer', ctaKo: '완료' }
};
var trNode = window.SG_INSTRUCTION.renderModuleEnd(transferScreen, ctx);
var trText = textOf(trNode);
ok('transfer.editable → 편집 패널 렌더', trText.indexOf('Your answers') >= 0);
var trRadios = walk(trNode, []).filter(function (x) { return x.tagName === 'INPUT' && x.type === 'radio'; });
ok('transfer 편집 패널에 선택지 렌더', trRadios.length === 8, trRadios.length + ' radios');
var noTransfer = window.SG_INSTRUCTION.renderModuleEnd(me, ctx);
ok('transfer 없으면 패널 없음', textOf(noTransfer).indexOf('Your answers') < 0);

/* review 집계 */
var sum0 = window.SG_INSTRUCTION.reviewSummary(screens, {});
check('review 총 문항', sum0.total.total, 91);
check('review 미응답(무답 상태)', sum0.total.unanswered, 91);
var fake = {};
screens.forEach(function (s) { (s.questionIds || []).forEach(function (q) { if (s.section === 'reading') fake[q] = { v: 1 }; }); });
var sum1 = window.SG_INSTRUCTION.reviewSummary(screens, fake);
check('review reading 응답', pickRow(sum1, 'reading').answered, 35);
check('review listening 미응답', pickRow(sum1, 'listening').unanswered, 33);
function pickRow(sum, sec) {
  for (var i = 0; i < sum.rows.length; i++) { if (sum.rows[i].section === sec) return sum.rows[i]; }
  return { answered: -1, unanswered: -1 };
}

/* Adjusting the Microphone — 레퍼런스 화면(hardwareCheck 이지만 전용 레이아웃) */
var micScreen = prepById('intro.microphone');
ok('intro.microphone 화면 존재', !!micScreen);
var micNode = window.SG_INSTRUCTION.renderMicAdjust(micScreen, ctx);
var micText = textOf(micNode);
ok('제목 Adjusting the Microphone', micText.indexOf('Adjusting the Microphone') >= 0);
ok('Record 안내 문구', micText.indexOf("Select the 'Record' button") >= 0);
ok('낭독 지문', micText.indexOf('There are several reasons why I would prefer to live in a large city') >= 0);
ok('레벨 미터 라벨', micText.indexOf('Too Quiet') >= 0 && micText.indexOf('Good') >= 0 && micText.indexOf('Too Loud') >= 0);
/* 마이크 점검은 필수다 — 건너뛰기가 없다(2026-08-11 결정, exam-render-instruction.js
 * renderMicAdjust 주석). 종전에는 우하단에 "Skip microphone check" 가 있었고 이 줄은
 * 그것을 고정하고 있었다. 버튼이 사라졌는데 테스트가 남아 실패하고 있었다.
 *
 * 검사를 지우는 대신 반대 방향을 고정한다 — 지우면 버튼이 슬그머니 돌아와도 아무도
 * 모른다. 소리가 잡힌 녹음을 끝내기 전에는 진행이 열리지 않는다는 본계약은
 * tests/test_mic_required.js 가 따로 지킨다. */
ok('마이크 점검을 건너뛸 수 없다', micText.indexOf('Skip microphone check') < 0 && micText.indexOf('건너뛰') < 0, micText.slice(0, 120));
ok('대신 다시 시도만 열어 둔다', micText.indexOf('Try microphone again') >= 0);
check('미터 칸 수', walk(micNode, []).filter(function (x) {
  return String(x.className).indexOf('instr-seg-cell') >= 0; }).length, 24);
check('피크 판정 — 무음', window.SG_INSTRUCTION.micVerdict(0), 'silent');
check('피크 판정 — 작음', window.SG_INSTRUCTION.micVerdict(0.05), 'quiet');
check('피크 판정 — 적절', window.SG_INSTRUCTION.micVerdict(0.4), 'good');
check('피크 판정 — 큼', window.SG_INSTRUCTION.micVerdict(0.95), 'loud');

/* hardwareCheck 폴백 — navigator.mediaDevices 없음 */
var hwScreen = hw.filter(function (s) { return s.id === 'speaking.hardware'; })[0];
var hwNode = window.SG_INSTRUCTION.renderHardwareCheck(hwScreen, ctx);
var hwText = textOf(hwNode);
ok('hardwareCheck 에 마이크 없음 안내', hwText.indexOf('cannot access a microphone') >= 0);
/* 마이크를 못 잡는 브라우저에서도 그냥 통과시키지 않는다(2026-08-11 결정).
 * 종전의 "Continue without microphone" 은 사라졌다 — 마이크 없이 들어가면 스피킹
 * 녹음이 통째로 비고, 그건 시험 뒤에야 드러난다. 대신 원인을 말하고 재시도를 연다. */
ok('마이크 없이 계속할 수 없다', hwText.indexOf('Continue without microphone') < 0, hwText.slice(0, 120));
ok('대신 어떻게 해야 하는지 말해 준다', hwText.indexOf('Chrome, Edge or Safari') >= 0);
ok('hardwareCheck 에 스피커 테스트', hwText.indexOf('Play Test Sound') >= 0);

/* listening 화면 — 소진 전/후 */
window.SG_STORE.setBackend(window.SG_STORE.memoryBackend());
window.SG_STORE.open('render-session');
window.SG_STORE.saveMeta({ session: 'render-session' });
var lsNode = window.SG_LISTEN.renderListeningQuestion(withAudio, ctx);
var lsText = textOf(lsNode);
ok('오디오 1회 안내 문구', lsText.indexOf('Audio plays once') >= 0);
ok('재생 전 선택지 잠금', lsText.indexOf('choices unlock') >= 0);
var lockedInputs = walk(lsNode, []).filter(function (x) { return x.tagName === 'INPUT' && x.type === 'radio'; });
/* 2026-08-07 실측 반영: 오디오 재생 화면(blockKind 'audio-play')에는 선택지가 없었다
 * (docs/reference/screens/listening-audio-700s.png — 화자 사진과 제목만 있다).
 *
 * 2026-08-10 변경: audioOnQuestionScreen:true 로 그 분리가 사라졌다. 이제 사진·선택지가
 * 한 화면에 있고 그 화면에서 mp3 가 재생된다. 그래서 "선택지가 없다" 가 아니라
 * "선택지는 있되 재생이 끝날 때까지 잠겨 있다" 가 계약이다 — 들으면서 답을 고르면
 * 리스닝이 아니라 읽기 문제가 된다. */
ok('오디오 화면에도 선택지 4개', lockedInputs.length === 4, String(lockedInputs.length));
ok('재생 중에는 선택지가 잠겨 있다',
   lockedInputs.length > 0 && lockedInputs.every(function (x) { return x.disabled === true; }));
/* 오디오가 붙지 않은 문항 화면을 고른다. audioSet[0] 은 블록 첫 문항이라 오디오를
   갖고 있어 잠금 대상이다 — 잠금이 오디오 유무를 따르는지 보려면 없는 쪽을 봐야 한다. */
var answerScreen = audioSet.filter(function (s) { return !(s.audio && s.audio.src); })[0] || audioSet[0];
var ansInputs = walk(window.SG_LISTEN.renderListeningQuestion(answerScreen, ctx), [])
  .filter(function (x) { return x.tagName === 'INPUT' && x.type === 'radio'; });
ok('답변 화면 선택지 4개', ansInputs.length === 4, String(ansInputs.length));
/* 오디오가 없는 문항(이 화면)은 잠글 이유가 없으므로 즉시 활성이어야 한다.
 * 위의 '재생 중 잠금' 과 짝을 이뤄, 잠금이 오디오 유무에 따라 걸리는지 확인한다. */
ok('오디오 없는 문항은 선택지가 즉시 활성',
   ansInputs.length > 0 && ansInputs.every(function (x) { return x.disabled === false; }));
ok('controls 속성 미사용(FR8)',
   walk(lsNode, []).filter(function (x) { return x.tagName === 'AUDIO' && x.attrs.controls; }).length === 0);

window.SG_LISTEN.markAudioSpent(window.SG_LISTEN.spentKey(withAudio.id, withAudio.audio.src));
var lsNode2 = window.SG_LISTEN.renderListeningQuestion(withAudio, ctx);
var lsText2 = textOf(lsNode2);
ok('소진 후 안내 문구', lsText2.indexOf('Audio already played') >= 0);
ok('소진 후 audio 엘리먼트 없음',
   walk(lsNode2, []).filter(function (x) { return x.tagName === 'AUDIO'; }).length === 0);
var freeInputs = walk(lsNode2, []).filter(function (x) { return x.tagName === 'INPUT' && x.type === 'radio'; });
ok('소진 후 선택지 활성', freeInputs.every(function (x) { return x.disabled === false; }));

/* 블록 오디오 방식의 후속 문항: audio 없음 + 삽화 유지 */
var followUp = null;
for (var fi = 0; fi < audioSet.length; fi++) {
  if (!audioSet[fi].audio && audioSet[fi].image) { followUp = audioSet[fi]; break; }
}
ok('블록 오디오 후속 문항 존재', !!followUp, followUp ? followUp.id : 'none');
if (followUp) {
  var fu = window.SG_LISTEN.renderListeningQuestion(followUp, ctx);
  var imgs = walk(fu, []).filter(function (x) { return x.tagName === 'IMG'; });
  ok('후속 문항에도 화자 삽화 유지', imgs.length === 1, String(imgs.length));
  var fuInputs = walk(fu, []).filter(function (x) { return x.tagName === 'INPUT' && x.type === 'radio'; });
  ok('후속 문항 선택지 즉시 활성', fuInputs.length > 0 && fuInputs.every(function (x) { return x.disabled === false; }));
}

/* ── [9] question 디스패처가 다른 스토리를 밀어내지 않는가 ── */
console.log('\n[9] blockKind 디스패처 공존');
ok('SG_QRENDER 설치됨', !!window.SG_QRENDER);
ok('audio-set 등록됨', window.SG_QRENDER.has('audio-set'));
var chainedCalls = 0;
window.SG_RENDER.register('question', function (s) {   // 다른 스토리가 하는 방식
  chainedCalls++;
  var n = makeNode('div'); n.className = 'other-story'; return n;
});
var clozeScreen = screens.filter(function (s) { return s.blockKind === 'cloze'; })[0];
var clozeNode = window.SG_RENDER.render(clozeScreen, ctx);
ok('미지원 blockKind → 체인 폴백', chainedCalls === 1 && clozeNode.className === 'other-story',
   'calls=' + chainedCalls + ' cls=' + clozeNode.className);
// 오디오 화면(blockKind 'audio-play')은 아직 SG_QRENDER 에 등록돼 있지 않다(담당 B 작업).
// 여기서는 답변 화면(blockKind 'audio-set')이 여전히 리스닝 렌더러로 가는지만 고정한다.
var stillMine = window.SG_RENDER.render(audioSet[0], ctx);
ok('listening 은 계속 내 렌더러', String(stillMine.className).indexOf('lst-screen') >= 0, String(stillMine.className));

console.log('\n' + (fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
