/* 고른 녹음 파일이 어느 음원 자리에 걸리는가 — assets/audio-match.js 의 검산.
 * 실행: node studyground/tests/test_audio_match.js
 *
 * 여기가 틀리면 다른 문항의 음원이 걸린 채 시험이 나간다. 화면(admin-set-import.html 의
 * "Upload the recordings")이 부르는 것과 같은 함수다.
 */

'use strict';

var path = require('path');
var M = require(path.join(__dirname, '..', 'sg2', 'assets', 'audio-match.js'));

var fails = [];
function check(name, actual, expected) {
  var a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  var e = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

function f(name, rel) { return { name: name, webkitRelativePath: rel || '' }; }
function paired(res) {
  return res.pairs.map(function (p) { return M.base(p.slot.path) + '<-' + M.base(p.file.name) + ':' + p.how; }).sort();
}

var SLOTS = [
  { path: 'media/audio/set10/l1-q01.mp3' },
  { path: 'media/audio/set10/l1-q02.mp3' },
  { path: 'media/audio/set10/l2-q10.mp3' },
  { path: 'media/audio/set10/s1-intro.mp3' }
];

console.log('\n이름이 그대로 같을 때');
var r = M.match(SLOTS, [f('l1-q01.mp3'), f('S1-INTRO.MP3')]);
check('두 개가 걸린다', paired(r), ['l1-q01.mp3<-l1-q01.mp3:exact', 's1-intro.mp3<-S1-INTRO.MP3:exact']);
check('남은 자리 둘', r.slotsLeft.length, 2);
check('남은 파일 없음', r.filesLeft.length, 0);

console.log('\n숫자 앞의 0 만 다를 때');
r = M.match(SLOTS, [f('l1_q1.mp3'), f('L2 Q010.m4a')]);
check('0 을 무시하고 걸린다', paired(r), ['l1-q01.mp3<-l1_q1.mp3:zeros', 'l2-q10.mp3<-L2 Q010.m4a:zeros']);
check('덩어리 안의 0 은 살려 둔다', M.loose('l1-q100.mp3'), 'l1q100');

console.log('\n앞에 세트 이름이 붙었을 때');
r = M.match(SLOTS, [f('SET 10 - L1 Q02.wav')]);
check('꼬리로 걸린다', paired(r), ['l1-q02.mp3<-SET 10 - L1 Q02.wav:tail']);

console.log('\n폴더를 통째로 골랐을 때');
r = M.match(SLOTS, [
  f('l1-q01.mp3', 'SET 10 AUDIO/listening/l1-q01.mp3'),
  f('.DS_Store', 'SET 10 AUDIO/.DS_Store'),
  f('script.docx', 'SET 10 AUDIO/script.docx')
]);
check('경로를 떼고 걸린다', paired(r), ['l1-q01.mp3<-l1-q01.mp3:exact']);
check('소리 아닌 것은 건너뛴다', r.skipped.length, 2);

console.log('\n후보가 여럿이면 걸지 않는다');
r = M.match([{ path: 'media/audio/set10/q01.mp3' }, { path: 'media/audio/set10/l1-q01.mp3' }], [f('q01.mp3')]);
check('정확히 같은 쪽이 이긴다', paired(r), ['q01.mp3<-q01.mp3:exact']);
r = M.match([{ path: 'media/audio/set10/a-q01.mp3' }, { path: 'media/audio/set10/b-q01.mp3' }], [f('q01.mp3')]);
check('가릴 수 없으면 아무 데도 안 건다', r.pairs.length, 0);
check('가릴 수 없다고 알려 준다', r.ambiguous.length, 1);
check('후보를 함께 준다', r.ambiguous[0].slots.length, 2);

console.log('\n한 파일은 한 자리에만');
r = M.match([{ path: 'media/audio/set10/l1-q01.mp3' }], [f('l1-q01.mp3'), f('l1-q01.wav')]);
check('먼저 온 것이 걸린다', r.pairs.length, 1);
check('나머지는 남는다', r.filesLeft.length, 1);

console.log('\n' + (fails.length ? fails.length + ' FAILED: ' + fails.join(', ') : 'all passed'));
process.exit(fails.length ? 1 : 0);
