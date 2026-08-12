/* 영역별 진입은 관리자가 연다 — node 전용.
 * 실행: node "studyground/tests/test_section_permission.js"
 *
 * 발주 요구(2026-08-12): "학생이라도 섹션별 아이콘을 보여줘. 하지만 섹션별로
 * 진행은 admin 의 permission 이 필요함 — admin ID 와 패스워드 입력 시 진입 가능."
 *
 * 보이는 것과 열리는 것을 갈라 놓은 자리라, 한쪽만 무너져도 티가 나지 않는다.
 * 아이콘만 남고 문이 열려 있으면 학생이 감독 없이 한 영역을 치고, 문만 남고
 * 아이콘이 없으면 시험장에서 감독관이 누를 자리를 찾지 못한다. 그래서 셋을 본다.
 *
 *  [1] 승인 칸(assets/admin-approve.js) — 틀린 비밀번호로는 열리지 않고,
 *      맞으면 열린다. 관리자 세션이 있는 기기는 아예 묻지 않는다.
 *  [2] 일회용 표 — 목록에서 받은 승인은 셸에서 한 번만 쓰이고 사라진다.
 *      3분이 지나면 죽는다(주소를 눌러 두고 나중에 들어가는 길을 막는다).
 *  [3] 셸의 문(assets/exam-shell.js gateSection) — 표가 없으면 그 자리에서 묻고,
 *      취소하면 시험이 시작되지 않는다. 전체 한 벌(mode=exam)은 그대로 지난다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
var approveSrc = fs.readFileSync(path.join(SG2, 'assets/admin-approve.js'), 'utf8');
var shell = fs.readFileSync(path.join(SG2, 'assets/exam-shell.js'), 'utf8');

var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!cond) fails.push(name);
}

/* ── 화면 밖에서 승인 칸을 세운다 ─────────────────────────────
 * jsdom 없이 돌아야 하므로, 승인 칸이 실제로 만지는 것만 흉내낸다. 선택자 하나가
 * 어긋나면 여기서 null 참조로 터진다(= 배선이 끊긴 것을 잡는다). */
function el() {
  var e = {
    hidden: false, value: '', textContent: '', className: '', innerHTML: '', id: '',
    focused: false, _ev: {}, _kids: {}, _cls: {},
    classList: {
      add: function (c) { e._cls[c] = 1; },
      remove: function (c) { delete e._cls[c]; },
      contains: function (c) { return !!e._cls[c]; }
    },
    querySelector: function (sel) { return (e._kids[sel] = e._kids[sel] || el()); },
    addEventListener: function (t, fn) { (e._ev[t] = e._ev[t] || []).push(fn); },
    emit: function (t, ev) { (e._ev[t] || []).forEach(function (f) { f(ev || { preventDefault: function () {} }); }); },
    appendChild: function (c) { return c; },
    focus: function () { e.focused = true; },
    reset: function () {},
    closest: function () { return null; }
  };
  return e;
}

