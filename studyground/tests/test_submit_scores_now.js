/* 제출하면 그 자리에서 채점한다 — SG_RESULTS.push({waitScore}) 검증.
 *
 * 왜 이 테스트가 있는가
 *   예전 push() 는 AI 채점을 걸어만 두고(fire-and-forget) 곧바로 끝났다. 제출
 *   화면이 그 promise 를 기다리지 않으니 학생이 창을 닫으면 요청이 중간에 끊겨
 *   W·S 가 반만 채점되곤 했다. 지금은 제출 직후 화면만 waitScore 로 끝까지
 *   기다리고 진행(몇/몇)을 받는다. 그 계약이 깨지면 여기서 잡는다.
 *
 * 실행: node studyground/tests/test_submit_scores_now.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'sg2', 'assets', 'sg-results.js');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}

/* ── 브라우저 대역 ────────────────────────────────────────────────────────
 * 로컬 응시 한 건(SET9, 아직 서버에 없음)과 토큰이 있는 로그인 상태를 세운다.
 * 팩은 productive() 가 W·S 과제를 뽑을 수 있을 만큼만 흉내 낸다. */

var SESSION = 's-test-1';
var STORAGE = {};
STORAGE['sg2_attempt::' + SESSION + '::meta'] =
  JSON.stringify({ session: SESSION, setCode: 'SET9', submittedAt: 1754870000000 });
STORAGE['sg2_attempt::' + SESSION + '::answers'] =
  JSON.stringify({ 'set9-W1-q01': { v: 'Dear Sir, ...' } });

var PACK = {
  code: 'SET9',
  allQuestions: function () {
    return [
      { q: { id: 'set9-W1-q01', kind: 'email', prompt: 'Write an email.' } },
      { q: { id: 'set9-W2-q01', kind: 'discussion', prompt: 'Join the discussion.' } },
      { q: { id: 'set9-S1-q01', kind: 'repeat', reference: 'I wanted to know.' } },
      { q: { id: 'set9-S2-q01', kind: 'interview', prompt: 'Tell me about...' } },
      { q: { id: 'set9-R1-q01', kind: 'mcq', answer: 'A' } }   // 자동채점 — 목록에 없어야 한다
    ];
  }
};

var calls = [];            // /api/score 로 나간 요청 본문
var scoreDone = false;     // 마지막 채점 응답이 돌아왔는가

/* PostgREST 흉내. 쓰기(return=minimal)는 성공해도 본문이 비어 있다 —
 * 그 자리를 json() 으로 읽으면 터진다는 것이 이 스텁의 요점이다. */
function res(text) {
  return Promise.resolve({
    ok: true,
    text: function () { return Promise.resolve(text); },
    json: function () {
      return text ? Promise.resolve(JSON.parse(text))
                  : Promise.reject(new Error('Unexpected end of JSON input'));
    }
  });
}
function jsonRes(body) { return res(body === null ? '' : JSON.stringify(body)); }

var sandbox = {
  console: console,
  setTimeout: setTimeout,
  Promise: Promise,
  JSON: JSON,
  Date: Date,
  Object: Object,
  fetch: function (url, init) {
    var body = init && init.body ? JSON.parse(init.body) : null;
    if (String(url).indexOf('/api/score') >= 0) {
      calls.push(body);
      // 마지막 묶음은 한 틱 늦게 돌려준다 — 안 기다리면 push() 가 먼저 끝나 버린다.
      return new Promise(function (resolve) {
        setTimeout(function () {
          scoreDone = true;
          resolve(jsonRes({
            scored: (body.tasks || []).map(function (t) {
              return { question_id: t.question_id, skill: t.skill, score: 4 };
            }),
            skipped: []
          }));
        }, 0);
      });
    }
    if (String(url).indexOf('/storage/') >= 0) return jsonRes([]);
    if (String(url).indexOf('sg_results') >= 0) {
      // GET 은 "서버에 아무 것도 없다", POST(업로드)는 빈 본문이다.
      return jsonRes(init && init.method === 'POST' ? null : []);
    }
    return jsonRes([]);
  },
  localStorage: {
    length: 0,
    key: function (i) { return Object.keys(STORAGE)[i]; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(STORAGE, k) ? STORAGE[k] : null; },
    setItem: function (k, v) { STORAGE[k] = String(v); }
  }
};
Object.defineProperty(sandbox.localStorage, 'length', {
  get: function () { return Object.keys(STORAGE).length; }
});
sandbox.window = sandbox;
sandbox.SMEAG_SET9 = PACK;
sandbox.SG_AUTH = {
  url: 'https://db.test', anonKey: 'anon',
  user: function () { return { id: 'u-1' }; },
  token: function () { return Promise.resolve('tok'); }
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'sg-results.js' });
var SG_RESULTS = sandbox.SG_RESULTS;

