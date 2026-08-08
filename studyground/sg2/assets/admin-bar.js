/* SMEAG StudyGround — 관리자 오디오 트랜스포트 + 플로팅 관리 바.
 *
 * 두 가지를 제공한다.
 *
 *  1) window.SG_AUDIO_CTRL — 이 페이지의 모든 <audio>/<video> 를 한 번에
 *     일시정지 / 재개 / 정지(처음으로) / 음소거 한다. 렌더러가 스크립트로
 *     만들어 붙이는 엘리먼트까지 잡기 위해 HTMLMediaElement.prototype.play 를
 *     감싼다 — "정지" 상태에서는 새로 시작하는 재생도 즉시 눌러 앉힌다.
 *     시험 런타임에서는 SG_CLOCK 오프셋을 밀어 시험 시계도 같이 세울 수 있다.
 *
 *  2) window.SG_ADMIN_BAR — 관리자로 로그인했을 때만 뜨는 화면 좌하단 바.
 *     ⏸/▶/⏹/🔇 트랜스포트, 재생 중인 클립의 즉시 교체(URL·파일 업로드),
 *     오디오 설정·오디오 파일 점검·문항 교체 페이지 링크.
 *
 * 학생 화면에는 아무 것도 그리지 않는다(로그인 전에는 작은 ⚙ 점 하나뿐이며,
 * Ctrl+Alt+A 로도 로그인 창을 연다).
 *
 * 의존: assets/admin-session.js (필수), assets/audio-config.js (오디오 교체용, 선택)
 */
