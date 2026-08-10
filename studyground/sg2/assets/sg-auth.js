/* SMEAG · StudyGround 2.0 — 회원 세션 (Supabase Auth). 의존성 없음, CDN 없음.
 *
 * supabase-js 를 쓰지 않는 이유: sg2 는 무네트워크 로컬 모드로도 돌아야 해서
 * 외부 스크립트를 붙일 수 없다. 필요한 건 fetch 세 번뿐이라 REST 를 직접 친다.
 *
 * 가입은 Edge Function `sg-auth` 를 거친다 — 서버에서 email_confirm:true 로 계정을
 * 만들기 때문에 확인 메일을 기다리지 않고 가입 즉시 로그인 상태가 된다.
 * 로그인도 같은 함수를 거쳐 이메일뿐 아니라 학번으로도 들어올 수 있다.
 *
 * 가입 시 학번 + 생년월일을 어드민 전산 명부(sg_roster)와 대조하지만, 지금은 그
 * 대조가 가입을 막지 않는다(soft verify) — 확인되면 profile.verified = true,
 * 아니면 false 로 두고 관리자가 명부 화면에서 정리한다.
 *
 * 노출 전역: window.SG_AUTH
 *   SG_AUTH.lookup(studentId, birthDate) → Promise<{found, name?, class_name?, claimed?}>
 *   SG_AUTH.signUp({ name, email, password, studentId, birthDate }) → Promise<user>
 *   SG_AUTH.signIn(login, password)                      → Promise<user>
 *   SG_AUTH.signOut()            현재 기기의 세션만 지운다
 *   SG_AUTH.user()               로그인 상태면 프로필 객체, 아니면 null
 *   SG_AUTH.profile(force)       → Promise<프로필|null>  서버 사본으로 갱신(role 포함)
 *   SG_AUTH.role()               → Promise<'student'|'teacher'|'admin'>
 *   SG_AUTH.isStaff()            → Promise<boolean>  선생님 또는 관리자
 *   SG_AUTH.token()              → Promise<string|null>  만료됐으면 알아서 갱신
 *   SG_AUTH.require()            비로그인이면 login.html?next= 로 보낸다
 *   SG_AUTH.onChange(fn)         로그인/로그아웃 때 호출
 */
