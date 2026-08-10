/* sg2 assets/offline-prep.js — 오프라인 사전 다운로드 검증.
 *
 * 여기서 잡고 싶은 것은 "받아지느냐"가 아니라 그 주변의 판단이다:
 *   · 캐시 이름을 서비스워커에게 물어 쓰는가 (VERSION 판올림 직후 버려진 캐시를 채우면 안 된다)
 *   · 이미 있는 파일을 다시 받지 않는가 (끊겼다 다시 열면 이어받아야 한다)
 *   · 일부가 실패해도 나머지를 마저 받고, 준비 완료로 속이지 않는가
 *   · 시험 화면(data-mode="check")에서는 회선을 쓰지 않는가
 *   · 데이터 절약 모드에서 25 MB 를 말없이 당기지 않는가
 *
 * 실행: node studyground/tests/test_offline_prep.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'sg2', 'assets', 'offline-prep.js');
var MANIFEST = path.join(__dirname, '..', 'sg2', 'config', 'offline.set9.json');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function section(t) { console.log('\n' + t); }

/* ── 가짜 브라우저 ────────────────────────────────────────────
   offline-prep.js 가 실제로 만지는 것만 세운다. DOM 은 진행 표시용이라
   호출이 터지지 않을 만큼만 흉내 낸다. */

function fakeEl() {
  var el = {
    className: '', innerHTML: '', hidden: false, style: {}, onclick: null,
    children: [],
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
  return el;
}

function makeCaches() {
  var stores = {};
  return {
    _stores: stores,
    open: function (name) {
      stores[name] = stores[name] || {};
      var box = stores[name];
      return Promise.resolve({
        match: function (url) { return Promise.resolve(box[url] ? { ok: true } : undefined); },
        put: function (url) { box[url] = true; return Promise.resolve(); }
      });
    },
    keys: function () { return Promise.resolve(Object.keys(stores)); }
  };
}

/* 스크립트를 매번 새 전역 위에서 다시 평가한다 — 모듈 안의 state 가 시험마다 깨끗해야 한다. */
function boot(opts) {
  opts = opts || {};
  var manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  var log = { fetched: [], swAsked: 0, autoRan: false };

  var g = {};
  g.window = g;
  g.document = {
    readyState: 'complete',
    baseURI: 'https://sg.example/',
    currentScript: { dataset: opts.mode ? { mode: opts.mode } : {} },
    body: fakeEl(),
    createElement: function () { return fakeEl(); },
    addEventListener: function () {}
  };
  g.navigator = {
    onLine: opts.online !== false,
    connection: opts.saveData ? { saveData: true } : {},
    serviceWorker: opts.noSW ? undefined : {
      ready: Promise.resolve({
        active: {
          postMessage: function (msg, ports) {
            log.swAsked++;
            if (opts.oldSW) return;           // 옛 서비스워커 — 답이 없다
            ports[0].onmessage_target = null;
            // MessageChannel 흉내: port2 로 보낸 답이 port1.onmessage 로 간다
            setTimeout(function () { ports[0]._deliver({ media: opts.cacheName || 'sg-media-sg-v25' }); }, 0);
          }
        }
      })
    }
  };
  if (opts.noSW) delete g.navigator.serviceWorker;

  g.caches = opts.caches || makeCaches();
  g.localStorage = { _d: {}, getItem: function (k) { return this._d[k] || null; },
                     setItem: function (k, v) { this._d[k] = v; } };
  g.URL = URL;
  g.setTimeout = setTimeout;
  g.MessageChannel = function () {
    var p1 = { onmessage: null };
    var p2 = { _deliver: function (data) { if (p1.onmessage) p1.onmessage({ data: data }); } };
    this.port1 = p1; this.port2 = p2;
  };
  g.fetch = function (url) {
    log.fetched.push(url);
    if (opts.failing && opts.failing.some(function (f) { return url.indexOf(f) !== -1; })) {
      return Promise.resolve({ ok: false, status: 502 });
    }
    if (url.indexOf('offline.set9.json') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(manifest); } });
    }
    return Promise.resolve({ ok: true, status: 200 });
  };

  var code = fs.readFileSync(SRC, 'utf8');
  var vm = require('vm');
  vm.createContext(g);
  vm.runInContext(code, g);

  return { g: g, log: log, manifest: manifest, api: g.SG_OFFLINE };
}

function settle() {
  // 마이크로태스크 + setTimeout(0) 이 여러 겹 물려 있다 — 넉넉히 돌린다.
  return new Promise(function (r) { setTimeout(r, 60); });
}

