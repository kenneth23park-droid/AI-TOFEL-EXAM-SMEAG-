/* sg2 assets/set-import.js — 원본 대조 gate(첫 관문의 마지막 그물).
 *
 * headingOrigin·choicesOrigin 같은 표식은 파서가 스스로 신고한 것이라, 신고 없이 문장이
 * 달라지는 길(줄을 잇다 낱말이 빠지거나, 손으로 고친 팩을 다시 커밋하거나, AI 가 매끄럽게
 * 다듬거나)은 그 표식으로 잡히지 않는다. 그래서 결과물 쪽에서 한 번 더 본다 —
 * **팩에 적힌 모든 문장이 원본 문서에 그대로 있는가.** 그 판정이 여기서 고정된다.
 *
 * 실행: node studyground/tests/test_verbatim_gate.js
 */
'use strict';

var path = require('path');
global.window = global;
var IMPORT = require(path.join(__dirname, '..', 'sg2', 'assets', 'set-import.js'));

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('FAIL ' + msg); } else { console.log('PASS ' + msg); }
}

function doc(lines) { return { paragraphs: lines.map(function (t) { return { text: t }; }) }; }
function sec(blocks) { return [{ id: 'reading', modules: [{ id: 'R1', blocks: blocks }] }]; }
function where(gaps) { return gaps.map(function (g) { return g.where + ' :: ' + g.text; }).join(' | '); }

var SOURCE = doc([
  'Questions 1-2',
  'The kelp forest shelters more species than any other coastal habitat.',
  'Divers counted three hundred fish in a single afternoon.',
  'What can be inferred about the kelp forest?',
  'It shelters many species.',
  'It is found only in warm water.'
]);

/* ---- 원본 그대로면 지나간다 ---- */
var same = IMPORT.verbatimGaps(sec([{
  heading: 'Questions 1-2',
  paragraphs: ['The kelp forest shelters more species than any other coastal habitat.'],
  questions: [{
    id: 'R1-1', kind: 'mcq',
    prompt: 'What can be inferred about the kelp forest?',
    choices: ['It shelters many species.', 'It is found only in warm water.']
  }]
}]), { questions: SOURCE });
ok(same.length === 0, '원본 문장을 그대로 옮긴 팩은 지나간다 — ' + where(same));

/* ---- 한 낱말만 달라도 걸린다 ---- */
var oneWord = IMPORT.verbatimGaps(sec([{
  heading: 'Questions 1-2',
  paragraphs: ['The kelp forest shelters more species than any other coastal habitats.'],
  questions: []
}]), { questions: SOURCE });
ok(oneWord.length === 1, '낱말 하나가 달라진 문장을 잡는다 — ' + where(oneWord));

/* ---- 매끄럽게 다듬은 보기도 걸린다 ---- */
var polished = IMPORT.verbatimGaps(sec([{
  questions: [{ id: 'R1-1', kind: 'mcq', prompt: 'What can be inferred about the kelp forest?',
    choices: ['It shelters a great many species.', 'It is found only in warm water.'] }]
}]), { questions: SOURCE });
ok(polished.length === 1 && /R1-1 choices\[1\]/.test(polished[0].where),
  '다듬은 보기를 어느 자리인지와 함께 잡는다 — ' + where(polished));

/* ---- 지어낸 문장은 걸린다 ---- */
var invented = IMPORT.verbatimGaps(sec([{
  questions: [{ id: 'R1-2', kind: 'mcq', prompt: 'How deep does the kelp grow?', choices: [] }]
}]), { questions: SOURCE });
ok(invented.length === 1, '원본에 없는 문두를 잡는다 — ' + where(invented));

/* ---- 문장 단위로 본다: 여러 문단을 이어 붙인 것은 지나간다 ----
   W2 이메일 문두는 원본의 상황문과 요구사항 줄을 한 필드로 잇는다. 통째로 찾으면
   이어 붙였다는 이유만으로 걸리므로, 문장 하나씩 원본에 있는지만 본다. */
var joined = IMPORT.verbatimGaps(sec([{
  questions: [{ id: 'W2', kind: 'email',
    prompt: 'The kelp forest shelters more species than any other coastal habitat. '
      + 'Divers counted three hundred fish in a single afternoon.' }]
}]), { questions: SOURCE });
ok(joined.length === 0, '원본 문단 둘을 이어 붙인 문두는 지나간다 — ' + where(joined));

