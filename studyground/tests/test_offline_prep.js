/* sg2 assets/offline-prep.js — 오프라인 사전 다운로드 · 자동 업데이트 검증.
 *
 * 여기서 잡고 싶은 것은 "받아지느냐"가 아니라 그 주변의 판단이다:
 *   · 캐시 이름을 서비스워커에게 물어 쓰는가 (버려진 캐시를 채우면 안 된다)
 *   · 이미 있는 파일을 다시 받지 않는가 (끊겼다 다시 열면 이어받아야 한다)
 *   · 같은 주소에 내용이 바뀌면 그것만 다시 받는가 (전체 25 MB 가 아니라)
 *   · 목록에서 빠진 파일을 캐시에서 지우는가
 *   · 일부가 실패해도 나머지를 마저 받고, 준비 완료로 속이지 않는가
 *   · 시험 화면(data-mode="check")에서는 회선을 쓰지 않는가
 *   · 데이터 절약 모드에서 25 MB 를 말없이 당기지 않는가
 *
 * 실행: node studyground/tests/test_offline_prep.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'sg2', 'assets', 'offline-prep.js');
var MANIFEST = path.join(__dirname, '..', 'sg2', 'config', 'offline.set9.json');
var CACHE = 'sg-media-v2';
var BASE = 'https://sg.example/';

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function section(t) { console.log('\n' + t); }

/* ── 가짜 브라우저 ────────────────────────────────────────────
   offline-prep.js 가 실제로 만지는 것만 세운다. DOM 은 진행 표시용이라
   호출이 터지지 않을 만큼만 흉내 낸다. */

function fakeEl() {
  return {
    className: '', innerHTML: '', hidden: false, style: {}, onclick: null, children: [],
    classList: {
      _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c, on) { if (on) this._s[c] = true; else delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    setAttribute: function () {},
    addEventListener: function () {},
    appendChild: function (c) { this.children.push(c); return c; },
    querySelector: function () { return fakeEl(); }
  };
}

function makeCaches(seedUrls) {
  var stores = {};
  if (seedUrls) { stores[CACHE] = {}; seedUrls.forEach(function (u) { stores[CACHE][u] = true; }); }
  function box(name) { stores[name] = stores[name] || {}; return stores[name]; }
  return {
    _stores: stores,
    open: function (name) {
      var b = box(name);
      return Promise.resolve({
        match: function (url) { return Promise.resolve(b[url] ? { ok: true } : undefined); },
        put: function (url) { b[url] = true; return Promise.resolve(); },
        delete: function (req) { delete b[req.url || req]; return Promise.resolve(true); },
        keys: function () {
          return Promise.resolve(Object.keys(b).map(function (u) { return { url: u }; }));
        }
      });
    },
    keys: function () { return Promise.resolve(Object.keys(stores)); }
  };
}

/* 스크립트를 매번 새 전역 위에서 다시 평가한다 — 모듈 안의 state 가 시험마다 깨끗해야 한다. */
function boot(opts) {
  opts = opts || {};
  var manifest = opts.manifest || JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  var log = { fetched: [], calls: [], swAsked: 0 };

  var g = {};
  g.window = g;
  g._listeners = {};
  g.addEventListener = function (t, fn) { (g._listeners[t] = g._listeners[t] || []).push(fn); };
  g.document = {
    readyState: 'complete',
    baseURI: BASE,
    currentScript: { dataset: opts.mode ? { mode: opts.mode } : {} },
    body: fakeEl(),
    createElement: function () { return fakeEl(); },
    addEventListener: function () {}
  };
  g.navigator = {
    onLine: opts.online !== false,
    connection: opts.saveData ? { saveData: true } : {},
    serviceWorker: {
      ready: Promise.resolve({
        active: {
          postMessage: function (msg, ports) {
            log.swAsked++;
            if (opts.oldSW) return;          // 옛 서비스워커 — 이 메시지를 모른다
            setTimeout(function () { ports[0]._deliver({ media: opts.cacheName || CACHE }); }, 0);
          }
        }
      })
    }
  };
  if (opts.noSW) delete g.navigator.serviceWorker;

  g.caches = opts.caches || makeCaches();
  g.localStorage = {
    _d: {},
    getItem: function (k) { return this._d[k] || null; },
    setItem: function (k, v) { this._d[k] = v; }
  };
  if (opts.record) g.localStorage._d['sg2_offline_have'] = JSON.stringify(opts.record);
  g.URL = URL;
  g.setTimeout = setTimeout;
  g.MessageChannel = function () {
    var p1 = { onmessage: null };
    var p2 = { _deliver: function (d) { if (p1.onmessage) p1.onmessage({ data: d }); } };
    this.port1 = p1; this.port2 = p2;
  };
  g.fetch = function (url, init) {
    log.fetched.push(url);
    log.calls.push({ url: url, headers: (init && init.headers) || {} });
    if (opts.failing && opts.failing.some(function (f) { return url.indexOf(f) !== -1; })) {
      return Promise.resolve({ ok: false, status: 502 });
    }
    if (url.indexOf('offline.set9.json') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(manifest); } });
    }
    return Promise.resolve({ ok: true, status: 200 });
  };

  vm.createContext(g);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), g);
  return { g: g, log: log, manifest: manifest, api: g.SG_OFFLINE };
}