window.SG_AUTH = (function () {
  'use strict';

  var URL_ = 'https://qrmidnmlethqvdbmnyun.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFybWlkbm1sZXRocXZkYm1ueXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Mzg3NzQsImV4cCI6MjEwMTMxNDc3NH0.U2cprYXkpIS_1tSAiEjCFuHAztZRwIIK6DYCCowgxg4';
  var KEY = 'sg2_auth_v1';
  var listeners = [];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function write(v) {
    try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {}
    listeners.forEach(function (fn) { try { fn(v && v.user); } catch (e) {} });
  }

  /** Edge Function/토큰 응답을 { user, access_token, refresh_token, expires_at } 로 정규화. */
  function store(payload) {
    var s = payload.session || payload;
    var saved = {
      user: payload.user || (s.user ? { id: s.user.id, email: s.user.email } : null),
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      // expires_at 은 초 단위 epoch. 없으면 expires_in 으로 만든다.
      expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600))
    };
    write(saved);
    return saved.user;
  }

  function fn(body) {
    return fetch(URL_ + '/functions/v1/sg-auth', {
      method: 'POST',
      headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.message || 'Request failed');
          e.code = j.error; e.messageKo = j.message_ko;
          throw e;
        }
        return j;
      });
    }, function () {
      // 네트워크 자체가 안 되는 경우 — 오프라인 데모 현장에서 흔하다.
      var e = new Error('Cannot reach the server. Check your connection.');
      e.code = 'offline'; e.messageKo = '서버에 연결할 수 없습니다. 네트워크를 확인하세요.';
      throw e;
    });
  }

  function lookup(studentId, birthDate) {
    return fn({ action: 'lookup', student_id: studentId || '', birth_date: birthDate || '' });
  }

  function signUp(o) {
    return fn({
      action: 'signup',
      name: o.name || '',
      email: o.email || '',
      password: o.password || '',
      student_id: o.studentId || '',
      birth_date: o.birthDate || ''
    }).then(store);
  }

  function signIn(login, password) {
    return fn({ action: 'signin', login: login, password: password }).then(store);
  }

  function signOut() {
    var s = read();
    if (s && s.access_token) {
      // 서버 쪽 refresh 토큰도 끊는다. 실패해도 로컬 세션은 지운다.
      fetch(URL_ + '/auth/v1/logout', {
        method: 'POST',
        headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + s.access_token }
      }).catch(function () {});
    }
    write(null);
  }

  function user() {
    var s = read();
    return s ? s.user : null;
  }

  /* 저장해 둔 프로필에는 role 이 없을 수 있다 — 로그인 응답이 만들어진 시점보다
   * role 이 늦게 생겼거나, 관리자가 나중에 선생님으로 올렸을 수 있기 때문이다.
   * 그래서 필요할 때 서버 사본으로 한 번 채우고 로컬에 그대로 붙여 둔다.
   * 오프라인이면 들고 있던 값을 그대로 돌려준다 — 시험은 멈추지 않는다. */
  var PROFILE_COLS = 'id,email,name,student_id,plan,role,is_admin,verified';
  function profile(force) {
    var s = read();
    if (!s || !s.user) return Promise.resolve(null);
    if (!force && s.user.role) return Promise.resolve(s.user);
    return token().then(function (tok) {
      if (!tok) return s.user;
      return fetch(URL_ + '/rest/v1/sg_profiles?select=' + PROFILE_COLS + '&id=eq.' + s.user.id, {
        headers: { apikey: ANON, Authorization: 'Bearer ' + tok }
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
        var p = rows && rows[0];
        if (!p) return s.user;
        var cur = read();
        if (!cur) return p;
        cur.user = p; write(cur);
        return p;
      });
    }).catch(function () { return s.user; });
  }

  /** role 이 없던 시절 계정도 있으니 is_admin 을 예비로 본다. */
  function role() {
    return profile().then(function (p) {
      if (!p) return 'student';
      return p.role || (p.is_admin ? 'admin' : 'student');
    });
  }
  function isStaff() {
    return role().then(function (r) { return r === 'teacher' || r === 'admin'; });
  }

  var refreshing = null;
  function token() {
    var s = read();
    if (!s) return Promise.resolve(null);
    if (s.expires_at - 60 > Math.floor(Date.now() / 1000)) return Promise.resolve(s.access_token);
    if (refreshing) return refreshing;
    refreshing = fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (r) {
      if (!r.ok) throw new Error('refresh failed');
      return r.json();
    }).then(function (j) {
      var u = s.user;                 // 갱신 응답에는 프로필이 없으니 들고 있던 걸 유지
      store(j);
      var cur = read(); cur.user = u; write(cur);
      return cur.access_token;
    }).catch(function () {
      write(null);                    // 리프레시 토큰까지 죽었으면 로그아웃 처리
      return null;
    }).then(function (t) { refreshing = null; return t; });
    return refreshing;
  }

  function require_() {
    if (user()) return true;
    var next = location.pathname.split('/').pop() + location.search;
    location.replace('login.html?next=' + encodeURIComponent(next));
    return false;
  }

  function onChange(f) { listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; }

  /* 헤더의 Login / Sign Up Free 버튼을, 로그인 상태면 이름 + 로그아웃으로 바꾼다.
   * 페이지마다 같은 마크업이라 여기서 한 번에 처리한다. */
  function paintNav() {
    var right = document.querySelector('.nav-right');
    if (!right) return;
    var u = user();
    var login = right.querySelector('a[href="login.html"]');
    var signup = right.querySelector('a[href="signup.html"]');
    var chip = right.querySelector('[data-sg-user]');

    if (!u) {
      if (chip) chip.remove();
      if (login) login.hidden = false;
      if (signup) signup.hidden = false;
      return;
    }
    if (login) login.hidden = true;
    if (signup) signup.hidden = true;
    if (!chip) {
      chip = document.createElement('span');
      chip.setAttribute('data-sg-user', '');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:8px';
      chip.innerHTML =
        '<a class="btn ghost sm" href="dashboard.html" data-role="who"></a>' +
        '<button class="btn ghost sm" type="button" data-role="out">' +
          '<span data-en>Log out</span><span data-ko>로그아웃</span></button>';
      chip.querySelector('[data-role=out]').addEventListener('click', function () {
        signOut();
        location.href = 'index.html';
      });
      right.appendChild(chip);
    }
    chip.querySelector('[data-role=who]').textContent = '👤 ' + (u.name || u.student_id || u.email);
  }

  document.addEventListener('DOMContentLoaded', function () {
    paintNav();
    if (user()) token();   // 세션이 살아 있는지 조용히 확인/갱신
  });
  onChange(paintNav);

  return {
    lookup: lookup, signUp: signUp, signIn: signIn, signOut: signOut,
    user: user, profile: profile, role: role, isStaff: isStaff,
    token: token, require: require_, onChange: onChange,
    url: URL_, anonKey: ANON
  };
})();