/* ── 1. 목록 자체 ─────────────────────────────────────────── */
section('목록 (config/offline.set9.json)');
var m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
ok(m.count === m.files.length, '선언한 개수와 실제 항목 수가 같다 (' + m.count + ')');
ok(m.bytes === m.files.reduce(function (s, f) { return s + f.b; }, 0), '선언한 총 바이트가 항목 합과 같다');
ok(m.files.every(function (f) { return /^media\//.test(f.u); }), '모든 경로가 media/ 아래다');
ok(m.files.every(function (f) { return f.b > 0; }), '빈 파일이 없다');
ok(!m.files.some(function (f) { return /_backup|_segments/.test(f.u); }),
   '생성 중간물(_backup_* · _segments_*)이 섞여 있지 않다');
ok(m.files.every(function (f) { return fs.existsSync(path.join(__dirname, '..', 'sg2', f.u)); }),
   '목록의 파일이 모두 실제로 존재한다');
var seen = {}, dup = false;
m.files.forEach(function (f) { if (seen[f.u]) dup = true; seen[f.u] = 1; });
ok(!dup, '중복 항목이 없다');

/* ── 2. 자동 실행 ─────────────────────────────────────────── */
var t = [];

t.push(function () {
  section('빈 기기에서 페이지를 열면');
  var b = boot({});
  return settle().then(function () {
    var media = b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
    ok(b.log.swAsked > 0, '캐시 이름을 서비스워커에게 물었다');
    ok(media.length === b.manifest.count,
       '누르지 않아도 ' + b.manifest.count + '개를 전부 받았다 (' + media.length + ')');
    var box = b.g.caches._stores['sg-media-sg-v25'];
    ok(box && Object.keys(box).length === b.manifest.count, '받은 파일이 미디어 캐시에 들어갔다');
    ok(media.every(function (u) { return u.indexOf('https://sg.example/') === 0; }),
       '경로를 문서 기준 절대 주소로 풀었다');
  });
});

t.push(function () {
  section('절반이 이미 있는 기기에서');
  var c = makeCaches();
  return c.open('sg-media-sg-v25').then(function (cache) {
    var half = m.files.slice(0, 40);
    return Promise.all(half.map(function (f) { return cache.put('https://sg.example/' + f.u); }));
  }).then(function () {
    var b = boot({ caches: c });
    return settle().then(function () {
      var media = b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
      ok(media.length === m.count - 40, '있는 것은 건너뛰고 나머지 ' + (m.count - 40) + '개만 받았다 (' + media.length + ')');
      ok(!media.some(function (u) { return u.indexOf(m.files[0].u) !== -1; }), '이미 받은 파일을 다시 받지 않았다');
    });
  });
});

t.push(function () {
  section('이미 다 받아 둔 기기에서');
  var c = makeCaches();
  return c.open('sg-media-sg-v25').then(function (cache) {
    return Promise.all(m.files.map(function (f) { return cache.put('https://sg.example/' + f.u); }));
  }).then(function () {
    var b = boot({ caches: c });
    return settle().then(function () {
      var media = b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
      ok(media.length === 0, '아무것도 다시 받지 않는다');
      return b.api.status().then(function (s) {
        ok(s.ready === true, 'status() 가 준비 완료로 답한다');
        ok(s.have === m.count && s.haveBytes === m.bytes, '보유량이 총량과 같다');
      });
    });
  });
});

t.push(function () {
  section('일부 파일이 서버에서 실패하면');
  var b = boot({ failing: ['l1-q01.mp3', 'l1-q02.mp3'] });
  return settle().then(function () {
    return b.api.status().then(function (s) {
      ok(s.ready === false, '준비 완료로 속이지 않는다');
      ok(s.have === m.count - 2, '실패한 2개를 뺀 나머지는 다 받았다 (' + s.have + ')');
      var box = b.g.caches._stores['sg-media-sg-v25'];
      ok(!box['https://sg.example/media/audio/set9/l1-q01.mp3'], '실패한 응답을 캐시에 넣지 않았다');
    });
  });
});

t.push(function () {
  section('시험 화면 (data-mode="check")');
  var b = boot({ mode: 'check' });
  return settle().then(function () {
    var media = b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
    ok(media.length === 0, '응시 중에는 회선을 쓰지 않는다');
    ok(b.log.fetched.some(function (u) { return u.indexOf('offline.set9.json') !== -1; }),
       '대신 목록을 읽어 무엇이 빠졌는지는 확인한다');
  });
});

t.push(function () {
  section('데이터 절약 모드 · 오프라인');
  var save = boot({ saveData: true });
  return settle().then(function () {
    var media = save.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
    ok(media.length === 0, '종량제 회선에서 25 MB 를 말없이 당기지 않는다');
    var off = boot({ online: false });
    return settle().then(function () {
      var m2 = off.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
      ok(m2.length === 0, '이미 오프라인이면 받기를 시도하지 않는다');
    });
  });
});

t.push(function () {
  section('서비스워커가 없거나 옛 버전일 때');
  var b = boot({ oldSW: true });
  return settle().then(function () {
    var media = b.log.fetched.filter(function (u) { return u.indexOf('/media/') !== -1; });
    ok(media.length === 0, '캐시 이름을 모르면 아무 데도 쓰지 않는다 (엉뚱한 캐시를 만들지 않는다)');
    ok(Object.keys(b.g.caches._stores).length === 0, '캐시를 새로 만들지 않았다');
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
  var b = boot({ cacheName: 'sg-media-sg-v99' });
  return settle().then(function () {
    var names = Object.keys(b.g.caches._stores);
    ok(names.length === 1 && names[0] === 'sg-media-sg-v99',
       '판올림된 이름(sg-v99)에 넣었다 — 짐작한 이름을 쓰지 않는다');
  });
});

t.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
  .then(function () {
    console.log('\n' + (fails ? fails + ' 실패' : '전부 통과'));
    process.exit(fails ? 1 : 0);
  })
  .catch(function (e) { console.error(e); process.exit(1); });
