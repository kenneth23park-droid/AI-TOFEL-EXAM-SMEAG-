/* SMEAG StudyGround — 영역별 진입 승인(관리자 그 자리 확인).
 *
 * 학생에게 네 영역(Reading · Listening · Speaking · Writing)은 보이지만, 그 문은
 * 학생 혼자 열지 못한다. 감독하는 선생님이 그 자리에서 관리자 아이디·비밀번호를
 * 넣어야 한 영역이 시작된다. Exit 승인·다시 응시 승인(assets/exam-shell.js)과
 * 같은 뜻이고, 같은 계정표(assets/admin-session.js)를 쓴다.
 *
 * 세션을 만들지 않는다 — SG_ADMIN.verify 로 "관리자가 지금 여기 있다"만 확인한다.
 * 학생 기기에 12시간짜리 관리자 세션을 남기면 그 뒤로 문항 편집 패널까지 열린다.
 * 이미 관리자 세션이 있는 기기(선생님 노트북)는 묻지 않고 그대로 지난다.
 *
 * 목록에서 한 번 승인받고 시험 셸로 넘어갈 때 두 번 묻지 않도록, 승인은 짧은
 * 일회용 표로 남는다(sessionStorage · 3분 · 쓰면 사라진다). 주소를 직접 쳐서 들어온
 * 경우에는 표가 없으니 셸이 그 자리에서 다시 묻는다.
 *
 * 노출 전역: window.SG_APPROVE
 */