/* ---- 빈칸·삽입 자리 표시는 원본에 없는 것이 정상이다 ---- */
var tpl = IMPORT.verbatimGaps(sec([{
  template: 'The kelp forest shelters {{1}} than any other coastal habitat.',
  questions: []
}]), { questions: SOURCE });
ok(tpl.length === 0, '{{1}} 자리 표시를 사이에 둔 글은 앞뒤만 본다 — ' + where(tpl));

/* ---- 원본 셋을 모두 본다 — 대본과 정답지에서 온 문장도 통과해야 한다 ---- */
var fromOthers = IMPORT.verbatimGaps(sec([{
  script: 'Welcome to the marine biology lab.',
  questions: [{ id: 'W1-1', kind: 'build', answerSentence: 'The tide pools freeze in winter.' }]
}]), {
  questions: SOURCE,
  script: doc(['Welcome to the marine biology lab.']),
  answers: doc(['The tide pools freeze in winter.'])
});
ok(fromOthers.length === 0, '대본·정답지에서 온 문장도 원본으로 친다 — ' + where(fromOthers));

/* ---- 따옴표·대시·표 구분자·대소문자 차이는 고침이 아니다 ---- */
var typography = IMPORT.verbatimGaps(sec([{
  paragraphs: ['The kelp forest shelters more species than any other coastal habitat.']
}]), { questions: doc(['The kelp forest shelters more species than any other coastal habitat.']) });
ok(typography.length === 0, '같은 문장은 지나간다');
var curly = IMPORT.verbatimGaps(sec([{ paragraphs: ["The diver's log said it was cold—very cold."] }]),
  { questions: doc(['The diver’s log said it was cold—very cold.']) });
ok(curly.length === 0, '굽은 따옴표·긴 대시 차이는 고침으로 세지 않는다 — ' + where(curly));

/* ---- 화면 문구는 원본에 없어도 통과한다(목록에 적힌 것만) ---- */
var ui = IMPORT.verbatimGaps(sec([{
  instruction: 'Fill in the blank.',
  questions: [{ id: 'L1-1', kind: 'mcq', prompt: 'Listen to the question and select the best response.', choices: [] }]
}]), { questions: SOURCE });
ok(ui.length === 0, '여기서 짓는 화면 문구는 목록에 있어 통과한다 — ' + where(ui));
var otherUi = IMPORT.verbatimGaps(sec([{ instruction: 'Choose the best answer below.', questions: [] }]),
  { questions: SOURCE });
ok(otherUi.length === 1, '목록에 없는 안내 문구는 통과하지 않는다 — ' + where(otherUi));

/* ---- 원본을 못 읽으면 모든 문장이 어긋난 것이다(조용히 통과하지 않는다) ---- */
var noSource = IMPORT.verbatimGaps(sec([{ paragraphs: ['The kelp forest shelters more species.'] }]), {});
ok(noSource.length === 1, '원본이 없으면 통과시키지 않는다');

/* ---- build() 에서 strict source mode 면 stop, 아니면 warn ----
   삽입 문항의 보기는 원본에 목록이 없으면 여기서 지어진다("Position A"~"D"). 지어진 글은
   원본에 없으므로 이 gate 에도 걸려야 한다 — origin 표식과 문장 대조가 같은 것을
   가리키는지, 그리고 gate 가 build() 에 실제로 물려 있는지를 여기서 확인한다. */
function buildWith(strict) {
  return IMPORT.build({
    code: 'SET T',
    questions: doc([
      'READING', 'Module 1', 'Questions 1-1', 'Kelp Forests',
      'The kelp forest shelters more species than any other coastal habitat. {{A}} '
        + 'Divers counted three hundred fish. {{B}}', '',
      '1. Look at the four letters that indicate where the following sentence could be added.',
      'Divers counted three hundred fish in a single afternoon.'
    ]),
    script: { paragraphs: [] }, answers: { paragraphs: [] },
    strictSource: strict
  });
}
var strictGate = buildWith(true).gates.filter(function (g) { return g.scope === 'source'; });
ok(strictGate.length === 1 && strictGate[0].level === 'stop',
  'strict source mode 에서는 어긋난 문장이 stop 이다 — ' + (strictGate[0] ? strictGate[0].message.slice(0, 110) : 'gate 없음'));
var looseGate = buildWith(false).gates.filter(function (g) { return g.scope === 'source'; });
ok(looseGate.length === 1 && looseGate[0].level === 'warn', 'strict 가 아니면 같은 어긋남이 warn 이다');

if (fails) { console.error('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nALL PASS');
