/* 대본의 화자 표시를 어디까지 이름으로 보는가 — assets/tts-plan.js · assets/tts-client.js.
 * 실행: node studyground/tests/test_tts_speaker_labels.js
 *
 * 여기가 헐거우면 강의 한 대목이 사람 이름이 된다. SET 12 L2 의
 * "So the takeaway is this: thoughtful investment..." 이 화자로 잡혀 혼자 읽는 강의가
 * 두 사람 대화가 됐고, 배역표가 만들어지지 않아 그 세트의 음성이 통째로 멈췄다.
 *
 * 규칙은 하나다 — 화자 표시는 대문자로 시작하는 낱말 1~3개.
 * 두 파일이 같은 규칙을 써야 한다: tts-plan 은 만들 때, tts-client 는 화면에서 들려줄 때
 * 쓰는데 둘이 갈리면 "만든 음성과 화면이 세는 화자가 다른" 상태가 된다.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var SG2 = path.join(__dirname, '..', 'sg2');
var PLAN = require(path.join(SG2, 'assets', 'tts-plan.js'));

var fails = [];
function ok(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ': ' + extra : ''));
  if (!cond) fails.push(name);
}

console.log('[1] 화자 표시로 보는 것');
[
  ['M: Hello.', 'M', 'Hello.'],
  ['W: Hi there.', 'W', 'Hi there.'],
  ['Narrator: Listen carefully.', 'Narrator', 'Listen carefully.'],
  ['Professor Kim: Today we begin.', 'Professor Kim', 'Today we begin.'],
  ['M1: Over here.', 'M1', 'Over here.']
].forEach(function (row) {
  var got = PLAN.parseScript(row[0])[0];
  ok('"' + row[0] + '" → ' + row[1], got.speaker === row[1] && got.text === row[2],
     got.speaker + ' | ' + got.text);
});

console.log('\n[2] 문장 한가운데의 콜론은 화자가 아니다');
[
  'So the takeaway is this: thoughtful investment pays off.',
  'And here is the point: the bus came first.',
  'Remember this rule: never skip the gate.'
].forEach(function (line) {
  var got = PLAN.parseScript(line)[0];
  ok('"' + line.slice(0, 28) + '…" 은 Narrator', got.speaker === 'Narrator', got.speaker);
});

/* 실제로 걸렸던 모양 그대로 — 혼자 읽는 강의가 한 사람으로 남는가. */
var lecture = [
  'So, when people hear the words "public transit," they think of crowded buses.',
  'Take Bogota, Colombia, for example. The city built a bus rapid transit system.',
  'So the takeaway is this: thoughtful investment can make dense cities greener.'
].join('\n');
var speakers = PLAN.parseScript(lecture).map(function (s) { return s.speaker; })
  .filter(function (v, i, a) { return a.indexOf(v) === i; });
ok('강의 한 편의 화자는 한 명', speakers.length === 1, speakers.join(' · '));

console.log('\n[3] 두 파일이 같은 규칙을 쓰는가');
function ruleOf(file) {
  var src = fs.readFileSync(path.join(SG2, 'assets', file), 'utf8');
  var m = /var m = (\/\^\(\[A-Z\][^\n]*?\/)\.exec\(t\);/.exec(src);
  return m ? m[1] : null;
}
var a = ruleOf('tts-plan.js'), b = ruleOf('tts-client.js');
ok('tts-plan.js 에서 규칙을 찾았다', !!a, a || '');
ok('tts-client.js 에서 규칙을 찾았다', !!b, b || '');
ok('두 규칙이 글자까지 같다', !!a && a === b);

console.log(fails.length ? '\n✗ ' + fails.length + ' FAILED: ' + fails.join(', ') : '\n✓ ALL PASS');
process.exit(fails.length ? 1 : 0);