function settle() {
  return new Promise(function (r) { setTimeout(r, 80); });
}
function mediaFetches(b) {
  return b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
}
function fullRecord(mf) {
  var have = {};
  mf.files.forEach(function (f) { have[f.u] = f.h; });
  return { rev: mf.rev, have: have };
}
function allUrls(mf) {
  return mf.files.map(function (f) { return BASE + f.u; });
}
function stored(b) {
  return JSON.parse(b.g.localStorage._d['sg2_offline_have'] || '{}');
}

/* ── 1. 목록 자체 ─────────────────────────────────────────── */
section('목록 (config/offline.set9.json)');
var m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
ok(m.count === m.files.length, '선언한 개수와 실제 항목 수가 같다 (' + m.count + ')');
ok(m.bytes === m.files.reduce(function (s, f) { return s + f.b; }, 0), '선언한 총 바이트가 항목 합과 같다');
ok(typeof m.rev === 'string' && m.rev.length >= 8, '목록 전체의 지문(rev)이 있다 — ' + m.rev);
ok(m.files.every(function (f) { return typeof f.h === 'string' && f.h.length >= 8; }),
   '파일마다 내용 해시가 있다 (같은 주소의 교체를 알아채는 근거)');
ok(m.files.every(function (f) { return /^media\//.test(f.u); }), '모든 경로가 media/ 아래다');
ok(m.files.every(function (f) { return f.b > 0; }), '빈 파일이 없다');
ok(!m.files.some(function (f) { return /_backup|_segments/.test(f.u); }),
   '생성 중간물(_backup_* · _segments_*)이 섞여 있지 않다');
ok(m.files.every(function (f) { return fs.existsSync(path.join(__dirname, '..', 'sg2', f.u)); }),
   '목록의 파일이 모두 실제로 존재한다');
var seen = {}, dup = false;
m.files.forEach(function (f) { if (seen[f.u]) dup = true; seen[f.u] = 1; });
ok(!dup, '중복 항목이 없다');

/* ── 2. 동작 ─────────────────────────────────────────────── */
var t = [];

t.push(function () {
  section('빈 기기에서 페이지를 열면');
  var b = boot({});
  return settle().then(function () {
    var media = mediaFetches(b);
    ok(b.log.swAsked > 0, '캐시 이름을 서비스워커에게 물었다');
    ok(media.length === m.count, '누르지 않아도 ' + m.count + '개를 전부 받았다 (' + media.length + ')');
    ok(Object.keys(b.g.caches._stores[CACHE] || {}).length === m.count, '받은 파일이 미디어 캐시에 들어갔다');
    ok(media.every(function (u) { return u.indexOf(BASE) === 0; }), '경로를 문서 기준 절대 주소로 풀었다');
    ok(stored(b).rev === m.rev, '전부 받은 뒤 목록 판본(rev)을 기록했다');
  });
});

t.push(function () {
  section('절반만 받다 끊긴 기기에서 (이어받기)');
  var half = m.files.slice(0, 40);
  var rec = { rev: null, have: {} };
  half.forEach(function (f) { rec.have[f.u] = f.h; });
  var b = boot({ caches: makeCaches(half.map(function (f) { return BASE + f.u; })), record: rec });
  return settle().then(function () {
    var media = mediaFetches(b);
    ok(media.length === m.count - 40, '있는 것은 건너뛰고 나머지 ' + (m.count - 40) + '개만 받았다 (' + media.length + ')');
    ok(!media.some(function (u) { return u.indexOf(m.files[0].u) !== -1; }), '이미 받은 파일을 다시 받지 않았다');
  });
});

t.push(function () {
  section('이미 최신인 기기에서');
  var b = boot({ caches: makeCaches(allUrls(m)), record: fullRecord(m) });
  return settle().then(function () {
    ok(mediaFetches(b).length === 0, '아무것도 다시 받지 않는다');
    ok(b.log.fetched.some(function (u) { return u.indexOf('offline.set9.json') !== -1; }),
       '그래도 목록은 매번 새로 읽는다 — 업데이트 확인은 이 한 번의 요청이다');
    return b.api.status().then(function (s) {
      ok(s.ready === true && s.stale === 0 && s.fresh === 0, 'status() 가 최신으로 답한다');
      ok(s.have === m.count && s.haveBytes === m.bytes, '보유량이 총량과 같다');
    });
  });
});

t.push(function () {
  section('서버에서 오디오 두 개가 바뀌면 (같은 주소, 새 내용)');
  var changed = JSON.parse(JSON.stringify(m));
  changed.files[0].h = 'ffffffffffff';
  changed.files[5].h = 'eeeeeeeeeeee';
  changed.rev = 'newrev000000';
  var b = boot({ caches: makeCaches(allUrls(m)), record: fullRecord(m), manifest: changed });
  return settle().then(function () {
    var media = mediaFetches(b);
    ok(media.length === 2, '바뀐 2개만 다시 받았다 — 25 MB 전체가 아니라 (' + media.length + ')');
    ok(media.some(function (u) { return u.indexOf(m.files[0].u) !== -1; }) &&
       media.some(function (u) { return u.indexOf(m.files[5].u) !== -1; }), '받은 것이 바로 그 두 개다');
    ok(media.every(function (u) {
      var call = b.log.calls.filter(function (c) { return c.url === u; })[0];
      return call && call.headers['x-sg-refresh'] === '1';
    }), '갱신 요청에 x-sg-refresh 를 달았다 — 없으면 캐시의 옛 파일이 되돌아온다');
    ok(stored(b).rev === 'newrev000000', '새 판본을 기록했다');
    ok(stored(b).have[m.files[0].u] === 'ffffffffffff', '그 파일의 보유 해시가 새 값으로 바뀌었다');
  });
});

t.push(function () {
  section('문항이 교체되어 목록에서 빠진 파일이 생기면');
  var shrunk = JSON.parse(JSON.stringify(m));
  var dropped = shrunk.files.pop();
  shrunk.count = shrunk.files.length;
  shrunk.bytes -= dropped.b;
  shrunk.rev = 'shrunk000000';
  var b = boot({ caches: makeCaches(allUrls(m)), record: fullRecord(m), manifest: shrunk });
  return settle().then(function () {
    var box = b.g.caches._stores[CACHE];
    ok(!box[BASE + dropped.u], '더 이상 쓰지 않는 파일을 캐시에서 지웠다');
    ok(Object.keys(box).length === shrunk.count, '캐시에 남은 개수가 새 목록과 같다');
    ok(mediaFetches(b).length === 0, '지우기만 하고 새로 받지는 않았다');
    ok(!stored(b).have[dropped.u], '보유 기록에서도 지웠다');
  });
});

t.push(function () {
  section('캐시에는 있는데 어느 판본인지 모르는 파일 (기록 없음)');
  var b = boot({ caches: makeCaches(allUrls(m)) });   // record 없음
  return settle().then(function () {
    ok(mediaFetches(b).length === m.count,
       '확인할 수 없으면 최신이라 우기지 않고 다시 받는다 (' + mediaFetches(b).length + ')');
  });
});

t.push(function () {
  section('일부 파일이 서버에서 실패하면');
  var b = boot({ failing: ['l1-q01.mp3', 'l1-q02.mp3'] });
  return settle().then(function () {
    return b.api.status().then(function (s) {
      ok(s.ready === false, '준비 완료로 속이지 않는다');
      ok(s.have === m.count - 2, '실패한 2개를 뺀 나머지는 다 받았다 (' + s.have + ')');
      ok(!b.g.caches._stores[CACHE][BASE + 'media/audio/set9/l1-q01.mp3'], '실패한 응답을 캐시에 넣지 않았다');
      ok(!stored(b).rev, '반쪽짜리를 최신 판본으로 적지 않는다 — 다음 방문이 그냥 지나가면 안 된다');
    });
  });
});

t.push(function () {
  section('시험 화면 (data-mode="check")');
  var b = boot({ mode: 'check' });
  return settle().then(function () {
    ok(mediaFetches(b).length === 0, '응시 중에는 회선을 쓰지 않는다');
    ok(b.log.fetched.some(function (u) { return u.indexOf('offline.set9.json') !== -1; }),
       '대신 목록을 읽어 무엇이 빠졌는지는 확인한다');
  });
});

t.push(function () {
  section('데이터 절약 모드 · 오프라인');
  var save = boot({ saveData: true });
  return settle().then(function () {
    ok(mediaFetches(save).length === 0, '종량제 회선에서 25 MB 를 말없이 당기지 않는다');
    var off = boot({ online: false });
    return settle().then(function () {
      ok(mediaFetches(off).length === 0, '이미 오프라인이면 받기를 시도하지 않는다');
      // 와이파이에 다시 붙으면 스스로 다시 본다.
      off.g.navigator.onLine = true;
      (off.g._listeners.online || []).forEach(function (fn) { fn(); });
      return settle().then(function () {
        ok(mediaFetches(off).length === m.count, '회선이 돌아오자 그때 받았다 (' + mediaFetches(off).length + ')');
      });
    });
  });
});

t.push(function () {
  section('서비스워커가 없거나 옛 버전일 때');
  var b = boot({ oldSW: true });
  return settle().then(function () {
    ok(mediaFetches(b).length === 0, '캐시 이름을 모르면 아무 데도 쓰지 않는다');
    ok(Object.keys(b.g.caches._stores).length === 0, '엉뚱한 캐시를 새로 만들지 않았다');
    var n = boot({ noSW: true });
    return settle().then(function () {
      return n.api.status().then(function (s) {
        ok(s.supported === false, '서비스워커가 없으면 supported:false 로 답한다');
      });
    });
  });
});

t.push(function () {
  section('서비스워커가 알려준 캐시 이름을 쓴다');
  var b = boot({ cacheName: 'sg-media-v9' });
  return settle().then(function () {
    var names = Object.keys(b.g.caches._stores);
    ok(names.length === 1 && names[0] === 'sg-media-v9', '알려준 이름에 넣었다 — 짐작한 이름을 쓰지 않는다');
  });
});

t.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
  .then(function () {
    console.log('\n' + (fails ? fails + ' 실패' : '전부 통과'));
    process.exit(fails ? 1 : 0);
  })
  .catch(function (e) { console.error(e); process.exit(1); });
