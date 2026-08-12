/* SMEAG · StudyGround — exam-cloud.js
 * 목적: 응시 중 답안·커서·시계·체크포인트를 Supabase 에 실시간으로 올린다.
 *       기존 exam-sync.js 는 "교실 FastAPI 가 있을 때"의 경로다. 이 파일은 그 서버가
 *       없는 배포(Vercel + Supabase)에서도 답안이 학생 기기 밖에 남게 한다.
 * 의존 전역: window.SG_AUTH(토큰), window.SG_LDB(미전송 큐 · 없으면 메모리)
 * 노출 전역: window.SG_CLOUD
 *
 * 계약 — 이 파일은 시험을 절대 멈추지 않는다(F12).
 *   로그인이 없거나 네트워크가 죽어도 큐에만 쌓이고 화면은 그대로 간다.
 *   모든 쓰기는 멱등이다:
 *     attempt      upsert on (user_id, session)      ← 같은 세션이면 같은 행
 *     answers      upsert on (attempt_id, question_id)
 *     checkpoints  upsert on (attempt_id, step)
 *   그래서 재전송이 무해하고, 정전 뒤 켜서 다시 보내도 값이 겹쳐 쓰일 뿐이다.
 *
 * attempt id 는 클라이언트가 만든 uuid 다. 서버 왕복 없이 첫 답안부터 바로 실을 수
 * 있어야 하기 때문이다(교실 FastAPI 의 정수 PK 와 다른 점). 세션에 묶여 localStorage
 * 에 남으므로 새로고침·정전 뒤에도 같은 id 로 돌아온다.
 */
