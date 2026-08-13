/* 시작 전에 "이 답안이 이 기기 밖에도 남는가"를 묻는다 (sg-storage-guard.js).
 * 실행: node studyground/tests/test_storage_guard.js
 *
 * 발주 요구(2026-08-13): "비로그인 상태로 응시 시작하려 할 때 경고. 시크릿 모드 감지."
 *
 * 사고의 모양은 하나다. 답안은 세 층에 산다 — localStorage(답안·시계) · IndexedDB(녹음)
 * · Supabase(기기 밖 사본). 앞의 둘은 그 브라우저 프로필 안에만 있어서 시크릿 창이면
 * 창을 닫는 순간, PC 를 바꾸면 그 자리에서 사라진다. 셋째 층만 살아남는데 그 층은
 * sg2 로그인이 있어야 열린다(exam-cloud.js 는 토큰이 없으면 큐에만 쌓는다).
 * 그러니 비로그인 응시는 "두 시간을 치르고 자리를 뜨는 순간 없어지는" 응시다.
 *
 * 여기서 고정하는 성질.
 *  [1] 로그인 + 저장소 정상이면 아무것도 그리지 않는다 — 평상시에는 존재하지 않는다.
 *  [2] 비로그인이면 막이 서고, 그 동안 boot 은 돌지 않는다(시계가 흐르지 않는다).
 *  [3] Start anyway 는 언제나 있다 — 시험을 막지 않는다(F12).
 *  [4] localStorage 가 막힌 창(시크릿 등)도 같은 막으로 잡는다.
 *  [5] IndexedDB 는 "거부당했을 때"만 위험이다. 대답이 없는 것은 위험으로 세지 않는다 —
 *      멀쩡한 기기에 뜨는 경고 하나가 모든 경고를 못 믿게 만든다.
 *  [6] 스스로를 잠근 문서(meta sg-auth=required)는 sg-auth 의 막에 맡기고, 그 뒤에서
 *      시험을 시작하지 않는다.
 *  [7] 읽고 시작한 탭은 새로고침해도 다시 묻지 않는다(정전 복구가 매번 막히지 않게).
 *
 * 브라우저 없이 돌리려고 window/document/localStorage/indexedDB 를 최소한으로 흉내 낸다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SRC = fs.readFileSync(
  path.join(__dirname, '..', 'sg2', 'assets', 'sg-storage-guard.js'), 'utf8');

var fails = [];
function ok(name, cond, info) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
  if (!cond) fails.push(name);
}

/* ── 최소 브라우저 흉내 ─────────────────────────────────────── */

function makeEl(sink) {
  var el = {
    style: {}, className: '', id: '', children: [], _html: '',
    setAttribute: function () {},
    appendChild: function (c) { this.children.push(c); },
    addEventListener: function () {},
    querySelector: function (sel) {
      var self = this;
      if (!self._html) return null;
      if (sel === '.sg-guard-anyway') {
        return { addEventListener: function (t, f) { self._anyway = f; }, focus: function () {} };
      }
      if (sel === '.sg-guard-go') {
        return self._html.indexOf('sg-guard-go') !== -1 ? { focus: function () {} } : null;
      }
      return null;
    }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = v; }
  });
  sink.push(el);
  return el;
}

function deadStorage() {
  return {
    setItem: function () { throw new Error('blocked'); },
    removeItem: function () {},
    getItem: function () { throw new Error('blocked'); }
  };
}
function liveStorage(seed) {
  var m = seed || {};
  return {
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }
  };
}

function makeWindow(o) {
  var nodes = [];
  var w = {
    location: { href: 'https://x.test/set9.html', search: '' },
    navigator: {},
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: o.localOk === false ? deadStorage() : liveStorage(),
    sessionStorage: liveStorage(o.acked ? { sg2_guard_ack: '1' } : {}),
    document: {
      baseURI: 'https://x.test/set9.html',
      readyState: 'complete',
      body: makeEl(nodes),
      createElement: function () { return makeEl(nodes); },
      querySelector: function (sel) {
        if (sel.indexOf('meta') !== 0) return null;
        return o.metaRequired ? { getAttribute: function () { return 'required'; } } : null;
      },
      addEventListener: function () {}
    }
  };
  if (o.idb !== 'absent') {
    w.indexedDB = {
      open: function () {
        var req = {};
        setTimeout(function () {
          if (o.idb === 'error') { if (req.onerror) req.onerror(); return; }
          if (o.idb === 'silent') return;             // 아무 답도 하지 않는다
          req.result = { close: function () {} };
          if (req.onsuccess) req.onsuccess();
        }, 5);
        return req;
      },
      deleteDatabase: function () {}
    };
  }
  if (o.user !== undefined) w.SG_AUTH = { user: function () { return o.user; } };
  w._nodes = nodes;
  return w;
}

/* 파일은 window 하나만 만지므로, 그 window 를 넘겨 통째로 평가하면 된다. */
function loadGuard(w) {
  return new Function('window', SRC + '\nreturn window.SG_GUARD;')(w);
}