/* ── 1) 채점 대상 고르기 ──────────────────────────────────────────────── */

console.log('채점 대상');
var list = SG_RESULTS.productive({ set_code: 'SET9' });
ok(list.length === 4, 'W·S 네 과제만 오른다 (얻은 값 ' + list.length + ')');
ok(list.every(function (t) { return t.question_id.indexOf('-R') < 0; }),
   '자동채점 문항(R)은 AI 채점에 들어가지 않는다');

/* ── 2) 제출 직후: 채점을 끝까지 기다린다 ─────────────────────────────── */

console.log('제출 직후 push({session, waitScore:true})');
var seen = [];
/* session 을 지목해서 부른다 — 제출 화면이 그렇게 부른다(exam-shell.js).
   지목이 곧 "이 시험은 지금 이 학생 것"이라는 사람의 확인이고, 그것이 없으면
   push() 는 주인이 박히지 않은 응시를 올리지 않는다(§uploadable). 아래 3) 이
   그 거절을 따로 확인한다. */
SG_RESULTS.push({
  session: SESSION,
  waitScore: true,
  onProgress: function (done, total) { seen.push(done + '/' + total); }
}).then(function (r) {
  ok(scoreDone, '채점이 끝난 뒤에 resolve 된다 (안 기다리면 여기서 걸린다)');
  ok(r && r.scored && (r.scored.scored || []).length === 4,
     '채점 결과 네 건을 돌려준다 (얻은 값 ' +
     ((r && r.scored && (r.scored.scored || []).length) || 0) + ')');
  ok(calls.length === 2, '과제 4개는 3개씩 두 묶음으로 나가 함수 실행시간 상한을 넘지 않는다 ' +
     '(얻은 값 ' + calls.length + ')');
  ok(seen[0] === '0/4' && seen[seen.length - 1] === '4/4',
     '진행을 0/4 로 열고 4/4 로 닫는다 (얻은 값 ' + JSON.stringify(seen) + ')');

  /* ── 3) 지목도 없고 주인도 안 박힌 응시는 올리지 않는다 ─────────────
   *
   * 공용 시험 PC 의 localStorage 에는 앞 학생들의 응시가 남는다. 예전에는
   * 대시보드를 여는 것만으로 그것이 지금 로그인한 학생 앞으로 올라갔다 —
   * 2026-08-27 에 세션 60개가 여러 학생에게 걸쳐 있었고 한 세션은 11명이
   * 주인이었다. 이 자리가 그 길을 막는다. */
  return SG_RESULTS.push({ waitScore: true }).then(function (r2) {
    ok(r2 && r2.sent === 0,
       '지목 없이 부르면 주인 없는 응시는 올리지 않는다 (얻은 값 ' +
       ((r2 && r2.sent) || 0) + ')');

    console.log(fails ? '\nFAILED ' + fails + '건' : '\n모두 통과');
    process.exit(fails ? 1 : 0);
  });
})['catch'](function (e) {
  console.error('예외: ' + (e && e.stack || e));
  process.exit(1);
});
