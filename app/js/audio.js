/* =============================================================
 * SMEAG TOEFL — 오디오 플레이어 (담당 A) → window.SMEAG_AUDIO
 *
 * 실제 시험 규칙: 오디오는 "1회만" 재생된다. 컨트롤(진행바/되감기) 없음.
 *
 *   var p = SMEAG_AUDIO.create({
 *     src, playKey, autoplay:true, onEnded(), onBlocked()
 *   });
 *   p.element  // .audio-box DOM (상태 표시 + 차단 시 재생 버튼)
 *   p.play(); p.stop(); p.isDone();
 *
 * 동작
 *  - SMEAG_STORE.hasPlayed(playKey) 가 true 면 '이미 재생함' 을 표시하고
 *    소리를 내지 않는다. 화면 흐름이 막히지 않도록 onEnded() 는 비동기로 1회 호출한다.
 *  - 브라우저 자동재생 정책으로 play() 가 reject 되면 onBlocked() 를 호출하고
 *    '▶ 오디오 재생' 버튼을 노출한다. 아직 한 번도 못 들었으므로 이 버튼으로 듣는 것은
 *    1회 제한에 걸리지 않는다.
 *  - 재생이 끝나면 SMEAG_STORE.markPlayed(playKey) 후 onEnded().
 * ============================================================= */
(function () {
  'use strict';

  var AUDIO = {};

  function noop() { }

  function encode(p) {
    return (window.SMEAG && window.SMEAG.encodePath) ? window.SMEAG.encodePath(p) : String(p || '');
  }

  function storeHasPlayed(key) {
    try {
      return !!(key && window.SMEAG_STORE && window.SMEAG_STORE.hasPlayed(key));
    } catch (e) { return false; }
  }

  function storeMarkPlayed(key) {
    try {
      if (key && window.SMEAG_STORE) window.SMEAG_STORE.markPlayed(key);
    } catch (e) { /* 무시 */ }
  }

  AUDIO.create = function (opts) {
    opts = opts || {};
    var src = opts.src || '';
    var playKey = opts.playKey || null;
    var autoplay = opts.autoplay !== false;   // 기본 true
    var onEnded = typeof opts.onEnded === 'function' ? opts.onEnded : noop;
    var onBlocked = typeof opts.onBlocked === 'function' ? opts.onBlocked : noop;

    var alreadyPlayed = storeHasPlayed(playKey);
    var finished = false;      // 이 인스턴스에서 끝까지 재생됐거나, 이미 들은 상태
    var started = false;
    var endedFired = false;

    /* ---- DOM ---- */
    var box = document.createElement('div');
    box.className = 'audio-box';

    var icon = document.createElement('span');
    icon.className = 'audio-ic';
    icon.textContent = '🎧';

    var status = document.createElement('span');
    status.className = 'audio-status';

    var btnWrap = document.createElement('span');
    btnWrap.className = 'audio-btn-wrap';

    var media = document.createElement('audio');
    media.preload = 'auto';
    media.controls = false;
    media.setAttribute('playsinline', '');
    if (src) media.src = encode(src);
    media.className = 'audio-el';

    box.appendChild(icon);
    box.appendChild(status);
    box.appendChild(btnWrap);
    box.appendChild(media);

    function setStatus(text, cls) {
      status.textContent = text;
      box.className = 'audio-box' + (cls ? ' ' + cls : '');
    }

    function fireEnded() {
      if (endedFired) return;
      endedFired = true;
      try { onEnded(); } catch (e) { /* 콜백 오류 무시 */ }
    }

    function showPlayButton(label) {
      if (btnWrap.firstChild) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'audio-play-btn';
      b.textContent = label || '▶ 오디오 재생';
      b.addEventListener('click', function () {
        btnWrap.innerHTML = '';
        realPlay(true);   // 사용자 제스처 — 1회 제한과 무관 (아직 들은 적 없음)
      });
      btnWrap.appendChild(b);
    }

    /* ---- 이벤트 ---- */
    media.addEventListener('playing', function () {
      started = true;
      setStatus('재생 중…', 'playing');
    });

    media.addEventListener('ended', function () {
      finished = true;
      setStatus('재생 완료', 'done');
      storeMarkPlayed(playKey);
      fireEnded();
    });

    media.addEventListener('error', function () {
      // 파일이 없거나 코덱 문제 — 시험이 멈추면 안 되므로 흐름만 풀어 준다.
      // markPlayed 는 찍지 않는다: 일시적 로드 실패로 '1회 재생'을 소진시켜
      // 학생이 그 오디오를 영영 못 듣게 되는 상황을 막기 위함.
      setStatus('오디오를 불러올 수 없습니다', 'error');
      finished = true;
      fireEnded();
    });

    /* ---- 재생 ---- */
    function realPlay(fromUserGesture) {
      if (finished) return;
      var pr;
      try {
        pr = media.play();
      } catch (e) {
        setStatus('재생하려면 버튼을 누르세요', 'blocked');
        showPlayButton();
        if (!fromUserGesture) { try { onBlocked(); } catch (e2) { } }
        return;
      }
      if (pr && typeof pr.then === 'function') {
        pr.then(function () {
          started = true;
          setStatus('재생 중…', 'playing');
        }).catch(function () {
          // 자동재생 차단
          setStatus('재생하려면 버튼을 누르세요', 'blocked');
          showPlayButton();
          if (!fromUserGesture) { try { onBlocked(); } catch (e3) { } }
        });
      }
    }

    var api = {};
    api.element = box;

    api.play = function () {
      if (alreadyPlayed) return;
      realPlay(false);
    };

    api.stop = function () {
      try {
        media.pause();
        media.removeAttribute('src');
        media.load();
      } catch (e) { /* 무시 */ }
    };

    api.isDone = function () { return !!finished; };

    /* 재생 시작 여부 (계약서 외 편의용) */
    api.hasStarted = function () { return !!started; };

    /* ---- 초기 상태 ---- */
    if (alreadyPlayed) {
      finished = true;
      setStatus('이미 재생함 (1회 제한)', 'done');
      try { media.removeAttribute('src'); } catch (e) { }
      // 화면 흐름(onReady)이 막히지 않도록 다음 틱에 onEnded 를 알린다.
      setTimeout(fireEnded, 0);
    } else if (!src) {
      setStatus('오디오 없음', 'error');
      finished = true;
      setTimeout(fireEnded, 0);
    } else {
      setStatus('오디오 준비 중…', '');
      if (autoplay) {
        // DOM 에 붙기 전에 play() 하면 실패할 수 있으므로 다음 틱에 시도한다.
        setTimeout(function () { api.play(); }, 0);
      } else {
        showPlayButton();
      }
    }

    return api;
  };

  window.SMEAG_AUDIO = AUDIO;
})();
