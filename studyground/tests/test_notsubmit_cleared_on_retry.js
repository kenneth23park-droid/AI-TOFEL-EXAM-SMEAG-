/* 늦게 성공한 녹음은 NOT SUBMIT 을 지운다 — node 전용.
 * 실행: node "studyground/tests/test_notsubmit_cleared_on_retry.js"
 *
 * 2026-09-02 SET 11 응시(offline-a4680a97…)에서 드러난 일.
 *   마이크가 처음 안 열리면 화면은 그 자리에서 NOT SUBMIT 을 적는다
 *   (exam-render-speaking.markNotSubmit). 포기하는 게 아니라, 응답 시간이 남아
 *   있는 동안 조용히 재시도한다(startRecording). q05 는 그 재시도가 성공해서
 *   3.87초짜리 녹음이 IndexedDB 에 앉고 버킷까지 올라갔다.
 *
 *   그런데 답안에는 notSubmit:true 가 그대로 남아 있었다. upsertAnswer 는 키를
 *   덮어쓸 뿐 지우지 않는데, putMedia 가 되돌린다고 말하지 않았기 때문이다.
 *   그래서 api/score.js 는 버킷에 멀쩡한 녹음을 두고도 전사를 건너뛰고
 *   "No response was recorded (NOT SUBMIT)" 로 0 점을 박았다.
 *
 * 여기서 고정하는 성질.
 *  [1] 녹음이 저장되면 그 문항의 notSubmit·reason 이 내려간다.
 *  [2] 그 답안을 api/score.js 는 더 이상 미제출로 보지 않는다.
 *  [3] 녹음이 끝내 없는 문항의 NOT SUBMIT 은 그대로 남는다(되돌리기가 번지지 않는다).
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

var fails = [];
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}
function eq(name, actual, expected) {
  var good = actual === expected;
  console.log((good ? '  ok   ' : '  FAIL ') + name + ': ' + JSON.stringify(actual) +
              (good ? '' : ' — expected ' + JSON.stringify(expected)));
  if (!good) fails.push(name);
}

/* ── 가짜 브라우저 ───────────────────────────────────────────── */

var ls = {};
global.localStorage = {
  getItem: function (k) { return ls.hasOwnProperty(k) ? ls[k] : null; },
  setItem: function (k, v) { ls[k] = String(v); },
  removeItem: function (k) { delete ls[k]; },
  key: function (i) { return Object.keys(ls)[i]; },
  get length() { return Object.keys(ls).length; }
};

/* IndexedDB 는 put 이 성공했다고만 말하면 된다 — 여기서 보는 것은 답안 쪽이다. */
var kept = {};
global.indexedDB = {
  open: function () {
    var req = { result: null, error: null };
    req.result = {
      objectStoreNames: { contains: function () { return true; } },
      createObjectStore: function () {},
      transaction: function () {
        var tx = {
          objectStore: function () {
            return { put: function (blob, key) { kept[key] = blob; } };
          }
        };
        setImmediate(function () { if (tx.oncomplete) tx.oncomplete(); });
        return tx;
      }
    };
    setImmediate(function () { if (req.onsuccess) req.onsuccess(); });
    return req;
  }
};

eval(fs.readFileSync(path.join(SG2, 'assets/exam-store.js'), 'utf8'));
var S = window.SG_STORE;

/* api/score.js 가 미제출을 판정하는 그 함수. 두 벌로 갈라지지 않도록 원문을 옮긴다.
   (score.js 는 Vercel 핸들러라 통째로 require 하면 환경변수를 요구한다.) */
var scoreSrc = fs.readFileSync(path.join(SG2, 'api/score.js'), 'utf8');
ok('score.js 는 여전히 notSubmit 으로 전사를 건너뛴다(이 테스트의 전제)',
   /function isNotSubmit\(rec\)\s*\{\s*return !!\(rec && typeof rec === 'object' && rec\.notSubmit\);/.test(scoreSrc));
function isNotSubmit(rec) {
  return !!(rec && typeof rec === 'object' && rec.notSubmit);
}

function settle() { return new Promise(function (r) { setImmediate(r); }); }

async function main() {
  S.open('offline-test', true);

  /* ── [1] 마이크 실패 → 재시도 성공 ───────────────────────── */
  console.log('\n[1] 마이크가 늦게 열린 문항');

  // 화면이 즉시 적는 것(exam-render-speaking.markNotSubmit 과 같은 모양)
  S.upsertAnswer('S1-q05', 'NOT SUBMIT',
                 { notSubmit: true, recorded: false, media: '', reason: 'denied' });
  eq('일단 미제출로 적힌다', S.getAnswer('S1-q05').notSubmit, true);

  // 재시도가 성공해 녹음이 안착한다
  await new Promise(function (done) {
    S.putMedia('S1-q05', {
      blob: { size: 62120, type: 'audio/webm;codecs=opus' },
      mime: 'audio/webm;codecs=opus', durationMs: 3870, peak: 0.056
    }, done);
  });
  await settle();

  var q5 = S.getAnswer('S1-q05');
  eq('미제출 표시가 내려간다', q5.notSubmit, false);
  eq('이유도 지워진다', q5.reason, '');
  eq('녹음됨으로 바뀐다', q5.recorded, true);
  eq('답안 값은 녹음 참조', q5.v, 'idb:S1-q05');
  eq('길이는 남는다', q5.durationMs, 3870);
  eq('용량은 남는다', q5.bytes, 62120);

  /* ── [2] 채점기가 보는 눈 ─────────────────────────────────── */
  console.log('\n[2] api/score.js 는 이제 전사하러 간다');
  eq('미제출이 아니다', isNotSubmit(q5), false);

  /* ── [3] 번지지 않는다 ───────────────────────────────────── */
  console.log('\n[3] 끝내 녹음이 없는 문항');

  S.upsertAnswer('S1-q04', 'NOT SUBMIT',
                 { notSubmit: true, recorded: false, media: '', reason: 'denied' });
  await settle();
  var q4 = S.getAnswer('S1-q04');
  eq('NOT SUBMIT 그대로', q4.notSubmit, true);
  eq('이유 그대로', q4.reason, 'denied');
  eq('채점기도 미제출로 본다', isNotSubmit(q4), true);

  console.log('');
  if (fails.length) {
    console.log('FAILED (' + fails.length + '): ' + fails.join(', '));
    process.exit(1);
  }
  console.log('all passed');
}

main().catch(function (e) { console.error(e); process.exit(1); });
