/* sg2 assets/set-import.js — 정답지 ↔ 문제지 크로스체크 규칙.
 *
 * 정답을 "붙였다" 는 것과 붙은 정답이 그 문항에서 "성립한다" 는 것은 다르다. 정답지가 한 줄
 * 밀리면 문항마다 정답이 하나씩 있는 상태 그대로 전부 틀린다. 세트를 만들 때마다 전수로
 * 대조하는 이유이고, 그 판정이 여기서 고정된다. 이 규칙이 무너지면 시험장에서만 드러난다.
 *
 * 실행: node studyground/tests/test_answer_crosscheck.js
 */
'use strict';

var path = require('path');
global.window = global;
var IMPORT = require(path.join(__dirname, '..', 'sg2', 'assets', 'set-import.js'));

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('FAIL ' + msg); } else { console.log('PASS ' + msg); }
}

function sec(questions) {
  return [{ id: 'reading', modules: [{ id: 'R1', blocks: [{ questions: questions }] }] }];
}
function mcq(id, answer, choices) {
  return { id: id, kind: 'mcq', prompt: 'What is it?', choices: choices || ['a', 'b', 'c', 'd'], answer: answer };
}

ok(IMPORT.crossCheckAnswers(sec([mcq('R1-1', 0), mcq('R1-2', 3)])).length === 0,
  '보기 안에 있는 정답은 통과한다');

var over = IMPORT.crossCheckAnswers(sec([mcq('R1-1', 4)]));
ok(over.length === 1 && /only 4 choices/.test(over[0]), '보기 범위를 넘는 정답 번호를 잡는다 — ' + over[0]);

var text = IMPORT.crossCheckAnswers(sec([mcq('R1-1', 'nitrogen')]));
ok(text.length === 1 && /matches none of the choices/.test(text[0]), '보기와 못 맞춘 정답 본문을 잡는다 — ' + text[0]);

var none = IMPORT.crossCheckAnswers(sec([mcq('R1-1', undefined)]));
ok(none.length === 1, '정답이 없는 문항을 잡는다');

ok(IMPORT.crossCheckAnswers(sec([mcq('R1-1', undefined)]), ['R1-1']).length === 0,
  '이미 다른 gate 로 올린 문항은 두 번 세지 않는다');

var noChoices = IMPORT.crossCheckAnswers(sec([{ id: 'R1-1', kind: 'mcq', prompt: 'Pick one', choices: [], answer: 0 }]));
ok(noChoices.length === 1 && /no choices/.test(noChoices[0]), '보기가 통째로 빠진 문항을 잡는다');

/* "Click on the sentence …" 은 지문 문장을 고르는 문항이라 보기 목록이 없는 게 정상이다. */
var click = { id: 'R1-34', kind: 'mcq', prompt: 'Click on the sentence that best summarizes…', choices: [], answer: 'The city grew.' };
ok(IMPORT.crossCheckAnswers(sec([click])).length === 0, 'click-sentence 문항은 보기가 없어도 통과한다');
click.answer = '';
ok(IMPORT.crossCheckAnswers(sec([click])).length === 1, 'click-sentence 문항도 정답이 비면 잡는다');

var blankOk = { id: 'R2-1', kind: 'blank', hint: 'th', answer: 'therefore' };
ok(IMPORT.crossCheckAnswers(sec([blankOk])).length === 0, '빈칸은 글자 정답이면 통과한다');
ok(IMPORT.crossCheckAnswers(sec([{ id: 'R2-1', kind: 'blank', answer: '  ' }])).length === 1,
  '빈칸 정답이 공백뿐이면 잡는다');

if (fails) { console.error('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nALL PASS');
