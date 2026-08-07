/* SMEAG · StudyGround — exam-sync.js
 * 목적: architecture.md §7.1 응시자 런타임 API 클라이언트.
 *       오프라인 우선 — 모든 쓰기는 SG_STORE 아웃박스에 먼저 쌓이고, 네트워크가
 *       살아있을 때만 지수 백오프로 비워진다. 어떤 실패도 시험을 멈추지 않는다(F12).
 * 의존 전역: window.SG_STORE (outbox/enqueue/dropFromOutbox/getMedia/meta)
 * 노출 전역: window.SG_SYNC
 *
 * 아웃박스 계약(exam-store.js 실측): enqueue(kind, payload) -> seq,
 *   outbox() -> [{seq, kind, payload, at}], dropFromOutbox([seq...]).
 * kind: 'state' | 'answers' | 'media' | 'events' | 'submit'
 * 전송 순서는 seq 오름차순 그대로다 — 서버의 (attempt_id, question_key) upsert 덕분에
 * 중복 전송은 무해하고, client_seq 로 역전만 걸러진다.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    baseUrl: '',              // 같은 오리진이면 빈 문자열
    attemptId: null,
    session: '',
    timeoutMs: 15000,
    baseDelayMs: 1000,        // 1s → 2s → 4s → 8s (지수 백오프)
    maxDelayMs: 60000,
    maxRetries: 3             // Story 3.3 AC4: 미디어는 3회 실패 시 포기(NOT SUBMIT)
  };

  var cfg = {};
  var flushing = false;
  var timer = null;
  var attemptSeq = 0;         // 서버로 보낼 client_seq (역전 감지용)
  var failures = {};          // seq -> 연속 실패 횟수
  var dropped = {};           // 포기한 항목 (kind 별 카운트)
  var listeners = [];

  function assign(target, src) {
    var k;
    for (k in src) { if (src.hasOwnProperty(k)) target[k] = src[k]; }
    return target;
  }

  function configure(options) {
    cfg = assign(assign({}, DEFAULTS), options || {});
    return cfg;
  }

  configure({});

  function on(fn) { if (typeof fn === 'function') listeners.push(fn); }

  // 상태 브로드캐스트. 렌더러가 'n / 11 uploaded' 를 그릴 수 있게 한다(Story 3.3 AC5).
  function emit(type, data) {
    var i, payload = assign({ type: type }, data || {});
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](payload); } catch (e) { warn('sync listener failed', e); }
    }
  }

  function warn(message, err) {
    if (root.console && root.console.warn) root.console.warn('[SG_SYNC] ' + message, err || '');
  }

  function store() { return root.SG_STORE || null; }

  function online() {
    var nav = root.navigator;
    return !nav || nav.onLine === undefined ? true : !!nav.onLine;
  }

  /* ── HTTP (XMLHttpRequest — fetch 없는 환경도 지원) ─────────── */

  function request(method, path, body, cb) {
    var xhr;
    try { xhr = new root.XMLHttpRequest(); } catch (e) { cb(e, null, 0); return; }
    var url = (cfg.baseUrl || '') + path;
    var done = false;

    function finish(err, data, status) {
      if (done) return;
      done = true;
      cb(err, data, status);
    }

    try { xhr.open(method, url, true); } catch (e2) { finish(e2, null, 0); return; }
    xhr.timeout = cfg.timeoutMs;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var status = xhr.status || 0;
      var data = null;
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText); } catch (e3) { data = null; }
      }
      // 2xx 는 성공. 4xx 는 재시도해도 같은 답이므로 "영구 실패"로 분류한다.
      if (status >= 200 && status < 300) finish(null, data, status);
      else finish(new Error('HTTP ' + status), data, status);
    };
    xhr.ontimeout = function () { finish(new Error('timeout'), null, 0); };
    xhr.onerror = function () { finish(new Error('network'), null, 0); };

    try { xhr.send(body === undefined || body === null ? null : JSON.stringify(body)); }
    catch (e4) { finish(e4, null, 0); }
  }

  function permanent(status) {
    // 404/409/413/415/422 는 재시도가 무의미하다 — 큐에서 버린다.
    return status === 400 || status === 404 || status === 409 ||
           status === 413 || status === 415 || status === 422;
  }

  /* ── 시작 / 재개 ───────────────────────────────────────────── */

  // 서버가 살아 있으면 attemptId 를 받아오고, 아니면 오프라인으로 그냥 진행한다.
  function startAttempt(payload, cb) {
    request('POST', '/api/attempts', payload, function (err, data, status) {
      if (!err && data && data.attempt_id) {
        cfg.attemptId = data.attempt_id;
        cfg.session = data.session || cfg.session;
        var s = store();
        if (s && typeof s.patchMeta === 'function') {
          try { s.patchMeta({ attemptId: data.attempt_id, session: data.session, resumed: !!data.resume }); }
          catch (e) { warn('patchMeta failed', e); }
        }
        emit('attempt', { attemptId: data.attempt_id, resume: !!data.resume });
      } else {
        emit('offline', { reason: 'start_failed', status: status });
      }
      if (cb) cb(err, data, status);
    });
  }

  function attemptId() { return cfg.attemptId; }

  function setAttemptId(id) { cfg.attemptId = id; return cfg.attemptId; }

  /* ── 큐잉 (시험 진행을 막지 않는 유일한 쓰기 경로) ─────────── */

  function enqueue(kind, payload) {
    var s = store();
    if (!s || typeof s.enqueue !== 'function') { warn('SG_STORE outbox unavailable; dropping ' + kind); return null; }
    var seq = null;
    try { seq = s.enqueue(kind, payload); } catch (e) { warn('enqueue failed', e); }
    emit('queued', { kind: kind, seq: seq, pending: pending() });
    schedule(0);
    return seq;
  }

  function queueState(cursor, clocks) {
    return enqueue('state', { cursor: cursor || {}, clocks: clocks || {} });
  }

  function queueAnswers(items) {
    attemptSeq += 1;
    return enqueue('answers', { items: items || [], client_seq: attemptSeq });
  }

  // Blob 은 IndexedDB 에 있고 아웃박스에는 참조만 담는다(§5.2).
  function queueMedia(questionKey, opts) {
    var o = opts || {};
    return enqueue('media', {
      question_key: questionKey,
      qid: o.qid || questionKey,
      mime: o.mime || 'audio/webm',
      duration_ms: o.durationMs || 0,
      data_b64: o.dataB64 || ''
    });
  }

  function queueEvents(events) { return enqueue('events', { events: events || [] }); }

  function queueSubmit(payload) { return enqueue('submit', payload || {}); }

  function pending() {
    var s = store();
    if (!s || typeof s.outbox !== 'function') return 0;
    try { return s.outbox().length; } catch (e) { return 0; }
  }

  function stats() {
    var s = store(), q = [], counts = {}, i;
    if (s && typeof s.outbox === 'function') { try { q = s.outbox(); } catch (e) { q = []; } }
    for (i = 0; i < q.length; i++) counts[q[i].kind] = (counts[q[i].kind] || 0) + 1;
    return { pending: q.length, byKind: counts, dropped: assign({}, dropped), online: online() };
  }

  /* ── Blob → base64 (미디어 업로드 직전에만 수행) ───────────── */

  function blobToBase64(blob, cb) {
    var reader;
    try { reader = new root.FileReader(); } catch (e) { cb(e, null); return; }
    reader.onloadend = function () {
      var out = String(reader.result || '');
      var comma = out.indexOf(',');
      cb(null, comma >= 0 ? out.slice(comma + 1) : out);
    };
    reader.onerror = function () { cb(reader.error || new Error('read failed'), null); };
    try { reader.readAsDataURL(blob); } catch (e2) { cb(e2, null); }
  }

  function withMediaBody(item, cb) {
    var p = item.payload || {};
    if (p.data_b64) { cb(null, p); return; }
    var s = store();
    if (!s || typeof s.getMedia !== 'function') { cb(new Error('no media store'), null); return; }
    s.getMedia(p.qid || p.question_key, function (err, blob) {
      if (err || !blob) { cb(err || new Error('recording missing'), null); return; }
      blobToBase64(blob, function (err2, b64) {
        if (err2) { cb(err2, null); return; }
        cb(null, {
          question_key: p.question_key, mime: p.mime || blob.type || 'audio/webm',
          duration_ms: p.duration_ms || 0, data_b64: b64
        });
      });
    });
  }

  /* ── 아웃박스 플러시 (순차 · 지수 백오프) ──────────────────── */

  function endpoint(kind) {
    var id = cfg.attemptId;
    if (kind === 'state') return { method: 'PUT', path: '/api/attempts/' + id + '/state' };
    if (kind === 'answers') return { method: 'POST', path: '/api/attempts/' + id + '/answers' };
    if (kind === 'media') return { method: 'POST', path: '/api/attempts/' + id + '/media' };
    if (kind === 'events') return { method: 'POST', path: '/api/attempts/' + id + '/events' };
    if (kind === 'submit') return { method: 'POST', path: '/api/attempts/' + id + '/submit' };
    return null;
  }

  function delayFor(tries) {
    var d = cfg.baseDelayMs * Math.pow(2, Math.max(0, tries - 1));
    if (d > cfg.maxDelayMs) d = cfg.maxDelayMs;
    // 지터 — 교실 30대가 동시에 재시도해 서버를 때리지 않게 한다.
    return Math.round(d * (0.75 + Math.random() * 0.5));
  }

  function drop(seq, kind, reason) {
    var s = store();
    if (s && typeof s.dropFromOutbox === 'function') {
      try { s.dropFromOutbox([seq]); } catch (e) { warn('dropFromOutbox failed', e); }
    }
    delete failures[seq];
    if (reason !== 'sent') dropped[kind] = (dropped[kind] || 0) + 1;
    emit(reason === 'sent' ? 'sent' : 'gaveup',
         { kind: kind, seq: seq, reason: reason, pending: pending() });
  }

  function schedule(ms) {
    if (timer !== null) return;
    timer = (root.setTimeout || setTimeout)(function () { timer = null; flush(); }, ms || 0);
  }

  function flush(cb) {
    if (flushing) { if (cb) cb(null, stats()); return; }
    var s = store();
    if (!s || typeof s.outbox !== 'function') { if (cb) cb(null, stats()); return; }
    if (!cfg.attemptId || !online()) { if (cb) cb(null, stats()); return; }

    var queue = [];
    try { queue = s.outbox(); } catch (e) { queue = []; }
    if (!queue.length) { if (cb) cb(null, stats()); return; }

    flushing = true;
    var item = queue[0];
    var ep = endpoint(item.kind);
    if (!ep) { drop(item.seq, item.kind, 'unknown_kind'); flushing = false; schedule(0); if (cb) cb(null, stats()); return; }

    function send(body) {
      request(ep.method, ep.path, body, function (err, data, status) {
        flushing = false;
        if (!err) {
          drop(item.seq, item.kind, 'sent');
          schedule(0);                       // 다음 항목으로 즉시 진행
          if (cb) cb(null, stats());
          return;
        }
        var tries = (failures[item.seq] = (failures[item.seq] || 0) + 1);
        if (permanent(status) || tries >= cfg.maxRetries) {
          // 3회(또는 영구 오류) — 포기한다. Speaking 은 서버에 행이 남지 않아
          // 관리자 화면에서 'NOT SUBMIT' 으로 보인다(Story 3.3 AC4).
          drop(item.seq, item.kind, permanent(status) ? 'rejected_' + status : 'max_retries');
          schedule(delayFor(1));
        } else {
          emit('retry', { kind: item.kind, seq: item.seq, tries: tries, status: status });
          schedule(delayFor(tries));
        }
        if (cb) cb(err, stats());
      });
    }

    if (item.kind === 'media') {
      withMediaBody(item, function (err, body) {
        if (err) {
          flushing = false;
          var tries = (failures[item.seq] = (failures[item.seq] || 0) + 1);
          if (tries >= cfg.maxRetries) drop(item.seq, item.kind, 'recording_unavailable');
          schedule(delayFor(tries));
          if (cb) cb(err, stats());
          return;
        }
        send(body);
      });
      return;
    }

    send(item.payload);
  }

  /* ── 온라인 복귀 훅 ────────────────────────────────────────── */

  function attach() {
    if (!root.addEventListener) return;
    root.addEventListener('online', function () { emit('online', {}); schedule(0); });
    root.addEventListener('offline', function () { emit('offline', { reason: 'navigator' }); });
  }
  attach();

  /* ── 오프라인 최후수단: 답안 JSON 내보내기 (Story 3.2 AC8) ── */

  function exportPayload() {
    var s = store();
    var out = { session: cfg.session || '', attemptId: cfg.attemptId || null, exportedAt: Date.now() };
    if (s) {
      try { out.meta = s.meta(); } catch (e) { out.meta = {}; }
      try { out.answers = s.answers(); } catch (e2) { out.answers = {}; }
      try { out.events = s.events(); } catch (e3) { out.events = []; }
      try { out.outbox = s.outbox(); } catch (e4) { out.outbox = []; }
    }
    return out;
  }

  // 브라우저에서만 의미가 있다. 실패해도 예외를 던지지 않는다.
  function downloadExport(filename) {
    var data = exportPayload();
    try {
      var blob = new root.Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = root.URL.createObjectURL(blob);
      var a = root.document.createElement('a');
      a.href = url;
      a.download = filename || ('answers-' + (data.session || 'offline') + '.json');
      root.document.body.appendChild(a);
      a.click();
      root.document.body.removeChild(a);
      (root.setTimeout || setTimeout)(function () { root.URL.revokeObjectURL(url); }, 0);
      return true;
    } catch (e) { warn('export download failed', e); return false; }
  }

  root.SG_SYNC = {
    configure: configure, config: function () { return cfg; },
    on: on,
    startAttempt: startAttempt, attemptId: attemptId, setAttemptId: setAttemptId,
    queueState: queueState, queueAnswers: queueAnswers, queueMedia: queueMedia,
    queueEvents: queueEvents, queueSubmit: queueSubmit,
    flush: flush, pending: pending, stats: stats, online: online,
    exportPayload: exportPayload, downloadExport: downloadExport,
    // 테스트 훅 — 순수하지 않은 경계를 갈아끼울 수 있게 노출한다.
    _request: request, _delayFor: delayFor, _permanent: permanent
  };
})(typeof window !== 'undefined' ? window : this);
