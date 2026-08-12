/* sg2 assets/sg-update-check.js — 내려받은 사본의 판올림 확인 검증.
 *
 * 여기서 잡고 싶은 것은 "알림이 예쁘게 뜨느냐"가 아니라 그 주변의 판단이다:
 *   · 웹 사본에서는 아예 묻지 않는가 (그 일은 서비스워커가 이미 한다)
 *   · 낡은 사본에서만 알림이 뜨는가, 최신 사본에서는 조용한가
 *   · 판 비교를 숫자로 하는가 (문자열이면 'sg-v9' > 'sg-v45' 가 된다)
 *   · 오프라인이면 조용히 물러나고, 회선이 돌아온 첫 순간에 다시 묻는가
 *   · 한 번 닫은 판을 다시 들이밀지 않는가
 *   · 시험 화면에서는 회선도 화면도 건드리지 않는가
 *
 * 실행: node studyground/tests/test_update_check.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'sg2', 'assets', 'sg-update-check.js');
var CODE = fs.readFileSync(SRC, 'utf8');
var ORIGIN = 'https://sg.example';

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function section(t) { console.log('\n' + t); }

/* ── 가짜 브라우저 ────────────────────────────────────────────
   검사기가 실제로 만지는 것만 세운다: localStorage, fetch, 그리고 카드 하나를
   body 에 붙이는 정도의 DOM. */

function fakeEl(tag) {
  var el = {
    tag: tag, className: '', innerHTML: '', href: '', children: [],
    _on: {},
    classList: {
      _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    setAttribute: function () {},
    addEventListener: function (t, fn) { this._on[t] = fn; },
    appendChild: function (c) { this.children.push(c); return c; },
    remove: function () { el.removed = true; },
    querySelector: function (sel) {
      // innerHTML 을 파싱하지 않으므로, 검사기가 찾는 세 조각만 대신 돌려준다.
      if (!this._parts) this._parts = {};
      if (!this._parts[sel]) this._parts[sel] = fakeEl(sel);
      return this._parts[sel];
    }
  };
  return el;
}

function run(opts) {
  var store = opts.storage || {};
  var body = fakeEl('body');
  var fetched = [];
  var rafs = [];

  var sandbox = {
    window: {
      SG_BUILD: opts.build,
      AbortController: function () { this.signal = {}; this.abort = function () {}; }
    },
    location: { pathname: opts.pathname || '/index.html' },
    localStorage: {
      getItem: function (k) { return k in store ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    document: {
      body: body,
      createElement: function (t) { return fakeEl(t); }
    },
    fetch: function (url, init) {
      fetched.push({ url: url, init: init });
      return opts.reply();
    },
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    requestAnimationFrame: function (fn) { rafs.push(fn); },
    console: console
  };
  sandbox.window.location = sandbox.location;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);

  return {
    fetched: fetched,
    store: store,
    card: function () { return body.children[0] || null; },
    paint: function () { rafs.forEach(function (fn) { fn(); }); },
    body: body
  };
}

function build(over) {
  var b = { version: 'sg-v25', n: 25, channel: 'bundle', built: '2026-08-10T00:00:00Z', origin: ORIGIN };
  for (var k in (over || {})) b[k] = over[k];
  return b;
}
function live(n) {
  return function () {
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve({ version: 'sg-v' + n, n: n, download: ORIGIN + '/tools.html' });
      }
    });
  };
}
function offline() { return function () { return Promise.reject(new Error('offline')); }; }

function later() { return new Promise(function (r) { setImmediate(function () { setImmediate(r); }); }); }

(async function () {
  section('묻지 않아야 할 때');

  var web = run({ build: build({ channel: 'web' }), reply: live(46) });
  await later();
  ok(web.fetched.length === 0, '웹 사본은 라이브에 묻지 않는다 — 서비스워커가 하는 일이다');
  ok(web.card() === null, '웹 사본에는 알림이 뜨지 않는다');

  var old = run({ build: undefined, reply: live(46) });
  await later();
  ok(old.fetched.length === 0, '판 표가 없는 옛 사본에서도 터지지 않고 조용히 끝난다');

  var exam = run({ build: build(), reply: live(46), pathname: '/exam-runtime.html' });
  await later();
  ok(exam.fetched.length === 0, '응시 화면에서는 묻지 않는다');

  var soon = run({
    build: build(), reply: live(46),
    storage: { sg2_update_asked: String(Date.now() - 60 * 1000) }
  });
  await later();
  ok(soon.fetched.length === 0, '방금 물어봤으면 다시 묻지 않는다');

  section('낡은 사본');

  var stale = run({ build: build(), reply: live(46) });
  await later();
  ok(stale.fetched.length === 1, '라이브에 한 번 묻는다');
  ok(stale.fetched[0].url === ORIGIN + '/version.json', '주소는 사본이 아니라 라이브를 가리킨다');
  ok(stale.fetched[0].init.cache === 'no-store', '중간 캐시가 옛 판 번호로 답하지 못하게 한다');
  ok(stale.fetched[0].init.credentials === 'omit', '쿠키를 딸려 보내지 않는다');
  var card = stale.card();
  ok(card && card.className.indexOf('sg-update') >= 0, '알림 카드가 붙는다');
  ok(card && card.innerHTML.indexOf('sg-v25') >= 0 && card.innerHTML.indexOf('sg-v46') >= 0,
     '가진 판과 나온 판을 둘 다 보여 준다');
  ok(card && card.querySelector('.sg-prep-go').href === ORIGIN + '/tools.html',
     '받는 곳으로 가는 길이 있다');
  stale.paint();
  ok(card && card.classList.contains('on'), '한 프레임 뒤에 떠오른다');
  ok(stale.store.sg2_update_asked, '물어본 시각을 남긴다');

  section('최신 사본과 거꾸로 된 비교');

  var same = run({ build: build({ version: 'sg-v46', n: 46 }), reply: live(46) });
  await later();
  ok(same.card() === null, '같은 판이면 알림이 없다');

  // 문자열로 비교하면 'sg-v9' > 'sg-v46' 이라 최신 사본에 알림이 뜬다.
  var ahead = run({ build: build({ version: 'sg-v46', n: 46 }), reply: live(9) });
  await later();
  ok(ahead.card() === null, '라이브가 더 낮은 판이면 알림이 없다 (비교는 숫자로)');

  section('오프라인');

  var off = run({ build: build(), reply: offline() });
  await later();
  ok(off.card() === null, '회선이 없으면 아무것도 띄우지 않는다');
  ok(!off.store.sg2_update_asked,
     '물어본 시각을 남기지 않는다 — 회선이 돌아온 첫 순간에 다시 묻는다');

  section('닫은 판');

  var hidden = run({
    build: build(), reply: live(46),
    storage: { sg2_update_hidden: 'sg-v46' }
  });
  await later();
  ok(hidden.card() === null, '한 번 닫은 판은 다시 들이밀지 않는다');

  var dismiss = run({ build: build(), reply: live(46) });
  await later();
  var c = dismiss.card();
  c.querySelector('.sg-prep-x')._on.click();
  ok(dismiss.store.sg2_update_hidden === 'sg-v46', '닫으면 그 판을 기억한다');
  ok(!c.classList.contains('on'), '닫으면 사라진다');

  console.log('\n' + (fails ? '✗ ' + fails + ' 실패' : '✓ 전부 통과'));
  process.exit(fails ? 1 : 0);
})();
