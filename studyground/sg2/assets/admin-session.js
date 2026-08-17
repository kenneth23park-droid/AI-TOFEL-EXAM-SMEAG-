/* SMEAG StudyGround — SET 별 관리자 세션.
 *
 * 이 파일은 "이 SET 을 손댈 수 있는가"를 가른다. 관리자로 로그인해야만
 *   · 시험 셸의 화면 이동·문항 편집 패널(assets/exam-admin-nav.js)
 *   · 오디오 교체(assets/audio-config.js · admin-audio.html)
 *   · 문항 교체(assets/question-config.js · admin-questions.html)
 * 가 열린다. 학생 화면은 로그인 전과 완전히 동일하다.
 *
 * 주의 — "가림막"이지 인증이 아니다. 정적 배포라 서버가
 * 없고 아래 계정표가 파일에 그대로 들어 있다. 외부 공개 시에는 서버/프록시
 * 인증(Vercel Password Protection, Basic Auth 등)으로 교체해야 한다.
 *
 * 노출 전역: window.SG_ADMIN
 */
(function () {
  'use strict';

  var KEY = 'sg2_admin_v1';
  var TTL_MS = 12 * 60 * 60 * 1000;      // gate 와 같은 12시간 — 하루 수업 길이.

  /* SET 별 계정. sets:['*'] 은 모든 SET 권한(마스터). */
  var ACCOUNTS = [
    { id: 'admin', pw: 'smeag2222', sets: ['*'],     label: 'Master admin',  labelKo: '전체 관리자' },
    { id: 'set1',  pw: 'set1-2222', sets: ['set1'],  label: 'SET 1 admin',   labelKo: 'SET 1 관리자' },
    { id: 'set9',  pw: 'set9-2222', sets: ['set9'],  label: 'SET 9 admin',   labelKo: 'SET 9 관리자' }
  ];

  /* 이 사이트가 아는 SET 목록 — 관리자 페이지의 SET 선택기가 이걸 쓴다. */
  var SETS = [
    { id: 'set1', label: 'SET 1', global: 'SMEAG_SET1' },
    { id: 'set9', label: 'SET 9', global: 'SMEAG_SET9' }
  ];

  var listeners = [];
  var session = null;

  function emit() { listeners.forEach(function (fn) { try { fn(session); } catch (e) {} }); }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw || !raw.t || !raw.sets) return null;
      if (Date.now() - raw.t >= TTL_MS) { localStorage.removeItem(KEY); return null; }
      return raw;
    } catch (e) { return null; }
  }
  function save(s) {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); }
    catch (e) { /* 프라이빗 모드 — 세션 동안만 유지 */ }
    emit();
  }

  session = load();

  /* ── 학생 계정이 로그인해 있으면 관리자 권한을 덮어 끈다 ──────────
   *
   * SG_ADMIN(비밀번호 가림막)과 SG_AUTH(회원 계정)는 서로 다른 세션이라, 선생님이
   * 쓰던 기기에 관리자 세션(12시간)이 남은 채로 학생이 자기 계정으로 들어오면
   * 시험 화면에 관리자 패널이 그대로 보였다. 수험생 계정으로 로그인해 있는 동안은
   * 관리자 세션이 남아 있어도 없는 것으로 친다 — 로그아웃하면 그대로 되살아난다.
   *
   * role 이 아직 안 채워진 옛 계정은 일단 학생으로 보고(막는 쪽이 안전),
   * 서버 프로필을 한 번 받아 온 뒤 다시 판정한다. */
  var AUTH_KEY = 'sg2_auth_v1';       // sg-auth.js 와 같은 열쇠.
  function authUser() {
    var Auth = window.SG_AUTH;
    if (Auth && typeof Auth.user === 'function') return Auth.user();
    // sg-auth.js 가 아직 안 떴어도 저장소는 읽을 수 있다 — 패널이 한 번 깜빡이지 않게.
    try { var s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return (s && s.user) || null; }
    catch (e) { return null; }
  }

  function studentSignedIn() {
    var u = authUser();
    if (!u) return false;
    var r = u.role || (u.is_admin ? 'admin' : 'student');
    return r !== 'teacher' && r !== 'admin';
  }

  /* sg-auth.js 는 이 파일보다 늦게 로드될 수 있다(시험 셸의 선택 스크립트).
     떴을 때 한 번 붙잡아 로그인/로그아웃마다 패널이 다시 판정되게 한다. */
  (function hookAuth(tries) {
    var Auth = window.SG_AUTH;
    if (!Auth) {
      if (tries < 40) setTimeout(function () { hookAuth(tries + 1); }, 250);
      return;
    }
    if (Auth.onChange) Auth.onChange(emit);
    var u = authUser();
    if (u && !u.role && Auth.profile) Auth.profile().then(emit, function () {});
    emit();
  })(0);

  /* 이 페이지가 어떤 SET 을 다루는지: <body data-sg-set> → ?set= → ?testId= → set1 */
  function pageSet() {
    var b = document.body && document.body.getAttribute('data-sg-set');
    if (b) return b.toLowerCase();
    var qs = new URLSearchParams(location.search);
    var q = (qs.get('set') || '').toLowerCase();
    if (q) return q;
    var t = String(qs.get('testId') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/(^|[A-Z])0*9$/.test(t) || t === 'SET9') return 'set9';
    return t ? 'set1' : '';
  }

  /** 아이디·비밀번호가 맞는 계정. 없으면 null. 세션은 건드리지 않는다. */
  function find(id, pw) {
    var u = String(id || '').trim().toLowerCase(), p = String(pw || '');
    for (var i = 0; i < ACCOUNTS.length; i++) {
      if (ACCOUNTS[i].id === u && ACCOUNTS[i].pw === p) return ACCOUNTS[i];
    }
    return null;
  }

  var API = {
    SETS: SETS,
    TTL_MS: TTL_MS,

    /** 현재 세션 {id,label,labelKo,sets:[],t} 또는 null. */
    current: function () {
      if (session && Date.now() - session.t >= TTL_MS) save(null);
      return session;
    },
    /** setId 에 대한 관리 권한이 있는가. 인자를 비우면 "아무 SET 이라도" 로 본다. */
    can: function (setId) {
      if (studentSignedIn()) return false;
      var s = API.current();
      if (!s) return false;
      if (s.sets.indexOf('*') >= 0) return true;
      if (!setId) return s.sets.length > 0;
      return s.sets.indexOf(String(setId).toLowerCase()) >= 0;
    },
    /** 이 세션이 다룰 수 있는 SET id 목록(마스터면 전체). */
    allowedSets: function () {
      var s = API.current();
      if (!s) return [];
      if (s.sets.indexOf('*') >= 0) return SETS.map(function (x) { return x.id; });
      return s.sets.slice();
    },
    pageSet: pageSet,
    /** 수험생 계정으로 로그인해 있는가 — 그 동안은 관리자 UI 를 아예 그리지 않는다. */
    blockedByStudent: studentSignedIn,

    login: function (id, pw) {
      var a = find(id, pw);
      if (!a) return false;
      save({ id: a.id, label: a.label, labelKo: a.labelKo, sets: a.sets.slice(), t: Date.now() });
      return true;
    },

    /* 세션을 만들지 않고 계정만 확인한다 — 시험 중 Exit 승인처럼 "관리자가 그 자리에
     * 있다"만 보고 싶을 때 쓴다. 학생 기기에 12시간짜리 관리자 세션을 남기지 않는다. */
    verify: function (id, pw, setId) {
      var a = find(id, pw);
      if (!a) return null;
      if (a.sets.indexOf('*') < 0 && setId && a.sets.indexOf(String(setId).toLowerCase()) < 0) return null;
      return { id: a.id, label: a.label, labelKo: a.labelKo, sets: a.sets.slice() };
    },
    logout: function () { save(null); },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /** 로그인 모달. 이미 권한이 있으면 바로 onOk 를 부른다. */
    openLogin: function (setId, onOk) {
      if (API.can(setId)) { onOk && onOk(API.current()); return; }
      ensureModal();
      modal.dataset.set = setId || '';
      modal._ok = onOk || null;
      modal.hidden = false;
      modal.querySelector('.sga-err').classList.remove('on');
      var f = modal.querySelector('form'); f.reset();
      setTimeout(function () { modal.querySelector('[name=sga-id]').focus(); }, 30);
    },

    /** 권한이 없으면 로그인 모달을 띄우고 false. 관리자 페이지 진입 가드용. */
    require: function (setId, onOk) {
      if (API.can(setId)) { onOk && onOk(API.current()); return true; }
      API.openLogin(setId, onOk);
      return false;
    }
  };

  /* ── 로그인 모달 ─────────────────────────────────────────── */
  var modal = null;
  function ensureModal() {
    if (modal) return modal;
    injectCss();
    modal = document.createElement('div');
    modal.className = 'sga-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="sga-card">' +
        '<span class="sga-tag"><span data-en>Admin sign-in</span><span data-ko>관리자 로그인</span></span>' +
        '<h2 class="sga-h"><span data-en>Set-level admin access</span><span data-ko>SET 별 관리자 접근</span></h2>' +
        '<p class="sga-sub"><span data-en>Audio transport, audio replacement and question replacement are admin-only. The student view is unchanged.</span>' +
          '<span data-ko>오디오 정지·일시정지, 오디오 교체, 문항 교체는 관리자 전용입니다. 학생 화면은 그대로입니다.</span></p>' +
        '<div class="sga-err"><span data-en>Wrong ID or password — or this account has no rights for this set.</span>' +
          '<span data-ko>아이디·비밀번호가 틀렸거나 이 SET 권한이 없는 계정입니다.</span></div>' +
        '<form autocomplete="off">' +
          '<label class="sga-lb"><span data-en>Admin ID</span><span data-ko>관리자 아이디</span>' +
            '<input name="sga-id" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
          '<label class="sga-lb"><span data-en>Password</span><span data-ko>비밀번호</span>' +
            '<input name="sga-pw" type="password" required></label>' +
          '<div class="sga-acts">' +
            '<button type="button" class="sga-btn" data-act="cancel"><span data-en>Cancel</span><span data-ko>취소</span></button>' +
            '<button type="submit" class="sga-btn primary"><span data-en>Sign in</span><span data-ko>로그인</span></button>' +
          '</div>' +
        '</form>' +
        '<p class="sga-note"><span data-en>Signed in on this device for 12 hours.</span><span data-ko>이 기기에서 12시간 유지됩니다.</span></p>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-act=cancel]')) modal.hidden = true;
    });
    modal.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var id = modal.querySelector('[name=sga-id]').value;
      var pw = modal.querySelector('[name=sga-pw]').value;
      var want = modal.dataset.set || '';
      var signedIn = API.login(id, pw);

      /* 학생 계정이 남아 있으면 그 자리를 비워 준다 — 비밀번호를 맞힌 사람은
       * 선생님이니, "학생이 로그인해 있어서 안 된다"고 되돌려보내는 대신
       * 학생 세션을 끊고 들여보낸다. 학생 기기에 관리자 세션을 남기지 않으려던
       * 원래 뜻은 그대로다(학생은 비밀번호를 모른다). */
      if (signedIn && studentSignedIn() && window.SG_AUTH && window.SG_AUTH.signOut) {
        window.SG_AUTH.signOut();
      }

      if (!signedIn || studentSignedIn() || (want && !API.can(want))) {
        // 로그인 자체는 됐지만 이 SET 권한이 없는 계정이면 세션을 남기지 않는다.
        // 실패한 입력 때문에 이미 유효한 세션까지 끊기지는 않게 한다.
        if (signedIn && (studentSignedIn() || (want && !API.can(want)))) API.logout();
        modal.querySelector('.sga-err').classList.add('on');
        modal.querySelector('[name=sga-pw]').value = '';
        return;
      }
      modal.hidden = true;
      var ok = modal._ok; modal._ok = null;
      ok && ok(API.current());
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) modal.hidden = true;
    });
    return modal;
  }

  function injectCss() {
    if (document.getElementById('sga-css')) return;
    var s = document.createElement('style');
    s.id = 'sga-css';
    s.textContent =
      '.sga-modal{position:fixed;inset:0;z-index:9000;background:rgba(7,26,28,.55);display:flex;' +
        'align-items:center;justify-content:center;padding:20px}' +
      '.sga-modal[hidden]{display:none}' +
      '.sga-card{background:var(--card,#fff);color:var(--ink,#0e1a1c);border-radius:18px;padding:26px 26px 20px;' +
        'width:min(420px,100%);box-shadow:0 24px 60px rgba(0,0,0,.28);font-family:inherit}' +
      '.sga-tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;' +
        'color:var(--brand,#0e8f82);background:var(--surface-2,#e3eeed);border-radius:999px;padding:5px 11px}' +
      '.sga-h{font-size:20px;font-weight:850;margin:12px 0 6px}' +
      '.sga-sub{font-size:12.5px;line-height:1.6;color:var(--muted,#6b8083);margin:0 0 14px}' +
      '.sga-err{display:none;font-size:12.5px;font-weight:700;color:#b3261e;background:#fdeceb;border:1px solid #f5c6c2;' +
        'border-radius:10px;padding:9px 12px;margin-bottom:12px}.sga-err.on{display:block}' +
      '.sga-lb{display:block;font-size:12px;font-weight:750;color:var(--ink-2,#33474a);margin-bottom:11px}' +
      '.sga-lb input{display:block;width:100%;margin-top:5px;font:inherit;font-size:14px;padding:10px 12px;' +
        'border:1px solid var(--line-2,#c2d6d4);border-radius:10px;background:var(--paper,#fff);color:inherit}' +
      '.sga-lb input:focus{outline:none;border-color:var(--brand,#0e8f82)}' +
      '.sga-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}' +
      '.sga-btn{font:inherit;font-size:13px;font-weight:750;padding:9px 16px;border-radius:10px;cursor:pointer;' +
        'border:1px solid var(--line-2,#c2d6d4);background:var(--paper,#fff);color:inherit}' +
      '.sga-btn.primary{background:var(--brand,#0e8f82);border-color:var(--brand,#0e8f82);color:#fff}' +
      '.sga-note{font-size:11.5px;color:var(--dim,#96a9ab);text-align:center;margin:14px 0 0}';
    document.head.appendChild(s);
  }

  window.SG_ADMIN = API;
})();
