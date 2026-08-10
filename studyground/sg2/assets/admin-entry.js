/* SMEAG StudyGround — 관리자 로그인 진입점.
 *
 * 화면 좌하단의 작은 ⚙ 점 하나와 Ctrl+Alt+A 단축키만 제공한다. 누르면
 * assets/admin-session.js 의 로그인 창이 뜨고, 로그인에 성공하면 시험 셸의
 * 관리자 패널(assets/exam-admin-nav.js — 화면 이동·문항 편집)이 스스로 뜬다.
 * 학생 화면에는 그 점 말고는 아무 것도 그리지 않는다.
 *
 * 의존: assets/admin-session.js (필수)
 * 노출 전역: window.SG_ADMIN_ENTRY
 */
(function () {
  'use strict';

  var A = window.SG_ADMIN;
  if (!A) return;

  var setId = '', dot = null;

  function css() {
    if (document.getElementById('sgdot-css')) return;
    var s = document.createElement('style');
    s.id = 'sgdot-css';
    s.textContent =
      '.sgdot{position:fixed;left:14px;bottom:14px;z-index:8400;width:30px;height:30px;border-radius:50%;' +
        'border:1px solid rgba(0,0,0,.15);background:rgba(36,29,26,.55);color:#fff;font-size:14px;line-height:1;' +
        'cursor:pointer;opacity:.4;transition:opacity .15s}' +
      '.sgdot:hover{opacity:1}' +
      '.sgdot[hidden]{display:none}';
    document.head.appendChild(s);
  }

  function showDot() {
    css();
    if (!dot) {
      dot = document.createElement('button');
      dot.className = 'sgdot';
      dot.type = 'button';
      dot.textContent = '⚙';
      dot.title = 'Admin sign-in (Ctrl+Alt+A)';
      dot.addEventListener('click', function () { A.openLogin(setId); });
      document.body.appendChild(dot);
    }
    dot.hidden = false;
  }

  var ENTRY = {
    mount: function (opts) {
      opts = opts || {};
      setId = String(opts.set || A.pageSet() || '').toLowerCase();
      sync();
      A.onChange(sync);
      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.altKey && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          if (!A.can(setId)) A.openLogin(setId);
        }
      });
    },
    setId: function () { return setId; }
  };
  // 로그인해 있으면 점은 숨긴다 — 관리자 UI 는 exam-admin-nav.js 가 그린다.
  function sync() { A.can(setId) ? (dot && (dot.hidden = true)) : showDot(); }

  window.SG_ADMIN_ENTRY = ENTRY;

  // <body data-sg-admin-entry> 가 있으면 알아서 붙는다.
  function auto() {
    if (document.body && document.body.hasAttribute('data-sg-admin-entry')) ENTRY.mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