(function (root) {
  'use strict';

  var URL_ = 'https://qrmidnmlethqvdbmnyun.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFybWlkbm1sZXRocXZkYm1ueXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Mzg3NzQsImV4cCI6MjEwMTMxNDc3NH0.U2cprYXkpIS_1tSAiEjCFuHAztZRwIIK6DYCCowgxg4';
  var LS_ATTEMPT = 'sg2_cloud_attempt::';   // + session → uuid
  var PUSH_MS = 1000;                       // 답안 변경을 1초로 모아 보낸다
  var RETRY_MS = 4000;

  var cfg = { session: '', setCode: '', mode: '' };
  var attemptId = null;
  var attemptOpened = false;
  var dirty = {};            // qid -> true
  var pushTimer = null;
  var retryTimer = null;
  var sending = false;
  var listeners = [];
  var stats = { sent: 0, failed: 0, queued: 0, lastError: null, lastOkAt: 0 };

  function warn(m, e) { if (root.console && root.console.warn) root.console.warn('[SG_CLOUD] ' + m, e || ''); }
  function emit(type, data) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ type: type, data: data || {}, stats: snapshot() }); } catch (e) {}
    }
  }
  function snapshot() {
    return { sent: stats.sent, failed: stats.failed, queued: stats.queued,
             online: online(), attemptId: attemptId, lastOkAt: stats.lastOkAt };
  }
  function online() {
    var nav = root.navigator;
    return !nav || nav.onLine === undefined ? true : !!nav.onLine;
  }

  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) {} }

  /* uuid v4. crypto 가 있으면 그것을 쓰고, 없으면 Math.random 으로 만든다 —
     충돌해도 RLS 때문에 남의 행을 건드릴 수 없고, 실질 위험은 자기 세션끼리다. */
  function uuid() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === 'function') { try { return c.randomUUID(); } catch (e) {} }
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return s.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  /* ── HTTP ────────────────────────────────────────────────── */

  function token(cb) {
    var A = root.SG_AUTH;
    if (!A || typeof A.token !== 'function') { cb(null); return; }
    try {
      var p = A.token();
      if (p && typeof p.then === 'function') { p.then(function (t) { cb(t || null); }, function () { cb(null); }); return; }
      cb(p || null);
    } catch (e) { cb(null); }
  }

  /* PostgREST 한 방. prefer 로 upsert 를 지시한다. */
  function rest(method, path, body, prefer, cb) {
    token(function (t) {
      if (!t) { cb(new Error('no_session'), 0); return; }
      var headers = {
        'apikey': ANON,
        'Authorization': 'Bearer ' + t,
        'Content-Type': 'application/json',
        'Prefer': prefer || 'return=minimal'
      };
      var opts = { method: method, headers: headers, keepalive: true };
      if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
      var f = root.fetch;
      if (!f) { cb(new Error('no_fetch'), 0); return; }
      f(URL_ + '/rest/v1/' + path, opts).then(function (r) {
        if (r.ok) { cb(null, r.status); return; }
        r.text().then(function (txt) {
          var e = new Error('HTTP ' + r.status + ' ' + String(txt || '').slice(0, 200));
          e.status = r.status;
          cb(e, r.status);
        }, function () { cb(new Error('HTTP ' + r.status), r.status); });
      }, function (err) { cb(err || new Error('network'), 0); });
    });
  }

  /* 4xx 는 다시 보내도 같은 답이다 — 큐에서 버린다(401 은 예외: 토큰이 곧 갱신된다). */
  function permanent(status) {
    return status === 400 || status === 403 || status === 404 ||
           status === 409 || status === 413 || status === 422;
  }

  /* ── attempt 열기 ────────────────────────────────────────── */

  function start(opts, cb) {
    var o = opts || {};
    cfg.session = o.session || cfg.session;
    cfg.setCode = o.setCode || cfg.setCode;
    cfg.mode = o.mode || cfg.mode;
    if (!cfg.session) { if (cb) cb(new Error('no_session')); return null; }

    var k = LS_ATTEMPT + cfg.session;
    attemptId = lsGet(k);
    if (!attemptId) { attemptId = uuid(); lsSet(k, attemptId); }

    var row = {
      id: attemptId,
      session: cfg.session,
      set_code: cfg.setCode || '',
      started_at: new Date(o.startedAt || Date.now()).toISOString(),
      status: 'in_progress',
      client_created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
    // user_id 는 서버 기본값 auth.uid() 가 채운다 — 클라이언트가 정하지 않는다.
    rest('POST', 'toefl_attempts?on_conflict=id',
         [row], 'return=minimal,resolution=merge-duplicates', function (err) {
      if (err) {
        attemptOpened = false;
        stats.lastError = String(err.message || err);
        emit('offline', { reason: 'attempt_open', error: stats.lastError });
        // 실패해도 계속 간다 — 답안은 큐에 쌓이고 나중에 같은 id 로 올라간다.
        scheduleRetry();
      } else {
        attemptOpened = true;
        stats.lastOkAt = Date.now();
        emit('ready', { attemptId: attemptId });
        flushQueue();
      }
      if (cb) cb(err || null, attemptId);
    });
    return attemptId;
  }

  function id() { return attemptId; }
  function ready() { return attemptOpened; }

  /* ── 큐 (정전에도 살아남는다) ────────────────────────────── */

  function enqueue(kind, payload) {
    var item = { kind: kind, attemptId: attemptId, payload: payload, at: Date.now() };
    stats.queued += 1;
    if (root.SG_LDB && typeof root.SG_LDB.queuePush === 'function') {
      try { root.SG_LDB.queuePush(item); } catch (e) { warn('queuePush failed', e); }
    } else {
      memQueue.push({ id: 'm' + (memId += 1), item: item });
    }
    emit('queued', { kind: kind });
    scheduleRetry(200);
    return item;
  }

  var memQueue = [];
  var memId = 0;

  function allQueued(cb) {
    if (root.SG_LDB && typeof root.SG_LDB.queueAll === 'function') {
      root.SG_LDB.queueAll(function (err, list) { cb(err || null, list || []); });
      return;
    }
    cb(null, memQueue.slice());
  }

  function dropQueued(ids) {
    if (root.SG_LDB && typeof root.SG_LDB.queueDrop === 'function') {
      try { root.SG_LDB.queueDrop(ids); } catch (e) {}
      return;
    }
    memQueue = memQueue.filter(function (q) { return ids.indexOf(q.id) < 0; });
  }

  function endpointFor(item) {
    var p = item.payload;
    if (item.kind === 'answers') {
      return { method: 'POST', path: 'toefl_answers?on_conflict=attempt_id,question_id',
               body: p, prefer: 'return=minimal,resolution=merge-duplicates' };
    }
    if (item.kind === 'state') {
      return { method: 'PATCH', path: 'toefl_attempts?id=eq.' + item.attemptId, body: p, prefer: 'return=minimal' };
    }
    if (item.kind === 'checkpoint') {
      return { method: 'POST', path: 'toefl_checkpoints?on_conflict=attempt_id,step',
               body: [p], prefer: 'return=minimal,resolution=merge-duplicates' };
    }
    if (item.kind === 'submission') {
      return { method: 'POST', path: 'toefl_submissions?on_conflict=attempt_id,question_id',
               body: [p], prefer: 'return=minimal,resolution=merge-duplicates' };
    }
    return null;
  }

  /* 큐를 앞에서부터 하나씩 비운다. 순서를 지키는 이유는 state/checkpoint 가
     "나중 것이 이긴다"는 성질에 기대고 있어서다. */
  function flushQueue(cb) {
    if (sending || !online()) { if (cb) cb(); return; }
    allQueued(function (err, list) {
      if (err || !list.length) { stats.queued = 0; if (cb) cb(); return; }
      stats.queued = list.length;
      var q = list[0];
      var ep = endpointFor(q.item);
      if (!ep || !q.item.attemptId) { dropQueued([q.id]); if (cb) cb(); return; }
      sending = true;
      rest(ep.method, ep.path, ep.body, ep.prefer, function (e2, status) {
        sending = false;
        if (!e2) {
          dropQueued([q.id]);
          stats.sent += 1;
          stats.lastOkAt = Date.now();
          attemptOpened = true;
          emit('sent', { kind: q.item.kind });
          scheduleRetry(0);                     // 다음 항목으로 곧장
          if (cb) cb();
          return;
        }
        stats.failed += 1;
        stats.lastError = String(e2.message || e2);
        if (permanent(status)) {
          warn('버리는 항목: ' + q.item.kind + ' — ' + stats.lastError);
          dropQueued([q.id]);
          scheduleRetry(0);
        } else {
          emit('offline', { reason: q.item.kind, error: stats.lastError });
          scheduleRetry(RETRY_MS);
        }
        if (cb) cb(e2);
      });
    });
  }

  function scheduleRetry(ms) {
    if (retryTimer !== null) return;
    retryTimer = (root.setTimeout || setTimeout)(function () {
      retryTimer = null;
      flushQueue();
    }, ms === undefined ? RETRY_MS : ms);
  }

  /* ── 답안 · 상태 · 체크포인트 ────────────────────────────── */

  /* 답안은 "바뀌었다"고 표시만 하고 1초 뒤 한 번에 싣는다. 타이핑 한 글자마다
     왕복하면 교실 30대가 서버를 때린다. 로컬(IndexedDB·localStorage)에는 이미
     즉시 적혀 있으므로 이 1초는 정전 시 잃는 양이 아니라 "클라우드가 늦는 양"이다. */
  function markAnswer(qid) {
    if (!qid) return;
    dirty[qid] = true;
    if (pushTimer === null) {
      pushTimer = (root.setTimeout || setTimeout)(function () { pushTimer = null; pushAnswers(); }, PUSH_MS);
    }
  }

  function pushAnswers(answersMap) {
    if (pushTimer !== null) { (root.clearTimeout || clearTimeout)(pushTimer); pushTimer = null; }
    if (!attemptId) return null;
    var all = answersMap;
    if (!all) {
      try { all = (root.SG_STORE && root.SG_STORE.answers()) || {}; } catch (e) { all = {}; }
    }
    var rows = [], qid, rec;
    for (qid in dirty) {
      if (!dirty.hasOwnProperty(qid)) continue;
      rec = all[qid];
      if (!rec) continue;
      rows.push({
        attempt_id: attemptId,
        question_id: qid,
        section: rec.skill || rec.section || '',
        module: rec.module || '',
        q_no: typeof rec.no === 'number' ? rec.no : null,
        kind: rec.qtype || '',
        response: { v: rec.v === undefined ? null : rec.v },
        client_ts: rec.t || Date.now()
      });
    }
    dirty = {};
    if (!rows.length) return null;
    return enqueue('answers', rows);
  }

  function pushState(cursor, clocks, step) {
    if (!attemptId) return null;
    return enqueue('state', {
      cursor: cursor || {},
      clocks: clocks || {},
      step: typeof step === 'number' ? step : 0,
      last_seen_at: new Date().toISOString()
    });
  }

  function pushCheckpoint(entry) {
    if (!attemptId || !entry) return null;
    return enqueue('checkpoint', {
      attempt_id: attemptId,
      step: entry.step || 0,
      screen_id: entry.screenId || '',
      screen_index: entry.screenIndex || 0,
      phase_index: entry.phaseIndex || 0,
      section: entry.section || '',
      cursor: entry.cursor || {},
      clocks: entry.clocks || {},
      answers: entry.answers || {},
      client_ts: entry.ts || Date.now()
    });
  }

  function markSubmitted(extra) {
    if (!attemptId) return null;
    var patch = { status: 'submitted', submitted_at: new Date().toISOString() };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) patch[k] = extra[k]; } }
    pushAnswers();
    return enqueue('state', patch);
  }

  /* 서버에 남은 체크포인트를 읽어 온다 — 학생이 다른 기기에서 켰거나 로컬이
     날아갔을 때의 마지막 보루다. */
  function fetchCheckpoints(cb) {
    if (!attemptId) { cb(new Error('no_attempt'), []); return; }
    token(function (t) {
      if (!t || !root.fetch) { cb(new Error('no_session'), []); return; }
      root.fetch(URL_ + '/rest/v1/toefl_checkpoints?attempt_id=eq.' + attemptId + '&order=step.asc', {
        headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + t }
      }).then(function (r) {
        if (!r.ok) { cb(new Error('HTTP ' + r.status), []); return; }
        r.json().then(function (j) { cb(null, j || []); }, function () { cb(null, []); });
      }, function (e) { cb(e, []); });
    });
  }

  /* 세션이 끝났을 때만 부른다 — 다음 응시가 같은 attempt 로 붙지 않도록. */
  function reset(session) {
    lsDel(LS_ATTEMPT + (session || cfg.session));
    attemptId = null;
    attemptOpened = false;
    dirty = {};
  }

  /* ── 창 생명주기 ─────────────────────────────────────────── */

  if (root.addEventListener) {
    root.addEventListener('online', function () { emit('online', {}); scheduleRetry(0); });
    root.addEventListener('offline', function () { emit('offline', { reason: 'navigator' }); });
    // 탭이 숨거나 닫힐 때 남은 답안을 즉시 큐로 밀어 넣는다. keepalive 로 보낸다.
    root.addEventListener('visibilitychange', function () {
      if (root.document && root.document.visibilityState === 'hidden') { pushAnswers(); flushQueue(); }
    });
    root.addEventListener('pagehide', function () { pushAnswers(); flushQueue(); });
  }

  root.SG_CLOUD = {
    start: start, id: id, ready: ready, reset: reset,
    markAnswer: markAnswer, pushAnswers: pushAnswers,
    pushState: pushState, pushCheckpoint: pushCheckpoint,
    markSubmitted: markSubmitted,
    fetchCheckpoints: fetchCheckpoints,
    flush: flushQueue, stats: snapshot,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    // 테스트 훅
    _rest: rest, _permanent: permanent, _uuid: uuid
  };
})(typeof window !== 'undefined' ? window : this);
