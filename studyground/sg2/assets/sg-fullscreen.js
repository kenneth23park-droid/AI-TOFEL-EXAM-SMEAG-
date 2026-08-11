/* SMEAG · StudyGround — 학생 화면은 로그인하는 순간 전체화면이 된다.
 *
 * 두 가지를 한다.
 *
 *  1) 전체화면 자동 진입
 *     브라우저는 "사용자가 방금 누른 것"이 있어야만 전체화면을 열어 준다. 그래서
 *     로그인 버튼을 누른 그 순간(비동기 로그인을 기다리기 전에) 요청하고, 학생
 *     세션이라는 표시를 sessionStorage 에 남긴다. 표시가 남아 있는 동안에는 다음
 *     페이지에서도 전체화면을 유지하고, 어쩌다 풀렸으면 다음 클릭·키 입력 한 번에
 *     조용히 되돌린다(그때가 또 하나의 사용자 동작이므로 허용된다).
 *     선생님·관리자는 표시를 지운다 — 관리 화면은 창을 여러 개 띄워 쓴다.
 *
 *  2) 화면 크기에 맞추기
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
      if (armed()) enter();
    }
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
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
    fit: fit, refit: refit, zoom: function () { return zoom; }
  };
})();