function loadApprove(env) {
  var store = {};
  var now = env.now || { t: 1000000 };
  var win = {
    SG_ADMIN: env.admin || null,
    sessionStorage: {
      getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  };
  var doc = {
    body: el(), head: el(),
    createElement: function () { return el(); },
    getElementById: function () { return null; },
    addEventListener: function () {}
  };
  new Function('window', 'document', 'setTimeout', 'Date',
    approveSrc)(win, doc, function (fn) { fn(); }, { now: function () { return now.t; } });
  return { P: win.SG_APPROVE, store: store, now: now };
}

var ADMIN = {
  can: function () { return false; },
  current: function () { return null; },
  verify: function (id, pw) {
    return (String(id).toLowerCase() === 'set9' && pw === 'right')
      ? { id: 'set9', label: 'SET 9 admin', sets: ['set9'] } : null;
  }
};

/* ── [1] 승인 칸 ───────────────────────────────────────────── */
console.log('[1] 승인 칸');

var A = loadApprove({ admin: ADMIN });
var opened = null, cancelled = 0;
A.P.ask({ what: 'Reading', setId: 'set9' }, function (who) { opened = who; }, function () { cancelled++; });

var modal = A.P._modal || null;   // 모달은 내부에 숨어 있다 — createElement 로 받은 것을 되짚는다.
ok('승인 없이는 아무 일도 일어나지 않는다', opened === null && cancelled === 0);

/* document.createElement 가 준 그 노드를 다시 잡기 위해, 같은 자리를 한 번 더 만든다.
   (ask 는 모듈 안의 modal 을 쓰므로, 여기서는 폼 이벤트로만 두드린다.) */
var A2 = (function () {
  var made = [];
  var store = {};
  var win = {
    SG_ADMIN: ADMIN,
    sessionStorage: {
      getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  };
  var doc = {
    body: el(), head: el(),
    createElement: function () { var e = el(); made.push(e); return e; },
    getElementById: function () { return null; },
    addEventListener: function () {}
  };
  new Function('window', 'document', 'setTimeout', 'Date',
    approveSrc)(win, doc, function (fn) { fn(); }, { now: function () { return 1000000; } });
  return { P: win.SG_APPROVE, made: made, store: store };
})();

var got = null;
A2.P.ask({ what: 'Listening', setId: 'set9' }, function (who) { got = who; });
var box = A2.made.filter(function (e) { return e.className === 'sgp-modal'; })[0];
ok('승인 칸이 그려진다', !!box);
ok('무엇에 들어가는지 적힌다', box.querySelector('#sgp-what').textContent === 'Listening',
   box.querySelector('#sgp-what').textContent);
ok('칸이 열려 있다', box.hidden === false);
ok('아이디 칸으로 커서가 간다', box.querySelector('[name=sgp-id]').focused === true);

var form = box.querySelector('form');

/* 틀린 비밀번호 — 문은 열리지 않고 그 자리에 남는다. */
box.querySelector('[name=sgp-id]').value = 'set9';
box.querySelector('[name=sgp-pw]').value = 'wrong';
form.emit('submit');
ok('틀리면 열리지 않는다', got === null);
ok('틀리면 그렇다고 말한다', box.querySelector('.sgp-err').classList.contains('on'));
ok('틀린 비밀번호는 지운다', box.querySelector('[name=sgp-pw]').value === '');
ok('칸은 그대로 열려 있다', box.hidden === false);

/* 맞으면 그 자리에서 열린다 — 세션은 만들지 않는다(verify 만 쓴다). */
box.querySelector('[name=sgp-pw]').value = 'right';
form.emit('submit');
ok('맞으면 열린다', got && got.id === 'set9', JSON.stringify(got));
ok('승인 뒤에는 칸이 닫힌다', box.hidden === true);
ok('학생 기기에 관리자 세션을 남기지 않는다', approveSrc.indexOf('SG_ADMIN.login') < 0 &&
   /A\.verify\(/.test(approveSrc));

/* 관리자 세션이 있는 기기는 묻지 않는다. */
var seen = 0;
var A3 = loadApprove({ admin: {
  can: function (setId) { return setId === 'set9'; },
  current: function () { return { id: 'admin' }; },
  verify: function () { return null; }
} });
A3.P.ask({ what: 'Writing', setId: 'set9' }, function () { seen++; });
ok('관리자 세션이 있으면 바로 지난다', seen === 1);

/* ── [2] 일회용 표 ─────────────────────────────────────────── */
console.log('\n[2] 일회용 표');

var T = loadApprove({ admin: ADMIN });
var key = T.P.key('set9', 'reading');
ok('목록과 셸이 같은 열쇠를 만든다', key === 'set9:reading' && T.P.key('SET9', 'Reading') === key);
ok('표가 없으면 못 지난다', T.P.claim(key) === false);

T.P.grant(key);
ok('다른 영역 표로는 못 지난다', T.P.claim(T.P.key('set9', 'writing')) === false);
T.P.grant(key);
ok('받은 표로는 지난다', T.P.claim(key) === true);
ok('표는 한 번 쓰면 사라진다', T.P.claim(key) === false);

T.P.grant(key);
T.now.t += 3 * 60 * 1000 + 1;
ok('3분이 지난 표는 죽는다', T.P.claim(key) === false);

/* ── [3] 셸의 문 ───────────────────────────────────────────── */
console.log('\n[3] 셸의 문');

var START = '  function gateSection(section, next) {';
var END = '  function boot() {';
var a = shell.indexOf(START), b = shell.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('gateSection 블록을 찾지 못했습니다 — exam-shell.js 구조가 바뀌었는지 확인하세요.');
  process.exit(1);
}

function gate(opts) {
  var started = 0;
  var loc = { href: '' };
  var asked = [];
  var win = {
    location: loc,
    SG_APPROVE: opts.noScript ? null : {
      key: function (s, sec) { return s + ':' + sec; },
      claim: function (k) { return !!opts.pass && opts.pass === k; },
      ask: function (o, onOk, onCancel) {
        asked.push(o);
        if (opts.approve) onOk({ id: 'set9' }); else onCancel && onCancel();
      }
    }
  };
  var run = new Function('window', 'SET_ID', 'BASE', 'scopeMode',
    shell.slice(a, b) + '\nreturn gateSection;'
  )(win, 'set9', '', function () { return opts.scope || 'section'; });
  run(opts.section === undefined ? 'reading' : opts.section, function () { started++; });
  return { started: started, loc: loc, asked: asked };
}

var g1 = gate({ approve: false });
ok('표가 없으면 그 자리에서 묻는다', g1.asked.length === 1);
ok('영역 이름을 세워 묻는다', g1.asked[0].what === 'Reading', String(g1.asked[0].what));
ok('승인 없이는 시험이 시작되지 않는다', g1.started === 0);
ok('취소하면 목록으로 돌아간다', g1.loc.href === 'tests.html', g1.loc.href);

var g2 = gate({ approve: true });
ok('승인하면 시작된다', g2.started === 1 && g2.loc.href === '');

var g3 = gate({ pass: 'set9:reading' });
ok('목록에서 받은 표로는 다시 묻지 않는다', g3.asked.length === 0 && g3.started === 1);

var g4 = gate({ scope: 'full', approve: false });
ok('전체 한 벌은 묻지 않는다', g4.asked.length === 0 && g4.started === 1);

var g5 = gate({ section: null, approve: false });
ok('영역이 없으면 묻지 않는다', g5.asked.length === 0 && g5.started === 1);

var g6 = gate({ noScript: true, approve: false });
ok('승인 스크립트가 못 떴어도 시험은 멈추지 않는다', g6.started === 1);

if (fails.length) {
  console.error('\nFAIL — 영역별 진입 승인 (' + fails.length + '): ' + fails.join(', '));
  process.exit(1);
}
console.log('\nok — 학생은 네 영역을 보고, 문은 관리자가 연다');
