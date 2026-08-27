/* recover-recordings.html — 한 세션에 계정이 둘이면 사람이 고르기 전에는 올리지 않는다.
 *
 * 2026-08-27 라이브에서 본 자리. sg_results 에 세션 offline-875f9127… 이 두 줄로
 * 있었다 — smeag029(FU ENZE) 와 smeag996 이 같은 offline 세션 id 로 각각 제출한
 * 것이다(같은 PC 에서 로그인만 바꾸면 이렇게 된다). 회수 페이지는 조회 결과를
 * 훑으며 owner 를 덮어써서 마지막 줄이 이겼고, 아무 말 없이 그 학생의 폴더로
 * 올리려 했다. 녹음은 남의 계정에 붙는다 — 조용히.
 *
 * 여기서 고정하는 성질.
 *  [1] 계정이 둘이면 업로드하지 않는다. 그 파일은 skip 이고, 이유가 화면에 남는다.
 *  [2] 누구인지 uuid 앞자리가 아니라 학번·이름으로 묻는다.
 *  [3] 고른 뒤에야 그 학생 폴더로 올라간다.
 *
 * 실행: node "studyground/tests/test_recover_owner_ambiguous.js"
 */
'use strict';

var fs = require('fs');
var path = require('path');

var PAGE = path.join(__dirname, '..', 'sg2', 'recover-recordings.html');
var src = fs.readFileSync(PAGE, 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); }
}
function settle() { return new Promise(function (r) { setImmediate(r); }); }

var SESSION = 'offline-875f9127-578c-ec3b-4c35-e2e0b02c6cae';
var A = 'da44e4c8-e7c7-465b-adfb-19f072ad4464';   // smeag029 · FU ENZE
var B = '948076cb-6f2a-4756-ac7a-2d43bf81ff8b';   // smeag996

var IDS = ['msg', 'btn-scan', 'btn-save', 'btn-up', 'stats', 's-sessions', 's-files',
           's-size', 's-up', 'signin', 'in-id', 'in-pw', 'btn-login', 'who', 'out'];
var els = {};
function mkEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', hidden: true, disabled: false,
    value: '', href: '', download: '', className: '', style: {}, _on: {},
    setAttribute: function () {}, getAttribute: function () { return null; },
    appendChild: function () {}, removeChild: function () {},
    addEventListener: function (t, fn) { this._on[t] = fn; },
    click: function () {}
  };
}
IDS.forEach(function (id) { els[id] = mkEl(id); });

global.window = global;
global.document = {
  getElementById: function (id) { return els[id] || null; },
  createElement: function () { return mkEl(''); },
  body: { appendChild: function () {}, removeChild: function () {} },
  addEventListener: function () {}
};
global.location = { search: '' };                 // 전체 훑기 — 세션 필터 없음
global.localStorage = { _s: {}, getItem: function () { return null; }, setItem: function () {} };
global.Blob = function () { this.size = 10; this.type = ''; };
global.URL = global.URL || {};
global.URL.createObjectURL = function () { return 'blob:x'; };
global.URL.revokeObjectURL = function () {};

var RECS = {};
['S-1', 'S-2'].forEach(function (q) {
  RECS[SESSION + '/' + q] = { blob: { size: 1000, type: 'audio/webm;codecs=opus' },
                              mime: 'audio/webm;codecs=opus' };
});
function req(result) {
  var r = { result: result, onsuccess: null, onerror: null };
  setImmediate(function () { if (r.onsuccess) r.onsuccess(); });
  return r;
}
global.indexedDB = {
  open: function () {
    var db = {
      objectStoreNames: { contains: function () { return true; } },
      transaction: function () {
        return { objectStore: function () {
          return {
            getAllKeys: function () { return req(Object.keys(RECS)); },
            getAll: function () { return req(Object.keys(RECS).map(function (k) { return RECS[k]; })); }
          };
        } };
      }
    };
    var r = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
    setImmediate(function () { if (r.onsuccess) r.onsuccess(); });
    return r;
  }
};

/* 서버: 같은 세션에 결과 행이 두 줄. 프로필은 학번·이름을 준다. */
var calls = [];
global.fetch = function (url, opts) {
  var u = String(url);
  calls.push({ url: u, opts: opts || {} });
  if (u.indexOf('sg_results') > 0) {
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve([{ session: SESSION, owner: A }, { session: SESSION, owner: B }]);
    } });
  }
  if (u.indexOf('sg_profiles') > 0) {
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve([{ id: A, student_id: 'smeag029', name: 'FU ENZE' },
                              { id: B, student_id: 'smeag996', name: 'Student TOELF 2' }]);
    } });
  }
  return Promise.resolve({ ok: true, status: 200,
    text: function () { return Promise.resolve(''); },
    json: function () { return Promise.resolve([]); } });
};
function uploads() {
  return calls.filter(function (c) { return c.url.indexOf('/storage/v1/object/') > 0; });
}

global.SG_AUTH = {
  url: 'https://x.supabase.co', anonKey: 'anon',
  token: function () { return Promise.resolve('tok'); },
  user: function () { return { id: 'admin-uuid', student_id: 'ADMIN' }; },
  signIn: function () { return Promise.resolve(); }
};

var a = src.indexOf('<script>\n(function () {');
var b = src.indexOf('</script>', a);
if (a < 0 || b < 0) { console.error('스크립트 블록을 찾지 못했습니다.'); process.exit(1); }
var code = src.slice(a + '<script>'.length, b);

function clickAttr(attr, value) {
  var btn = { getAttribute: function (x) { return x === attr ? value : null; } };
  els.out._on.click({ target: { closest: function (sel) {
    return sel === '[' + attr + ']' ? btn : null;
  } } });
}

async function main() {
  eval(code);
  await els['btn-scan'].onclick();
  await settle();

  console.log('[1] 고르기 전에는 한 건도 올리지 않는다');
  calls.length = 0;
  await els['btn-up'].onclick();
  await settle();
  ok(uploads().length === 0, '업로드 요청이 나가지 않는다 — ' + uploads().length);
  ok(/skip/.test(els.out.innerHTML), '두 건 모두 skip 으로 남는다');
  ok(/two accounts are on this test/.test(els.out.innerHTML), '이유를 그 줄에 적는다');

  console.log('[2] 학번·이름으로 묻는다');
  ok(/smeag029/.test(els.out.innerHTML) && /smeag996/.test(els.out.innerHTML),
     '두 계정을 학번으로 나란히 보여 준다');
  ok(/FU ENZE/.test(els.out.innerHTML), '이름도 함께 — uuid 앞자리로 고르게 하지 않는다');
  ok(/data-owner="/.test(els.out.innerHTML), '고르는 버튼이 있다');

  console.log('[3] 고른 뒤에야 그 학생 폴더로 올라간다');
  clickAttr('data-owner', SESSION + '|' + B);
  await settle();
  ok(/smeag996/.test(els.msg.innerHTML), '어느 계정으로 올릴지 먼저 말한다');

  calls.length = 0;
  await els['btn-up'].onclick();
  await settle();
  var up = uploads();
  ok(up.length === 2, '두 건이 올라간다 — ' + up.length);
  ok(up.every(function (c) { return c.url.indexOf('/' + B + '/') > 0; }),
     '고른 계정(smeag996) 폴더로만 간다');
  ok(!up.some(function (c) { return c.url.indexOf('/' + A + '/') > 0; }),
     '고르지 않은 계정 폴더는 건드리지 않는다');

  console.log('');
  if (fails) { console.log('FAILED (' + fails + ')'); process.exit(1); }
  console.log('all ok');
}

main().catch(function (e) { console.error(e); process.exit(1); });
