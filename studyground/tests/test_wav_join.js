/* WAV 토막 잇기의 검산 — assets/wav-join.js.
 * 실행: node studyground/tests/test_wav_join.js
 *
 * 여기가 틀리면 긴 대본의 뒷부분이 통째로 사라진다(재생기는 첫 토막에서 멈춘다).
 * 서버(api/tts.js)와 화면(admin-set-import.html)이 같은 이 함수를 쓴다.
 */

'use strict';

var path = require('path');
var W = require(path.join(__dirname, '..', 'sg2', 'assets', 'wav-join.js'));

var fails = [];
function check(name, actual, expected) {
  var a = String(actual), e = String(expected);
  var ok = a === e;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ': ' + a + (ok ? '' : '  (expected ' + e + ')'));
  if (!ok) fails.push(name);
}

/** 16bit mono PCM WAV 한 개. bytes 는 data 덩어리에 넣을 값들. */
function wav(bytes, rate, channels) {
  var b = Buffer.alloc(44 + bytes.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(channels || 1, 22);
  b.writeUInt32LE(rate || 24000, 24); b.writeUInt32LE((rate || 24000) * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes.length, 40);
  Buffer.from(bytes).copy(b, 44);
  return b;
}

function dataOf(u8) { return Array.from(W.parse(u8).data); }

console.log('\n토막 둘을 잇는다');
var out = W.join([wav([1, 2, 3, 4]), wav([5, 6])]);
check('WAV 이다', W.isWav(out), 'true');
check('소리가 순서대로 다 있다', dataOf(out), [1, 2, 3, 4, 5, 6].toString());
check('data 길이가 맞다', W.parse(out).data.length, 6);
check('RIFF 길이가 맞다', out.length - 8, W.parse(out).data.length + 36);

console.log('\n토막 하나면 그대로');
var one = wav([9, 9]);
check('그대로 돌려준다', Buffer.from(W.join([one])).equals(one), 'true');

console.log('\n형식이 다르면 잇지 않는다');
var threw = '';
try { W.join([wav([1, 2], 24000), wav([3, 4], 16000)]); } catch (e) { threw = 'threw'; }
check('샘플레이트가 다르면 던진다', threw, 'threw');

console.log('\nmp3 는 그냥 붙인다');
var mp3 = W.joinAuto([Buffer.from([0xff, 0xfb, 1]), Buffer.from([0xff, 0xfb, 2])], 'audio/mpeg');
check('길이가 합이다', mp3.length, 6);

console.log('\nWAV 는 mime 없이도 알아본다');
check('joinAuto 가 제대로 잇는다', dataOf(W.joinAuto([wav([1]), wav([2])])), [1, 2].toString());

console.log('\n머리표에 다른 덩어리가 섞여 있어도');
var lst = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'),
  Buffer.from('LIST'), (function () { var b = Buffer.alloc(4); b.writeUInt32LE(4, 0); return b; })(),
  Buffer.from('INFO'),
  wav([7, 8]).subarray(12)
]);
lst.writeUInt32LE(lst.length - 8, 4);
check('LIST 를 건너뛴다', dataOf(W.join([lst, wav([9])])), [7, 8, 9].toString());

console.log('\n' + (fails.length ? fails.length + ' FAILED: ' + fails.join(', ') : 'all passed'));
process.exit(fails.length ? 1 : 0);
