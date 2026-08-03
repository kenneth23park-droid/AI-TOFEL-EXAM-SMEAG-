/* =============================================================
 * SMEAG TOEFL — 저장소 (담당 A) → window.SMEAG_STORE
 *
 * localStorage 키
 *   smeag.toefl.attempts   : Attempt[] (최신순 유지)
 *   smeag.toefl.current    : 진행중 attempt id
 *   smeag.toefl.syncQueue  : sync.js 가 쓰는 대기열 (여기서는 헬퍼만 제공)
 * 녹음 Blob 은 용량 때문에 localStorage 가 아니라 IndexedDB 에 저장한다.
 *   DB 'smeag-toefl' / store 'recordings' / key '<attemptId>:<questionId>'
 *
 * 모든 write 는 즉시 수행한다(디바운스 금지 — 새로고침 대비).
 * QuotaExceeded 등 어떤 저장 오류에도 앱이 죽지 않는다.
 * ============================================================= */
(function () {
  'use strict';

  var K_ATTEMPTS = 'smeag.toefl.attempts';
  var K_CURRENT = 'smeag.toefl.current';
  var K_QUEUE = 'smeag.toefl.syncQueue';

  var DB_NAME = 'smeag-toefl';
  var DB_STORE = 'recordings';
  var DB_VERSION = 1;

  var STORE = {};

  /* ---------- localStorage 안전 래퍼 ---------- */

  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      // QuotaExceededError / 사생활 보호 모드 등 — 앱은 계속 동작해야 한다.
      try {
        if (window.console) console.warn('[SMEAG_STORE] 저장 실패(용량 초과 가능):', e && e.name);
      } catch (e2) { /* 무시 */ }
      return false;
    }
  }

  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 무시 */ }
  }

  function readJSON(key, fallback) {
    var raw = lsGet(key);
    if (!raw) return fallback;
    try {
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    var text;
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    return lsSet(key, text);
  }

  function nowISO() { return new Date().toISOString(); }

  function newId() {
    return (window.SMEAG && window.SMEAG.uid)
      ? window.SMEAG.uid()
      : String(Date.now()) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- attempt 목록 ---------- */

  function allAttempts() {
    var arr = readJSON(K_ATTEMPTS, []);
    return Array.isArray(arr) ? arr : [];
  }

  function writeAttempts(arr) {
    return writeJSON(K_ATTEMPTS, arr);
  }

  /* 목록에 반영(있으면 교체, 없으면 앞에 추가) 후 즉시 write */
  function upsert(attempt) {
    if (!attempt || !attempt.id) return;
    var arr = allAttempts();
    var found = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === attempt.id) { arr[i] = attempt; found = true; break; }
    }
    if (!found) arr.unshift(attempt);
    arr.sort(function (a, b) {
      return String((b && b.startedAt) || '').localeCompare(String((a && a.startedAt) || ''));
    });
    writeAttempts(arr);
  }

  /* 현재 진행중 attempt 캐시 (같은 객체를 계속 다루게 해서 참조 일관성 유지) */
  var _current = null;

  function loadCurrent() {
    var id = lsGet(K_CURRENT);
    if (!id) return null;
    var a = STORE.get(id);
    if (!a || a.status !== 'in_progress') {
      lsRemove(K_CURRENT);
      return null;
    }
    return a;
  }

  /* ---------- 공개 API ---------- */

  STORE.current = function () {
    if (_current && _current.status === 'in_progress') return _current;
    _current = loadCurrent();
    return _current;
  };

  STORE.start = function () {
    // 기존 진행중이 있으면 폐기한다.
    var old = STORE.current();
    if (old) STORE.remove(old.id);

    var setCode = (window.SMEAG_SET1 && window.SMEAG_SET1.code) || 'SET1';
    var a = {
      id: newId(),
      setCode: setCode,
      startedAt: nowISO(),
      submittedAt: null,
      status: 'in_progress',
      cursor: { sectionId: null, moduleId: null, blockIndex: 0, questionIndex: 0 },
      answers: {},
      played: {},
      elapsed: {},
      score: null,
      student: (window.SMEAG_CONFIG && window.SMEAG_CONFIG.student) || null
    };
    _current = a;
    upsert(a);
    lsSet(K_CURRENT, a.id);
    return a;
  };

  STORE.resume = function () {
    return STORE.current();
  };

  STORE.save = function (attempt) {
    var a = attempt || _current;
    if (!a) return;
    if (_current && a.id === _current.id) _current = a;
    upsert(a);
    if (a.status === 'in_progress') lsSet(K_CURRENT, a.id);
  };

  STORE.setAnswer = function (qid, response) {
    var a = STORE.current();
    if (!a || !qid) return;
    if (!a.answers) a.answers = {};
    a.answers[qid] = response;
    STORE.save(a);   // 즉시 write (디바운스 금지)
  };

  STORE.getAnswer = function (qid) {
    var a = STORE.current();
    if (!a || !a.answers) return undefined;
    return a.answers[qid];
  };

  STORE.markPlayed = function (key) {
    var a = STORE.current();
    if (!a || !key) return;
    if (!a.played) a.played = {};
    if (a.played[key] === true) return;
    a.played[key] = true;
    STORE.save(a);
  };

  STORE.hasPlayed = function (key) {
    var a = STORE.current();
    if (!a || !a.played || !key) return false;
    return a.played[key] === true;
  };

  STORE.setCursor = function (cursor) {
    var a = STORE.current();
    if (!a || !cursor) return;
    a.cursor = {
      sectionId: cursor.sectionId !== undefined ? cursor.sectionId : null,
      moduleId: cursor.moduleId !== undefined ? cursor.moduleId : null,
      blockIndex: cursor.blockIndex || 0,
      questionIndex: cursor.questionIndex || 0
    };
    STORE.save(a);
  };

  /* 섹션별 소요 시간(초) 기록 — exam.js 편의용 (계약서 외 추가 헬퍼) */
  STORE.setElapsed = function (sectionId, seconds) {
    var a = STORE.current();
    if (!a || !sectionId) return;
    if (!a.elapsed) a.elapsed = {};
    a.elapsed[sectionId] = Math.max(0, Math.floor(Number(seconds) || 0));
    STORE.save(a);
  };

  STORE.submit = function (scoreReport) {
    var a = STORE.current();
    if (!a) return null;
    a.status = 'submitted';
    a.submittedAt = nowISO();
    a.score = scoreReport || null;
    upsert(a);
    lsRemove(K_CURRENT);
    _current = null;
    return a;
  };

  STORE.list = function () {
    var arr = allAttempts();
    arr.sort(function (a, b) {
      return String((b && b.startedAt) || '').localeCompare(String((a && a.startedAt) || ''));
    });
    return arr;
  };

  STORE.get = function (id) {
    if (!id) return null;
    var arr = allAttempts();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return arr[i];
    }
    return null;
  };

  STORE.remove = function (id) {
    if (!id) return;
    var arr = allAttempts().filter(function (a) { return !a || a.id !== id; });
    writeAttempts(arr);
    if (lsGet(K_CURRENT) === id) lsRemove(K_CURRENT);
    if (_current && _current.id === id) _current = null;
    // 녹음도 함께 정리 (실패해도 무시)
    STORE.removeRecordings(id).catch(function () { });
  };

  /* ---------- 대시보드용 최고 기록 ---------- */

  /**
   * bests() -> {reading, listening, writing, total, attempts}
   * 제출(submitted/synced)된 attempt 들 중 영역별 최고 정답률(%)과 총 응시수.
   * 기록이 없으면 각 값은 null.
   */
  STORE.bests = function () {
    var out = { reading: null, listening: null, writing: null, total: null, attempts: 0 };
    var arr = allAttempts();
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (!a || (a.status !== 'submitted' && a.status !== 'synced')) continue;
      out.attempts += 1;
      var sc = a.score;
      if (!sc) continue;
      var s = sc.sections || {};
      out.reading = maxPct(out.reading, s.reading);
      out.listening = maxPct(out.listening, s.listening);
      out.writing = maxPct(out.writing, s.writing);
      if (sc.autoScore && typeof sc.autoScore.pct === 'number' && isFinite(sc.autoScore.pct)) {
        out.total = (out.total === null) ? sc.autoScore.pct : Math.max(out.total, sc.autoScore.pct);
      }
    }
    return out;
  };

  function maxPct(cur, sec) {
    if (!sec) return cur;
    var p = sec.pct;
    if (typeof p !== 'number' || !isFinite(p)) {
      if (typeof sec.correct === 'number' && sec.total) p = Math.round((sec.correct / sec.total) * 100);
      else return cur;
    }
    return (cur === null) ? p : Math.max(cur, p);
  }

  /* ---------- 동기화 큐 헬퍼 (sync.js 가 사용) ---------- */

  STORE.queue = function () {
    var q = readJSON(K_QUEUE, []);
    return Array.isArray(q) ? q : [];
  };
  STORE.setQueue = function (q) {
    writeJSON(K_QUEUE, Array.isArray(q) ? q : []);
  };

  /* ---------- IndexedDB (녹음 Blob) ---------- */

  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB 미지원')); return; }
      var req;
      try {
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e); return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 열기 실패')); };
      req.onblocked = function () { reject(new Error('IndexedDB 차단됨')); };
    });
    // 실패한 promise 를 캐시해도 다음 호출에서 다시 시도할 수 있게 리셋
    _dbPromise.catch(function () { _dbPromise = null; });
    return _dbPromise;
  }

  function recKey(attemptId, qid) { return String(attemptId) + ':' + String(qid); }

  STORE.putRecording = function (attemptId, qid, blob) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(blob, recKey(attemptId, qid));
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('녹음 저장 실패')); };
        tx.onabort = function () { reject(tx.error || new Error('녹음 저장 중단')); };
      });
    }).catch(function (e) {
      try { if (window.console) console.warn('[SMEAG_STORE] 녹음 저장 실패:', e && e.message); } catch (e2) { }
      // 시험은 계속되어야 하므로 reject 하지 않는다. 다만 호출측이 성공/실패를
      // 구분할 수 있도록 false 로 resolve 한다 (true=저장됨, false=저장 실패).
      return false;
    });
  };

  STORE.getRecording = function (attemptId, qid) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var r = tx.objectStore(DB_STORE).get(recKey(attemptId, qid));
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { reject(r.error || new Error('녹음 읽기 실패')); };
      });
    }).catch(function () { return null; });
  };

  STORE.listRecordings = function (attemptId) {
    var prefix = String(attemptId) + ':';
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction(DB_STORE, 'readonly');
        var cur = tx.objectStore(DB_STORE).openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) { resolve(out); return; }
          var key = String(c.key);
          if (key.indexOf(prefix) === 0) {
            out.push({ qid: key.slice(prefix.length), blob: c.value });
          }
          c.continue();
        };
        cur.onerror = function () { reject(cur.error || new Error('녹음 목록 실패')); };
      });
    }).catch(function () { return []; });
  };

  /* 특정 회차의 녹음 전부 삭제 (계약서 외 정리용 헬퍼) */
  STORE.removeRecordings = function (attemptId) {
    var prefix = String(attemptId) + ':';
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        var os = tx.objectStore(DB_STORE);
        var cur = os.openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) return;
          if (String(c.key).indexOf(prefix) === 0) c.delete();
          c.continue();
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
        tx.onabort = function () { resolve(); };
      });
    }).catch(function () { });
  };

  window.SMEAG_STORE = STORE;
})();
