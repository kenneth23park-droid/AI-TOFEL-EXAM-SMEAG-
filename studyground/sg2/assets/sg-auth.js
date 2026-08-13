/* SMEAG · StudyGround 2.0 — 회원 세션 (Supabase Auth). 의존성 없음, CDN 없음.
 *
 * supabase-js 를 쓰지 않는 이유: sg2 는 무네트워크 로컬 모드로도 돌아야 해서
 * 외부 스크립트를 붙일 수 없다. 필요한 건 fetch 세 번뿐이라 REST 를 직접 친다.
 *
 * 가입은 Edge Function `sg-auth` 를 거친다 — 서버에서 email_confirm:true 로 계정을
 * 만들기 때문에 확인 메일을 기다리지 않고 가입 즉시 로그인 상태가 된다.
 * 로그인도 같은 함수를 거쳐 이메일뿐 아니라 학번으로도 들어올 수 있다.
 *
 * 수험생 계정 규칙: 아이디는 smeag000~smeag999 를 서버가 순서대로 배정하고 비밀번호는
 * 전부 2222. 키는 (아이디, 시험일자)라 같은 날 중복은 불가, 다른 날 재사용은 가능하다.
 * 로그인은 아이디 수동 입력과 QR 스캔(assets/sg-qr.js) 둘 다로 들어온다.
 *
 * 노출 전역: window.SG_AUTH
 *   SG_AUTH.nextId(examDate)     → Promise<{student_id, used, free}>  빈 아이디 미리보기
 *   SG_AUTH.teachers()           → Promise<[{id, name, student_id}]>  가입 화면 드롭다운용
 *   SG_AUTH.register({ name, email, examDate, teacherId, studentId?, force?, keepSession? })
 *                                → Promise<{user, student_id, password, exam_date}>
 *   SG_AUTH.createTeacher({ name, login, password?, email?, role? })
 *                                → Promise<{user, login, password}>  관리자만
 *   SG_AUTH.signIn(login, password)                      → Promise<user>
 *   SG_AUTH.signOut()            현재 기기의 세션만 지운다
 *   SG_AUTH.user()               로그인 상태면 프로필 객체, 아니면 null
 *   SG_AUTH.profile(force)       → Promise<프로필|null>  서버 사본으로 갱신(role 포함)
 *   SG_AUTH.role()               → Promise<'student'|'teacher'|'admin'>
 *   SG_AUTH.isStaff()            → Promise<boolean>  선생님 또는 관리자
 *   SG_AUTH.token()              → Promise<string|null>  만료됐으면 알아서 갱신
 *   SG_AUTH.require()            비로그인이면 "Please log in" 막으로 화면을 덮는다
 *                                (<meta name="sg-auth" content="required"> 를 단 문서는 자동)
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

  /* ── 컴퓨터를 다시 켜면 로그인부터 ──────────────────────────────
   *
   * 고사장 PC 는 여러 학생이 돌려 쓴다. 앞사람 세션이 살아 있는 채로 다음 사람이
   * 앉으면 그 사람 이름으로 시험이 저장된다 — 그래서 부팅마다 아이디·비밀번호를
   * 다시 받는다.
   *
   * 브라우저에는 "이 컴퓨터가 언제 켜졌나"를 묻는 길이 없다. 대신 열려 있는 탭이
   * 계속 살아 있다는 표시를 남기고, 페이지가 뜰 때 그 표시가 얼마나 묵었는지 본다.
   * 재부팅(또는 브라우저 종료)이면 그 사이 아무도 표시를 남기지 못해 공백이 생긴다.
   * 공백이 GAP 을 넘었으면 저장된 세션을 지운다 — 남는 건 로그인 화면뿐이다.
   *
   * 탭을 잠깐 닫았다 다시 여는 것(GAP 안쪽)은 로그아웃이 아니다 — 시험 도중
   * 창을 잘못 닫은 학생을 다시 로그인시키자고 만든 장치가 아니다.
   * 시계가 뒤로 간 경우도 공백으로 친다(막는 쪽이 안전).
   *
   * 표시 자체는 로그인 여부와 무관하게 늘 남긴다 — 비로그인으로 둘러보다 로그인한
   * 사람의 첫 표시가 방금 찍힌 것처럼 보이게 하려면 그래야 한다. */
  var ALIVE_KEY = 'sg2_alive_v1';
  var ALIVE_GAP_MS = 2 * 60 * 1000;      // 이만큼 조용했으면 그 사이 컴퓨터가 꺼져 있었다
  var ALIVE_TICK_MS = 10 * 1000;         // 숨은 탭에서 타이머가 늘어져도 GAP 안쪽

  function stampAlive() {
    try { localStorage.setItem(ALIVE_KEY, String(Date.now())); } catch (e) {}
  }
  function expireOnBoot() {
    var last = 0;
    try { last = parseInt(localStorage.getItem(ALIVE_KEY) || '0', 10) || 0; } catch (e) { return; }
    var now = Date.now();
    if (last && now >= last && now - last < ALIVE_GAP_MS) return;   // 계속 켜져 있었다
    /* 지우는 것은 세션 하나(sg2_auth_v1)뿐이다. 답안·응시 기록·아웃박스 같은
       기기에 쌓인 자료는 그대로 둔다 — 다시 로그인하면 그 자리에서 이어진다. */
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  expireOnBoot();
  stampAlive();
  setInterval(stampAlive, ALIVE_TICK_MS);
  window.addEventListener('pageshow', stampAlive);

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

  /** 그 시험일에 아직 안 쓴 가장 빠른 아이디. 화면에 미리 보여줄 때만 쓴다. */
  function nextId(examDate) {
    return fn({ action: 'next_id', exam_date: examDate || '' });
  }

  /* 담당 선생님 목록. 가입 화면은 로그인 전이라 sg_profiles 를 직접 못 읽는다(RLS) —
   * 서버가 이름만 추려서 내려 준다. 선생님이 하나도 없으면 빈 배열이다. */
  function teachers() {
    return fn({ action: 'teachers' }).then(function (j) { return (j && j.teachers) || []; });
  }

  /* 가입 입력은 이름 + 이메일 + 시험일자 + 담당 선생님. 아이디(smeag000~999)는 서버가
   * 배정하고 비밀번호는 2222 로 통일돼 있어 학생이 정할 것이 없다.
   * 담당 선생님은 그 학생의 답안을 누가 볼 수 있는지를 정한다 — 서버가 값을 확인해
   * sg_profiles.teacher_id 에 박고, 그 뒤로는 RLS 가 열람 범위를 쥔다.
   * 같은 시험일에 같은 이메일은 409 email_taken_today 로 막힌다(force 로도 못 넘는다).
   * 같은 시험일에 같은 이름이 이미 있으면 409 same_name_today 로 되돌아온다 —
   * 화면이 팝업으로 묻고, 그대로 진행하려면 { force: true } 로 다시 부른다.
   *
   * 기본값은 "만든 계정으로 로그인"이다 — 학생이 자기 손으로 가입하는 자리라서다.
   * 관리자가 여러 명을 연달아 만드는 자리(admin-students.html)에서는 그러면 안 된다.
   * 만들 때마다 관리자 세션이 학생 세션으로 덮여 두 번째 줄에서 권한을 잃는다.
   * { keepSession: true } 는 응답을 저장하지 않고 그대로 돌려준다. */
  function register(o) {
    return fn({
      action: 'register',
      name: o.name || '',
      email: o.email || '',
      exam_date: o.examDate || '',
      teacher_id: o.teacherId || '',
      student_id: o.studentId || '',
      force: o.force === true
    }).then(function (j) {
      if (o.keepSession !== true) store(j);
      return j;                     // { user, student_id, password, exam_date, teacher }
    });
  }

  /* 선생님 계정 만들기. 관리자만 통과한다 — 화면이 아니라 서버가 내 토큰을 되짚어
   * role 을 다시 확인하므로, 이 함수를 콘솔에서 부른다고 되는 일이 아니다.
   * 만들어진 계정의 로그인 아이디는 login (예: kevin) 그대로다. */
  function createTeacher(o) {
    return token().then(function (tok) {
      return fn({
        action: 'create_staff',
        token: tok || '',
        name: o.name || '',
        login: o.login || '',
        password: o.password || '',
        email: o.email || '',
        role: o.role || 'teacher'
      });
    });
  }

  /* 로그인 아이디 → 서버가 아는 형태로 맞춘다.
   * 수험생 아이디(smeag###)는 서버가 시험일과 묶어 이메일을 만들어 주지만,
   * 선생님·관리자 계정은 시험일이 없는 상주 계정이라 아이디@도메인이 곧 이메일이다.
   * 그래서 admin 처럼 입력하면 admin@smeagstudyground.com 으로 보낸다. */
  var STAFF_DOMAIN = 'smeagstudyground.com';
  function loginId(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (!v || v.indexOf('@') >= 0 || /^smeag\d{3}$/.test(v)) return v;
    return v + '@' + STAFF_DOMAIN;
  }

  /* examDate 는 QR 카드로 들어올 때만 넘어온다. 같은 아이디가 여러 시험일에 걸쳐
   * 있을 수 있어서, 카드가 자기 날짜를 들고 오면 그 계정으로 정확히 들어간다.
   * 손으로 칠 때는 비워 두고, 서버가 오늘 → 최근 과거 → 가까운 미래 순으로 고른다. */
  function signIn(login, password, examDate) {
    return fn({
      action: 'signin', login: loginId(login), password: password, exam_date: examDate || ''
    }).then(store);
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
    // 로그아웃하면 전체화면도 함께 놓아 준다 — 시험이 끝난 화면을 창으로 돌려준다.
    if (window.SG_FS) window.SG_FS.release();
  }

  function user() {
    var s = read();
    return s ? s.user : null;
  }

  /* 저장해 둔 프로필에는 role 이 없을 수 있다 — 로그인 응답이 만들어진 시점보다
   * role 이 늦게 생겼거나, 관리자가 나중에 선생님으로 올렸을 수 있기 때문이다.
   * 그래서 필요할 때 서버 사본으로 한 번 채우고 로컬에 그대로 붙여 둔다.
   * 오프라인이면 들고 있던 값을 그대로 돌려준다 — 시험은 멈추지 않는다. */
  var PROFILE_COLS = 'id,email,name,student_id,plan,role,is_admin,verified,teacher_id';
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

  /* 비로그인 화면을 덮는 막. 예전에는 login.html 로 조용히 튕겼는데, 재부팅으로
   * 세션이 지워진 자리에서는 화면이 왜 갈아엎어졌는지 학생이 모른 채 넘어간다.
   * 지금은 그 자리에 "로그인하세요"를 세우고, 버튼을 눌러야 로그인 화면으로 간다.
   * 막은 문서 맨 위(z-index)라 아래 화면은 손댈 수 없다 — 시험도 시작되지 않는다.
   *
   * 2026-08-13 부터 이 막은 모든 응시 화면의 문이다(파생 페이지 포함). 그래서 문구도
   * 한 경우("재부팅해서 세션이 지워졌다")만 말하지 않는다 — 처음부터 로그인한 적 없는
   * 학생이 훨씬 흔하고, 그 사람에게 필요한 말은 "왜 로그인해야 하는가"다: 로그인이
   * 없으면 답안이 이 컴퓨터 밖으로 나가지 않는다. */
  function blockWithLogin() {
    if (document.getElementById('sg-auth-block')) return;
    /* 돌아올 자리는 sg2 루트에서 본 상대경로다. /en/test-nt/reading/ 같은 라우트는
       경로가 곧 페이지라 pathname 의 마지막 조각만 떼면 빈 문자열이 된다 —
       <base href="../../../"> 를 기준으로 잘라야 그 자리로 되돌아온다. */
    var here = String(location.href || (location.pathname || '') + (location.search || ''));
    var base = String(document.baseURI || here).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    var next = here.indexOf(base) === 0 ? here.slice(base.length) : here.split('/').pop();
    var href = 'login.html?next=' + encodeURIComponent(next);
    var box = document.createElement('div');
    box.id = 'sg-auth-block';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;' +
      'align-items:center;justify-content:center;padding:24px;background:#fffdf8;' +
      'font-family:inherit;text-align:center';
    box.innerHTML =
      '<div style="max-width:420px">' +
        '<div style="font-size:40px;line-height:1">🔒</div>' +
        '<h1 style="margin:14px 0 8px;font-size:22px;font-weight:800">Please log in</h1>' +
        '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#6b6357">' +
          'The test is saved to your account. Without a login your answers stay on ' +
          'this computer only, and leave with it. Enter your ID and password to ' +
          'continue — anything already saved is untouched.</p>' +
        '<a href="' + href + '" style="display:inline-block;padding:12px 22px;border-radius:999px;' +
          'background:#e8481f;color:#fff;font-weight:800;font-size:15px;text-decoration:none">Log in</a>' +
      '</div>';
    function mount() { (document.body || document.documentElement).appendChild(box); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  function require_() {
    if (user()) return true;
    blockWithLogin();
    return false;
  }

  function onChange(f) { listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; }

  /* 화면에 세울 로그인 아이디. 프로필의 student_id 가 정답이고, 그게 비어 있던
   * 옛 계정은 이메일 앞자리에서 smeag### 를 줍는다. 선생님 계정은 아이디가 곧
   * 이메일 앞자리(kevin@smeagstudyground.com → kevin)다. */
  function loginLabel(u) {
    if (!u) return '';
    if (u.student_id) return u.student_id;
    var mail = String(u.email || '').toLowerCase();
    var m = /^(smeag\d{3})/.exec(mail);
    return m ? m[1] : mail.split('@')[0] || mail;
  }

  /* 헤더의 Login / Sign Up Free 버튼을, 로그인 상태면 이름 + 아이디 + 로그아웃으로
   * 바꾼다. 아이디까지 세우는 이유는 고사장 사고 하나 때문이다 — 앞사람이 로그아웃
   * 하지 않은 자리에서 그대로 시험을 시작하면, 이름만 봐서는 아무도 못 알아챈다.
   * 페이지마다 같은 마크업이라 여기서 한 번에 처리한다. */
  /** 이름표를 누르면 갈 곳. 학생은 자기 성적(dashboard.html), 선생님·관리자는
   *  관리 화면(admin.html) — 두 사이트를 섞지 않는다. 저장해 둔 프로필을 그대로
   *  읽는다(서버를 기다리면 이름표가 늦게 그려진다). role 이 없으면 학생으로 본다. */
  function homeHref() {
    var s = read(), u = s && s.user;
    var r = u && (u.role || (u.is_admin ? 'admin' : 'student'));
    return (r === 'teacher' || r === 'admin') ? 'admin.html' : 'dashboard.html';
  }

  var idFetched = false;
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
        '<a class="btn ghost sm" href="' + homeHref() + '" data-role="who"></a>' +
        '<button class="btn ghost sm" type="button" data-role="out">' +
          '<span data-en>Log out</span><span data-ko>로그아웃</span></button>';
      chip.querySelector('[data-role=out]').addEventListener('click', function () {
        signOut();
        location.href = 'index.html';
      });
      right.appendChild(chip);
    }
    /* 이름과 아이디를 각각 다른 span 에 넣는다 — 폰처럼 좁은 화면에서는 이름을 접고
       아이디만 남기려면(app.css) 둘이 나뉘어 있어야 한다. */
    var who = chip.querySelector('[data-role=who]');
    who.setAttribute('href', homeHref());   // role 이 늦게 채워져도 행선지가 따라온다
    var id = loginLabel(u);
    who.textContent = '👤 ';
    who.title = u.name && id ? u.name + ' · ' + id : (u.name || id);
    if (u.name) {
      var nm = document.createElement('span');
      nm.className = 'nav-user-name';
      nm.textContent = u.name;
      who.appendChild(nm);
    }
    if (id) {
      var tail = document.createElement('span');
      tail.className = 'nav-user-id';
      if (u.name) tail.innerHTML = '<i class="nav-user-sep">·</i> ';
      tail.appendChild(document.createTextNode(id));
      who.appendChild(tail);
    }

    /* 기기에 저장된 프로필에 student_id 가 없던 옛 세션은 서버 사본으로 한 번 채운다.
       실패하면(오프라인) 이메일에서 주운 값이 그대로 남는다 — 자리는 비지 않는다. */
    if (!u.student_id && !idFetched) {
      idFetched = true;
      profile(true).then(function (p) { if (p && p.student_id) paintNav(); }, function () {});
    }
  }

  /* 로그인을 요구하는 문서는 스스로 그렇게 말한다:
   *   <meta name="sg-auth" content="required">
   * 페이지마다 같은 검사를 손으로 적지 않게, 여기서 한 번에 처리한다. */
  function autoGuard() {
    var m = document.querySelector('meta[name="sg-auth"]');
    if (m && m.getAttribute('content') === 'required') require_();
  }

  document.addEventListener('DOMContentLoaded', function () {
    paintNav();
    autoGuard();
    if (user()) token();   // 세션이 살아 있는지 조용히 확인/갱신
  });
  onChange(paintNav);

  return {
    nextId: nextId, teachers: teachers, register: register,
    createTeacher: createTeacher, signIn: signIn, signOut: signOut,
    user: user, profile: profile, role: role, isStaff: isStaff,
    token: token, require: require_, onChange: onChange,
    url: URL_, anonKey: ANON
  };
})();