function run(name, opts, expect) {
  return new Promise(function (resolve) {
    var w = makeWindow(opts);
    var G = loadGuard(w);
    var opened = false;
    G.gate(function () { opened = true; });
    setTimeout(function () {
      var gate = null;
      for (var i = 0; i < w._nodes.length; i++) if (w._nodes[i]._html) gate = w._nodes[i];
      var shown = !!gate;
      var risks = JSON.stringify(G.state().risks);
      ok(name, shown === expect.shown && opened === expect.opened &&
               (!expect.risks || risks === JSON.stringify(expect.risks)),
         'shown=' + shown + ' opened=' + opened + ' risks=' + risks);
      if (shown && expect.opensOnClick) {
        gate._anyway();
        ok(name + ' → Start anyway 를 누르면 시작된다', opened);
      }
      resolve();
    }, opts.idb === 'silent' ? 1500 : 60);   // 무응답 검사는 probe 의 1.2초를 기다린다
  });
}

/* ── 검사 ──────────────────────────────────────────────────── */

(function () {
  Promise.resolve()
    .then(function () { return run('[1] 로그인 + 저장소 정상이면 막이 서지 않는다',
      { user: { id: 1 }, idb: 'ok' }, { shown: false, opened: true, risks: [] }); })
    .then(function () { return run('[2] 비로그인이면 막이 서고 시험은 아직 시작하지 않는다',
      { user: null, idb: 'ok' }, { shown: true, opened: false, risks: ['login'], opensOnClick: true }); })
    .then(function () { return run('[4] localStorage 가 막힌 창(시크릿)도 같은 막으로 잡는다',
      { user: { id: 1 }, idb: 'ok', localOk: false }, { shown: true, opened: false, risks: ['local'] }); })
    .then(function () { return run('[5] IndexedDB 거부는 위험이다',
      { user: { id: 1 }, idb: 'error' }, { shown: true, opened: false, risks: ['idb'] }); })
    .then(function () { return run('[5] IndexedDB 무응답은 위험으로 세지 않는다',
      { user: { id: 1 }, idb: 'silent' }, { shown: false, opened: true, risks: [] }); })
    .then(function () { return run('[6] meta required + 비로그인 → sg-auth 에 맡기고 시계도 걸지 않는다',
      { user: null, idb: 'ok', metaRequired: true }, { shown: false, opened: false, risks: ['login'] }); })
    .then(function () { return run('[6] meta required + 로그인 → 곧장 시작',
      { user: { id: 1 }, idb: 'ok', metaRequired: true }, { shown: false, opened: true, risks: [] }); })
    .then(function () { return run('[7] 읽고 시작한 탭은 새로고침해도 다시 묻지 않는다',
      { user: null, idb: 'ok', acked: true }, { shown: false, opened: true }); })
    .then(function () { return run('SG_AUTH 가 아예 없는 문서에서는 로그인을 묻지 않는다',
      { idb: 'ok' }, { shown: false, opened: true, risks: [] }); })
    .then(function () {
      /* 배선 — 셸이 이 문을 지나 boot 하는가, 그리고 응시 화면이 파일을 싣는가. */
      var SG2 = path.join(__dirname, '..', 'sg2');
      var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');
      ok('[2] 셸은 gate 를 지나 boot 한다', shell.indexOf('SG_GUARD') > 0 &&
         shell.indexOf('G.gate(boot)') > 0);

      var PAGES = ['set9.html', 'set9-reading.html', 'exam-runtime.html',
                   'en/test-nt/reading/index.html', 'en/test-nt/listening/index.html',
                   'en/test-nt/speaking/index.html', 'en/test-nt/writing/index.html'];
      PAGES.forEach(function (p) {
        var html = fs.readFileSync(path.join(SG2, p), 'utf8');
        var guard = html.indexOf('assets/sg-storage-guard.js') > 0;
        var auth = html.indexOf('assets/sg-auth.js') > 0;
        /* sg-auth 까지 보는 이유: exam-cloud.js 는 SG_AUTH.token() 으로 답안을 올린다.
           그 파일이 없는 응시 화면은 로그인해도 클라우드로 아무것도 보내지 못한다. */
        ok('응시 화면이 막과 세션을 함께 싣는다 · ' + p, guard && auth,
           'guard=' + guard + ' auth=' + auth);
        ok('  막은 셸보다 먼저 실린다 · ' + p,
           html.indexOf('assets/sg-storage-guard.js') < html.indexOf('assets/exam-shell.js'));
        /* 학생이 처음 앉는 자리는 로그인을 강제하지 않는다 — 회선 없는 시험장에서
           로그인 막이 서면 시험 자체가 시작되지 않는다(F12). 알리되 막지 않는다.
           관리자·재응시로 들어오는 exam-runtime.html 만 여전히 잠겨 있다. */
        if (p !== 'exam-runtime.html') {
          ok('  로그인을 강제하지는 않는다 · ' + p,
             html.indexOf('sg-auth" content="required"') < 0);
        }
      });

      var sw = fs.readFileSync(path.join(SG2, 'sw.js'), 'utf8');
      ok('오프라인 시험장을 위해 셸 캐시에 들어 있다',
         sw.indexOf("'assets/sg-storage-guard.js'") > 0);

      console.log('');
      if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
      console.log('all passed');
    });
}());
