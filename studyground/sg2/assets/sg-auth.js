/* SMEAG · StudyGround 2.0 — 회원 세션 (Supabase Auth). 의존성 없음, CDN 없음.
 *
 * supabase-js 를 쓰지 않는 이유: sg2 는 무네트워크 로컬 모드로도 돌아야 해서
 * 외부 스크립트를 붙일 수 없다. 필요한 건 fetch 세 번뿐이라 REST 를 직접 친다.
 *
 * 가입은 Edge Function `sg-auth` 를 거친다 — 서버에서 email_confirm:true 로 계정을
 * 만들기 때문에 확인 메일을 기다리지 않고 가입 즉시 로그인 상태가 된다.
 * 로그인도 같은 함수를 거쳐 이메일뿐 아니라 학번으로도 들어올 수 있다.
 *
 * 노출 전역: window.SG_AUTH
 *   SG_AUTH.signUp({ name, email, password, studentId }) → Promise<user>
 *   SG_AUTH.signIn(login, password)                      → Promise<user>
 *   SG_AUTH.signOut()            현재 기기의 세션만 지운다
 *   SG_AUTH.user()               로그인 상태면 프로필 객체, 아니면 null
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

  function signUp(o) {
    return fn({
      action: 'signup',
      name: o.name || '',
      email: o.email || '',
      password: o.password || '',
      student_id: o.studentId || ''
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
    signUp: signUp, signIn: signIn, signOut: signOut,
    user: user, token: token, require: require_, onChange: onChange,
    url: URL_, anonKey: ANON
  };
})();
