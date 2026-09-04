/* sg2 assets/set-store.js — "저장키를 눌렀을 때 제대로 저장됐는지" 검산.
 *
 * 세트를 만드는 마지막 단계는 저장이고, 저장은 조용히 반쯤 실패한다. localStorage 가
 * 용량 때문에 잘리거나, 다른 무언가가 같은 키를 덮어쓰거나, 목록만 갱신되고 본문이
 * 안 들어가는 경우다. put 이 ok 를 돌려준 것만 믿고 "저장됨" 이라고 말하면 정답이 빠진
 * 세트로 시험이 열린다. 그래서 put 은 되읽어 대조한 뒤에만 ok 를 돌려줘야 한다.
 *
 * 실행: node studyground/tests/test_set_save_verify.js
 */
'use strict';

var path = require('path');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('FAIL ' + msg); } else { console.log('PASS ' + msg); }
}

/* localStorage 흉내 — 테스트가 고장을 일부러 만들 수 있게 훅을 둔다. */
function makeStorage() {
  var mem = {};
  return {
    _mem: mem,
    onSet: null,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { if (this.onSet) v = this.onSet(k, v); if (v !== null) mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
}

var storage = makeStorage();
global.localStorage = storage;
global.window = global;
var STORE = require(path.join(__dirname, '..', 'sg2', 'assets', 'set-store.js'));

function pack(answers) {
  return {
    title: 'SET TEST',
    sections: [{ id: 'reading', modules: [{ id: 'R1', blocks: [{
      kind: 'passage',
      questions: answers.map(function (a, i) {
        return { id: 'R1-' + (i + 1), no: i + 1, kind: 'mcq', choices: ['a', 'b', 'c', 'd'], answer: a };
      })
    }] }] }, { id: 'listening', modules: [{ id: 'L1', blocks: [{
      kind: 'audio-set', audio: 'media/tts/settest-L1.mp3', questions: []
    }] }] }]
  };
}

/* 1. 성한 저장 — ok 이고 verified 이며, 되읽은 팩이 같다. */
var good = pack([0, 1, 2, 3]);
var res = STORE.put('settest', good, { title: 'SET TEST' });
ok(res.ok && res.verified, '정상 저장은 되읽기 검산까지 통과한다');
ok(STORE.verify('settest', good).ok, 'verify() 는 저장 직후 문제를 찾지 못한다');
ok(STORE.get('settest').sections.length === 2, '되읽은 팩이 그대로다');

/* 2. 본문이 통째로 안 들어간 경우 — 목록만 남고 팩이 없다. */
storage.onSet = function (k, v) { return k.indexOf('sg2:set:') === 0 ? null : v; };
var res2 = STORE.put('settest2', good, { title: 'SET TEST 2' });
storage.onSet = null;
ok(!res2.ok, '본문이 저장되지 않으면 put 이 ok 를 돌려주지 않는다');
ok(/save/i.test(res2.error || ''), '실패 사유가 저장에 대한 말로 나온다 — ' + res2.error);
ok(!STORE.list().some(function (r) { return r.slug === 'settest2'; }),
  '본문이 없는 세트를 저장 목록이 광고하지 않는다');

/* 3. 저장된 뒤 정답이 바뀐 경우 — 문항별 대조가 잡아낸다. */
var drifted = pack([0, 1, 2, 3]);
STORE.put('settest3', drifted, {});
storage._mem['sg2:set:settest3'] = JSON.stringify(pack([0, 1, 2, 0]));
var v3 = STORE.verify('settest3', drifted);
ok(!v3.ok && /different answer/.test(v3.problems.join(' ')), '저장본의 정답이 다르면 verify 가 잡는다 — ' + v3.problems.join(' '));

/* 4. 문항이 줄어든 경우. */
var short = pack([0, 1, 2, 3]);
STORE.put('settest4', short, {});
storage._mem['sg2:set:settest4'] = JSON.stringify(pack([0, 1]));
var v4 = STORE.verify('settest4', short);
ok(!v4.ok && /Question count/.test(v4.problems.join(' ')), '문항 수가 줄면 verify 가 잡는다 — ' + v4.problems.join(' '));

/* 5. 듣기 음원 경로가 빠진 경우 — 소리 없는 시험은 시험이 아니다. */
var withAudio = pack([0, 1, 2, 3]);
STORE.put('settest5', withAudio, {});
var noAudio = pack([0, 1, 2, 3]);
noAudio.sections[1].modules[0].blocks[0].audio = '';
storage._mem['sg2:set:settest5'] = JSON.stringify(noAudio);
var v5 = STORE.verify('settest5', withAudio);
ok(!v5.ok && /audio path/.test(v5.problems.join(' ')), '음원 경로가 빠지면 verify 가 잡는다 — ' + v5.problems.join(' '));

/* 6. 저장 자체가 안 되는 브라우저(시크릿 모드)에서는 성공이라 말하지 않는다. */
ok(!STORE.verify('never-saved', good).ok, '저장한 적 없는 코드는 검산을 통과하지 못한다');

if (fails) { console.error('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nALL PASS');
