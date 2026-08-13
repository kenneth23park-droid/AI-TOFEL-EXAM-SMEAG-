/* SMEAG · StudyGround — sg-storage-guard.js
 * 목적: 응시가 시작되기 전에 "이 답안이 이 기기 밖에도 남는가"를 한 번 확인한다.
 * 의존 전역: window.SG_AUTH (없으면 로그인 검사를 건너뛴다)
 * 노출 전역: window.SG_GUARD
 *
 * 왜 필요한가. 답안이 사는 층은 셋이다 —
 *   localStorage(커서·시계·답안) · IndexedDB(녹음 Blob) · Supabase(기기 밖 사본).
 * 앞의 둘은 그 브라우저 프로필 안에만 있다. 시크릿 창이면 창을 닫는 순간 사라지고,
 * "인터넷 사용 기록 삭제"면 같이 지워지고, PC 가 바뀌면 따라오지 않는다.
 * 세 번째 층만이 기기가 통째로 사라져도 남는데, 그 층은 sg2 로그인이 있어야 열린다
 * (exam-cloud.js 는 SG_AUTH.token() 이 null 이면 큐에만 쌓고 보내지 않는다).
 *
 * 그래서 이 파일이 막는 사고는 하나다: 비로그인으로 두 시간을 치르고 제출한 뒤,
 * 그 PC 를 떠나는 순간 답안이 없어지는 것. 크롬의 구글 계정 로그인은 이 층과 아무
 * 상관이 없다 — 크롬 동기화는 localStorage·IndexedDB 를 동기화하지 않는다.
 *
 * 로그인은 2026-08-13 부터 응시 화면에서 강제다 — 모든 응시 화면이
 * <meta name="sg-auth" content="required"> 를 달고 있어 sg-auth.js 의 막이 먼저 선다.
 * 그래서 이 파일이 로그인을 묻는 자리는 그 표식이 없는 문서뿐이고, 응시 화면에서 하는
 * 일은 둘로 남는다: (1) 저장소가 막힌 창을 잡는다, (2) 로그인 막 뒤에서 boot 을 돌리지
 * 않는다 — 여태는 돌아서, 학생이 "Please log in" 을 읽는 동안 시험 시계가 흘렀다.
 *
 * 계약 — 저장소 경고는 시험을 막지 않는다(F12). 막은 시작 전에만 서고 Start anyway 가
 * 늘 있다. 위험이 없으면 이 파일은 아무것도 그리지 않고 조용히 지나간다.
 */
