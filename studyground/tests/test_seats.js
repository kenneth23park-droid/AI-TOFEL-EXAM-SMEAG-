/* sg2 assets/sg-seats.js — 좌석 저장소 검증.
 *
 * 좌석 30개가 항상 채워져 있는가, 여러 좌석에 한꺼번에 적용되는가, 옛 저장본에
 * 빠진 필드가 기본값으로 메워지는가, 내보내기→불러오기가 왕복하는가.
 *
 * 실행: node studyground/tests/test_seats.js
 */
'use strict';

var path = require('path');

/* 최소한의 브라우저 흉내 — localStorage 와 window 만 있으면 이 파일은 돈다. */
var store = {};
global.window = global;
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

require(path.join(__dirname, '..', 'sg2', 'assets', 'sg-seats.js'));
var S = window.SG_SEATS;

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}

console.log('기본값');
var all = S.all();
ok(all.length === 30, '좌석 30개');
ok(all[0].no === 1 && all[29].no === 30, '번호가 1..30 순서');
ok(all.every(function (s) { return s.mode === 'local' && s.course === 'toefl' && s.lang === 'en'; }),
   '기본값은 로컬 · TOEFL · EN');
ok(all.every(function (s) { return s.setId === '' && s.status === 'unbound'; }), '처음엔 미배정');

console.log('여러 좌석에 한꺼번에 적용');
S.set([1, 2, 3], { setId: 'set9', mode: 'cloud', lang: 'ko', audioRate: 0.75, audioReplays: 0 });
var s1 = S.get(1), s4 = S.get(4);
ok(s1.setId === 'set9' && s1.mode === 'cloud' && s1.lang === 'ko', '고른 좌석에 값이 들어감');
ok(s1.audioRate === 0.75 && s1.audioReplays === 0, '배속·재생 횟수도 숫자로 보존');
ok(s1.status === 'ready', '배정되면 status 가 ready 로');
ok(s4.setId === '' && s4.lang === 'en', '고르지 않은 좌석은 그대로');
ok(!!S.get(2).updatedAt, '적용 시각이 찍힘');

console.log('일부 필드만 바꾸기');
S.set([1], { items: 'L3,7,9' });
ok(S.get(1).items === 'L3,7,9' && S.get(1).setId === 'set9', '나머지 필드는 유지');

console.log('좌석 해제');
S.reset([1]);
ok(S.get(1).setId === '' && S.get(1).status === 'unbound' && S.get(1).lang === 'en', '처음 상태로 되돌아감');
ok(S.get(2).setId === 'set9', '옆 좌석은 건드리지 않음');

console.log('각인');
ok(S.mine() === 0, '각인 전에는 0');
S.bind(12);
ok(S.mine() === 12 && S.forThisDevice().no === 12, '각인하면 그 좌석 설정을 돌려줌');
S.bind(0);
ok(S.mine() === 0 && S.forThisDevice() === null, '각인을 지우면 null');

console.log('내보내기 → 불러오기');
var json = S.exportJson();
S.reset([2, 3]);
ok(S.get(2).setId === '', '되돌리기 전 상태 확인');
S.importJson(json);
ok(S.get(2).setId === 'set9' && S.get(2).lang === 'ko', '불러오면 값이 되살아남');

console.log('빠진 필드 메우기 (옛 저장본)');
S.importJson(JSON.stringify({ version: 1, seats: [{ no: 5, setId: 'set1' }] }));
var s5 = S.get(5);
ok(s5.setId === 'set1' && s5.mode === 'local' && s5.audioRate === 1 && s5.kiosk === true,
   '없는 필드는 기본값으로 채움');
ok(S.all().length === 30, '한 개만 담긴 파일을 불러와도 좌석 수는 30');

console.log('잘못된 파일');
var threw = false;
try { S.importJson('{"nope":1}'); } catch (e) { threw = true; }
ok(threw, 'seats[] 가 없으면 던진다 — 조용히 덮어쓰지 않는다');
ok(S.get(5).setId === 'set1', '실패한 불러오기는 기존 값을 지우지 않는다');

console.log(fails ? ('\n실패 ' + fails + '건') : '\n모두 통과');
process.exit(fails ? 1 : 0);
