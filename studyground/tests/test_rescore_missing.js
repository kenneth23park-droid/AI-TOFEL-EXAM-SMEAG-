/* "아직 채점 전" 은 다시 의뢰된다 — SG_RESULTS.unscored / scoreMissing 검증.
 *
 * 왜 이 테스트가 있는가
 *   제출 순간의 채점은 끊길 수 있다(서버리스 실행시간 상한, 키 미설정, 오프라인).
 *   예전 push() 는 새 응시이거나 녹음이 방금 올라간 응시만 채점을 걸었기 때문에,
 *   그렇게 끊긴 응시는 영영 "아직 채점 전" 으로 남았다 — 아무도 그 사실을 몰랐다.
 *   지금은 화면을 여는 것만으로 못 매긴 과제만 골라 다시 의뢰하고, 결과는 서버가
 *   sg_task_scores 에 쓴다. 그 계약이 깨지면 여기서 잡는다.
 *
 *   함께 지키는 것: 이미 매겨진 과제는 다시 보내지 않는다(돈), 교사가 확정한 행은
 *   건드리지 않는다, 그리고 자동 의뢰는 응시당 고삐가 있다(녹음이 없는 응시를 열
 *   때마다 전사·채점을 다시 사지 않기 위한 것).
 *
 * 실행: node studyground/tests/test_rescore_missing.js
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

/* ── 브라우저 대역 ───────────────────────────────────────────────────────
 * 응시 한 건은 **이미 서버에 있다**(새 응시가 아니다). W·S 네 과제 중
 *   W1 = AI 초안 있음        → 다시 보내지 않는다
 *   W2 = 교사 확정           → 건드리지 않는다
 *   S1 = ai_score 없이 오류만 → 다시 보낸다 (모델이 실패한 자리다)
 *   S2 = 행 자체가 없음       → 다시 보낸다 (채점이 아예 안 걸린 자리다)
 */

var SESSION = 's-old-1';
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
      { q: { id: 'set9-R1-q01', kind: 'mcq', answer: 'A' } }
    ];
  }
};

var TASK_ROWS = [
  { session: SESSION, question_id: 'set9-W1-q01', ai_score: 4, teacher_score: null, confirmed_at: null },
  { session: SESSION, question_id: 'set9-W2-q01', ai_score: null, teacher_score: 3,
    confirmed_at: '2026-08-12T00:00:00Z' },
  { session: SESSION, question_id: 'set9-S1-q01', ai_score: null, teacher_score: null,
    confirmed_at: null, ai_error: 'the model did not return a usable score' }
];

var calls = [];            // /api/score 로 나간 요청 본문

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
      return jsonRes({
        scored: (body.tasks || []).map(function (t) {
          return { question_id: t.question_id, skill: t.skill, score: 4 };
        }),
        skipped: []
      });
    }
    if (String(url).indexOf('/storage/') >= 0) return jsonRes([]);
    if (String(url).indexOf('sg_task_scores') >= 0) return jsonRes(TASK_ROWS);
    if (String(url).indexOf('sg_results') >= 0) {
      // 이 응시는 이미 서버에 있다 — 그래서 "새 응시" 길로 가지 않는다.
      return jsonRes(init && init.method === 'POST' ? null
                                                    : [{ session: SESSION, set_code: 'SET9' }]);
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

var ROW = { session: SESSION, set_code: 'SET9', answers: {} };

/* ── 1) 무엇이 "아직 채점 전" 인가 ────────────────────────────────────── */

console.log('아직 점수가 없는 과제 고르기');
var todo = SG_RESULTS.unscored(ROW, TASK_ROWS);
var ids = todo.map(function (t) { return t.question_id; }).sort();
ok(ids.length === 2, '점수가 없는 과제만 두 건 (얻은 값 ' + ids.length + ': ' + ids.join(', ') + ')');
ok(ids.indexOf('set9-S1-q01') >= 0, 'ai_error 만 있고 점수가 없는 행은 다시 매길 자리다');
ok(ids.indexOf('set9-S2-q01') >= 0, '행이 아예 없는 과제도 다시 매길 자리다');
ok(ids.indexOf('set9-W1-q01') < 0, '이미 AI 초안이 있는 과제는 다시 보내지 않는다');
ok(ids.indexOf('set9-W2-q01') < 0, '교사가 확정한 과제는 건드리지 않는다');

/* ── 2) 못 매긴 것만 다시 의뢰한다 ───────────────────────────────────── */

console.log('scoreMissing()');
SG_RESULTS.scoreMissing(ROW, { taskRows: TASK_ROWS }).then(function (out) {
  ok(calls.length === 1, '한 번의 요청으로 나간다 (얻은 값 ' + calls.length + ')');
  var sent = (calls[0] && calls[0].tasks || []).map(function (t) { return t.question_id; }).sort();
  ok(sent.join(',') === 'set9-S1-q01,set9-S2-q01',
     '보낸 과제는 점수가 없는 둘뿐이다 (얻은 값 ' + sent.join(',') + ')');
  ok(calls[0] && calls[0].force !== true, 'force 는 쓰지 않는다 — 재채점이 아니라 미채점 채우기다');
  ok(out && out.missing === 2, '몇 개가 비어 있었는지 돌려준다 (얻은 값 ' + (out && out.missing) + ')');

  /* ── 3) 다 매겨진 응시는 아무 요청도 하지 않는다 ────────────────────── */
  console.log('이미 다 매겨진 응시');
  var full = TASK_ROWS.concat([
    { session: SESSION, question_id: 'set9-S2-q01', ai_score: 3, teacher_score: null, confirmed_at: null },
    { session: SESSION, question_id: 'set9-S1-q01', ai_score: 2, teacher_score: null, confirmed_at: null }
  ]);
  var before = calls.length;
  return SG_RESULTS.scoreMissing(ROW, { taskRows: full }).then(function (o2) {
    ok(calls.length === before, '보낼 것이 없으면 서버를 부르지 않는다');
    ok(o2 && o2.missing === 0, 'missing 0 으로 돌아온다');

    /* ── 4) push() 는 예전 응시의 빈 자리를 메운다 ─────────────────────── */
    console.log('push() — 예전 응시의 빈 자리');
    calls.length = 0;
    return SG_RESULTS.push().then(function () {
      ok(calls.length === 1,
         '새 응시가 아니어도 못 매긴 과제를 다시 의뢰한다 (얻은 값 ' + calls.length + ')');

      /* ── 5) 고삐 — 곧바로 또 열어도 다시 사지 않는다 ─────────────────── */
      console.log('자동 의뢰의 고삐');
      calls.length = 0;
      return SG_RESULTS.push().then(function () {
        ok(calls.length === 0,
           '같은 응시를 곧바로 또 열면 자동 의뢰는 걸리지 않는다 (얻은 값 ' + calls.length + ')');

        // 사람이 누른 요청(auto 없음)은 그 고삐를 지나친다.
        calls.length = 0;
        return SG_RESULTS.scoreMissing(ROW, { taskRows: TASK_ROWS }).then(function () {
          ok(calls.length === 1, '버튼으로 부른 요청은 고삐와 무관하게 나간다');
          console.log(fails ? '\nFAILED ' + fails + '건' : '\n모두 통과');
          process.exit(fails ? 1 : 0);
        });
      });
    });
  });
})['catch'](function (e) {
  console.error('예외: ' + (e && e.stack || e));
  process.exit(1);
});
