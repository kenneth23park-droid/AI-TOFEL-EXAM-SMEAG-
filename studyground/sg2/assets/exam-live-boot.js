/* SMEAG · StudyGround — exam-live-boot.js
 * 목적: 실시간 저장 배선. exam-store.js 의 모든 쓰기를 (1) 로컬 DB(IndexedDB)와
 *       (2) Supabase 로 동시에 흘려보내고, 화면이 넘어갈 때마다 체크포인트를 남긴다.
 * 의존 전역: window.SG_STORE, window.SG_LDB, window.SG_CLOUD, window.SG_RESUME,
 *            window.SG_RUNTIME(상태머신) — 없는 것은 조용히 건너뛴다.
 * 노출 전역: window.SG_LIVE
 *
 * 배선 지점이 한 곳인 이유: 답안은 반드시 SG_STORE.upsertAnswer 를 지난다.
 * 렌더러가 몇 개든, 문항 유형이 몇 가지든 그 문 하나만 잡으면 전부 걸린다.
 *
 * 저장 순서는 항상 로컬 먼저다 —
 *   localStorage(동기) → IndexedDB(즉시 트랜잭션) → Supabase 큐(1초 병합)
 * 앞의 둘은 정전에서 살아남는 층이고, 마지막 하나는 기기가 통째로 사라져도
 * 답안이 남게 하는 층이다.
 */