(function () {
  'use strict';

  var PASS_KEY = 'sg2_section_pass_v1';
  var PASS_TTL_MS = 3 * 60 * 1000;         // 목록 → 셸로 넘어가는 몇 초를 위한 시간.

  /* ── 일회용 승인 표 ──────────────────────────────────────── */
  function grant(key) {
    if (!key) return;
    try {
      window.sessionStorage.setItem(PASS_KEY, JSON.stringify({ k: String(key), t: Date.now() }));
    } catch (e) { /* 프라이빗 모드 — 셸에서 한 번 더 묻는다 */ }
  }

  /** 표가 있으면 true 를 주고 그 자리에서 없앤다(한 번만 쓴다). */
  function claim(key) {
    var raw = null;
    try { raw = JSON.parse(window.sessionStorage.getItem(PASS_KEY) || 'null'); } catch (e) { return false; }
    if (!raw || raw.k !== String(key)) return false;
    try { window.sessionStorage.removeItem(PASS_KEY); } catch (e) {}
    return Date.now() - raw.t < PASS_TTL_MS;
  }

  /* ── 승인 모달 ───────────────────────────────────────────── */
  var modal = null;

  function ensureModal() {
    if (modal) return modal;
    injectCss();
    modal = document.createElement('div');
    modal.className = 'sgp-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="sgp-card">' +
        '<span class="sgp-tag"><span data-en>Admin approval</span><span data-ko>관리자 승인</span></span>' +
        '<h2 class="sgp-h" id="sgp-what"></h2>' +
        '<p class="sgp-sub"><span data-en>An administrator must approve entry to this section. ' +
          'Ask your supervisor to enter their ID and password.</span>' +
          '<span data-ko>이 영역에 들어가려면 관리자 승인이 필요합니다. 감독 선생님이 아이디·비밀번호를 넣어 주세요.</span></p>' +
        '<div class="sgp-err"><span data-en>Wrong admin ID or password.</span>' +
          '<span data-ko>관리자 아이디·비밀번호가 틀렸습니다.</span></div>' +
        '<form autocomplete="off">' +
          '<label class="sgp-lb"><span data-en>Admin ID</span><span data-ko>관리자 아이디</span>' +
            '<input name="sgp-id" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
          '<label class="sgp-lb"><span data-en>Password</span><span data-ko>비밀번호</span>' +
            '<input name="sgp-pw" type="password" required></label>' +
          '<div class="sgp-acts">' +
            '<button type="button" class="sgp-btn" data-act="cancel"><span data-en>Cancel</span><span data-ko>취소</span></button>' +
            '<button type="submit" class="sgp-btn primary"><span data-en>Start section</span><span data-ko>영역 시작</span></button>' +
          '</div>' +
        '</form>' +
        '<p class="sgp-note"><span data-en>Approval is for this entry only — no admin session is kept on this device.</span>' +
          '<span data-ko>이번 진입에만 쓰이는 승인입니다 — 이 기기에 관리자 세션은 남지 않습니다.</span></p>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || (e.target.closest && e.target.closest('[data-act=cancel]'))) close(true);
    });
    modal.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var A = window.SG_ADMIN;
      var idEl = modal.querySelector('[name=sgp-id]');
      var pwEl = modal.querySelector('[name=sgp-pw]');
      /* 세트로 좁히지 않는다 — 업로드로 만든 세트는 SET 목록에 없어서, 좁히면
         그 시험만 아무도 못 열게 된다(exam-shell.js 의 다시 응시 승인과 같은 이유). */
      var who = A && A.verify ? A.verify(idEl.value, pwEl.value) : null;
      if (!who) {
        modal.querySelector('.sgp-err').classList.add('on');
        pwEl.value = ''; pwEl.focus();
        return;
      }
      var ok = modal._ok;
      modal._ok = modal._cancel = null;
      modal.hidden = true;
      ok && ok(who);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) close(true);
    });
    return modal;
  }

  function close(cancelled) {
    if (!modal) return;
    modal.hidden = true;
    var no = modal._cancel;
    modal._ok = modal._cancel = null;
    if (cancelled) no && no();
  }

  /**
   * 승인을 받아 온다. 관리자 세션이 이미 있는 기기면 묻지 않고 바로 onOk.
   * opts: { what: '화면에 세울 이름', setId: '권한을 볼 SET(선택)' }
   */
  function ask(opts, onOk, onCancel) {
    var o = opts || {};
    var A = window.SG_ADMIN;
    if (A && A.can && A.can(o.setId || '')) { onOk && onOk(A.current()); return; }

    ensureModal();
    modal._ok = onOk || null;
    modal._cancel = onCancel || null;
    modal.querySelector('#sgp-what').textContent = o.what || 'Section';
    modal.querySelector('.sgp-err').classList.remove('on');
    modal.querySelector('form').reset();
    modal.hidden = false;
    setTimeout(function () { modal.querySelector('[name=sgp-id]').focus(); }, 30);
  }

  function injectCss() {
    if (document.getElementById('sgp-css')) return;
    var s = document.createElement('style');
    s.id = 'sgp-css';
    s.textContent =
      '.sgp-modal{position:fixed;inset:0;z-index:9200;background:rgba(20,16,14,.62);display:flex;' +
        'align-items:center;justify-content:center;padding:20px}' +
      '.sgp-modal[hidden]{display:none}' +
      '.sgp-card{background:var(--card,#fff);color:var(--ink,#221c19);border-radius:18px;padding:26px 26px 20px;' +
        'width:min(420px,100%);box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:inherit;text-align:left}' +
      '.sgp-tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;' +
        'color:var(--brand,#e8481f);background:var(--cream-2,#f6efe9);border-radius:999px;padding:5px 11px}' +
      '.sgp-h{font-size:20px;font-weight:850;margin:12px 0 6px}' +
      '.sgp-sub{font-size:12.5px;line-height:1.6;color:var(--muted,#7b716b);margin:0 0 14px}' +
      '.sgp-err{display:none;font-size:12.5px;font-weight:700;color:#b3261e;background:#fdeceb;border:1px solid #f5c6c2;' +
        'border-radius:10px;padding:9px 12px;margin-bottom:12px}.sgp-err.on{display:block}' +
      '.sgp-lb{display:block;font-size:12px;font-weight:750;color:var(--ink-2,#4a423d);margin-bottom:11px}' +
      '.sgp-lb input{display:block;width:100%;margin-top:5px;font:inherit;font-size:14px;padding:10px 12px;' +
        'border:1px solid var(--line-2,#e2d9d2);border-radius:10px;background:var(--paper,#fff);color:inherit}' +
      '.sgp-lb input:focus{outline:none;border-color:var(--brand,#e8481f)}' +
      '.sgp-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}' +
      '.sgp-btn{font:inherit;font-size:13px;font-weight:750;padding:9px 16px;border-radius:10px;cursor:pointer;' +
        'border:1px solid var(--line-2,#e2d9d2);background:var(--paper,#fff);color:inherit}' +
      '.sgp-btn.primary{background:var(--brand,#e8481f);border-color:var(--brand,#e8481f);color:#fff}' +
      '.sgp-note{font-size:11.5px;color:var(--dim,#a1968f);text-align:center;margin:14px 0 0}';
    document.head.appendChild(s);
  }

  window.SG_APPROVE = {
    ask: ask,
    grant: grant,
    claim: claim,
    /** 영역 진입 표의 열쇠 — 목록과 셸이 같은 문자열을 만들어야 한다. */
    key: function (setId, section) {
      return String(setId || '').toLowerCase() + ':' + String(section || '').toLowerCase();
    }
  };
})();
