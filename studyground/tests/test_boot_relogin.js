/* 재부팅하면 아이디·비밀번호를 다시 받는다 (sg-auth.js).
 * 실행: node studyground/tests/test_boot_relogin.js
 *
 * 고사장 PC 는 여러 학생이 돌려 쓴다. 앞사람 세션이 남은 채로 다음 사람이 앉으면
 * 그 사람 이름으로 시험이 저장된다. 그래서 지켜야 할 것이 셋이다.
 *
 *   [끊긴다]   컴퓨터가 꺼져 있던 공백(살아 있다는 표시가 묵음)이 있으면 세션을 지운다.
 *   [보존]     지우는 것은 세션 하나뿐이다 — 답안·응시 기록·아웃박스는 그대로 둔다.
 *   [막는다]   세션이 없으면 시험 화면을 "Please log in" 막으로 덮는다.
 *
 * 브라우저 없이 돌리려고 window/document/localStorage 를 최소한으로 흉내 낸다 —
 * sg-auth.js 가 실제로 만지는 것만 있으면 된다.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var AUTH_KEY = 'sg2_auth_v1';
var ALIVE_KEY = 'sg2_alive_v1';

var fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  fails++;
  console.log('  ✗ ' + label + (detail ? '\n      ' + detail : ''));
}

/* ── 최소 브라우저 흉내 ──────────────────────────────────────────────────── */

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(), id: '', innerHTML: '', style: { cssText: '' },
    children: [], _attrs: {},
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild: function (c) { this.children.push(c); return c; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

function makeEnv(store) {
  var body = makeEl('body');
  var doc = {
    readyState: 'complete',
    documentElement: makeEl('html'),
    body: body,
    addEventListener: function () {},
    createElement: makeEl,
    getElementById: function (id) {
      for (var i = 0; i < body.children.length; i++) if (body.children[i].id === id) return body.children[i];
      return null;
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  var loc = { pathname: '/sg2/exam-runtime.html', search: '?mode=exam&set=set9', replace: function (u) { loc.replaced = u; } };
  var win = {
    document: doc,
    location: loc,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    addEventListener: function () {},
    setInterval: function () { return 0; },      // 타이머는 붙잡지 않는다
    fetch: function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); }
  };
  win.window = win;
  return { win: win, doc: doc, body: body, loc: loc };
}

/** sg-auth.js 를 깨끗한 전역에서 한 번 실행하고 SG_AUTH 를 돌려준다. */
function load(env) {
  var src = fs.readFileSync(path.join(SG2, 'assets', 'sg-auth.js'), 'utf8');
  var fn = new Function('window', 'document', 'localStorage', 'location', 'fetch', 'setInterval', src);
  fn(env.win, env.doc, env.win.localStorage, env.loc, env.win.fetch, env.win.setInterval);
  return env.win.SG_AUTH;
}

function session() {
  return JSON.stringify({ user: { id: 'u1', email: 'smeag007@x', student_id: 'smeag007' },
                          access_token: 'a', refresh_token: 'r',
                          expires_at: Math.floor(Date.now() / 1000) + 3600 });
}

/* ── 1. 계속 켜져 있었으면 세션은 그대로 ─────────────────────────────────── */

var live = {};
live[AUTH_KEY] = session();
live[ALIVE_KEY] = String(Date.now() - 5 * 1000);        // 5초 전까지 탭이 살아 있었다
var A = load(makeEnv(live));
ok(!!live[AUTH_KEY], '탭이 살아 있던 사이의 새로고침은 로그아웃이 아니다');
ok(A.user() && A.user().student_id === 'smeag007', '같은 학생이 그대로 이어 간다');

/* ── 2. 공백이 있었으면(재부팅) 세션을 지운다 ────────────────────────────── */

var booted = {};
booted[AUTH_KEY] = session();
booted[ALIVE_KEY] = String(Date.now() - 10 * 60 * 1000);   // 10분간 아무도 표시를 못 남겼다
booted['sg2_attempt::set9'] = 'attempt-1';                 // 기기에 쌓인 자료
booted['sg2_results_v1'] = '[{"session":"set9"}]';
booted['sg2_admin_v1'] = '{"sets":["*"],"t":1}';
var B = load(makeEnv(booted));
ok(booted[AUTH_KEY] === undefined, '재부팅 뒤에는 저장된 세션이 없다');
ok(B.user() === null, '로그인 상태가 아니다 — 아이디·비밀번호를 다시 받는다');
ok(booted['sg2_attempt::set9'] === 'attempt-1' && booted['sg2_results_v1'] === '[{"session":"set9"}]',
   '답안·응시 기록은 지우지 않는다');
ok(booted['sg2_admin_v1'] === '{"sets":["*"],"t":1}', '세션 열쇠 하나만 건드린다');
ok(Number(booted[ALIVE_KEY]) > Date.now() - 5000, '페이지가 뜨면 살아 있다는 표시를 새로 남긴다');

/* ── 3. 표시가 아예 없는 기기(첫 방문·표시 유실)도 막는 쪽으로 ───────────── */

var fresh = {};
fresh[AUTH_KEY] = session();
var C = load(makeEnv(fresh));
ok(C.user() === null, '살아 있던 흔적이 없으면 세션을 믿지 않는다');

/* ── 4. 로그인하지 않았으면 "Please log in" 막이 화면을 덮는다 ───────────── */

var envD = makeEnv({});
var D = load(envD);
ok(D.require() === false, 'require() 는 비로그인에서 false 다');
var veil = envD.doc.getElementById('sg-auth-block');
ok(!!veil, '막이 문서에 선다');
ok(veil && /Please log in/.test(veil.innerHTML), '"Please log in" 이라고 말한다');
ok(veil && veil.innerHTML.indexOf('login.html?next=exam-runtime.html') > 0,
   '버튼은 보던 화면을 들고 로그인으로 간다', veil && veil.innerHTML);
ok(envD.loc.replaced === undefined, '조용히 튕기지 않는다 — 학생이 이유를 읽고 누른다');

D.require();
ok(envD.body.children.length === 1, '두 번 불러도 막은 하나다');

/* ── 5. 로그인해 있으면 막이 서지 않는다 ─────────────────────────────────── */

var liveStore = {};
liveStore[AUTH_KEY] = session();
liveStore[ALIVE_KEY] = String(Date.now() - 1000);
var envE = makeEnv(liveStore);
var E = load(envE);
ok(E.require() === true, '로그인해 있으면 require() 는 true 다');
ok(envE.doc.getElementById('sg-auth-block') === null, '시험 화면을 덮지 않는다');

/* ── 6. 시험 화면은 스스로 로그인을 요구한다고 적혀 있다 ─────────────────── */

var runtime = fs.readFileSync(path.join(SG2, 'exam-runtime.html'), 'utf8');
ok(/<meta name="sg-auth" content="required">/.test(runtime),
   'exam-runtime.html 이 sg-auth=required 를 단다');
ok(runtime.indexOf('assets/sg-auth.js') > 0 &&
   runtime.indexOf('assets/sg-auth.js') < runtime.indexOf('assets/exam-shell.js'),
   'sg-auth.js 가 exam-shell.js 보다 먼저 실린다');

console.log('\n' + (fails ? '✗ ' + fails + ' / ' + checks + ' 실패' : '✓ ' + checks + ' 검사 통과'));
process.exit(fails ? 1 : 0);