(function () {
  'use strict';

  /* ══════════════ 1. 트랜스포트 ══════════════════════════════ */

  var state = 'live';                 // 'live' | 'paused' | 'stopped'
  var muted = false;
  var registry = [];                  // play() 가 불린 적 있는 미디어 엘리먼트
  var held = [];                      // 관리자가 눌러 세운(재개하면 다시 틀) 엘리먼트
  var ctrlListeners = [];
  var current = null;                 // 마지막으로 재생을 시작한 엘리먼트

  function reg(el) {
    if (!el || registry.indexOf(el) >= 0) return;
    registry.push(el);
    if (registry.length > 400) registry.splice(0, 200);   // 긴 세션 메모리 보호
  }
  function allMedia() {
    var out = registry.slice();
    var live = document.querySelectorAll('audio,video');
    for (var i = 0; i < live.length; i++) if (out.indexOf(live[i]) < 0) out.push(live[i]);
    return out;
  }
  function ctrlEmit() { ctrlListeners.forEach(function (fn) { try { fn(state, muted); } catch (e) {} }); }

  // play() 를 감싼다 — 렌더러가 만든 엘리먼트도 등록되고, 정지 상태면 곧바로 눌러 앉는다.
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    var el = this;
    reg(el);
    if (muted) { try { el.muted = true; } catch (e) {} }
    var p;
    try { p = origPlay.apply(el, arguments); } catch (e) { return Promise.reject(e); }
    if (state !== 'live') {
      var hold = function () {
        try { el.pause(); if (state === 'stopped') el.currentTime = 0; } catch (e) {}
      };
      if (p && p.then) p.then(hold, function () {}); else hold();
    }
    return p;
  };

  document.addEventListener('play', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) { reg(el); current = el; ctrlEmit(); }
  }, true);

  /* ── 시험 시계 정지 ────────────────────────────────────────
     SG_CLOCK 은 deadline(절대시각) 기반이라 "now" 를 세우면 남은 시간이 멈춘다.
     정지 동안 오프셋을 계속 뒤로 밀고, 재개 시 밀린 오프셋을 그대로 둔다 —
     결과적으로 정지한 시간만큼 시험 시간이 소모되지 않는다. */
  var clockTimer = null, clockBase = 0, clockAt = 0;
  function freezeClock(on) {
    var C = window.SG_CLOCK;
    if (!C || typeof C.setOffset !== 'function') return false;
    if (on) {
      if (clockTimer) return true;
      clockBase = C.getOffset ? C.getOffset() : 0;
      clockAt = Date.now();
      clockTimer = setInterval(function () { C.setOffset(clockBase - (Date.now() - clockAt)); }, 200);
      return true;
    }
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    return true;
  }

  var CTRL = {
    get state() { return state; },
    isMuted: function () { return muted; },
    /** 지금 소리가 나고 있는 엘리먼트들. */
    playing: function () {
      return allMedia().filter(function (el) { return !el.paused && !el.ended; });
    },
    current: function () { return current; },

    pause: function (opts) {
      held = CTRL.playing();
      held.forEach(function (el) { try { el.pause(); } catch (e) {} });
      state = 'paused';
      if (!opts || opts.clock !== false) freezeClock(true);
      ctrlEmit();
      return held.length;
    },
    resume: function () {
      state = 'live';
      freezeClock(false);
      var n = held.length;
      held.forEach(function (el) { try { origPlay.call(el); } catch (e) {} });
      held = [];
      ctrlEmit();
      return n;
    },
    /** 정지 — 처음으로 되감고, 재개할 때까지 새 재생도 막는다. */
    stop: function (opts) {
      allMedia().forEach(function (el) {
        try { el.pause(); el.currentTime = 0; } catch (e) {}
      });
      held = [];
      state = 'stopped';
      if (!opts || opts.clock !== false) freezeClock(true);
      ctrlEmit();
    },
    setMuted: function (on) {
      muted = !!on;
      allMedia().forEach(function (el) { try { el.muted = muted; } catch (e) {} });
      ctrlEmit();
    },
    setVolume: function (v) {
      v = Math.max(0, Math.min(1, Number(v)));
      allMedia().forEach(function (el) { try { el.volume = v; } catch (e) {} });
    },
    freezeClock: freezeClock,
    isClockFrozen: function () { return !!clockTimer; },
    onChange: function (fn) { if (typeof fn === 'function') ctrlListeners.push(fn); }
  };
  window.SG_AUDIO_CTRL = CTRL;

  /* ══════════════ 2. 관리자 바 ══════════════════════════════ */

  var A = window.SG_ADMIN;
  if (!A) return;                         // 세션 모듈이 없으면 트랜스포트만 제공하고 끝.

  var setId = '', bar = null, dot = null;

  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function shortPath(p) {
    p = String(p || '');
    if (/^blob:/.test(p)) return 'uploaded file';
    try { p = decodeURI(p); } catch (e) {}
    return p.length > 52 ? '…' + p.slice(-51) : p;
  }
  /** 교체 키 — audio-config.js 가 남기는 원본 경로가 있으면 그것을 쓴다. */
  function keyOf(el) {
    if (!el) return '';
    return el.getAttribute('data-sg-orig') || el.getAttribute('src') || (el.currentSrc || '');
  }

  function css() {
    if (document.getElementById('sgbar-css')) return;
    var s = document.createElement('style');
    s.id = 'sgbar-css';
    s.textContent =
      '.sgbar{position:fixed;left:14px;bottom:14px;z-index:8500;width:min(330px,calc(100vw - 28px));' +
        'background:#241d1a;color:#f7f1ec;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.35);' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12.5px;overflow:hidden}' +
      '.sgbar[hidden]{display:none}' +
      '.sgbar-h{display:flex;align-items:center;gap:7px;padding:9px 11px;background:#e8481f;font-weight:800;font-size:11.5px;' +
        'letter-spacing:.05em;text-transform:uppercase;cursor:pointer;user-select:none}' +
      '.sgbar-h .who{margin-left:auto;font-weight:700;text-transform:none;letter-spacing:0;opacity:.9}' +
      '.sgbar-b{padding:11px}' +
      '.sgbar.is-min .sgbar-b{display:none}' +
      '.sgbar-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:9px}' +
      '.sgb{font:inherit;font-size:12px;font-weight:750;color:#f7f1ec;background:#3a2f2a;border:1px solid #50423b;' +
        'border-radius:9px;padding:7px 11px;cursor:pointer;line-height:1.1}' +
      '.sgb:hover{background:#4a3b34}' +
      '.sgb.on{background:#f7f1ec;color:#241d1a;border-color:#f7f1ec}' +
      '.sgb.danger{background:#8f2c17;border-color:#a3341c}' +
      '.sgb.wide{flex:1;text-align:center}' +
      '.sgbar-st{font-size:11.5px;font-weight:750;padding:6px 9px;border-radius:8px;background:#3a2f2a;margin-bottom:9px}' +
      '.sgbar-st.live{background:#1f5c3a}.sgbar-st.paused{background:#7a5a12}.sgbar-st.stopped{background:#7a2118}' +
      '.sgbar-now{font-size:11px;line-height:1.5;color:#cbbdb4;word-break:break-all;margin-bottom:8px}' +
      '.sgbar-now b{color:#f7f1ec;display:block;font-size:11.5px;margin-bottom:2px}' +
      '.sgbar input[type=url],.sgbar input[type=range]{width:100%;font:inherit;font-size:11.5px}' +
      '.sgbar input[type=url]{padding:7px 9px;border-radius:8px;border:1px solid #50423b;background:#180f0c;color:#f7f1ec;margin-bottom:6px}' +
      '.sgbar-sec{border-top:1px solid #3a2f2a;padding-top:9px;margin-top:2px}' +
      '.sgbar-sec>p{margin:0 0 7px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#a2938b}' +
      '.sgbar a.sgb{text-decoration:none;display:inline-block}' +
      '.sgbar-ck{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#cbbdb4;margin-bottom:9px}' +
      '.sgbar-file{position:relative;overflow:hidden}' +
      '.sgbar-file input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}' +
      '.sgdot{position:fixed;left:14px;bottom:14px;z-index:8400;width:30px;height:30px;border-radius:50%;' +
        'border:1px solid rgba(0,0,0,.15);background:rgba(36,29,26,.55);color:#fff;font-size:14px;line-height:1;' +
        'cursor:pointer;opacity:.4;transition:opacity .15s}' +
      '.sgdot:hover{opacity:1}';
    document.head.appendChild(s);
  }

  function build() {
    css();
    bar = document.createElement('div');
    bar.className = 'sgbar';
    bar.innerHTML =
      '<div class="sgbar-h" data-act="min">⚙ <span data-en>Admin</span><span data-ko>관리자</span>' +
        '<span class="who"></span></div>' +
      '<div class="sgbar-b">' +
        '<div class="sgbar-st live"></div>' +
        '<div class="sgbar-row">' +
          '<button class="sgb wide" data-act="pause">⏸ <span data-en>Pause</span><span data-ko>일시정지</span></button>' +
          '<button class="sgb wide" data-act="resume">▶ <span data-en>Resume</span><span data-ko>재개</span></button>' +
          '<button class="sgb wide danger" data-act="stop">⏹ <span data-en>Stop</span><span data-ko>정지</span></button>' +
        '</div>' +
        '<div class="sgbar-row">' +
          '<button class="sgb" data-act="mute">🔇 <span data-en>Mute</span><span data-ko>음소거</span></button>' +
          '<input type="range" min="0" max="100" value="100" data-act="vol" style="flex:1;min-width:90px">' +
        '</div>' +
        '<label class="sgbar-ck"><input type="checkbox" data-act="clock" checked>' +
          '<span data-en>Freeze the exam clock too</span><span data-ko>시험 시계도 함께 정지</span></label>' +
        '<div class="sgbar-sec">' +
          '<p><span data-en>Now playing · replace</span><span data-ko>현재 클립 · 교체</span></p>' +
          '<div class="sgbar-now"></div>' +
          '<input type="url" data-act="url" placeholder="https://… or media/audio/…">' +
          '<div class="sgbar-row">' +
            '<button class="sgb" data-act="seturl"><span data-en>Set URL</span><span data-ko>URL 적용</span></button>' +
            '<label class="sgb sgbar-file"><span data-en>Upload</span><span data-ko>업로드</span>' +
              '<input type="file" accept="audio/*" data-act="file"></label>' +
            '<button class="sgb" data-act="revert"><span data-en>Revert</span><span data-ko>되돌리기</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="sgbar-sec">' +
          '<p><span data-en>Authoring</span><span data-ko>출제 도구</span></p>' +
          '<div class="sgbar-row">' +
            '<a class="sgb" data-role="lnk-audio">🔊 <span data-en>Audio</span><span data-ko>오디오 교체</span></a>' +
            '<a class="sgb" data-role="lnk-files">📁 <span data-en>Files</span><span data-ko>파일 점검</span></a>' +
            '<a class="sgb" data-role="lnk-q">✎ <span data-en>Questions</span><span data-ko>문항 교체</span></a>' +
            '<button class="sgb" data-act="logout"><span data-en>Sign out</span><span data-ko>로그아웃</span></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);

    var q = setId ? ('?set=' + encodeURIComponent(setId)) : '';
    bar.querySelector('[data-role=lnk-audio]').href = 'admin-audio.html' + q;
    bar.querySelector('[data-role=lnk-files]').href = 'admin-audio-files.html' + q;
    bar.querySelector('[data-role=lnk-q]').href = 'admin-questions.html' + q;

    bar.addEventListener('click', onClick);
    bar.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-act') === 'vol') CTRL.setVolume(e.target.value / 100);
    });
    bar.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-act') !== 'file') return;
      var f = e.target.files[0]; if (!f) return;
      replace(function (key) { return window.SG_AUDIO.setFile(key, f); }, 'Uploaded · ' + f.name);
      e.target.value = '';
    });
    return bar;
  }

  function clockOpt() {
    var ck = bar.querySelector('[data-act=clock]');
    return { clock: !!(ck && ck.checked) };
  }

  function onClick(e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'min') { bar.classList.toggle('is-min'); return; }
    if (act === 'pause')  { CTRL.pause(clockOpt()); }
    else if (act === 'resume') { CTRL.resume(); }
    else if (act === 'stop')   { CTRL.stop(clockOpt()); }
    else if (act === 'mute')   { CTRL.setMuted(!CTRL.isMuted()); }
    else if (act === 'logout') { A.logout(); }
    else if (act === 'seturl') {
      var url = bar.querySelector('[data-act=url]').value.trim();
      if (!url) return;
      replace(function (key) { return window.SG_AUDIO.setUrl(key, url); }, 'URL applied');
    }
    else if (act === 'revert') {
      replace(function (key) { return window.SG_AUDIO.reset(key); }, 'Reverted to the original clip');
    }
    paint();
  }

  /* 재생 중(또는 마지막) 클립을 교체하고, 그 엘리먼트에 새 소스를 즉시 물린다. */
  function replace(run, okMsg) {
    if (!window.SG_AUDIO) { status('audio-config.js is not loaded on this page.'); return; }
    var el = current || CTRL.playing()[0];
    var key = keyOf(el);
    if (!key) { status('No clip on this screen yet — play one first.'); return; }
    run(key).then(function () {
      if (el) {
        el.setAttribute('data-sg-orig', key);
        el.setAttribute('src', window.SG_AUDIO.resolve(key));
        try { el.load(); } catch (e) {}
      }
      status(okMsg);
      paint();
    });
  }

  var statusMsg = '';
  function status(m) { statusMsg = m || ''; paint(); }

  function paint() {
    if (!bar) return;
    var s = A.current();
    bar.querySelector('.who').textContent = s ? (s.id + (setId ? ' · ' + setId.toUpperCase() : '')) : '';

    var st = bar.querySelector('.sgbar-st');
    st.className = 'sgbar-st ' + CTRL.state;
    var n = CTRL.playing().length;
    var label = CTRL.state === 'paused' ? ['Paused — audio held', '일시정지 — 오디오 대기']
              : CTRL.state === 'stopped' ? ['Stopped — new playback blocked', '정지 — 새 재생도 차단됨']
              : [n ? ('Playing · ' + n + ' clip(s)') : 'Live — nothing playing',
                 n ? ('재생 중 · ' + n + '개') : '진행 중 — 재생 없음'];
    if (CTRL.isClockFrozen()) { label[0] += ' · clock frozen'; label[1] += ' · 시계 정지'; }
    st.innerHTML = '<span data-en>' + esc(label[0]) + '</span><span data-ko>' + esc(label[1]) + '</span>';

    bar.querySelector('[data-act=mute]').classList.toggle('on', CTRL.isMuted());

    var el = current || CTRL.playing()[0];
    var key = keyOf(el);
    var info = (window.SG_AUDIO && key) ? window.SG_AUDIO.info(key) : { mode: 'default' };
    var tag = info.mode === 'url' ? ' · URL override' : info.mode === 'file' ? ' · uploaded' : '';
    bar.querySelector('.sgbar-now').innerHTML = key
      ? '<b>' + esc(shortPath(key)) + tag + '</b>' + (statusMsg ? esc(statusMsg) : '')
      : '<b><span data-en>No clip yet</span><span data-ko>아직 재생된 클립 없음</span></b>' +
        '<span data-en>Play a clip on this screen, then replace it here.</span>' +
        '<span data-ko>이 화면에서 클립을 한 번 재생하면 여기서 교체할 수 있습니다.</span>';
  }

  function showBar() {
    if (dot) dot.hidden = true;
    if (!bar) build();
    bar.hidden = false;
    paint();
  }
  function showDot() {
    if (bar) bar.hidden = true;
    css();
    if (!dot) {
      dot = document.createElement('button');
      dot.className = 'sgdot';
      dot.type = 'button';
      dot.textContent = '⚙';
      dot.title = 'Admin sign-in (Ctrl+Alt+A)';
      dot.addEventListener('click', function () { A.openLogin(setId, showBar); });
      document.body.appendChild(dot);
    }
    dot.hidden = false;
  }

  var BAR = {
    mount: function (opts) {
      opts = opts || {};
      setId = (opts.set || A.pageSet() || '').toLowerCase();
      sync();
      A.onChange(sync);
      CTRL.onChange(paint);
      setInterval(function () { if (bar && !bar.hidden) paint(); }, 1000);
      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.altKey && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          A.can(setId) ? showBar() : A.openLogin(setId, showBar);
        }
      });
    },
    show: showBar,
    setId: function () { return setId; }
  };
  function sync() { A.can(setId) ? showBar() : showDot(); }

  window.SG_ADMIN_BAR = BAR;

  // <body data-sg-admin-bar> 가 있으면 알아서 붙는다.
  function auto() {
    if (document.body && document.body.hasAttribute('data-sg-admin-bar')) BAR.mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
