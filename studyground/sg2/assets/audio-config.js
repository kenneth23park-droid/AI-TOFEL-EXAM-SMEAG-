/* SMEAG StudyGround — audio override store (admin authoring).
 *
 * A teacher/admin can point any listening clip somewhere else without touching
 * the exam data. Overrides are keyed by the clip's ORIGINAL path (e.g.
 * "media/audio/set9/l1-q01.mp3"), so any player that resolves through
 * SG_AUDIO.resolve(originalPath) picks up the override automatically.
 *
 *   • URL    — any http(s) address or relative path   → localStorage
 *   • Upload — an mp3/m4a/wav from the machine        → IndexedDB (blob)
 *
 * URL overrides survive reload as-is. Uploaded blobs live in IndexedDB and get
 * a fresh object URL each load. If IndexedDB is blocked (some file:// contexts),
 * uploads still work for the session; storageWarning() explains the limitation.
 *
 * Not an ES module — loaded via <script src> to define window.SG_AUDIO.
 */
(function () {
  'use strict';

  var LS_KEY = 'sg_audio_overrides_v1';
  var DB_NAME = 'sg-audio-overrides';
  var DB_STORE = 'files';

  var meta = {};          // key -> {mode:'url',url} | {mode:'file',name,size,type}
  var blobUrls = {};      // key -> object URL for an uploaded blob (rebuilt each load)
  var listeners = [];
  var dbFailed = false;
  var readyPromise = null;

  function loadMeta() {
    try { meta = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { meta = {}; }
    if (!meta || typeof meta !== 'object') meta = {};
  }
  function saveMeta() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(meta)); } catch (e) { /* quota/private */ }
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (dbFailed || typeof indexedDB === 'undefined') { dbFailed = true; return reject(new Error('no idb')); }
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { dbFailed = true; return reject(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbFailed = true; reject(req.error || new Error('open failed')); };
    });
  }
  function dbPut(key, blob) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      var tx = db.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(blob, key);
      tx.oncomplete = function () { db.close(); res(); }; tx.onerror = function () { db.close(); rej(tx.error); };
    }); });
  }
  function dbDelete(key) {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      var tx = db.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE)['delete'](key);
      tx.oncomplete = function () { db.close(); res(); }; tx.onerror = function () { db.close(); rej(tx.error); };
    }); });
  }
  function dbGetAll() {
    return openDb().then(function (db) { return new Promise(function (res, rej) {
      var out = {}, tx = db.transaction(DB_STORE, 'readonly'), cur = tx.objectStore(DB_STORE).openCursor();
      cur.onsuccess = function () { var c = cur.result; if (!c) return; out[c.key] = c.value; c['continue'](); };
      tx.oncomplete = function () { db.close(); res(out); }; tx.onerror = function () { db.close(); rej(tx.error); };
    }); });
  }
  function revoke(key) {
    if (blobUrls[key]) { try { URL.revokeObjectURL(blobUrls[key]); } catch (e) {} delete blobUrls[key]; }
  }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  var API = {
    /** Rehydrate overrides + uploaded blobs. Call once before resolve(). */
    ready: function () {
      if (readyPromise) return readyPromise;
      loadMeta();
      /* IndexedDB 가 응답하지 않는 브라우저/모드가 있다(프라이빗 창, 일부 헤드리스).
         그런 곳에서 화면이 영영 비어 있으면 안 되므로 2.5초면 그냥 진행한다 —
         URL 오버라이드는 localStorage 라 이미 살아 있고, 업로드 blob 만 늦게 붙는다. */
      readyPromise = new Promise(function (resolve) {
        var settled = false;
        function finish() { if (!settled) { settled = true; resolve(API); } }
        setTimeout(finish, 2500);
        dbGetAll().then(function (blobs) {
          Object.keys(blobs).forEach(function (k) {
            if (meta[k] && meta[k].mode === 'file') blobUrls[k] = URL.createObjectURL(blobs[k]);
          });
          if (settled) emit();          // 늦게 도착했으면 화면을 한 번 더 갱신
        }).catch(function () {}).then(finish);
      });
      return readyPromise;
    },
    /** Effective src for an original clip path (falls back to the original). */
    resolve: function (originalPath) {
      var m = meta[originalPath];
      if (m && m.mode === 'url' && m.url) return m.url;
      if (m && m.mode === 'file' && blobUrls[originalPath]) return blobUrls[originalPath];
      return originalPath;
    },
    info: function (key) {
      var m = meta[key];
      if (m && m.mode === 'url' && m.url) return { mode: 'url', url: m.url };
      if (m && m.mode === 'file') return { mode: 'file', name: m.name || 'file', size: m.size || 0, missing: !blobUrls[key] };
      return { mode: 'default' };
    },
    isOverridden: function (key) { return !!meta[key]; },
    setUrl: function (key, url) {
      url = (url || '').trim();
      if (!url) return API.reset(key);
      return API.reset(key).then(function () { meta[key] = { mode: 'url', url: url }; saveMeta(); emit(); });
    },
    setFile: function (key, file) {
      if (!file) return Promise.resolve();
      return API.reset(key)
        .then(function () { return dbPut(key, file).catch(function () {}); })
        .then(function () {
          blobUrls[key] = URL.createObjectURL(file);
          meta[key] = { mode: 'file', name: file.name, size: file.size, type: file.type };
          saveMeta(); emit();
        });
    },
    reset: function (key) {
      revoke(key); var had = !!meta[key]; delete meta[key]; if (had) saveMeta();
      return dbDelete(key).catch(function () {}).then(function () { if (had) emit(); });
    },
    resetAll: function () {
      var keys = Object.keys(meta);
      return Promise.all(keys.map(function (k) { return API.reset(k); }))
        .then(function () { meta = {}; saveMeta(); emit(); });
    },
    list: function () { return Object.keys(meta); },
    exportJson: function () {
      var out = {};
      Object.keys(meta).forEach(function (k) { if (meta[k].mode === 'url') out[k] = meta[k].url; });
      return JSON.stringify({ version: 1, urls: out }, null, 2);
    },
    importJson: function (text) {
      var data; try { data = JSON.parse(text); } catch (e) { return Promise.reject(new Error('Not valid JSON.')); }
      var urls = (data && data.urls) || data;
      if (!urls || typeof urls !== 'object') return Promise.reject(new Error('No "urls" map found.'));
      var keys = Object.keys(urls);
      return Promise.all(keys.map(function (k) { return API.setUrl(k, String(urls[k])); })).then(function () { return keys.length; });
    },
    storageWarning: function () {
      return dbFailed
        ? 'Uploaded files can’t be saved in this browser (IndexedDB blocked — common on file://). They play this session but are lost on reload. Use a URL, or serve over http://.'
        : null;
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /** Swap the src of any <audio> whose original path has an override.
     *  Non-invasive: a page only needs to include this script — no per-player code.
     *  The original path is remembered in data-sg-orig so re-runs stay correct. */
    apply: function (root) {
      root = root || document;
      var els = root.querySelectorAll ? root.querySelectorAll('audio[src], audio source[src]') : [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var orig = el.getAttribute('data-sg-orig') || el.getAttribute('src');
        if (!el.getAttribute('data-sg-orig')) el.setAttribute('data-sg-orig', orig);
        var eff = API.resolve(orig);
        if (eff !== el.getAttribute('src')) {
          el.setAttribute('src', eff);
          var media = el.tagName === 'SOURCE' ? el.parentNode : el;
          if (media && media.load) { try { media.load(); } catch (e) {} }
        }
      }
    },

    /** 나중에 만들어지는 <audio> 까지 덮어쓴다.
     *  시험 런타임(exam-render-listening.js)은 화면마다 <audio> 를 스크립트로
     *  만들어 붙이므로, 한 번 훑는 apply() 만으로는 교체가 걸리지 않는다. */
    observe: function () {
      if (API._obs || typeof MutationObserver === 'undefined') return;
      API._obs = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var added = recs[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'AUDIO' || n.tagName === 'SOURCE') API.apply(n.parentNode || document);
            else if (n.querySelector && n.querySelector('audio')) API.apply(n);
          }
        }
      });
      var start = function () { API._obs.observe(document.documentElement, { childList: true, subtree: true }); };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    }
  };

  window.SG_AUDIO = API;

  // Auto-apply on load and whenever overrides change, so including this one
  // script is enough to make a page honor admin audio settings.
  function autoApply() { API.ready().then(function () { API.apply(document); API.observe(); }); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoApply);
  } else {
    autoApply();
  }
  // Re-apply shortly after load too (covers players that build <audio> in script).
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', function () { setTimeout(autoApply, 300); });
  }
  API.onChange(function () { API.apply(document); });
})();