(function (root) {
  'use strict';

  var wired = false;
  var machineWired = false;
  var session = null;
  var state = { ldb: false, cloud: false, checkpoints: 0 };

  function warn(m, e) { if (root.console && root.console.warn) root.console.warn('[SG_LIVE] ' + m, e || ''); }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(root.location.search || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  /* ── 쓰기 미러링 ─────────────────────────────────────────── */

  function wireStore() {
    var S = root.SG_STORE;
    if (!S || typeof S.onWrite !== 'function' || wired) return;
    wired = true;

    S.onWrite(function (ev) {
      if (!ev) return;
      var sess = ev.session || session;
      if (!sess) return;

      if (ev.type === 'answer') {
        // 클라우드에는 "이 문항이 바뀌었다"만 알린다 — 1초 뒤 한 번에 올라간다.
        if (root.SG_CLOUD) { try { root.SG_CLOUD.markAnswer(ev.detail && ev.detail.qid); } catch (e) {} }
        return;
      }
      if (ev.type === 'media') {
        /* 녹음은 모으지 않는다 — 다음 문항으로 넘어가기 전에 기기 밖으로 내보낸다.
           IndexedDB 사본은 그대로 남으므로 실패해도 잃는 것은 없다. */
        if (root.SG_CLOUD) {
          try { root.SG_CLOUD.uploadMedia(ev.detail && ev.detail.qid, ev.detail && ev.detail.rec); } catch (e) {}
        }
        return;
      }
      if (ev.type === 'answers') {
        if (root.SG_LDB) { try { root.SG_LDB.saveAnswers(sess, ev.detail); state.ldb = true; } catch (e) {} }
        return;
      }
      if (ev.type === 'cursor') {
        if (root.SG_LDB) { try { root.SG_LDB.saveCursor(sess, ev.detail); } catch (e) {} }
        return;
      }
      if (ev.type === 'clocks') {
        if (root.SG_LDB) { try { root.SG_LDB.saveClocks(sess, ev.detail); } catch (e) {} }
      }
    });
  }

  /* ── 클라우드 attempt 열기 ───────────────────────────────── */

  function startCloud() {
    var S = root.SG_STORE, C = root.SG_CLOUD;
    if (!S || !C) return;
    session = S.current();
    if (!session) return;
    var meta = {};
    try { meta = S.meta() || {}; } catch (e) {}
    C.start({
      session: session,
      setCode: meta.setCode || param('set') || param('testId') || '',
      mode: meta.mode || '',
      startedAt: meta.startedAt || Date.now()
    }, function (err) {
      state.cloud = !err;
      if (err) warn('클라우드 없이 진행 — 답안은 로컬에 쌓이고 연결되면 올라간다', err);
    });
    if (root.SG_LDB) {
      try { root.SG_LDB.saveMeta(session, meta); } catch (e2) {}
    }
  }

  /* ── 체크포인트 ──────────────────────────────────────────── */

  function wireMachine(waited) {
    if (machineWired) return;
    var rt = root.SG_RUNTIME;
    var machine = rt && typeof rt.machine === 'function' ? rt.machine() : null;
    if (!machine) {
      if ((waited || 0) > 20000) return;
      (root.setTimeout || setTimeout)(function () { wireMachine((waited || 0) + 250); }, 250);
      return;
    }
    machineWired = true;

    var S = root.SG_STORE, R = root.SG_RESUME;
    if (!S || !R) return;

    R.attach(session || S.current(), R.step());
    // 시작 지점도 한 벌 남긴다 — 첫 화면에서 꺼져도 돌아올 자리가 있어야 한다.
    try { R.capture(machine, S); state.checkpoints += 1; } catch (e) {}

    machine.onTransition(function () {
      try { S.flushAnswers(); } catch (e) {}
      try { R.capture(machine, S); state.checkpoints += 1; } catch (e2) {}
    });

    machine.on(function (ev) {
      if (!ev) return;
      if (ev.type === 'submitting' || ev.type === 'submitted') {
        try { S.flushAnswers(); } catch (e) {}
        if (root.SG_CLOUD) { try { root.SG_CLOUD.markSubmitted(); root.SG_CLOUD.flush(); } catch (e2) {} }
      }
    });
  }

  /* ── 시작 ────────────────────────────────────────────────── */

  /* 세션은 셸이 콘텐츠·타이밍을 다 읽은 뒤에야 열린다(exam-shell.js bootRun).
     그래서 여기서는 열릴 때까지 기다렸다가 붙는다 — 먼저 붙으면 session 이 null 이다. */
  function waitSession(waited, done) {
    var S = root.SG_STORE;
    var cur = S && typeof S.current === 'function' ? S.current() : null;
    if (cur) { session = cur; done(); return; }
    if ((waited || 0) > 20000) { warn('세션이 열리지 않아 실시간 저장을 건너뛴다'); return; }
    (root.setTimeout || setTimeout)(function () { waitSession((waited || 0) + 200, done); }, 200);
  }

  function start() {
    wireStore();
    waitSession(0, function () {
      startCloud();
      wireMachine(0);
    });
    // 30초마다 한 번 더 — 화면 전환이 없는 긴 Writing 구간에서도 클라우드가 따라온다.
    (root.setInterval || setInterval)(function () {
      var S = root.SG_STORE;
      if (!S) return;
      try { S.flushAnswers(); } catch (e) {}
      if (root.SG_CLOUD) {
        try {
          root.SG_CLOUD.pushAnswers();
          root.SG_CLOUD.pushState(S.cursor() || {}, S.clocks() || {},
                                  root.SG_RESUME ? root.SG_RESUME.step() : 0);
          root.SG_CLOUD.flush();
        } catch (e2) {}
      }
    }, 30000);
  }

  function autostart() {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', function () { start(); });
    } else {
      start();
    }
  }

  /* 세션이 갈렸을 때(전체 다시 시작) 클라우드 attempt 도 새로 연다.
     같은 attempt 에 이어 붙이면 옛 응시의 답안이 새 응시에 섞인다. */
  function rebind(newSession) {
    if (!newSession || newSession === session) return;
    if (root.SG_CLOUD) { try { root.SG_CLOUD.reset(session); } catch (e) {} }
    session = newSession;
    machineWired = false;
    startCloud();
    wireMachine(0);
  }

  root.SG_LIVE = { start: start, rebind: rebind, state: state, session: function () { return session; } };

  autostart();
}(window));