window.SG_GUARD = (function (root) {
  'use strict';

  var ACK_KEY = 'sg2_guard_ack';
  var acked = false;              // sessionStorage 가 죽은 자리를 위한 메모리 사본
  var state = { login: null, local: null, idb: null, persisted: null, risks: [] };

  function doc() { return root.document; }

  /* ── 검사 ────────────────────────────────────────────────── */

  function loggedIn() {
    var A = root.SG_AUTH;
    if (!A || typeof A.user !== 'function') return null;   // 모르는 것과 없는 것은 다르다
    try { return !!A.user(); } catch (e) { return null; }
  }

  /* 이 문서가 이미 <meta name="sg-auth" content="required"> 로 스스로를 잠갔다면
     sg-auth.js 의 "Please log in" 막이 먼저 선다. 그 위에 같은 말을 또 세우지 않는다. */
  function pageRequiresLogin() {
    var m = doc().querySelector('meta[name="sg-auth"]');
    return !!(m && m.getAttribute('content') === 'required');
  }

  function probeLocal() {
    try {
      root.localStorage.setItem('sg2_guard_probe', '1');
      root.localStorage.removeItem('sg2_guard_probe');
      return true;
    } catch (e) { return false; }
  }

  /* IndexedDB 는 열어 봐야 안다 — 파이어폭스 사생활 보호 창처럼 객체는 있는데 open 이
     거부되는 자리가 있다. 녹음(스피킹)이 통째로 사라지는 층이라 그냥 넘기지 않는다.
     답은 셋이다: 'ok' · 'fail' · 'unknown'. 대답이 없는 것(느린 디스크, 다른 탭이 잡고
     있는 DB)을 실패로 세면 멀쩡한 기기에 "녹음이 안 됩니다"를 띄우게 된다 — 그건
     경고를 못 믿게 만드는 가장 빠른 길이라, 확실히 거부당했을 때만 실패로 센다. */
  function probeIdb(cb) {
    var idb = root.indexedDB, req, done = false;
    if (!idb) { cb('fail'); return; }
    function settle(v) { if (done) return; done = true; clearTimeout(timer); cb(v); }
    var timer = setTimeout(function () { settle('unknown'); }, 1200);
    try { req = idb.open('sg2-guard-probe', 1); } catch (e) { settle('fail'); return; }
    req.onerror = function () { settle('fail'); };
    req.onblocked = function () { settle('unknown'); };
    req.onsuccess = function () {
      try { req.result.close(); idb.deleteDatabase('sg2-guard-probe'); } catch (e) {}
      settle('ok');
    };
  }

  /* 브라우저에게 "이 자리는 용량이 모자라도 먼저 버리지 말라"고 부탁한다. 크롬은
     설치형(PWA)이거나 방문이 잦은 사이트에만 내주고, 아니면 조용히 거절한다.
     거절당해도 알리지 않는다 — 평상시에도 흔한 답이라 경고로 쓰면 늑대소년이 된다. */
  function askPersist() {
    var s = root.navigator && root.navigator.storage;
    if (!s || typeof s.persist !== 'function') return;
    try {
      (typeof s.persisted === 'function' ? s.persisted() : Promise.resolve(false))
        .then(function (already) { return already ? true : s.persist(); })
        .then(function (ok) { state.persisted = !!ok; }, function () {});
    } catch (e) {}
  }

  /* ── 막 ──────────────────────────────────────────────────── */

  /* 로그인 뒤 돌아올 자리. sg2 루트에서 본 상대경로여야 한다 — login.html 이 그 자리에
     있기 때문이다. 라우트 페이지(en/test-nt/reading/)는 <base href="../../../"> 로 이미
     sg2 루트를 가리키고 있으니, baseURI 를 기준으로 잘라 내면 두 경우가 한 식으로 풀린다. */
  function nextParam() {
    var here = root.location.href;
    var base = String(doc().baseURI || here).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    var rel = here.indexOf(base) === 0 ? here.slice(base.length) : here.split('/').pop();
    return encodeURIComponent(rel);
  }

  function line(icon, title, body) {
    return '<li><span class="sg-guard-ico">' + icon + '</span>' +
           '<span><b>' + title + '</b><br>' + body + '</span></li>';
  }

  function render(risks, go) {
    var box = doc().createElement('div');
    box.className = 'sg-guard';
    box.id = 'sg-guard';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');

    var items = '';
    if (risks.indexOf('login') !== -1) {
      items += line('☁️', 'You are not logged in',
        'Your answers are saved on this computer only. Nothing is copied to the server, ' +
        'so a different PC, a cleared browser, or a broken machine takes them with it.');
    }
    if (risks.indexOf('local') !== -1) {
      items += line('🕵️', 'This browser is not keeping data',
        'Site storage is blocked — a private window, or a strict privacy setting. ' +
        'Answers and the clock will be lost the moment this window closes.');
    }
    if (risks.indexOf('idb') !== -1) {
      items += line('🎙️', 'Recordings cannot be stored',
        'The recording database will not open in this browser. ' +
        'Speaking answers may be lost before they reach the server.');
    }

    var loginBtn = risks.indexOf('login') !== -1
      ? '<a class="sg-guard-go" href="login.html?next=' + nextParam() + '">Log in and start</a>'
      : '';

    box.innerHTML =
      '<div class="sg-guard-card">' +
        '<div class="sg-guard-mark">⚠️</div>' +
        '<h1>Your work may not be saved</h1>' +
        '<p class="sg-guard-lead">Check this before you start — it cannot be fixed afterwards.</p>' +
        '<ul class="sg-guard-list">' + items + '</ul>' +
        '<div class="sg-guard-btns">' + loginBtn +
          '<button type="button" class="sg-guard-anyway">Start anyway</button>' +
        '</div>' +
        '<p class="sg-guard-fine">Signing in to Chrome with a Google account does not help — ' +
        'Chrome sync does not carry test data. Only a StudyGround login does.</p>' +
      '</div>';

    box.querySelector('.sg-guard-anyway').addEventListener('click', function () {
      ack();
      box.parentNode && box.parentNode.removeChild(box);
      go();
    });

    (doc().body || doc().documentElement).appendChild(box);
    var first = box.querySelector('.sg-guard-go') || box.querySelector('.sg-guard-anyway');
    if (first && first.focus) { try { first.focus(); } catch (e) {} }
  }

  /* 한 번 읽고 시작한 사람에게 새로고침마다 같은 막을 다시 세우지 않는다.
     탭 단위(sessionStorage)라 다음 학생이 앉은 자리에서는 다시 선다. */
  function ack() {
    acked = true;
    try { root.sessionStorage.setItem(ACK_KEY, '1'); } catch (e) {}
  }
  function isAcked() {
    if (acked) return true;
    try { return root.sessionStorage.getItem(ACK_KEY) === '1'; } catch (e) { return false; }
  }

  /* ── 문 ──────────────────────────────────────────────────── */

  /* 셸이 부른다: SG_GUARD.gate(boot). 위험이 없으면 같은 틱에 boot 를 부른다 —
     시계는 boot 안에서 시작하므로, 막이 서 있는 동안 시험 시간이 흐르는 일은 없다. */
  function gate(go) {
    if (typeof go !== 'function') go = function () {};
    var fired = false;
    function once() { if (fired) return; fired = true; go(); }

    askPersist();

    // 검사가 어떤 이유로든 답하지 않으면 시험이 먼저다 — 2초 뒤에는 그냥 연다.
    var bail = setTimeout(once, 2000);

    probeIdb(function (idb) {
      clearTimeout(bail);
      if (fired) return;

      var login = loggedIn();
      var local = probeLocal();
      state.login = login; state.local = local; state.idb = idb;

      /* 스스로를 잠근 문서(<meta name="sg-auth" content="required">)에서 비로그인이면
         sg-auth.js 의 막이 화면을 덮는다. 그 뒤에서 boot 을 돌리지 않는다 — 여태는
         돌았고, 그래서 학생이 "Please log in" 을 읽는 동안 시험 시계가 흘렀다. */
      if (login === false && pageRequiresLogin()) { state.risks = ['login']; return; }

      var risks = [];
      if (login === false) risks.push('login');
      if (!local) risks.push('local');
      if (idb === 'fail') risks.push('idb');
      state.risks = risks;

      if (!risks.length || isAcked()) { once(); return; }

      fired = true;   // boot 은 학생이 누른 뒤에 — 막 뒤에서 시계가 돌면 안 된다.
      function mount() { render(risks, go); }
      if (doc().body) mount(); else doc().addEventListener('DOMContentLoaded', mount);
    });
  }

  return { gate: gate, state: function () { return state; }, ack: ack };
}(window));
