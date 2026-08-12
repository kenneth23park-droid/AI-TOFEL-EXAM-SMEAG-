/* SMEAG · StudyGround — 학생 화면은 로그인하는 순간 전체화면이 되고, 잠긴다.
 *
 * 세 가지를 한다.
 *
 *  1) 전체화면 자동 진입
 *     브라우저는 "사용자가 방금 누른 것"이 있어야만 전체화면을 열어 준다. 그래서
 *     로그인 버튼을 누른 그 순간(비동기 로그인을 기다리기 전에) 요청하고, 학생
 *     세션이라는 표시를 sessionStorage 에 남긴다. 표시가 남아 있는 동안에는 다음
 *     페이지에서도 전체화면을 유지하고, 어쩌다 풀렸으면 다음 클릭·키 입력 한 번에
 *     조용히 되돌린다(그때가 또 하나의 사용자 동작이므로 허용된다).
 *     선생님·관리자는 표시를 지운다 — 관리 화면은 창을 여러 개 띄워 쓴다.
 *
 *  2) 창 잠금 — 학생은 창을 못 만진다
 *     표시가 남아 있는 동안 이 기기는 시험대다. 오른쪽 클릭 메뉴, F11, 새로고침·새
 *     탭·창 닫기·인쇄·소스 보기·개발자 도구 단축키를 막는다. 전체화면이 풀려도 화면을
 *     덮지는 않는다 — 다음 동작 한 번에 조용히 되돌아간다. 정말로 창을 돌려받으려면
 *     학생이 전체화면 버튼을 눌러야 하고, 그때 감독관이 관리자 아이디·비밀번호를
 *     넣는다(SG_ADMIN.verify — 확인만 하고 학생 기기에 관리자 세션은 남기지 않는다).
 *     브라우저 밖(Alt+Tab, Dock, 전원 버튼)까지는 웹이 막을 수 없다. 거기까지가 한계다.
 *     전체화면 API 가 없는 기기(iPhone Safari)에서는 잠그지 않는다 — 잠그면 학생이
 *     돌아올 방법이 없다.
 *
 *  3) 화면 크기에 맞추기
 *     시험 셸(.exam-shell)은 높이가 화면에 묶여 있고 본문(.exam-main)만 스크롤한다.
 *     노트북 세로 해상도가 낮으면 지문·보기가 접혀 학생이 스크롤을 찾아야 하는데,
 *     시험 중에는 그 자체가 손해다. 그래서 본문이 넘치면 넘치지 않을 때까지 확대율을
 *     5%씩 낮춰(최저 60%) 한 화면에 다 들어오게 만든다. 넘치지 않으면 아무것도 하지
 *     않는다 — 글자를 키우지는 않는다.
 *
 * 의존성 없음. window.SG_FS 로 노출한다.
 */
