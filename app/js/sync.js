/* =============================================================
 * SMEAG TOEFL — Supabase 동기화 (window.SMEAG_SYNC)
 *
 * 계약 (app/INTERFACES.md):
 *   SMEAG_SYNC.enabled()      -> boolean
 *   SMEAG_SYNC.push(attempt)  -> Promise<{ok:boolean, error?:string}>
 *   SMEAG_SYNC.retryQueue()   -> Promise<{done:number, failed:number}>
 *   SMEAG_SYNC.queueSize()    -> number
 *
 * 설계 원칙
 *  - **절대 throw 하지 않는다.** 모든 실패는 {ok:false, error:'...'} 로 돌려주고
 *    localStorage 큐('smeag.toefl.syncQueue')에 attemptId 를 남긴다.
 *  - Supabase JS(UMD)는 최초 push 시점에 <script> 태그를 동적 삽입해 지연 로드한다.
 *    로드에 실패해도 시험/채점/결과 화면은 그대로 동작해야 한다.
 *  - config 에 URL/키가 없으면 아무 것도 하지 않는다(오프라인 전용 모드).
 *  - ES module 아님. 클래식 <script src> 로 로드되어 window.SMEAG_SYNC 하나만 정의.
 * ============================================================= */
(function () {
  'use strict';

  var QUEUE_KEY = 'smeag.toefl.syncQueue';
  var IDMAP_KEY = 'smeag.toefl.syncIds';   // 로컬 attemptId → 서버용 UUID 매핑
  var DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  var DEFAULT_BUCKET = 'toefl-recordings';

  var libPromise = null;   // Supabase UMD 로드 Promise (1회만)
  var client = null;       // createClient 결과 캐시
  var retrying = false;    // retryQueue 중복 실행 방지

  /* --- 작은 헬퍼 ------------------------------------------------ */

  function cfg() {
    return window.SMEAG_CONFIG || {};
  }

  function log() {
    if (cfg().debug && window.console) {
      console.log.apply(console, ['[SMEAG_SYNC]'].concat([].slice.call(arguments)));
    }
  }

  function msg(e) {
    if (!e) return '알 수 없는 오류';
    if (typeof e === 'string') return e;
    return e.message || e.error_description || e.error || String(e);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /* --- 큐 (localStorage) ---------------------------------------- */

  function readQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(arr) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(arr));
    } catch (e) { /* 저장 실패는 무시 (용량 초과 등) */ }
  }

  function enqueue(attemptId) {
    if (!attemptId) return;
    var q = readQueue();
    if (q.indexOf(attemptId) === -1) {
      q.push(attemptId);
      writeQueue(q);
    }
  }

  function dequeue(attemptId) {
    var q = readQueue().filter(function (x) { return x !== attemptId; });
    writeQueue(q);
  }

  /* --- attemptId → UUID ----------------------------------------
   * 서버 toefl_attempts.id 는 uuid 타입인데, 로컬 SMEAG.uid() 는 UUID 가
   * 아닐 수도 있다(crypto.randomUUID 미지원 브라우저). 그래서 로컬 id →
   * 서버 UUID 매핑을 localStorage 에 고정 저장해 재시도 시에도 같은 행을
   * upsert 하도록 한다. 로컬 id 가 이미 UUID 면 그대로 쓴다.
   * ------------------------------------------------------------- */

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function makeUuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
      if (window.crypto && window.crypto.getRandomValues) {
        var b = new Uint8Array(16);
        window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var hex = [];
        for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
        return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
          hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
          hex.slice(10, 16).join('');
      }
    } catch (e) { /* fallthrough */ }
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return s.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function serverId(localId) {
    if (UUID_RE.test(String(localId || ''))) return localId;
    var map = {};
    try {
      map = JSON.parse(localStorage.getItem(IDMAP_KEY) || '{}') || {};
    } catch (e) { map = {}; }
    if (!map[localId]) {
      map[localId] = makeUuid();
      try { localStorage.setItem(IDMAP_KEY, JSON.stringify(map)); } catch (e2) { /* 무시 */ }
    }
    return map[localId];
  }

  /* --- Supabase JS 지연 로드 ------------------------------------ */

  function loadLib() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      return Promise.resolve(window.supabase);
    }
    if (libPromise) return libPromise;

    libPromise = new Promise(function (resolve, reject) {
      var src = cfg().supabaseJsCdn || DEFAULT_CDN;
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
          resolve(window.supabase);
        } else {
          reject(new Error('Supabase JS 를 불러왔지만 createClient 가 없습니다.'));
        }
      };
      s.onerror = function () {
        reject(new Error('Supabase JS 로드 실패 (네트워크 또는 CDN 차단)'));
      };
      (document.head || document.documentElement).appendChild(s);
    });

    // 실패한 Promise 를 캐시해두면 영영 재시도가 안 되므로 초기화한다.
    libPromise['catch'](function () { libPromise = null; });
    return libPromise;
  }

  function getClient() {
    if (client) return Promise.resolve(client);
    return loadLib().then(function (lib) {
      client = lib.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      return client;
    });
  }

  /* --- 익명 로그인 ---------------------------------------------- */

  function ensureAuth(sb) {
    return sb.auth.getSession().then(function (res) {
      var sess = res && res.data ? res.data.session : null;
      if (sess && sess.user) return sess.user.id;
      if (typeof sb.auth.signInAnonymously !== 'function') {
        throw new Error('이 Supabase JS 버전은 익명 로그인을 지원하지 않습니다.');
      }
      return sb.auth.signInAnonymously().then(function (r) {
        if (r && r.error) throw r.error;
        var u = r && r.data && r.data.user ? r.data.user : null;
        if (!u) throw new Error('익명 로그인 실패 (Anonymous sign-ins 설정 확인)');
        return u.id;
      });
    });
  }

  /* --- attempt → 서버 행 변환 ----------------------------------- */

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function attemptRow(attempt, uid) {
    var sc = attempt.score || {};
    var sec = sc.sections || {};
    var r = sec.reading || {}, l = sec.listening || {}, w = sec.writing || {}, sp = sec.speaking || {};
    var auto = sc.autoScore || {};
    return {
      id: serverId(attempt.id),
      user_id: uid,
      set_code: attempt.setCode || null,
      started_at: attempt.startedAt || null,
      submitted_at: attempt.submittedAt || null,
      status: 'synced',
      reading_correct: num(r.correct),
      reading_total: num(r.total),
      listening_correct: num(l.correct),
      listening_total: num(l.total),
      writing_correct: num(w.correct),
      writing_total: num(w.total),
      speaking_submitted: num(sp.submitted),
      speaking_total: num(sp.total),
      auto_correct: num(auto.correct),
      auto_total: num(auto.total),
      auto_pct: num(auto.pct),
      client_created_at: attempt.submittedAt || attempt.startedAt || nowIso()
    };
  }

  /* 문항 메타(section/module/no/kind) 조회 — set1.js 의 findQuestion 사용 */
  function metaOf(qid) {
    var set = window.SMEAG_SET1;
    if (!set || typeof set.findQuestion !== 'function') return null;
    try { return set.findQuestion(qid); } catch (e) { return null; }
  }

  var SUBMISSION_KINDS = { email: 'email', discussion: 'discussion', repeat: 'speaking', interview: 'speaking' };

  function splitAnswers(attempt) {
    var out = { answers: [], texts: [], speaking: [] };
    var answers = attempt.answers || {};
    var perQ = (attempt.score && attempt.score.perQuestion) || {};
    var aid = serverId(attempt.id);

    Object.keys(answers).forEach(function (qid) {
      var resp = answers[qid];
      var m = metaOf(qid);
      var kind = m && m.q ? m.q.kind : null;
      var subKind = kind ? SUBMISSION_KINDS[kind] : null;
      var graded = perQ[qid] || {};

      if (subKind === 'email' || subKind === 'discussion') {
        out.texts.push({
          attempt_id: aid,
          question_id: qid,
          kind: subKind,
          text_body: typeof resp === 'string' ? resp : JSON.stringify(resp),
          storage_path: null,
          duration_ms: null
        });
        return;
      }

      if (subKind === 'speaking') {
        var rec = resp && typeof resp === 'object' ? resp : {};
        out.speaking.push({
          questionId: qid,
          recorded: !!rec.recorded,
          durationMs: num(rec.durationMs),
          row: {
            attempt_id: aid,
            question_id: qid,
            kind: 'speaking',
            text_body: null,
            storage_path: null,
            duration_ms: num(rec.durationMs)
          }
        });
        return;
      }

      // 자동채점 대상 (blank / mcq / insert / build)
      out.answers.push({
        attempt_id: aid,
        question_id: qid,
        section: m && m.section ? m.section.id : null,
        module: m && m.module ? m.module.id : null,
        q_no: m && m.q && typeof m.q.no === 'number' ? m.q.no : null,
        kind: kind,
        response: resp === undefined ? null : resp,
        is_correct: (typeof graded.correct === 'boolean') ? graded.correct : null
      });
    });

    return out;
  }

  /* --- 스피킹 녹음 업로드 ---------------------------------------- */

  function uploadRecordings(sb, attempt, uid, list) {
    var bucket = cfg().storageBucket || DEFAULT_BUCKET;
    var store = window.SMEAG_STORE;
    var aid = serverId(attempt.id);

    // 순차 업로드 (동시 업로드로 모바일 회선을 막지 않기 위해)
    return list.reduce(function (chain, item) {
      return chain.then(function () {
        if (!item.recorded || !store || typeof store.getRecording !== 'function') return null;
        return store.getRecording(attempt.id, item.questionId).then(function (blob) {
          if (!blob) return null;
          var path = uid + '/' + aid + '/' + item.questionId + '.webm';
          return sb.storage.from(bucket).upload(path, blob, {
            upsert: true,
            contentType: blob.type || 'audio/webm'
          }).then(function (res) {
            if (res && res.error) throw res.error;
            item.row.storage_path = path;
            return path;
          });
        })['catch'](function (e) {
          // 녹음 하나가 실패하면 전체 push 를 실패로 본다 (큐에 남아 재시도)
          throw new Error('녹음 업로드 실패(' + item.questionId + '): ' + msg(e));
        });
      });
    }, Promise.resolve());
  }

  /* --- push ------------------------------------------------------ */

  function push(attempt) {
    if (!attempt || !attempt.id) {
      return Promise.resolve({ ok: false, error: 'attempt 가 비어 있습니다.' });
    }
    if (!enabled()) {
      return Promise.resolve({ ok: false, error: '동기화 비활성 (config 에 Supabase URL/키 없음)' });
    }

    var sb, uid, parts;

    return getClient()
      .then(function (c) { sb = c; return ensureAuth(sb); })
      .then(function (id) {
        uid = id;
        parts = splitAnswers(attempt);

        // 1) 회차 upsert
        return sb.from('toefl_attempts')
          .upsert(attemptRow(attempt, uid), { onConflict: 'id' })
          .then(function (res) { if (res && res.error) throw res.error; });
      })
      .then(function () {
        // 2) 문항 응답 일괄 upsert
        if (!parts.answers.length) return null;
        return sb.from('toefl_answers')
          .upsert(parts.answers, { onConflict: 'attempt_id,question_id' })
          .then(function (res) { if (res && res.error) throw res.error; });
      })
      .then(function () {
        // 3) 스피킹 녹음 업로드 → storage_path 채우기
        if (!parts.speaking.length) return null;
        return uploadRecordings(sb, attempt, uid, parts.speaking);
      })
      .then(function () {
        // 4) 이메일/토론 본문 + 스피킹 메타 upsert
        var rows = parts.texts.concat(parts.speaking.map(function (s) { return s.row; }));
        if (!rows.length) return null;
        return sb.from('toefl_submissions')
          .upsert(rows, { onConflict: 'attempt_id,question_id' })
          .then(function (res) { if (res && res.error) throw res.error; });
      })
      .then(function () {
        // 5) 로컬 상태를 'synced' 로
        try {
          var store = window.SMEAG_STORE;
          if (store && typeof store.save === 'function') {
            var latest = (typeof store.get === 'function' && store.get(attempt.id)) || attempt;
            latest.status = 'synced';
            store.save(latest);
          } else {
            attempt.status = 'synced';
          }
        } catch (e) { /* 로컬 저장 실패는 동기화 성공 여부와 무관 */ }

        dequeue(attempt.id);
        log('push 성공', attempt.id);
        return { ok: true };
      })
      ['catch'](function (e) {
        enqueue(attempt.id);
        var m = msg(e);
        log('push 실패', attempt.id, m);
        return { ok: false, error: m };
      });
  }

  /* --- retryQueue ------------------------------------------------ */

  function retryQueue() {
    if (retrying) return Promise.resolve({ done: 0, failed: 0 });
    var ids = readQueue();
    if (!ids.length || !enabled()) return Promise.resolve({ done: 0, failed: 0 });

    retrying = true;
    var done = 0, failed = 0;
    var store = window.SMEAG_STORE;

    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        var attempt = (store && typeof store.get === 'function') ? store.get(id) : null;
        if (!attempt) {
          // 로컬에서 삭제된 회차는 큐에서도 제거
          dequeue(id);
          return null;
        }
        return push(attempt).then(function (r) {
          if (r && r.ok) done++; else failed++;
        });
      });
    }, Promise.resolve()).then(function () {
      retrying = false;
      return { done: done, failed: failed };
    })['catch'](function () {
      retrying = false;
      return { done: done, failed: failed };
    });
  }

  /* --- 공개 API -------------------------------------------------- */

  function enabled() {
    var c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  function queueSize() {
    return readQueue().length;
  }

  window.SMEAG_SYNC = {
    enabled: enabled,
    push: push,
    retryQueue: retryQueue,
    queueSize: queueSize
  };

  /* 온라인으로 복귀하면 큐를 한 번 재시도한다. */
  window.addEventListener('online', function () {
    try {
      if (enabled() && queueSize() > 0) retryQueue();
    } catch (e) { /* 절대 throw 금지 */ }
  });
})();
