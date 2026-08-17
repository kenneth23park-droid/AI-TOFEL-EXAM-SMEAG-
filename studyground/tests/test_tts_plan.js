/* 세트 하나를 소리로 만드는 계획의 검산.
 * 실행: node studyground/tests/test_tts_plan.js
 *
 * 여기가 틀리면 돈이 나간 뒤에야 안다 — 잘못된 자리를 읽거나, 이미 있는 것을 또 읽거나,
 * 상한을 넘겨 400 을 받거나, 같은 사람이 문항마다 다른 목소리로 나온다. 그래서
 * 네트워크를 타지 않는 부분(assets/tts-plan.js)만 떼어 여기서 고정한다.
 *
 * 화면(admin-set-import.html 의 "Voice the scripts") 이 부르는 것과 같은 함수다.
 */

'use strict';

var path = require('path');
var PLAN = require(path.join(__dirname, '..', 'sg2', 'assets', 'tts-plan.js'));

var fails = [];
function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

/* AI 가 지은 팩과 같은 모양. 리스닝은 블록 하나에 대본 하나(문항 여럿), 스피킹은
   안내 방송 하나 + 문항마다 음원 하나다(assets/set-generate.js). */
var PACK = {
  sections: [
    { id: 'reading', modules: [{ id: 'r1', label: 'R1', blocks: [
      { heading: 'Passage', paragraphs: ['no audio here'], questions: [{ id: 'r1-1' }] }
    ] }] },
    { id: 'listening', modules: [{ id: 'l1', label: 'L1', blocks: [
      { heading: 'Conversation', audio: 'media/audio/set10/l1-q01.mp3',
        script: 'M: Where is the lounge?\nW: Second floor.',
        questions: [{ id: 'l1-1' }, { id: 'l1-2' }] },
      { heading: 'Repeat', perQuestionAudio: true, questions: [
        { id: 'l2-1', audio: 'media/audio/set10/l2-q01.mp3', script: 'Say this back to me.' },
        { id: 'l2-2', audio: 'media/audio/set10/l2-q02.mp3', script: '' }   // 대본이 없다
      ] }
    ] }] },
    { id: 'speaking', modules: [{ id: 's1', label: 'S1', blocks: [
      { heading: 'Task 1', introAudio: 'media/audio/set10/s1-instructions.mp3',
        script: 'You will speak about a familiar topic.',
        questions: [{ id: 's1-1', audio: 'media/audio/set10/s1-q1.mp3', script: 'Describe a place you like.' }] }
    ] }] },
    { id: 'writing', modules: [{ id: 'w1', label: 'W1', blocks: [{ heading: 'Essay', questions: [{ id: 'w1-1' }] }] }] }
  ]
};

/* ── 무엇을 읽는가 ────────────────────────────────────────────────── */
var jobs = PLAN.jobsFrom(PACK);
check('읽어야 할 자리만 센다', jobs.length, 4);
check('순서는 시험 순서 그대로', jobs.map(function (j) { return j.path.split('/').pop(); }),
  ['l1-q01.mp3', 'l2-q01.mp3', 's1-instructions.mp3', 's1-q1.mp3']);
check('대본이 없는 자리는 빠진다',
  jobs.some(function (j) { return /l2-q02/.test(j.path); }), false);
check('리딩·라이팅은 아예 안 본다',
  jobs.some(function (j) { return /r1|w1/.test(j.label); }), false);
check('안내 방송은 그렇게 이름 붙는다', /Instructions$/.test(jobs[2].label), true);
check('글자 수를 함께 센다 — 누르기 전에 얼마인지 보여야 한다',
  jobs[3].chars, 'Describe a place you like.'.length);

/* 오버라이드 키는 다른 관리자 화면과 같은 규칙으로 푼다. 어긋나면 만들어 놓고도
   시험 화면에서 안 걸린다 — 그래서 규칙을 여기서 새로 만들지 않고 받아 쓴다. */
var keyed = PLAN.jobsFrom(PACK, function (p) { return 'X|' + p; });
check('키는 받아 온 함수가 정한다', keyed[0].key, 'X|media/audio/set10/l1-q01.mp3');