window.SG_FS = (function () {
  'use strict';

  var KEY = 'sg2_fullscreen';
  var MIN_ZOOM = 0.6;          // 이보다 줄이면 시험지가 읽히지 않는다
  var STEP = 0.05;

  /* ── 전체화면 ──────────────────────────────────────────── */

  function on() {
    var d = document;
    return !!(d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement);
  }

  function enter() {
    if (on()) return;
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return;
    try {
      var p = fn.call(el);
      if (p && p.catch) p.catch(function () {});   // 사용자 동작이 없으면 조용히 실패
    } catch (e) {}
  }

  function exit() {
    if (!on()) return;
    var d = document;
    var fn = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
    if (!fn) return;
    try {
      var p = fn.call(d);
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function armed() {
    try { return window.sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function arm() {
    try { window.sessionStorage.setItem(KEY, '1'); } catch (e) {}
  }

  /** 관리자·선생님, 그리고 로그아웃. 표시를 지우고 창을 돌려준다. */
  function release() {
    try { window.sessionStorage.removeItem(KEY); } catch (e) {}
    hideVeil();
    exit();
  }

  /** 로그인 버튼이 눌린 그 순간에 부른다 — 여기가 유일하게 허용되는 시점이다. */
  function armAndEnter() {
    arm();
    enter();
  }

  /* 표시가 남았는데 전체화면이 아니면(페이지 이동 중 풀렸거나 Esc), 다음 사용자
     동작 한 번에 되돌린다. 되돌리기를 강요하지는 않는다 — 학생이 Esc 를 다시 누르면
     그대로 두고, 그다음 동작에서 또 한 번 시도한다. */
  var pending = false;
  function rearmOnGesture() {
    if (pending || !armed() || on()) return;
    pending = true;
    function go() {
      pending = false;
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      // 덮개가 떠 있으면 그 위의 버튼이 스스로 부른다 — 감독관이 아이디를 치는 중에
      // 화면이 전체화면으로 튀어 덮개가 닫히는 일이 없게.
      if (armed() && !veilOpen()) enter();
    }
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }

  /* ── 창 잠금 ───────────────────────────────────────────── */

  var SELF = (document.currentScript && document.currentScript.src) || '';

  function supported() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
  }

  /** 지금 이 화면이 잠겨 있는가 — 학생 세션이고, 전체화면을 걸 수 있는 기기다. */
  function locked() { return armed() && supported(); }

  /* 브라우저가 스스로 처리해 버리는 것(Alt+Tab, Cmd+Q)은 애초에 오지 않는다.
     오는 것만 막는다. 크롬은 Ctrl+W·Ctrl+N 을 넘겨주지 않을 때가 있어 완벽하지 않다. */
  function onKey(e) {
    if (!locked()) return;
    var k = e.key || '';
    var mod = e.ctrlKey || e.metaKey;
    var stop =
      k === 'F11' || k === 'F12' || k === 'ContextMenu' ||
      (mod && e.shiftKey && /^[ijcw]$/i.test(k)) ||       // 개발자 도구, 창 통째로 닫기
      (mod && /^[rwntpsuo]$/i.test(k)) ||                 // 새로고침·닫기·새 창·인쇄·저장·소스
      (e.altKey && k === 'F4') ||                         // 윈도우 창 닫기
      (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight'));   // 뒤로·앞으로
    if (stop) { e.preventDefault(); e.stopPropagation(); }
  }

  function onContext(e) { if (locked()) e.preventDefault(); }

  /* ── 창 닫기 막기 ──────────────────────────────────────────
   * 창 오른쪽 위의 X 는 운영체제 것이라 웹이 지울 수 없다. 웹이 할 수 있는 건 하나,
   * 닫으려는 순간에 브라우저가 "정말 나가시겠습니까" 를 띄우게 만드는 것뿐이다.
   * 그래서 시험이 도는 동안에만 그 문을 세운다(hold(true) — exam-shell 이 켠다).
   * 시험 목록·대시보드처럼 학생이 오가는 화면에서는 켜지 않는다.
   *
   * 우리 코드가 스스로 페이지를 옮길 때(Exit 승인, 재응시)는 물어볼 이유가 없다.
   * 그 자리에서 allow() 를 부르면 이번 한 번만 조용히 지나간다.
   */
  var holding = false;
  var allowOnce = false;

  function onBeforeUnload(e) {
    if (!holding || allowOnce) { allowOnce = false; return; }
    if (!armed()) return;                 // 감독관이 풀어 준 뒤에는 붙잡지 않는다
    e.preventDefault();
    e.returnValue = '';                   // 옛 브라우저는 이 값이 있어야 묻는다
    return '';
  }

  /** 시험이 도는 동안 창 닫기·새로고침을 브라우저 확인창으로 한 번 붙잡는다. */
  function hold(on2) { holding = on2 !== false; }

  /** 우리가 옮기는 이번 한 번은 묻지 않는다. 옮기기 직전에 부른다. */
  function allow() { allowOnce = true; }

  /* ── 덮개 ──────────────────────────────────────────────── */

  var veil = null;

  function assetUrl(name) {
    try { return new URL(name, SELF || location.href).href; } catch (e) { return 'assets/' + name; }
  }

  /** admin-session.js 는 시험 셸에만 실려 있다. 없으면 그 자리에서 불러온다. */
  function ensureAdmin(cb) {
    if (window.SG_ADMIN) { cb(true); return; }
    var s = document.createElement('script');
    s.src = assetUrl('admin-session.js');
    s.onload = function () { cb(!!window.SG_ADMIN); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function veilCss() {
    if (document.getElementById('sgfs-css')) return;
    var s = document.createElement('style');
    s.id = 'sgfs-css';
    s.textContent =
      '.sgfs-veil{position:fixed;inset:0;z-index:9500;background:rgba(20,16,14,.92);display:flex;' +
        'align-items:center;justify-content:center;padding:20px;' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;zoom:1}' +
      '.sgfs-veil[hidden]{display:none}' +
      '.sgfs-card{background:#fff;color:#221c19;border-radius:18px;padding:28px 28px 22px;' +
        'width:min(430px,100%);box-shadow:0 24px 60px rgba(0,0,0,.4);text-align:center}' +
      '.sgfs-tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.08em;' +
        'text-transform:uppercase;color:#e8481f;background:#f6efe9;border-radius:999px;padding:5px 11px}' +
      '.sgfs-h{font-size:20px;font-weight:850;margin:13px 0 6px}' +
      '.sgfs-sub{font-size:13px;line-height:1.6;color:#7b716b;margin:0 0 18px}' +
      '.sgfs-btn{font:inherit;font-size:14px;font-weight:750;padding:11px 18px;border-radius:11px;' +
        'cursor:pointer;border:1px solid #e2d9d2;background:#fff;color:inherit}' +
      '.sgfs-btn.primary{background:#e8481f;border-color:#e8481f;color:#fff}' +
      '.sgfs-auth{margin-top:18px;border-top:1px solid #efe7e1;padding-top:16px;text-align:left}' +
      '.sgfs-auth[hidden]{display:none}' +
      '.sgfs-err{display:none;font-size:12.5px;font-weight:700;color:#b3261e;background:#fdeceb;' +
        'border:1px solid #f5c6c2;border-radius:10px;padding:9px 12px;margin:0 0 12px}' +
      '.sgfs-err.on{display:block}' +
      '.sgfs-lb{display:block;font-size:12px;font-weight:750;color:#4a423d;margin-bottom:11px}' +
      '.sgfs-lb input{display:block;width:100%;margin-top:5px;font:inherit;font-size:14px;' +
        'padding:10px 12px;border:1px solid #e2d9d2;border-radius:10px;background:#fff;color:inherit}' +
      '.sgfs-lb input:focus{outline:none;border-color:#e8481f}' +
      '.sgfs-acts{display:flex;gap:8px;justify-content:flex-end}';
    document.head.appendChild(s);
  }

  function ensureVeil() {
    if (veil) return veil;
    veilCss();
    veil = document.createElement('div');
    veil.className = 'sgfs-veil';
    veil.hidden = true;
    veil.innerHTML =
      '<div class="sgfs-card">' +
        '<span class="sgfs-tag">Exam mode</span>' +
        '<h2 class="sgfs-h">Leaving fullscreen needs approval</h2>' +
        '<p class="sgfs-sub">This device is locked for the test. ' +
          'An invigilator must sign in to release it.</p>' +
        '<form class="sgfs-auth" autocomplete="off" hidden>' +
          '<p class="sgfs-err">Wrong admin ID or password for this test.</p>' +
          '<label class="sgfs-lb">Admin ID' +
            '<input name="fs-id" type="text" autocapitalize="none" autocorrect="off"' +
            ' spellcheck="false" required></label>' +
          '<label class="sgfs-lb">Password<input name="fs-pw" type="password" required></label>' +
          '<div class="sgfs-acts">' +
            '<button type="button" class="sgfs-btn" data-act="cancel">Cancel</button>' +
            '<button type="submit" class="sgfs-btn primary">Unlock</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(veil);

    var form = veil.querySelector('form');
    var err = veil.querySelector('.sgfs-err');

    veil.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'cancel') hideVeil();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = form.querySelector('[name=fs-id]').value;
      var pw = form.querySelector('[name=fs-pw]').value;
      ensureAdmin(function (ok) {
        var A = window.SG_ADMIN;
        var who = ok && A && A.verify
          ? A.verify(id, pw, A.pageSet ? A.pageSet() : '') : null;
        if (!who) {
          err.textContent = ok
            ? 'Wrong admin ID or password for this test.'
            : 'Admin sign-in is unavailable on this device.';
          err.classList.add('on');
          form.querySelector('[name=fs-pw]').value = '';
          return;
        }
        release();                       // 표시를 지우고 창을 돌려준다
        hideVeil();
        try {
          document.dispatchEvent(new CustomEvent('sg-fs-unlock', { detail: { by: who.id } }));
        } catch (e2) {}
      });
    });

    return veil;
  }

  function showAuth() {
    var v = ensureVeil();
    v.querySelector('.sgfs-auth').hidden = false;
    v.querySelector('.sgfs-err').classList.remove('on');
    v.querySelector('form').reset();
    setTimeout(function () { v.querySelector('[name=fs-id]').focus(); }, 30);
  }

  function hideAuth() {
    if (!veil) return;
    veil.querySelector('.sgfs-auth').hidden = true;
    veil.querySelector('.sgfs-err').classList.remove('on');
  }

  /** 학생이 전체화면을 나가겠다고 눌렀을 때만 뜬다 — 감독관이 풀어 준다. */
  function showVeil() {
    var v = ensureVeil();
    v.hidden = false;
    showAuth();
  }

  function hideVeil() {
    if (veil) { veil.hidden = true; hideAuth(); }
  }

  function veilOpen() { return !!(veil && !veil.hidden); }
  function authOpen() { return veilOpen() && !veil.querySelector('.sgfs-auth').hidden; }

  /* 전체화면이 풀려도 화면을 덮지 않는다 — 덮개는 학생이 나가겠다고 누른 때만 뜬다.
     풀린 전체화면은 다음 클릭·키 입력 한 번에 조용히 되돌아간다(rearmOnGesture). */
  function guard() {
    if (!locked()) { hideVeil(); return; }
    // 감독관이 아이디를 치는 중이면 덮개를 걷지 않는다.
    if (on() && !authOpen()) hideVeil();
  }

  /** 시험 셸의 전체화면 버튼이 부른다 — 학생 혼자서는 창으로 돌아가지 못한다. */
  function requestExit() {
    if (!locked()) { release(); return; }
    showVeil();
  }

  function bindLock() {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onContext, true);
    document.addEventListener('fullscreenchange', guard);
    document.addEventListener('webkitfullscreenchange', guard);
    window.addEventListener('beforeunload', onBeforeUnload);
    guard();
  }

  /* ── 화면 크기에 맞추기 ─────────────────────────────────── */

  var zoom = 1;

  function shell() { return document.querySelector('.exam-shell'); }

  function applyZoom(z) {
    var s = shell();
    zoom = z;
    document.body.style.zoom = z === 1 ? '' : String(z);
    // zoom 은 셸의 100dvh 까지 같이 줄인다 — 화면을 다시 꽉 채우도록 되돌려 준다.
    if (s) s.style.height = z === 1 ? '' : (window.innerHeight / z) + 'px';
  }

  function overflows(el) {
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }

  /** 본문이 한 화면에 들어올 때까지 확대율을 낮춘다. 들어오면 1 로 둔다. */
  function fit() {
    var s = shell();
    if (!s) return;
    var main = s.querySelector('.exam-main') || s;
    applyZoom(1);
    var z = 1;
    while (overflows(main) && z > MIN_ZOOM) {
      z = Math.round((z - STEP) * 100) / 100;
      applyZoom(z < MIN_ZOOM ? MIN_ZOOM : z);
    }
  }

  var timer = null;
  function refit() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(function () { timer = null; fit(); }, 80);
  }

  function watch() {
    var s = shell();
    if (!s) return;
    refit();
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    document.addEventListener('fullscreenchange', refit);
    document.addEventListener('webkitfullscreenchange', refit);
    var main = s.querySelector('.exam-main');
    if (main && window.MutationObserver) {
      // 화면(문항)이 바뀌면 다시 잰다. 우리가 건드리는 건 body/셸의 style 이라
      // 이 관찰 대상 안에서는 변화가 나지 않는다 — 되먹임 고리가 없다.
      new MutationObserver(refit).observe(main, { childList: true, subtree: true });
    }
  }

  /* ── 시작 ──────────────────────────────────────────────── */

  function boot() {
    var page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (page.indexOf('admin') === 0) { release(); return; }   // 관리 화면은 창으로 쓴다
    document.addEventListener('fullscreenchange', rearmOnGesture);
    document.addEventListener('webkitfullscreenchange', rearmOnGesture);
    rearmOnGesture();
    bindLock();
    watch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return {
    on: on, enter: enter, exit: exit,
    arm: arm, armed: armed, armAndEnter: armAndEnter, release: release,
    locked: locked, requestExit: requestExit, guard: guard,
    hold: hold, allow: allow, holding: function () { return holding; },
    fit: fit, refit: refit, zoom: function () { return zoom; }
  };
})();
