/* recover-recordings.html — 응시 id 가 어긋난 녹음을 없다고 하지 않는다.
 *
 * 2026-08-27. 선생님이 리뷰에서 "녹음 회수" 를 눌러 들어왔다. 주소에는 채점된 응시의
 * id(offline-437f…)가 붙어 있었고, 화면은 "이 브라우저에 저장된 녹음이 없습니다" 라고
 * 답했다. 그런데 같은 컴퓨터의 다운로드 폴더에는 조금 전 이 페이지가 내려받은
 * offline-875f…__S-3 … S-9 이 그대로 있었다.
 *
 * 없어서가 아니었다. 시험을 처음부터 다시 시작하거나(restart_all) 범위를 바꿔 "새
 * 응시로 따로" 열면 exam-shell.js 가 그때마다 새 offline 세션을 발급한다 — 녹음은
 * 앞선 id 밑에, 제출·채점된 결과는 뒤의 id 밑에 남는다. 페이지는 ?session= 으로 온
 * id 만 남기고 나머지를 걸러 낸 뒤, 걸러 냈다는 말 대신 "없다" 고 말했다.
 *
 * 여기서 고정하는 성질.
 *  [1] 그 응시 id 로 없고 이 컴퓨터에 다른 녹음이 있으면, 감추지 않고 전부 보여 준다.
 *  [2] "없다" 고 말하지 않는다 — 왜 id 가 다른지 말하고 Save 를 열어 둔다.
 *  [3] 한 뭉치를 골라 "이 응시에 붙이기" 를 누르면, 업로드 자리가 열고 들어온 응시가
 *      된다({owner}/{열린 session}/{qid}.{ext}) — 리뷰는 그 자리만 들여다보므로,
 *      녹음이 적힌 옛 id 자리에 올리면 영영 붙지 않는다.
 *
 * 실행: node "studyground/tests/test_recover_session_mismatch.js"
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

/* ── 가짜 화면 ───────────────────────────────────────────────
   페이지 스크립트가 실제로 만지는 것만 세운다: getElementById, innerHTML/textContent,
   hidden/disabled/onclick, #out 의 위임 클릭, a.click() 한 번(다운로드). */
var IDS = ['msg', 'btn-scan', 'btn-save', 'btn-up', 'stats', 's-sessions', 's-files',
           's-size', 's-up', 'signin', 'in-id', 'in-pw', 'btn-login', 'who', 'out'];
var els = {};
var downloads = [];

function mkEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', hidden: true, disabled: false,
    value: '', href: '', download: '', className: '', style: {},
    _on: {},
    setAttribute: function () {}, getAttribute: function () { return null; },
    appendChild: function () {}, removeChild: function () {},
    addEventListener: function (t, fn) { this._on[t] = fn; },
    click: function () { downloads.push(this.download); }
  };
}
IDS.forEach(function (id) { els[id] = mkEl(id); });

global.window = global;
global.document = {
  getElementById: function (id) { return els[id] || null; },
  createElement: function () { return mkEl(''); },
  querySelector: function () { return null; },
  body: { appendChild: function () {}, removeChild: function () {} },
  addEventListener: function () {}
};
global.location = { search: '?session=offline-437f5f60-3673-1e91-a505-597b3b6527b2' };
var OPENED = 'offline-437f5f60-3673-1e91-a505-597b3b6527b2';
var TAKEN  = 'offline-875f9127-578c-ec3b-4c35-e2e0b02c6cae';
global.localStorage = {
  _s: {},
  getItem: function (k) { return this._s.hasOwnProperty(k) ? this._s[k] : null; },
  setItem: function (k, v) { this._s[k] = String(v); }
};
global.Blob = function (parts, o) { this.size = 10; this.type = (o && o.type) || ''; };
global.URL = global.URL || {};
global.URL.createObjectURL = function () { return 'blob:x'; };
global.URL.revokeObjectURL = function () {};

