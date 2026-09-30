/* SMEAG · StudyGround — exam-store.js
 * 목적: 응시 상태 지속성. architecture.md §5.1~§5.4 정본.
 *       localStorage 에는 커서/시계/답안/이벤트/아웃박스만, 미디어 Blob 은 IndexedDB.
 * 의존 전역: 없음 (localStorage / indexedDB 는 있으면 쓰고 없으면 메모리로 degrade)
 * 노출 전역: window.SG_STORE
 *
 * 순수부(hashString / findScreenIndex / planResume / serialize·restore)는 DOM·타이머
 * 접근이 없어 node 에서 그대로 검증 가능하다(coding standards F9).
 */
(function (root) {
  'use strict';

  var K_ACTIVE = 'sg2_attempt_active';
  var PREFIX = 'sg2_attempt::';
  var EVENT_CAP = 500;          // §5.2 링버퍼 상한
  var ANSWER_DEBOUNCE_MS = 200; // §5.3 텍스트 입력 폭주 방지
  var MEDIA_DB = 'sg2-media';
  var MEDIA_STORE = 'recordings';

  /* ── 백엔드 (localStorage 또는 메모리) ─────────────────────── */

  function memoryBackend() {
    var m = {};
    return {
      getItem: function (k) { return m.hasOwnProperty(k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      allKeys: function () { var o = []; for (var k in m) { if (m.hasOwnProperty(k)) o.push(k); } return o; }
    };
  }

  function wrapLocalStorage(ls) {
    return {
      getItem: function (k) { try { return ls.getItem(k); } catch (e) { return null; } },
      setItem: function (k, v) { try { ls.setItem(k, String(v)); } catch (e) { /* quota: F12 */ } },
      removeItem: function (k) { try { ls.removeItem(k); } catch (e) {} },
      allKeys: function () {
        var o = [];
        try { for (var i = 0; i < ls.length; i++) o.push(ls.key(i)); } catch (e) {}
        return o;
      }
    };
  }

  var backend = (function () {
    try {
      if (typeof root.localStorage !== 'undefined' && root.localStorage) {
        root.localStorage.setItem('sg2_probe', '1');
        root.localStorage.removeItem('sg2_probe');
        return wrapLocalStorage(root.localStorage);
      }
    } catch (e) {}
    return memoryBackend();
  })();

  function setBackend(b) { backend = b || memoryBackend(); cache = {}; }

  var session = null;
  var cache = {};                 // 파싱 결과 캐시 (읽기 폭주 방지)
  var answerTimer = null;
  var writeCbs = [];              // 쓰기 관찰자 (로컬 DB·클라우드 미러링)

  /* 쓰기 알림. 이 파일은 여전히 전역에 의존하지 않는다 — 미러링을 붙이는 쪽
     (exam-live-boot.js)이 여기에 등록한다. 콜백이 터져도 저장은 이미 끝나 있다. */
  function onWrite(fn) {
    if (typeof fn === 'function') writeCbs.push(fn);
    return function () {
      for (var i = 0; i < writeCbs.length; i++) { if (writeCbs[i] === fn) { writeCbs.splice(i, 1); return; } }
    };
  }

  function notifyWrite(type, detail) {
    for (var i = 0; i < writeCbs.length; i++) {
      try { writeCbs[i]({ type: type, session: session, detail: detail || {} }); } catch (e) {}
    }
  }

  function key(part) { return PREFIX + session + '::' + part; }

  function readJSON(k, dflt) {
    if (cache.hasOwnProperty(k)) return cache[k];
    var raw = backend.getItem(k);
    var v = dflt;
    if (raw !== null && raw !== undefined) {
      try { v = JSON.parse(raw); } catch (e) { v = dflt; }
    }
    cache[k] = v;
    return v;
  }

  function writeJSON(k, v) {
    cache[k] = v;
    backend.setItem(k, JSON.stringify(v));
  }

  /* ── sessionId (§5.1) ─────────────────────────────────────── */

  function rand4() {
    var s = '', hex = '0123456789abcdef';
    for (var i = 0; i < 4; i++) s += hex.charAt(Math.floor(Math.random() * 16));
    return s;
  }

  function ymd(d) {
    var x = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return x.getFullYear() + p(x.getMonth() + 1) + p(x.getDate());
  }

  // 서버 발급이 정본. 오프라인일 때만 아래 형식으로 임시 발급한다.
  function newSessionId(examCode, studentNo, date) {
    return String(examCode || 'SET1') + '-' + ymd(date) + '-' + String(studentNo || 'GUEST') + '-' + rand4();
  }

  function offlineSessionId() {
    var s = '';
    for (var i = 0; i < 8; i++) s += rand4();
    return 'offline-' + s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) +
           '-' + s.slice(16, 20) + '-' + s.slice(20, 32);
  }

  /* ── 세션 열기 ───────────────────────────────────────────── */

  function activeSession() { return backend.getItem(K_ACTIVE); }
  function setActive(s) { if (s) backend.setItem(K_ACTIVE, s); else backend.removeItem(K_ACTIVE); }
  function clearActive() { backend.removeItem(K_ACTIVE); }

  function open(s, makeActive) {
    session = s;
    cache = {};
    if (makeActive !== false) setActive(s);
    return api;
  }

  function current() { return session; }

  /* ── meta / cursor / clocks ──────────────────────────────── */

  function meta() { return readJSON(key('meta'), {}); }
  function saveMeta(o) { writeJSON(key('meta'), o || {}); }

  /* mode 는 세션 도중 바뀌지 않는다(Story 1.8 AC5). URL 로 바꿔도 저장값이 이긴다. */
  function patchMeta(patch) {
    var m = meta(), k;
    for (k in patch) {
      if (!patch.hasOwnProperty(k)) continue;
      if (k === 'mode' && m.mode && m.mode !== patch.mode) {
        pushEvent('mode_change_rejected', '', { stored: m.mode, attempted: patch.mode });
        continue;
      }
      m[k] = patch[k];
    }
    saveMeta(m);
    return m;
  }

  function cursor() { return readJSON(key('cursor'), null); }

  function saveCursor(screenId, screenIndex, phaseIndex) {
    var c = {
      screenId: screenId,
      screenIndex: screenIndex,
      phaseIndex: phaseIndex || 0,
      updatedAt: Date.now()
    };
    writeJSON(key('cursor'), c);
    notifyWrite('cursor', c);
  }

  function clocks() { return readJSON(key('clocks'), {}); }
  function saveClocks(m) { writeJSON(key('clocks'), m || {}); notifyWrite('clocks', m || {}); }

  /* ── 답안 (§5.3) ─────────────────────────────────────────── */

  function answers() { return readJSON(key('answers'), {}); }

  function flushAnswers() {
    if (answerTimer !== null) { (root.clearTimeout || clearTimeout)(answerTimer); answerTimer = null; }
    var a = answers();
    writeJSON(key('answers'), a);
    notifyWrite('answers', a);
  }

  /* upsert. 캐시에는 즉시 반영하고 디스크 기록만 debounce 한다 —
     화면 이탈/visibilitychange 에서 flushAnswers() 로 우회 저장한다. */
  function upsertAnswer(qid, value, extra) {
    var a = answers();
    var rec = a[qid] || {};
    rec.v = value;
    rec.t = Date.now();
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) rec[k] = extra[k]; } }
    a[qid] = rec;
    cache[key('answers')] = a;
    /* 정전은 예고가 없다 — 클릭 한 번으로 끝나는 답(객관식·드래그)은 debounce 없이
       그 자리에서 디스크로 내린다. 긴 글(Writing)만 200ms 로 모은다. */
    if (typeof value !== 'string' || value.length <= 64) {
      flushAnswers();
    } else if (answerTimer === null) {
      answerTimer = (root.setTimeout || setTimeout)(function () { answerTimer = null; flushAnswers(); }, ANSWER_DEBOUNCE_MS);
    }
    notifyWrite('answer', { qid: qid, rec: rec });
    return rec;
  }

  function getAnswer(qid) { var a = answers(); return a.hasOwnProperty(qid) ? a[qid] : null; }
  function answeredCount() { var a = answers(), n = 0, k; for (k in a) { if (a.hasOwnProperty(k)) n++; } return n; }

  /* ── 이벤트 링버퍼 ───────────────────────────────────────── */

  function events() { return readJSON(key('events'), []); }

  function pushEvent(type, screenId, detail) {
    if (!session) return null;
    var e = events();
    var rec = { ts: Date.now(), type: type, screenId: screenId || '', detail: detail === undefined ? '' : detail };
    e.push(rec);
    if (e.length > EVENT_CAP) e = e.slice(e.length - EVENT_CAP);
    writeJSON(key('events'), e);
    return rec;
  }

  /* ── 아웃박스 (미전송 제출 큐) ───────────────────────────── */

  function outbox() { return readJSON(key('outbox'), []); }

  function enqueue(kind, payload) {
    var q = outbox();
    var seq = q.length ? (q[q.length - 1].seq + 1) : 1;
    q.push({ seq: seq, kind: kind, payload: payload, at: Date.now() });
    writeJSON(key('outbox'), q);
    return seq;
  }

  function dropFromOutbox(seqs) {
    var drop = {}, i;
    for (i = 0; i < (seqs || []).length; i++) drop[seqs[i]] = true;
    var q = outbox().filter(function (it) { return !drop[it.seq]; });
    writeJSON(key('outbox'), q);
    return q;
  }

  function clearOutbox() { writeJSON(key('outbox'), []); }

  /* ── 미디어 (IndexedDB) ──────────────────────────────────── */

  function idb(cb) {
    var f = root.indexedDB;
    if (!f) { cb(new Error('IndexedDB unavailable.'), null); return; }
    var req;
    try { req = f.open(MEDIA_DB, 1); } catch (e) { cb(e, null); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = function () { cb(null, req.result); };
    req.onerror = function () { cb(req.error || new Error('IndexedDB open failed.'), null); };
  }

  function mediaKey(qid) { return session + '/' + qid; }

  /* Blob 은 localStorage 5MB 한도를 넘기므로 IndexedDB 로 간다(§5.2).
     answers 에는 "idb:{questionId}" 참조만 남긴다. */
  function putMedia(qid, blob, cb) {
    idb(function (err, db) {
      if (err) { if (cb) cb(err); return; }
      try {
        var tx = db.transaction(MEDIA_STORE, 'readwrite');
        tx.objectStore(MEDIA_STORE).put(blob, mediaKey(qid));
        tx.oncomplete = function () {
          /* 녹음이 남긴 사실을 답안에 함께 적는다 — 길이·무음 여부는 나중에 파일을
             열어도 알 수 없거나(무음 판정) 비싸다(길이). 옛 경로가 Blob 을 그대로
             넘기는 경우도 있어 record 인지 먼저 본다. */
          /* notSubmit 을 여기서 되돌리는 이유:
             마이크가 처음 안 열리면 화면이 즉시 NOT SUBMIT 을 적고, 그 뒤 응답 시간이
             남아 있는 동안 조용히 재시도한다(exam-render-speaking.startRecording).
             재시도가 성공해 녹음이 여기까지 오면 그 문항은 더 이상 미제출이 아니다.
             upsertAnswer 는 키를 덮어쓸 뿐 지우지 않으므로, 되돌린다고 말하지 않으면
             notSubmit:true 가 그대로 남는다. 그러면 api/score.js 는 버킷에 멀쩡한
             녹음이 있는데도 전사를 건너뛰고 0 점을 박는다(SET 11 q05 가 그랬다). */
          var meta = { media: 'idb:' + qid, recorded: true, notSubmit: false, reason: '' };
          if (blob && blob.blob) {
            if (blob.mime) meta.mime = blob.mime;
            if (typeof blob.durationMs === 'number') meta.durationMs = blob.durationMs;
            if (typeof blob.peak === 'number') meta.peak = blob.peak;
            if (blob.silent === true) meta.silent = true;
            if (typeof blob.blob.size === 'number') meta.bytes = blob.blob.size;
          }
          upsertAnswer(qid, 'idb:' + qid, meta);
          flushAnswers();
          /* 녹음이 기기에 안착한 그 순간을 알린다 — 클라우드로 곧장 올리는 쪽
             (exam-live-boot.js)이 여기에 붙는다. 이 파일은 여전히 전역을 모른다. */
          notifyWrite('media', { qid: qid, rec: blob });
          if (cb) cb(null, 'idb:' + qid);
        };
        tx.onerror = function () { if (cb) cb(tx.error || new Error('Media write failed.')); };
      } catch (e) { if (cb) cb(e); }
    });
  }

  function getMedia(qid, cb) {
    idb(function (err, db) {
      if (err) { cb(err, null); return; }
      try {
        var req = db.transaction(MEDIA_STORE, 'readonly').objectStore(MEDIA_STORE).get(mediaKey(qid));
        req.onsuccess = function () { cb(null, req.result || null); };
        req.onerror = function () { cb(req.error || new Error('Media read failed.'), null); };
      } catch (e) { cb(e, null); }
    });
  }

  /* ── 해시 · 복구 (§5.4) ──────────────────────────────────── */

  // FNV-1a 32bit. contentHash/timingHash 용 — 충돌 위험보다 "바뀌었는지"만 본다.
  function hashString(s) {
    var h = 0x811c9dc5, i;
    s = String(s === undefined || s === null ? '' : s);
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // 저장된 인덱스 숫자를 신뢰하지 않는다 — 안정 screen id 로 재탐색한다(§5.4-5).
  function findScreenIndex(screens, screenId) {
    if (!screens || !screenId) return -1;
    for (var i = 0; i < screens.length; i++) { if (screens[i] && screens[i].id === screenId) return i; }
    return -1;
  }

  function scopeOfKey(k) { var i = String(k).indexOf(':'); return i < 0 ? '' : String(k).slice(0, i); }
  function targetOfKey(k) { var i = String(k).indexOf(':'); return i < 0 ? String(k) : String(k).slice(i + 1); }

  var RESUME_RANK = { question: 0, screen: 1, task: 2, module: 3, section: 4 };

  /* 순수 함수. 저장된 cursor·clocks·현재 시각만으로 "어느 화면에 안착할지" 계산한다.
     §5.4-6: 만료된 deadline 은 좁은 scope 부터 조용히 적용하고, 가장 넓은 scope 의
     결과 화면에 안착한다. 답안은 유지한다. */
  function planResume(screens, cur, clockMap, nowMs) {
    var notes = [], expired = [];
    var idx = findScreenIndex(screens, cur && cur.screenId);
    if (idx < 0) {
      return { screenIndex: 0, screenId: screens && screens.length ? screens[0].id : null,
               phaseIndex: 0, expiredKeys: [], notes: ['cursor screen not found; restarting at first screen'] };
    }
    var k;
    for (k in (clockMap || {})) {
      if (!clockMap.hasOwnProperty(k)) continue;
      var d = clockMap[k];
      if (d !== null && d !== undefined && d <= nowMs) expired.push(k);
    }
    expired.sort(function (a, b) {
      var ra = RESUME_RANK[scopeOfKey(a)], rb = RESUME_RANK[scopeOfKey(b)];
      return (ra === undefined ? 9 : ra) - (rb === undefined ? 9 : rb);
    });

    for (var i = 0; i < expired.length; i++) {
      var sc = scopeOfKey(expired[i]), tgt = targetOfKey(expired[i]);
      if (sc === 'question' || sc === 'screen') {
        // 현재 화면에 걸린 문항/화면 타이머가 만료됐으면 다음 화면으로 커서 이동
        if (screens[idx] && screens[idx].id === tgt && idx + 1 < screens.length) {
          idx += 1;
          notes.push('advanced past expired ' + expired[i]);
        }
      } else {
        // module/task/section 만료 → 해당 scope 의 종료 화면으로 이동
        var end = -1;
        for (var j = idx; j < screens.length; j++) {
          var s = screens[j];
          if (!s) continue;
          if (s.screenType === 'moduleEnd' && (s.moduleId === tgt || s.section === tgt || s.id.indexOf(tgt) >= 0)) { end = j; break; }
        }
        if (end >= 0) { idx = end; notes.push('jumped to module end for expired ' + expired[i]); }
        else if (idx + 1 < screens.length) { idx += 1; notes.push('no module end screen for ' + expired[i] + '; advanced one screen'); }
      }
    }

    var phase = cur && typeof cur.phaseIndex === 'number' ? cur.phaseIndex : 0;
    return {
      screenIndex: idx,
      screenId: screens[idx] ? screens[idx].id : null,
      phaseIndex: (screens[idx] && cur && screens[idx].id === cur.screenId) ? phase : 0,
      expiredKeys: expired,
      notes: notes
    };
  }

  /* 재개 가능 여부. 콘텐츠/타이밍이 바뀌었으면 이어붙이지 않는다(§5.4-2). */
  function canResume(contentHash, timingHash) {
    var m = meta();
    if (!m || !m.session) return { ok: false, reason: 'no_meta' };
    if (m.submittedAt) return { ok: false, reason: 'submitted' };
    if (contentHash && m.contentHash && m.contentHash !== contentHash) return { ok: false, reason: 'content_changed' };
    if (timingHash && m.timingHash && m.timingHash !== timingHash) return { ok: false, reason: 'timing_changed' };
    return { ok: true, reason: 'ok' };
  }

  /* ── 직렬화 (새로고침/이관 시뮬레이션 · 테스트용) ─────────── */

  function serialize() {
    var out = {}, all = backend.allKeys(), i, k;
    for (i = 0; i < all.length; i++) {
      k = all[i];
      if (k === K_ACTIVE || k.indexOf(PREFIX) === 0) out[k] = backend.getItem(k);
    }
    return out;
  }

  /* 한 세션의 키만 추린 스냅샷. 되감기·다시시작 직전 백업본(SG_LDB.arch)이 이것을
     통째로 안고 간다 — 그래야 잘못 누른 학생의 답안을 손으로 되살릴 수 있다. */
  function serializeSession(s) {
    var target = s || session, out = {}, all = backend.allKeys(), i, k;
    for (i = 0; i < all.length; i++) {
      k = all[i];
      if (k.indexOf(PREFIX + target + '::') === 0) out[k] = backend.getItem(k);
    }
    return out;
  }

  // 새 백엔드에 스냅샷을 심고 캐시를 버린다 = 새로고침과 동일한 상태.
  function restore(snapshot) {
    var b = memoryBackend(), k;
    for (k in (snapshot || {})) { if (snapshot.hasOwnProperty(k)) b.setItem(k, snapshot[k]); }
    setBackend(b);
    session = null;
    return b;
  }

  function dropSession(s) {
    var target = s || session, all = backend.allKeys(), i;
    for (i = 0; i < all.length; i++) {
      if (all[i].indexOf(PREFIX + target + '::') === 0) backend.removeItem(all[i]);
    }
    if (activeSession() === target) clearActive();
    cache = {};
  }

  var api = {
    K_ACTIVE: K_ACTIVE, PREFIX: PREFIX, EVENT_CAP: EVENT_CAP,
    // 백엔드
    setBackend: setBackend, memoryBackend: memoryBackend,
    // 세션
    newSessionId: newSessionId, offlineSessionId: offlineSessionId,
    open: open, current: current, activeSession: activeSession,
    setActive: setActive, clearActive: clearActive, dropSession: dropSession,
    // 상태
    meta: meta, saveMeta: saveMeta, patchMeta: patchMeta,
    cursor: cursor, saveCursor: saveCursor,
    clocks: clocks, saveClocks: saveClocks,
    answers: answers, upsertAnswer: upsertAnswer, getAnswer: getAnswer,
    flushAnswers: flushAnswers, answeredCount: answeredCount,
    events: events, pushEvent: pushEvent,
    outbox: outbox, enqueue: enqueue, dropFromOutbox: dropFromOutbox, clearOutbox: clearOutbox,
    // 미디어
    putMedia: putMedia, getMedia: getMedia,
    // 관찰
    onWrite: onWrite,
    // 순수
    hashString: hashString, findScreenIndex: findScreenIndex, planResume: planResume,
    canResume: canResume, serialize: serialize, serializeSession: serializeSession, restore: restore
  };

  root.SG_STORE = api;
})(typeof window !== 'undefined' ? window : this);
