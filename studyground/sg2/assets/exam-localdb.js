/* SMEAG · StudyGround — exam-localdb.js
 * 목적: 응시 중 상태를 브라우저 로컬 DB(IndexedDB)에 즉시 적어 둔다.
 *       localStorage(exam-store.js)는 이미 있지만 두 가지가 모자란다 —
 *       (1) 5MB 한도라 Writing 원고와 스냅샷 여러 벌을 같이 못 담고,
 *       (2) 되감기용 스냅샷 링을 담을 자리가 없다.
 * 의존 전역: 없음 (IndexedDB 가 없으면 메모리로 degrade — 시험은 그대로 돈다)
 * 노출 전역: window.SG_LDB
 *
 * 정전을 전제로 쓴다. 전원이 끊길 때 브라우저는 beforeunload 도 pagehide 도 주지
 * 않는다. 그래서 "나갈 때 저장"이 아니라 "바뀔 때마다 이미 저장돼 있음"이어야 한다.
 * 여기의 모든 쓰기는 debounce 가 없다 — 부르는 즉시 트랜잭션이 열린다.
 *
 * 스토어 셋:
 *   state  key = session + '::' + part   (part: answers | cursor | clocks | meta)
 *   ckpt   key = session + '::' + 8자리 step   되감기 스냅샷 링
 *   queue  autoIncrement                 클라우드 미전송분(새로고침·정전에도 살아남는다)
 *   arch   key = ts + '::' + session      되감기·다시시작 직전의 백업본
 *
 * 백업본(arch)이 따로 있는 이유 —
 *   되감기와 '다시 시작'은 지우는 동작이다. 3스텝 전으로 돌아가면 그 뒤에 쓴 답안이
 *   사라지고, '전체 다시'는 세션을 통째로 버린다. 학생이 잘못 눌렀을 때 되돌릴 자리가
 *   없으면 그걸로 끝이다. 그래서 지우기 직전의 한 벌을 여기에 먼저 적는다.
 *   arch 는 dropSession 이 건드리지 않는다 — 세션을 지워도 백업본은 남아야 한다.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'sg2-local';
  var DB_VER = 2;
  var S_STATE = 'state';
  var S_CKPT = 'ckpt';
  var S_QUEUE = 'queue';
  var S_ARCH = 'arch';
  var CKPT_KEEP = 12;          // 되감기는 3스텝까지지만 여유를 둔다
  var ARCH_KEEP = 30;          // 백업본은 넉넉히 — 한 벌이 커야 몇십 KB 다

  var memory = { state: {}, ckpt: {}, queue: {}, arch: {} };
  var memSeq = 0;
  var dbPromiseCache = null;
  var broken = false;

  function noop() {}
  function warn(m, e) { if (root.console && root.console.warn) root.console.warn('[SG_LDB] ' + m, e || ''); }

  function stateKey(session, part) { return String(session) + '::' + part; }
  function ckptKey(session, step) {
    var s = '00000000' + String(step);
    return String(session) + '::' + s.slice(-8);
  }

  /* ── IndexedDB 열기 (한 번만) ─────────────────────────────── */

  function openDb(cb) {
    if (broken || !root.indexedDB) { cb(new Error('IndexedDB unavailable'), null); return; }
    if (dbPromiseCache) { cb(null, dbPromiseCache); return; }
    var req;
    try { req = root.indexedDB.open(DB_NAME, DB_VER); } catch (e) { broken = true; cb(e, null); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(S_STATE)) db.createObjectStore(S_STATE);
      if (!db.objectStoreNames.contains(S_CKPT)) db.createObjectStore(S_CKPT);
      if (!db.objectStoreNames.contains(S_QUEUE)) db.createObjectStore(S_QUEUE, { autoIncrement: true });
      if (!db.objectStoreNames.contains(S_ARCH)) db.createObjectStore(S_ARCH);
    };
    var settled = false;
    function settle(err, db) { if (settled) return; settled = true; cb(err, db); }
    req.onsuccess = function () { dbPromiseCache = req.result; settle(null, dbPromiseCache); };
    req.onerror = function () { broken = true; settle(req.error || new Error('open failed'), null); };
    /* 버전이 올라갈 때(v1 → v2, 백업본 스토어 추가) 다른 탭이 옛 버전을 붙들고 있으면
       open 은 성공도 실패도 하지 않고 멈춘다. 그대로 두면 모든 쓰기가 조용히 멈추므로
       여기서 끊고 메모리로 내려간다 — 시험을 세우는 것보다 낫다(F12). */
    req.onblocked = function () {
      broken = true;
      warn('로컬 DB 업그레이드가 다른 탭에 막혔다 — 메모리로 진행한다');
      settle(new Error('upgrade blocked'), null);
    };
  }

  /* 실패는 조용히 메모리 폴백으로 흡수한다 — 시험을 멈추는 것보다 낫다(F12). */
  function tx(storeName, mode, run, cb) {
    var done = cb || noop;
    openDb(function (err, db) {
      if (err) { done(err, null); return; }
      var t, store, out = null;
      try {
        t = db.transaction(storeName, mode);
        store = t.objectStore(storeName);
      } catch (e) { done(e, null); return; }
      try { out = run(store); } catch (e2) { done(e2, null); return; }
      t.oncomplete = function () { done(null, out && out.value !== undefined ? out.value : out); };
      t.onerror = function () { done(t.error || new Error('tx failed'), null); };
      t.onabort = function () { done(t.error || new Error('tx aborted'), null); };
    });
  }

  /* ── 상태 (답안 · 커서 · 시계 · 메타) ─────────────────────── */

  function putState(session, part, value, cb) {
    var k = stateKey(session, part);
    memory.state[k] = value;
    tx(S_STATE, 'readwrite', function (s) { s.put({ session: session, part: part, value: value, ts: Date.now() }, k); }, cb || noop);
    return value;
  }

  function getState(session, part, cb) {
    var k = stateKey(session, part);
    tx(S_STATE, 'readonly', function (s) {
      var r = s.get(k);
      var box = { value: undefined };
      r.onsuccess = function () { box.value = r.result ? r.result.value : undefined; };
      return box;
    }, function (err, v) {
      if (err || v === undefined) { cb(err || null, memory.state.hasOwnProperty(k) ? memory.state[k] : null); return; }
      cb(null, v);
    });
  }

  /* 답안 전체를 통째로 덮어쓴다. 문항 수가 120 남짓이라 부분 갱신보다 이쪽이
     싸고, 무엇보다 "쓴 순간 한 벌이 온전하다"는 성질이 정전에서 중요하다. */
  function saveAnswers(session, answers, cb) { return putState(session, 'answers', answers || {}, cb); }
  function saveCursor(session, cursor, cb) { return putState(session, 'cursor', cursor || null, cb); }
  function saveClocks(session, clocks, cb) { return putState(session, 'clocks', clocks || {}, cb); }
  function saveMeta(session, meta, cb) { return putState(session, 'meta', meta || {}, cb); }

  /* ── 체크포인트 링 ───────────────────────────────────────── */

  /* entry: { step, screenId, screenIndex, phaseIndex, section, cursor, clocks, answers, ts } */
  function putCheckpoint(session, entry, cb) {
    var e = entry || {};
    var rec = {
      session: session,
      step: e.step || 0,
      screenId: e.screenId || '',
      screenIndex: e.screenIndex || 0,
      phaseIndex: e.phaseIndex || 0,
      section: e.section || '',
      cursor: e.cursor || null,
      clocks: e.clocks || {},
      answers: e.answers || {},
      ts: e.ts || Date.now()
    };
    memory.ckpt[ckptKey(session, rec.step)] = rec;
    tx(S_CKPT, 'readwrite', function (s) {
      s.put(rec, ckptKey(session, rec.step));
      // 링 유지 — 오래된 것부터 버린다. 커서 하나로 앞에서부터 훑는다.
      var keep = [];
      var cur = s.openCursor(range(session));
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { keep.push(c.primaryKey); c.continue(); return; }
        for (var i = 0; i < keep.length - CKPT_KEEP; i++) s.delete(keep[i]);
      };
    }, cb || noop);
    return rec;
  }

  function range(session) {
    try { return root.IDBKeyRange.bound(session + '::', session + '::￿'); } catch (e) { return null; }
  }

  /* step 오름차순. 마지막 원소가 "꺼지기 직전"이다. */
  function checkpoints(session, cb) {
    tx(S_CKPT, 'readonly', function (s) {
      var box = { value: [] };
      var cur = s.openCursor(range(session));
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) return;
        box.value.push(c.value);
        c.continue();
      };
      return box;
    }, function (err, list) {
      if (err || !list) {
        var out = [], k;
        for (k in memory.ckpt) {
          if (memory.ckpt.hasOwnProperty(k) && k.indexOf(session + '::') === 0) out.push(memory.ckpt[k]);
        }
        out.sort(function (a, b) { return a.step - b.step; });
        cb(null, out);
        return;
      }
      list.sort(function (a, b) { return a.step - b.step; });
      cb(null, list);
    });
  }

  /* ── 클라우드 미전송 큐 ──────────────────────────────────── */

  function queuePush(item, cb) {
    var rec = { at: Date.now(), item: item };
    memSeq += 1;
    memory.queue[memSeq] = rec;
    tx(S_QUEUE, 'readwrite', function (s) { s.add(rec); }, cb || noop);
    return rec;
  }

  function queueAll(cb) {
    tx(S_QUEUE, 'readonly', function (s) {
      var box = { value: [] };
      var cur = s.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) return;
        box.value.push({ id: c.primaryKey, at: c.value.at, item: c.value.item });
        c.continue();
      };
      return box;
    }, function (err, list) { cb(err || null, list || []); });
  }

  function queueDrop(ids, cb) {
    tx(S_QUEUE, 'readwrite', function (s) {
      for (var i = 0; i < (ids || []).length; i++) s.delete(ids[i]);
    }, cb || noop);
  }

  function queueClear(cb) {
    memory.queue = {};
    tx(S_QUEUE, 'readwrite', function (s) { s.clear(); }, cb || noop);
  }

  /* ── 백업본 ──────────────────────────────────────────────── */

  var archSeq = 0;

  /* 키를 ts 로 시작시킨다 — 커서로 훑으면 그대로 오래된 순이라 트리밍이 싸다.
     같은 ms 에 두 번 부를 수 있으니 순번을 붙여 서로 덮어쓰지 않게 한다. */
  function archKey(ts, session) {
    var t = '0000000000000' + String(ts);
    archSeq += 1;
    return t.slice(-13) + '::' + ('000' + archSeq).slice(-3) + '::' + String(session);
  }

  /* 지우기 직전의 한 벌을 통째로 적는다.
     opts.snapshot 이 있으면 그쪽이 정본이다 — 부르는 쪽이 이미 지우기 시작했을 수
     있어, 여기서 IndexedDB 를 다시 읽으면 지워진 뒤를 뜨게 된다. 그래서 답안·시계·
     커서는 부르는 순간 동기로 뜬 값을 받고, 체크포인트 목록만 여기서 읽는다
     (체크포인트는 되감기가 지우지 않는다).
     opts.local 에는 localStorage 스냅샷을 얹는다. 실패해도 시험은 멈추지 않는다. */
  function archiveSession(session, reason, opts, cb) {
    var done = cb || noop;
    var o = opts || {};
    var pre = o.snapshot || null;
    readSession(session, function (err, snap) {
      var src = snap || {};
      var rec = {
        session: String(session || ''),
        reason: String(reason || ''),
        ts: Date.now(),
        answers: (pre && pre.answers) || src.answers || {},
        cursor: (pre && pre.cursor !== undefined ? pre.cursor : src.cursor) || null,
        clocks: (pre && pre.clocks) || src.clocks || {},
        meta: (pre && pre.meta) || src.meta || {},
        checkpoints: src.checkpoints || [],
        local: o.local || null,
        step: typeof o.step === 'number' ? o.step : null
      };
      var k = archKey(rec.ts, rec.session);
      memory.arch[k] = rec;
      tx(S_ARCH, 'readwrite', function (s) {
        s.put(rec, k);
        var keys = [];
        var cur = s.openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { keys.push(c.primaryKey); c.continue(); return; }
          for (var i = 0; i < keys.length - ARCH_KEEP; i++) s.delete(keys[i]);
        };
      }, function (e2) { done(e2 || null, rec); });
    });
  }

  /* 최신이 앞으로 온다 — 복구 화면은 "가장 최근 백업본"부터 보여 준다. */
  function archives(cb) {
    tx(S_ARCH, 'readonly', function (s) {
      var box = { value: [] };
      var cur = s.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) return;
        box.value.push({ key: c.primaryKey, rec: c.value });
        c.continue();
      };
      return box;
    }, function (err, list) {
      if (err || !list || !list.length) {
        var out = [], k;
        for (k in memory.arch) { if (memory.arch.hasOwnProperty(k)) out.push({ key: k, rec: memory.arch[k] }); }
        list = out;
      }
      list.sort(function (a, b) { return (b.rec.ts || 0) - (a.rec.ts || 0); });
      cb(null, list);
    });
  }

  /* ── 세션 정리 ───────────────────────────────────────────── */

  function dropSession(session, cb) {
    var k;
    for (k in memory.state) { if (memory.state.hasOwnProperty(k) && k.indexOf(session + '::') === 0) delete memory.state[k]; }
    for (k in memory.ckpt) { if (memory.ckpt.hasOwnProperty(k) && k.indexOf(session + '::') === 0) delete memory.ckpt[k]; }
    tx(S_STATE, 'readwrite', function (s) {
      var cur = s.openCursor(range(session));
      cur.onsuccess = function () { var c = cur.result; if (!c) return; s.delete(c.primaryKey); c.continue(); };
    }, function () {
      tx(S_CKPT, 'readwrite', function (s2) {
        var cur2 = s2.openCursor(range(session));
        cur2.onsuccess = function () { var c = cur2.result; if (!c) return; s2.delete(c.primaryKey); c.continue(); };
      }, cb || noop);
    });
  }

  /* 세션 하나를 통째로 읽어 온다 — 되감기 화면이 무엇을 보여줄지 정할 때 쓴다. */
  function readSession(session, cb) {
    var out = { session: session, answers: {}, cursor: null, clocks: {}, meta: {}, checkpoints: [] };
    getState(session, 'answers', function (e1, a) {
      out.answers = a || {};
      getState(session, 'cursor', function (e2, c) {
        out.cursor = c || null;
        getState(session, 'clocks', function (e3, cl) {
          out.clocks = cl || {};
          getState(session, 'meta', function (e4, m) {
            out.meta = m || {};
            checkpoints(session, function (e5, list) { out.checkpoints = list || []; cb(null, out); });
          });
        });
      });
    });
  }

  root.SG_LDB = {
    CKPT_KEEP: CKPT_KEEP, ARCH_KEEP: ARCH_KEEP,
    available: function () { return !!root.indexedDB && !broken; },
    saveAnswers: saveAnswers, saveCursor: saveCursor, saveClocks: saveClocks, saveMeta: saveMeta,
    putState: putState, getState: getState,
    putCheckpoint: putCheckpoint, checkpoints: checkpoints,
    queuePush: queuePush, queueAll: queueAll, queueDrop: queueDrop, queueClear: queueClear,
    archiveSession: archiveSession, archives: archives,
    readSession: readSession, dropSession: dropSession
  };
})(typeof window !== 'undefined' ? window : this);