/* ── 가짜 IndexedDB — 시험을 친 세션(TAKEN) 밑에만 녹음이 있다 ── */
var RECS = {};
['S-3', 'S-4', 'S-5', 'S-6', 'S-7', 'S-8', 'S-9'].forEach(function (q) {
  RECS[TAKEN + '/' + q] = { blob: { size: 120000, type: 'audio/webm;codecs=opus' },
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

/* ── 가짜 서버 — owner 는 열고 들어온 응시(OPENED)에만 달려 있다 ── */
var calls = [];
global.fetch = function (url, opts) {
  calls.push({ url: String(url), opts: opts || {} });
  if (String(url).indexOf('sg_results') > 0) {
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve([{ session: OPENED, owner: 'owner-uuid-1' }]);
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
  user: function () { return { id: 'owner-uuid-1', student_id: 'smeag996' }; },
  signIn: function () { return Promise.resolve(); }
};

/* 페이지의 스크립트 블록만 떼어 돌린다 (assets/*.js 는 위에서 대신 세웠다). */
var a = src.indexOf('<script>\n(function () {');
var b = src.indexOf('</script>', a);
if (a < 0 || b < 0) { console.error('스크립트 블록을 찾지 못했습니다.'); process.exit(1); }
var code = src.slice(a + '<script>'.length, b);

/* #out 의 위임 클릭 — 어느 속성의 버튼을 눌렀는지까지 흉내 낸다. */
function clickAttr(attr, value) {
  var btn = { getAttribute: function (a) { return a === attr ? value : null; } };
  els.out._on.click({ target: { closest: function (sel) {
    return sel === '[' + attr + ']' ? btn : null;
  } } });
}

async function main() {
  eval(code);                       // ?session= 이 붙어 있으므로 스스로 스캔한다
  await settle(); await settle(); await settle(); await settle();

  var msg = els.msg.innerHTML, out = els.out.innerHTML;

  console.log('[1] 어긋난 id 를 "녹음 없음" 으로 끝내지 않는다');
  ok(!/No recordings are stored in this browser/.test(msg),
     '"이 브라우저에 녹음이 없다" 고 말하지 않는다');
  ok(/7/.test(msg) && /other test id/.test(msg),
     '이 컴퓨터에 있는 7건과 다른 id 라는 사실을 말한다');
  ok(/restarted/.test(msg), '왜 id 가 다른지(재시작·별도 응시) 알려 준다');

  console.log('[2] 있는 것을 보여 주고 저장을 열어 둔다');
  ok(out.indexOf(TAKEN) > 0, '녹음이 적힌 세션이 표에 뜬다');
  ok(els['s-files'].textContent === 7, '7건으로 센다 — ' + els['s-files'].textContent);
  ok(els['btn-save'].disabled === false, 'Save all 이 열려 있다');
  ok(els.signin.hidden === false, '로그인 칸이 열려 있다');
  ok(/data-attach="/.test(out), '"이 응시에 붙이기" 버튼이 붙어 있다');

  console.log('[3] 붙이면 열고 들어온 응시 자리로 올라간다');
  clickAttr('data-attach', TAKEN);
  await settle();
  ok(/uploaded into the attempt you opened/.test(els.msg.innerHTML),
     '어디로 올라가는지 먼저 말한다');

  calls.length = 0;
  await els['btn-up'].onclick();
  await settle();

  var up = uploads();
  ok(up.length === 7, '7건이 올라간다 — ' + up.length);
  ok(up.every(function (c) { return c.url.indexOf('/' + OPENED + '/') > 0; }),
     '자리는 {owner}/{열린 session}/{qid} 다');
  ok(!up.some(function (c) { return c.url.indexOf('/' + TAKEN + '/') > 0; }),
     '녹음이 적힌 옛 id 자리에는 올리지 않는다');
  ok(up[0].opts.headers['Content-Type'] === 'audio/webm',
     'Content-Type 에서 코덱은 여전히 뗀다');
  ok(/Uploaded 7 of 7/.test(els.msg.innerHTML), '결과를 그대로 적는다');

  console.log('');
  if (fails) { console.log('FAILED (' + fails + ')'); process.exit(1); }
  console.log('all ok');
}

main().catch(function (e) { console.error(e); process.exit(1); });
