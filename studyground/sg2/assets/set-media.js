/* SMEAG StudyGround — set-media.js : 업로드로 만든 세트의 그림 보관소.
 *
 * 왜 필요한가
 *   문항 docx 안에는 삽화가 들어 있고(SET 9 은 20장, 4.7MB), 팩은 그것을
 *   'media/pictures/set10/image13.png' 로 가리킨다. 커밋된 세트는 그 파일이 저장소에 있지만
 *   업로드로 만든 세트는 없다 — 브라우저 메모리에만 있던 바이트라 어딘가 두지 않으면
 *   시험 화면에서 그림이 전부 깨진다.
 *
 *   base64 로 팩에 심는 방법은 못 쓴다. 4.7MB 는 base64 로 6.4MB 가 되어
 *   localStorage(보통 5MB)를 넘긴다. 그래서 오디오 덮어쓰기(assets/audio-config.js)가
 *   쓰는 것과 같은 방식 — IndexedDB 에 blob 으로 넣고, 화면에서 object URL 로 바꿔 준다.
 *
 * 계약
 *   SG_SET_PICS.put(path, blobOrBytes)  저장 (path 는 팩에 적힌 그대로)
 *   SG_SET_PICS.ready()                 blob → object URL 재수화. resolve() 전에 한 번.
 *   SG_SET_PICS.resolve(path)           → object URL 또는 원래 path
 *   SG_SET_PICS.apply(root)             <img> 의 src 를 바꿔 끼운다
 *   SG_SET_PICS.observe()               나중에 만들어지는 <img> 까지 따라간다
 *   SG_SET_PICS.removeSet(prefix)       세트 하나를 통째로 지운다
 *
 * ES5 문법만 쓴다(빌드 단계 없음).
 */
(function () {
  'use strict';

  var DB_NAME = 'sg-set-pictures';
  var DB_STORE = 'files';

  var blobUrls = {};      // path -> object URL (로드할 때마다 새로 만든다)
  var known = {};         // path -> true
  var dbFailed = false;
  var readyPromise = null;

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

  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(DB_STORE, mode);
        var out = fn(t.objectStore(DB_STORE));
        t.oncomplete = function () { db.close(); res(out && out.value !== undefined ? out.value : out); };
        t.onerror = function () { db.close(); rej(t.error); };
      });
    });
  }

  var API = {
    /** 저장된 그림을 전부 object URL 로 되살린다. 한 번만 돈다. */
    ready: function () {
      if (readyPromise) return readyPromise;
      readyPromise = openDb().then(function (db) {
        return new Promise(function (res) {
          var t = db.transaction(DB_STORE, 'readonly');
          var cur = t.objectStore(DB_STORE).openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c) return;
            try { blobUrls[c.key] = URL.createObjectURL(c.value); known[c.key] = true; } catch (e) {}
            c['continue']();
          };
          t.oncomplete = function () { db.close(); res(API); };
          t.onerror = function () { db.close(); res(API); };
        });
      })['catch'](function () { return API; });
      return readyPromise;
    },

    /** @param {string} path 팩에 적힌 경로 @param {Blob|Uint8Array} data */
    put: function (path, data) {
      var blob = (typeof Blob !== 'undefined' && data instanceof Blob)
        ? data : new Blob([data], { type: guessType(path) });
      return tx('readwrite', function (store) { store.put(blob, path); }).then(function () {
        if (blobUrls[path]) { try { URL.revokeObjectURL(blobUrls[path]); } catch (e) {} }
        try { blobUrls[path] = URL.createObjectURL(blob); } catch (e) {}
        known[path] = true;
        return true;
      });
    },

    /** 여러 장을 한 번에. {path: bytes} */
    putAll: function (map) {
      var paths = Object.keys(map || {});
      var chain = Promise.resolve();
      paths.forEach(function (p) { chain = chain.then(function () { return API.put(p, map[p]); }); });
      return chain.then(function () { return paths.length; });
    },

    has: function (path) { return !!known[path]; },
    list: function () { return Object.keys(known); },

    resolve: function (path) { return blobUrls[path] || path; },

    /** 세트 하나가 쓰는 그림을 통째로 지운다. prefix 는 'media/pictures/set10/'. */
    removeSet: function (prefix) {
      var gone = Object.keys(known).filter(function (p) { return p.indexOf(prefix) === 0; });
      return tx('readwrite', function (store) {
        gone.forEach(function (p) { store['delete'](p); });
      }).then(function () {
        gone.forEach(function (p) {
          if (blobUrls[p]) { try { URL.revokeObjectURL(blobUrls[p]); } catch (e) {} }
          delete blobUrls[p]; delete known[p];
        });
        return gone.length;
      })['catch'](function () { return 0; });
    },

    /** <img> 의 src 를 저장된 그림으로 바꿔 끼운다. 원래 경로는 data-sg-orig 에 남긴다. */
    apply: function (root) {
      root = root || document;
      var els = root.querySelectorAll ? root.querySelectorAll('img[src]') : [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var orig = el.getAttribute('data-sg-orig') || el.getAttribute('src');
        if (!orig || orig.indexOf('media/pictures/') < 0) continue;
        if (!el.getAttribute('data-sg-orig')) el.setAttribute('data-sg-orig', orig);
        var eff = API.resolve(orig);
        if (eff !== el.getAttribute('src')) el.setAttribute('src', eff);
      }
    },

    /** 시험 화면은 <img> 를 화면마다 스크립트로 만들어 붙인다 — 한 번 훑는 것으로는 부족하다. */
    observe: function () {
      if (API._obs || typeof MutationObserver === 'undefined') return;
      API._obs = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var added = recs[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'IMG') API.apply(n.parentNode || document);
            else if (n.querySelector && n.querySelector('img')) API.apply(n);
          }
        }
      });
      var start = function () { API._obs.observe(document.documentElement, { childList: true, subtree: true }); };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    }
  };

  function guessType(path) {
    var ext = String(path).toLowerCase().split('.').pop();
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'webp') return 'image/webp';
    return 'application/octet-stream';
  }

  window.SG_SET_PICS = API;

  /* 이 파일이 실려 있으면 저장된 그림은 언제나 화면에 붙는다 —
     시험 화면이 별도 배선 없이 업로드 세트를 그대로 띄울 수 있어야 한다. */
  if (typeof indexedDB !== 'undefined') {
    API.ready().then(function () { API.apply(document); API.observe(); });
  }
})();
