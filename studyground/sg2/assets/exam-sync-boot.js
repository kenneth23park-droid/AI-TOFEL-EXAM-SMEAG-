/* SMEAG · StudyGround — exam-sync-boot.js
 * 목적: exam-sync.js 를 실제로 서버에 연결한다. SG_SYNC 자체는 완성돼 있었지만
 *       configure() 를 부르는 곳이 없어 아웃박스가 영원히 나가지 않았다.
 *       (exam-runtime.html 은 exam-sync.js 를 로드조차 하지 않았다.)
 * 의존 전역: window.SG_SYNC, window.SG_STORE, window.SG_RUNTIME (선택: window.SG_AUTH)
 * 노출 전역: window.SG_SYNC_BOOT
 *
 * 설계 원칙 — 이 파일은 시험을 절대 멈추지 않는다(F12).
 *   서버가 없거나 죽어도 응시는 그대로 진행되고, 답안은 로컬에 남으며,
 *   화면에는 "대기 n건" 배지만 조용히 뜬다. 경고창은 띄우지 않는다 —
 *   시험장에서 오프라인은 사고가 아니라 정상 상태다.
 *
 * baseUrl 결정 순서 (먼저 찾은 것을 쓴다):
 *   1) ?server=http://192.168.0.10:8000   ← QR 로 배포할 때
 *   2) localStorage 'sg2_server_url'      ← 1)이 한 번 성공하면 저장된다
 *   3) 같은 오리진('')                     ← FastAPI 가 sg2 를 직접 서빙할 때
 */