/* 같은 경로를 두 번 읽지 않는다 — 두 번 만들면 두 번 과금된다. */
var TWICE = { sections: [{ id: 'listening', modules: [{ id: 'l', label: 'L', blocks: [
  { heading: 'A', audio: 'same.mp3', script: 'one' },
  { heading: 'B', audio: 'same.mp3', script: 'two' }
] }] }] };
check('같은 경로는 한 번만', PLAN.jobsFrom(TWICE).length, 1);

/* ── 누가 읽는가 ─────────────────────────────────────────────────── */
var VOICES = [
  { id: 'v-f1', gender: 'female' }, { id: 'v-m1', gender: 'male' },
  { id: 'v-f2', gender: 'female' }, { id: 'v-m2', gender: 'male' }
];
var cast = PLAN.caster(VOICES);
check('M 은 남자 목소리', cast('M'), 'v-m1');
check('W 는 여자 목소리', cast('W'), 'v-f1');
check('같은 화자는 언제나 같은 목소리', cast('M'), 'v-m1');
check('다른 남자 화자는 다른 목소리', cast('Professor'), 'v-m2');
check('성별을 모르는 화자도 배정된다', cast('Narrator'), 'v-f1');
check('성별 표시가 없는 목록에서도 선다',
  PLAN.caster([{ id: 'only' }])('M'), 'only');
check('목소리가 하나도 없으면 빈 값 — 부르지 않는다는 뜻', PLAN.caster([])('M'), '');

/* ── 얼마씩 끊어 보내는가 ─────────────────────────────────────────── */
var segs = PLAN.segmentsFor('M: Hello.\nM: Still me.\nW: And me.', cast);
check('이어지는 같은 화자는 한 토막으로 합친다', segs.length, 2);
check('합쳐도 말은 그대로', segs[0].text, 'Hello. Still me.');
check('화자가 바뀌면 목소리도 바뀐다', segs[1].voice !== segs[0].voice, true);

/* 강의 대본은 한 토막 상한(1200자)을 넘는다. 문장 경계에서 나눠야 억양이 안 끊긴다. */
var long = 'A'.repeat(600) + '. ' + 'B'.repeat(500) + '. ' + 'C'.repeat(400) + '.';
var cut = PLAN.segmentsFor('Narrator: ' + long, cast);
check('긴 대본은 나뉜다', cut.length > 1, true);
check('나눈 토막도 상한 안', cut.every(function (s) { return s.text.length <= PLAN.MAX_ONE; }), true);
check('문장 끝에서 나눈다', /\.$/.test(cut[0].text), true);
check('나눠도 목소리는 그대로', cut[0].voice === cut[1].voice, true);
check('글자를 잃지 않는다',
  cut.map(function (s) { return s.text; }).join(' ').replace(/\s+/g, ''), long.replace(/\s+/g, ''));

/* 요청 단위 — 20토막·6000자를 넘기지 않는다(api/tts.js 가 400 으로 거절한다). */
var many = [];
for (var i = 0; i < 45; i++) many.push({ text: 'line ' + i, voice: 'v' });
var b = PLAN.batches(many);
check('20토막씩 끊는다', b.map(function (x) { return x.length; }), [20, 20, 5]);
check('토막을 잃지 않는다', b.reduce(function (n, x) { return n + x.length; }, 0), 45);

var heavy = [];
for (var k = 0; k < 8; k++) heavy.push({ text: 'x'.repeat(1000), voice: 'v' });
var hb = PLAN.batches(heavy);
check('글자 수로도 끊는다', hb.map(function (x) { return x.length; }), [6, 2]);
check('한 요청이 6000자를 넘지 않는다',
  hb.every(function (x) {
    return x.reduce(function (n, s) { return n + s.text.length; }, 0) <= PLAN.MAX_CHARS;
  }), true);

/* 혼자서 상한을 넘는 토막은 잘라 낼 수 없다 — 그래도 버리지 않고 혼자 한 요청이 된다.
   (segmentsFor 를 거치면 1200자를 넘지 않으므로 실제로는 생기지 않는다.) */
check('혼자 큰 토막도 버리지 않는다',
  PLAN.batches([{ text: 'y'.repeat(9000), voice: 'v' }]).length, 1);

console.log(fails.length ? '\nFAILED: ' + fails.join(', ') : '\nall ok');
process.exit(fails.length ? 1 : 0);