(function (root) {
  'use strict';

  var LS_SERVER = 'sg2_server_url';
  var LS_ATTEMPT = 'sg2_attempt::';     // + session
  var ANSWER_DEBOUNCE_MS = 1500;        // 타이핑 중 매 글자마다 올리지 않는다
  var MACHINE_WAIT_MS = 15000;

  var state = { baseUrl: null, attemptId: null, ready: false, lastError: null };
  var dirty = {};                       // qid -> true (아직 안 올린 답안)
  var answerTimer = null;
  var wired = false;

  /* ── 작은 도구들 ──────────────────────────────────────────── */

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(root.location.search || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* quota: F12 */ } }
  function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) {} }
  function warn(m, e) { if (root.console && root.console.warn) root.console.warn('[SG_BOOT] ' + m, e || ''); }

  function resolveBaseUrl() {
    var q = param('server');
    if (q) return q.replace(/\/+$/, '');
    var saved = lsGet(LS_SERVER);
    return saved ? saved.replace(/\/+$/, '') : '';
  }

  /* ── attempt 발급 ─────────────────────────────────────────
   * attempt_id 는 반드시 서버가 준다 — 정수 PK 라 30대가 각자 지어내면 겹친다.
   * 즉 시험을 "시작"할 때만 서버가 필요하고, 그 뒤로는 끊겨도 된다.
   * 같은 session 으로 다시 열면 서버가 resume:true 로 같은 id 를 돌려준다.
   */
  function openAttempt(baseUrl, o, cb) {
    var cacheKey = LS_ATTEMPT + (o.session || 'nosession');
    var cached = lsGet(cacheKey);
    if (cached) {
      try { cb(null, JSON.parse(cached)); return; } catch (e) { lsDel(cacheKey); }
    }

    var xhr;
    try { xhr = new root.XMLHttpRequest(); } catch (e) { cb(e, null); return; }
    xhr.open('POST', baseUrl + '/api/attempts', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status !== 200 && xhr.status !== 201) {
        cb(new Error('attempt open failed: ' + xhr.status), null);
        return;
      }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { cb(e, null); return; }
      lsSet(cacheKey, JSON.stringify(data));
      cb(null, data);
    };
    xhr.onerror = function () { cb(new Error('network'), null); };
    xhr.ontimeout = function () { cb(new Error('timeout'), null); };
    try {
      xhr.send(JSON.stringify({
        student_no: o.studentNo || '',
        name: o.name || '',
        klass: o.klass || '',
        campus: o.campus || '',
        exam_code: o.examCode || '',
        profile: o.profile || 'toefl',
        session: o.session || '',
        content_hash: o.contentHash || '',
        timing_hash: o.timingHash || ''
      }));
    } catch (e) { cb(e, null); }
  }

  /* ── 대기 건수 배지 ───────────────────────────────────────
   * 학생에게 보여줄 건 하나뿐 — "아직 안 올라간 게 몇 건인가". */

  function badge() {
    var el = root.document.getElementById('sg-sync-badge');
    if (el) return el;
    el = root.document.createElement('div');
    el.id = 'sg-sync-badge';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:9999',
      'font:12px/1.4 ui-monospace,Menlo,monospace', 'padding:5px 10px',
      'border-radius:3px', 'background:rgba(0,0,0,.72)', 'color:#fff',
      'pointer-events:none', 'opacity:0', 'transition:opacity .2s'
    ].join(';');
    (root.document.body || root.document.documentElement).appendChild(el);
    return el;
  }

  function paint() {
    if (!root.SG_SYNC) return;
    var s = root.SG_SYNC.stats(), el = badge();
    if (!s.pending) { el.style.opacity = '0'; return; }
    el.textContent = (s.online ? 'Uploading' : 'Offline') + ' · ' + s.pending;
    el.style.opacity = '1';
  }

  /* ── 답안 → 아웃박스 ──────────────────────────────────────
   * 서버의 AnswerItemIn 형태로 옮긴다. qid 가 곧 question_key 다(‘R1-20’, ‘S-8’).
   * 화면이 아는 skill/module/no 는 콘텐츠 팩에서만 알 수 있으므로,
   * 저장해 둔 extra 에 있으면 싣고 없으면 서버 기본값에 맡긴다. */

  function flushAnswers() {
    if (answerTimer !== null) {
      (root.clearTimeout || clearTimeout)(answerTimer);
      answerTimer = null;
    }
    var store = root.SG_STORE;
    if (!store || !root.SG_SYNC || !state.ready) { dirty = {}; return; }

    var all = {};
    try { all = store.answers() || {}; } catch (e) { all = {}; }

    var items = [], qid, rec;
    for (qid in dirty) {
      if (!dirty.hasOwnProperty(qid)) continue;
      rec = all[qid];
      if (!rec) continue;
      items.push({
        question_key: qid,
        skill: rec.skill || '',
        module: rec.module || '',
        qtype: rec.qtype || '',
        no: typeof rec.no === 'number' ? rec.no : null,
        answer: rec.v,
        elapsed_ms: rec.elapsedMs || 0,
        prompt: ''
      });
    }
    dirty = {};
    if (items.length) { root.SG_SYNC.queueAnswers(items); paint(); }
  }

  function markDirty(qid) {
    dirty[qid] = true;
    if (answerTimer === null) {
      answerTimer = (root.setTimeout || setTimeout)(flushAnswers, ANSWER_DEBOUNCE_MS);
    }
  }

  function queueCursor() {
    var store = root.SG_STORE;
    if (!store || !root.SG_SYNC || !state.ready) return;
    var c = null, clocks = {};
    try { c = store.cursor(); clocks = store.clocks() || {}; } catch (e) { return; }
    root.SG_SYNC.queueState(c ? {
      // 클라이언트는 camelCase, 서버 CursorIn 은 snake_case 다.
      screen_id: c.screenId || '',
      screen_index: c.screenIndex || 0,
      phase_index: c.phaseIndex || 0
    } : {}, clocks);
  }

  /* ── 녹음 → 아웃박스 ──────────────────────────────────────
   * SG_STORE.putMedia 를 감싼다. exam-store.js 가 "IndexedDB 직접 접근 금지,
   * 반드시 putMedia 를 통과한다"고 못 박아 둔 덕분에 이 한 곳만 잡으면 된다.
   * 녹음기(exam-recorder.js)는 손대지 않는다. */

  function wrapPutMedia() {
    var store = root.SG_STORE;
    if (!store || typeof store.putMedia !== 'function' || store.__sgSyncWrapped) return;
    var original = store.putMedia;
    store.putMedia = function (qid, blob, cb) {
      return original.call(store, qid, blob, function (err, ref) {
        if (!err && root.SG_SYNC && state.ready) {
          try {
            // Blob 은 아웃박스에 넣지 않는다 — 참조만 넣고, 전송 직전에 꺼낸다(§5.2).
            root.SG_SYNC.queueMedia(qid, {
              qid: qid,
              mime: (blob && blob.type) || 'audio/webm',
              durationMs: (blob && blob.durationMs) || 0
            });
            paint();
          } catch (e) { warn('queueMedia failed', e); }
        }
        if (cb) cb(err, ref);
      });
    };
    store.__sgSyncWrapped = true;
  }

  /* ── 상태머신에 붙기 ──────────────────────────────────────
   * exam-shell.js 가 machine 을 만들 때까지 기다린다. */

  function wireMachine(waitedMs) {
    if (wired) return;
    var rt = root.SG_RUNTIME;
    var machine = rt && typeof rt.machine === 'function' ? rt.machine() : null;
    if (!machine) {
      if (waitedMs >= MACHINE_WAIT_MS) { warn('상태머신을 못 찾아 답안 배선을 건너뛴다'); return; }
      (root.setTimeout || setTimeout)(function () { wireMachine(waitedMs + 250); }, 250);
      return;
    }
    wired = true;

    machine.on(function (ev) {
      if (!ev) return;
      if (ev.type === 'answer') { markDirty(ev.qid); return; }
      if (ev.type === 'submitting' || ev.type === 'submitted') {
        flushAnswers();
        queueCursor();
        root.SG_SYNC.queueSubmit({ reason: ev.type });
        paint();
      }
    });

    machine.onTransition(function () { queueCursor(); });

    // 화면을 떠날 때 남은 답안을 흘려보낸다 — 탭이 닫혀도 로컬에는 이미 있다.
    if (root.addEventListener) {
      root.addEventListener('visibilitychange', function () {
        if (root.document.visibilityState === 'hidden') flushAnswers();
      });
      root.addEventListener('pagehide', flushAnswers);
    }
  }

  /* ── 시작 ─────────────────────────────────────────────────
   * opts 를 주지 않으면 로그인 정보와 URL 에서 알아서 채운다. */

  function inferOpts(given) {
    var o = given || {};
    var user = null;
    try { user = root.SG_AUTH && root.SG_AUTH.user ? root.SG_AUTH.user() : null; } catch (e) { user = null; }
    var store = root.SG_STORE;
    var session = o.session;
    if (!session && store && typeof store.current === 'function') {
      try { session = store.current(); } catch (e) { session = null; }
    }
    return {
      studentNo: o.studentNo || (user && (user.student_id || user.studentId)) || '',
      name: o.name || (user && user.name) || '',
      klass: o.klass || '',
      campus: o.campus || '',
      examCode: o.examCode || param('set') || '',
      profile: o.profile || 'toefl',
      session: session || '',
      contentHash: o.contentHash || '',
      timingHash: o.timingHash || ''
    };
  }

  function start(given, done) {
    var cb = done || function () {};
    if (!root.SG_SYNC) { cb(new Error('SG_SYNC missing'), null); return; }

    var opts = inferOpts(given);
    var baseUrl = resolveBaseUrl();
    state.baseUrl = baseUrl;

    if (!opts.studentNo || !opts.examCode) {
      // 누가 어느 시험을 보는지 모르면 서버에 열 수 없다. 시험은 그대로 진행한다.
      state.lastError = new Error('student_no / exam_code 미상');
      warn('학생·시험 정보가 없어 서버 없이 진행한다 — 답안은 로컬에만 남는다');
      cb(state.lastError, null);
      return;
    }

    openAttempt(baseUrl, opts, function (err, attempt) {
      if (err) {
        // 서버를 못 만났다. 답안은 로컬에 쌓이고, 관리자는 exam-sync.js 의
        // 내보내기(JSON 다운로드)로 회수할 수 있다.
        state.lastError = err;
        warn('서버 없이 진행 — 답안은 로컬에만 남는다', err);
        cb(err, null);
        return;
      }

      if (baseUrl) lsSet(LS_SERVER, baseUrl);   // 한 번 통했으면 기억한다

      root.SG_SYNC.configure({
        baseUrl: baseUrl,
        attemptId: attempt.attempt_id,
        session: attempt.session || opts.session || ''
      });
      root.SG_SYNC.on(function (ev) {
        if (ev && (ev.type === 'queued' || ev.type === 'sent' || ev.type === 'gaveup' ||
                   ev.type === 'online' || ev.type === 'offline')) paint();
      });

      state.attemptId = attempt.attempt_id;
      state.ready = true;

      wrapPutMedia();
      wireMachine(0);
      queueCursor();
      paint();
      cb(null, attempt);
    });
  }

  /* 제출이 서버에 닿은 뒤 다음 응시를 위해 비운다. */
  function reset(session) {
    lsDel(LS_ATTEMPT + (session || 'nosession'));
    state.attemptId = null;
    state.ready = false;
    wired = false;
  }

  /* 자동 시작 — exam-runtime.html 은 script 태그만 넣으면 된다.
     data-sg-autostart="0" 을 주면 호출자가 직접 start() 한다. */
  function autostart() {
    var s = root.document.currentScript;
    if (s && s.getAttribute('data-sg-autostart') === '0') return;
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', function () { start(); });
    } else {
      start();
    }
  }

  root.SG_SYNC_BOOT = {
    start: start, reset: reset, state: state,
    resolveBaseUrl: resolveBaseUrl, flushAnswers: flushAnswers
  };

  autostart();
}(window));
