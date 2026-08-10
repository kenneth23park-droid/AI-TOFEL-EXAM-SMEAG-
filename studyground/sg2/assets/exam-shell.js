/* SMEAG · StudyGround — exam-shell.js
 * 시험 셸 바인딩. exam-runtime.html 의 인라인 스크립트를 그대로 옮긴 것이며,
 * 라우트 페이지(en/test-nt/{section}/index.html)도 같은 DOM 을 쓰므로 함께 로드한다.
 *
 * 담당: URL 계약 해석, 세션 열기, 컴파일러/타이밍 로드(없으면 인라인 폴백),
 *       재개 흐름, 상단바·서브바(타이머/Hide Time)·모달·음량 팝오버 바인딩.
 * 화면 DOM 생성은 하지 않는다 — 그것은 SG_RENDER 에 등록된 렌더러의 몫이다.
 *
 * 라우트 계약 (선택) — 이 파일보다 먼저 window.SG_ROUTE 를 정의하면 된다:
 *   { section: 'reading',      // 이 페이지가 대표하는 섹션. 전체시험은 여기서 시작한다.
 *     base:    '../../../',    // sg2 루트까지의 상대경로(JS location 이동용).
 *     path:    '/en/test-nt/'  // 섹션이 바뀔 때 주소창을 갱신할 접두사(없으면 갱신 안 함).
 *   }
 * DOM 상대 URL(스크립트·fetch·오디오)은 페이지의 <base> 가 처리하므로 여기서 손대지 않는다.
 */
window.SG_RUNTIME = (function () {
  'use strict';

  var CLOCK = window.SG_CLOCK, STORE = window.SG_STORE, EXAM = window.SG_EXAM;
  var machine = null, timing = null, screens = [], volume = 0.8;

  var ROUTE = window.SG_ROUTE || {};
  var BASE = ROUTE.base || '';

  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(String(window.location.search || ''));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /* 원본 URL 의 mode 는 full|section 이다(관찰값). exam-engine 의 parseUrl 은 exam|practice 로
     좁히므로 "어디까지 응시하는가" 는 여기서 원문을 직접 읽는다. */
  function scopeMode() {
    var m = query('mode').toLowerCase();
    return m === 'section' ? 'section' : 'full';
  }

  /* 이 페이지가 다루는 섹션 — 라우트 > ?section= 순. 없으면 null(=전체시험 처음부터). */
  function routeSection() {
    var s = (ROUTE.section || query('section') || '').toLowerCase();
    return /^(reading|listening|writing|speaking)$/.test(s) ? s : null;
  }

  /* 컴파일러(exam-compile.js)·타이밍 로더(exam-timing.js)가 아직 없어도 셸이 동작하도록
     선택적으로 로드한다. 404 여도 진행한다(F12: 시험을 멈추지 않는다). */
  /* 어떤 콘텐츠 팩을 실을지 — `?set=set1|set9`, 없으면 `?testId=` 에서 유추한다.
     알 수 없는 값은 조용히 set1 로 떨어뜨린다(F12: 시험을 멈추지 않는다).
     exam-engine.js 의 parseUrl 은 이 파라미터를 모르므로 여기서 직접 읽는다. */
  var SET_IDS = { set1: 'SMEAG_SET1', set9: 'SMEAG_SET9' };

  /* 원본 사이트의 시험 코드 → 콘텐츠 팩. T-016 은 SET 1(=NT-016), T-009 는 SET 9 이다. */
  function setFromTestId(testId) {
    var t = String(testId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/(^|[A-Z])0*9$/.test(t) || t === 'SET9') return 'set9';
    return 'set1';
  }

  /* `?set=` > SG_ROUTE.set > `?testId=` 추론.
     SG_ROUTE.set 은 특정 세트 전용 진입 페이지(set9.html 등)가 쿼리스트링 없이도
     제 콘텐츠 팩을 싣기 위한 것이다 — URL 로 준 값이 언제나 이긴다. */
  function currentSetId() {
    var explicit = query('set').toLowerCase();
    if (SET_IDS[explicit]) return explicit;
    var routed = String(ROUTE.set || '').toLowerCase();
    if (SET_IDS[routed]) return routed;
    return setFromTestId(query('testId'));
  }

  var SET_ID = currentSetId();

  /* 선택된 팩의 전역. 로드 실패 시 set1 로 폴백한다. */
  function contentPack() {
    var p = window[SET_IDS[SET_ID]] || window.SMEAG_SET1 || null;
    /* 렌더러들은 문항 본문을 콘텐츠 팩에서 되찾는다. 어떤 팩이 활성인지 알려주는
       유일한 채널이 이 전역이다. 설정하지 않으면 렌더러가 SMEAG_SET1 로 폴백하므로
       set9 에서 listening/writing 화면이 placeholder 로 떨어진다. */
    window.SG_CONTENT_PACK = p;
    return p;
  }

  var OPTIONAL = ['assets/exam-types.js', 'assets/exam-timing.js', 'assets/exam-media.js',
                  'assets/exam-compile.js', 'assets/' + SET_ID + '.js',
                  /* 섹션 렌더러 — 각자 SG_RENDER.register() 로 자기를 등록한다.
                     아직 없는 파일은 onerror 로 건너뛰므로 순서·존재 여부에 의존하지 않는다. */
                  'assets/exam-recorder.js',
                  'assets/exam-render-instruction.js',
                  'assets/exam-render-listening.js',
                  'assets/exam-render-reading.js',
                  'assets/exam-render-writing.js',
                  'assets/exam-render-speaking.js'];

  function loadOptional(list, done) {
    var i = 0;
    function step() {
      if (i >= list.length) { done(); return; }
      var s = document.createElement('script');
      s.src = list[i++];
      s.onload = step;
      s.onerror = function () { step(); };
      document.head.appendChild(s);
    }
    step();
  }

  /* 오프라인 인라인 폴백 타이밍. config/timing.toefl.json 을 못 읽을 때만 쓴다. */
  var TIMING_FALLBACK = {
    schemaVersion: '0.0.0-inline',
    exam: { id: 'toefl-nt', label: 'New TOEFL' },
    sectionOrder: ['listening', 'speaking', 'reading', 'writing'],
    defaults: { timerFormat: 'MM:SS', onExpire: 'autoAdvance', advance: 'manual', warnAtSec: 60 },
    sections: {}
  };

  function loadTiming(profile, cb) {
    var file = 'config/timing.' + (profile === 'ielts' ? 'ielts' : 'toefl') + '.json';
    if (!window.fetch) { cb(TIMING_FALLBACK); return; }
    window.fetch(file).then(function (r) {
      return r.ok ? r.json() : TIMING_FALLBACK;
    }).then(function (j) { cb(j || TIMING_FALLBACK); })
      .catch(function () { cb(TIMING_FALLBACK); });
  }

  /* 컴파일러 미로드 시의 최소 화면열. 셸 자체(상단바/타이머/전이)를 검증할 수 있는 뼈대다. */
  function fallbackScreens(t) {
    var per = 20;
    try { per = t.sections.listening.fallbackPerQuestionSec || per; } catch (e) {}
    return [
      { id: 'intro.volume', screenType: 'instruction', section: 'listening', advance: 'manual', timer: null,
        copy: { titleEn: 'Adjusting the Volume', titleKo: '음량 조절',
                bodyEn: 'Use the Volume button in the toolbar to set a comfortable level.',
                bodyKo: '상단 Volume 버튼으로 편안한 음량을 설정하세요.', ctaEn: 'Continue', ctaKo: '계속' } },
      { id: 'listening.directions', screenType: 'instruction', section: 'listening', advance: 'manual', timer: null,
        copy: { titleEn: 'Listening Directions', titleKo: '리스닝 안내',
                bodyEn: 'You will hear each recording one time only.',
                bodyKo: '각 음원은 한 번만 재생됩니다.', ctaEn: 'Begin', ctaKo: '시작' } },
      { id: 'listening.q.L1.01', screenType: 'question', section: 'listening', module: 1, moduleId: 'L1',
        questionIds: ['L1-1'], advance: 'auto', progress: { index: 1, total: 1 },
        timer: { mode: 'countdown', scope: 'question', seconds: per, format: 'MM:SS', onExpire: 'autoAdvance', visible: true } },
      { id: 'listening.moduleEnd.L1', screenType: 'moduleEnd', section: 'listening', module: 1, moduleId: 'L1',
        advance: 'manual', timer: null,
        copy: { titleEn: 'End of Module 1', titleKo: '모듈 1 종료',
                bodyEn: 'Your time for Module 1 has ended.', bodyKo: '모듈 1 시간이 종료되었습니다.',
                ctaEn: 'Continue', ctaKo: '계속' } },
      { id: 'review.submit', screenType: 'review', section: 'writing', advance: 'manual', timer: null,
        copy: { titleEn: 'Review and submit', titleKo: '확인 후 제출',
                bodyEn: 'Submit your test when you are ready.', bodyKo: '준비되면 제출하세요.',
                ctaEn: 'Submit Test', ctaKo: '제출' } }
    ];
  }

  function buildScreens(t) {
    var pack = contentPack();
    if (window.SG_COMPILE && typeof window.SG_COMPILE.compileScreens === 'function' && pack) {
      try {
        // profile 은 'toefl' | 'ielts' 두 값만 — exam.id 는 'toefl-nt' 같은 식별자라 그대로 넘기면 안 된다.
        var scale = (t.exam && t.exam.scoreScale) || 'toefl120';
        var out = window.SG_COMPILE.compileScreens(pack, t,
                    { profile: scale === 'ielts9' ? 'ielts' : 'toefl' });
        if (out && out.screens && out.screens.length) {
          if (out.warnings && out.warnings.length && window.console) window.console.warn('[compile]', out.warnings);
          return out.screens;
        }
      } catch (e) { if (window.console) window.console.warn('[compile] failed; using fallback screens', e); }
    }
    return fallbackScreens(t);
  }

  /* ── 섹션 범위 ─────────────────────────────────────────────
     mode=section  → 그 섹션의 화면만 남긴다(단일 섹션 연습).
     mode=full     → 화면열은 그대로 두고 그 섹션의 첫 화면에서 시작한다.
     둘 다 이어보기(cursor)·`#screen=` 이 있으면 그쪽이 이긴다. */

  function scopeScreens(list, section, scope) {
    if (!section || scope !== 'section') return list;
    var only = [], i;
    for (i = 0; i < list.length; i++) if (list[i].section === section) only.push(list[i]);
    return only.length ? only : list;
  }

  function sectionStartIndex(list, section) {
    if (!section) return 0;
    for (var i = 0; i < list.length; i++) if (list[i].section === section) return i;
    return 0;
  }

  /* 전체시험 중 섹션이 넘어가면 주소창 경로도 따라간다 — 원본이 /en/test-nt/{section} 이다.
     쿼리(testId·sessionId·mode·section)는 유지하고 section 만 갈아끼운다. */
  function syncRoutePath(screen) {
    if (!ROUTE.path || !screen || !screen.section) return;
    if (!window.history || !window.history.replaceState) return;
    var want = ROUTE.path + screen.section;
    var qs = String(window.location.search || '');
    if (qs) qs = qs.replace(/([?&]section=)[^&]*/, '$1' + screen.section);
    var next = want + qs + String(window.location.hash || '');
    if (next === window.location.pathname + window.location.search + window.location.hash) return;
    try { window.history.replaceState(window.history.state, '', next); } catch (e) { /* F12 */ }
  }

  /* ── 상단바 ─────────────────────────────────────────────── */

  function setText(id, en, ko) {
    var elEn = document.getElementById(id + '-en'), elKo = document.getElementById(id + '-ko');
    if (elEn) elEn.textContent = en;
    if (elKo) elKo.textContent = ko;
  }

  function ctaFor(screen) {
    if (!screen) return { en: 'Continue', ko: '계속' };
    var c = screen.copy || {};
    if (c.ctaEn) return { en: c.ctaEn, ko: c.ctaKo || c.ctaEn };
    if (screen.screenType === 'question' || screen.screenType === 'speaking') return { en: 'Next', ko: '다음' };
    if (screen.screenType === 'review') return { en: 'Submit Test', ko: '제출' };
    if (String(screen.id).indexOf('.directions') >= 0) return { en: 'Begin', ko: '시작' };
    return { en: 'Continue', ko: '계속' };
  }

  /* ── 서브바(2행) ───────────────────────────────────────────
     관찰값(docs/reference/screens/*):
       · 좌: "Listening | Question 25 of 32" / "Reading | Questions 1-10 of 35"
       · 우: 등폭 MM:SS + "Hide Time". 타이머 없는 화면(오디오 재생 중)은 우측이 빈다.
       · moduleEnd 화면에는 서브바 자체가 없다.
     빨간 중앙 pill 은 SMEAG 관리자 미리보기(test_listening.php)의 UI 라 제거했다. */

  function sectionLabel(section) {
    var s = String(section || '');
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* 서브바를 띄우는 화면 종류. moduleEnd/review/hardwareCheck 는 진행표시가 없다. */
  function hasSubbar(screen) {
    if (!screen) return false;
    return screen.screenType === 'question' || screen.screenType === 'speaking' ||
           screen.screenType === 'instruction';
  }

  function syncSubbar(screen) {
    var bar = document.getElementById('exam-subbar');
    if (!bar) return;
    var show = hasSubbar(screen);
    bar.hidden = !show;
    if (!show) {
      // 서브바가 없는 화면(moduleEnd 등)에서는 타이머 상태도 같이 내린다.
      var box = document.getElementById('exam-time');
      if (box) box.hidden = true;
      return;
    }

    var sec = document.getElementById('subbar-section');
    var sep = document.getElementById('subbar-sep');
    var prog = document.getElementById('subbar-progress');
    if (sec) sec.textContent = sectionLabel(screen.section);

    /* progress 는 담당 A 의 컴파일러가 만든다: {first,last,total,style}.
       레거시 {index,total} 도 SG_TYPES.formatProgress 가 흡수한다. */
    var text = '';
    if (screen.progress) {
      if (window.SG_TYPES && window.SG_TYPES.formatProgress) {
        text = (document.documentElement.lang === 'ko' && window.SG_TYPES.formatProgressKo)
          ? window.SG_TYPES.formatProgressKo(screen.progress)
          : window.SG_TYPES.formatProgress(screen.progress);
      } else if (typeof screen.progress.index === 'number') {
        text = 'Question ' + screen.progress.index + ' of ' + screen.progress.total;
      }
    }
    if (prog) prog.textContent = text;
    if (sep) sep.hidden = !text;
    paintTimer(CLOCK.display());
  }

  /* 타이머는 서브바 우측의 평문 등폭 MM:SS 다. 표시할 clock 이 없으면 우측을 통째로 비운다. */
  function paintTimer(d) {
    var wrap = document.getElementById('exam-time');
    var val = document.getElementById('timer-value');
    if (!wrap || !val) return;
    var bar = document.getElementById('exam-subbar');
    /* response 모드(speaking 녹음/준비 시간)는 중앙 RESPONSE TIME 카드가 표시를 소유한다.
       관찰된 speaking 프레임의 서브바 우측은 비어 있으므로 여기서 중복 표시하지 않는다. */
    if (!d || d.mode === 'response' || (bar && bar.hidden)) { wrap.hidden = true; return; }
    wrap.hidden = false;
    val.textContent = d.text;
    /* 색은 바꾸지 않는다 — 관찰된 프레임은 00:13 · 00:09 까지도 검정 등폭이다.
       경고 상태는 display().warning 으로 여전히 노출되므로 다른 소비자는 쓸 수 있다. */
    val.className = 'exam-time-value';
    wrap.className = 'exam-time' + (d.hidden ? ' is-hidden' : '');
    setText('hidetime',
      d.hidden ? 'Show Time' : 'Hide Time',
      d.hidden ? '시간 보기' : '시간 숨기기');
  }

  /* ── 상단바 버튼 노출(섹션별, 관찰값) ─────────────────────
       Listening : Exit · Volume · Help · Next        (Back 없음)
       Reading   : Exit · Help · Review · Back · Next (Volume 없음)
       Speaking  : Exit · Volume                      (녹음 중)
       moduleEnd : Exit · Continue                                        */
  function syncActions(screen) {
    var t = screen ? screen.screenType : '';
    var sec = screen ? screen.section : '';
    var speakingLive = (t === 'speaking');
    var terminal = (t === 'moduleEnd' || t === 'review');

    var showVolume = !terminal && (sec === 'listening' || sec === 'speaking');
    var showHelp = !terminal && !speakingLive;
    var showReview = (sec === 'reading') && (t === 'question');
    var showBack = (sec === 'reading') && (t === 'question');
    var showAdvance = !speakingLive;

    function set(id, on) { var b = document.getElementById(id); if (b) b.hidden = !on; }
    set('btn-volume', showVolume);
    set('btn-help', showHelp);
    set('btn-review', showReview);
    set('btn-back', showBack);
    set('btn-advance', showAdvance);

    /* Back — 상태머신(SG_EXAM)에 역방향 이동 API 가 없어 지금은 항상 비활성이다.
       참조 프레임(reading-cloze-2760s.png)도 비활성 상태로 찍혀 있다.
       엔진에 back() 이 생기면 screen.allowBack 으로 열어주면 된다. */
    var back = document.getElementById('btn-back');
    if (back) back.disabled = true;

    /* Review 는 화면 단위 플래그다 — 화면이 바뀌면 눌린 상태를 다시 읽어 온다. */
    var rev = document.getElementById('btn-review');
    if (rev) {
      var on = !!(screen && reviewFlags[screen.id]);
      rev.classList.toggle('is-on', on);
      rev.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function syncHeader(screen, cfg) {
    var cta = ctaFor(screen);
    setText('advance', cta.en, cta.ko);
    syncActions(screen);
    var sub = document.getElementById('exam-subtitle');
    if (sub) sub.textContent = screen ? sectionLabel(screen.section) : '';
    var st = document.getElementById('exam-status');
    if (st) {
      st.textContent = (cfg.mode === 'practice' ? 'PRACTICE · ' : '') +
        (screen ? screen.id : '-') + ' · ' + cfg.sessionId;
    }
  }

  /* ── 모달 ───────────────────────────────────────────────── */

  function openModal(id) { var m = document.getElementById(id); if (m) m.hidden = false; }
  function closeModal(id) { var m = document.getElementById(id); if (m) m.hidden = true; }

  /* ── 음량 팝오버 ────────────────────────────────────────── */
  /* 관찰값: Volume 은 모달이 아니라 우측 팝오버다 — 막대 레벨미터 + 가로 슬라이더 + 닫기 ×.
     레벨미터는 현재 재생 중인 오디오가 있으면 WebAudio 실측 레벨을, 없으면 볼륨에 비례한
     정적 막대를 그린다. WebAudio 가 없거나 막히면 조용히 정적 막대로 떨어진다(F12). */
  var METER_BARS = 26;
  var meterRaf = null, audioCtx = null, analyser = null, analysed = null, freqData = null;

  function buildMeter() {
    var m = document.getElementById('volume-meter');
    if (!m || m.firstChild) return;
    for (var i = 0; i < METER_BARS; i++) m.appendChild(document.createElement('i'));
  }

  /* 실측 레벨이 없을 때의 기본 모양: 좌→우로 높아지는 막대. 볼륨만큼만 진하게 켠다. */
  function paintMeter(levels) {
    var m = document.getElementById('volume-meter');
    if (!m) return;
    var bars = m.getElementsByTagName('i');
    for (var i = 0; i < bars.length; i++) {
      var ramp = (i + 1) / bars.length;                 // 0..1
      var h = levels ? levels[i] : ramp;
      if (h < 0.04) h = 0.04;
      bars[i].style.height = Math.round(h * 100) + '%';
      bars[i].className = (ramp <= volume + 0.001) ? 'on' : '';
    }
  }

  function attachAnalyser() {
    if (!window.AudioContext && !window.webkitAudioContext) return null;
    var els = document.querySelectorAll('audio, video');
    var live = null, i;
    for (i = 0; i < els.length; i++) { if (!els[i].paused) { live = els[i]; break; } }
    if (!live || live === analysed) return analyser;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaElementSource(live);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      analysed = live;
    } catch (e) { analyser = null; }   /* 이미 라우팅된 엘리먼트면 여기로 온다 */
    return analyser;
  }

  function meterLoop() {
    var pop = document.getElementById('pop-volume');
    if (!pop || pop.hidden) { meterRaf = null; return; }
    var a = attachAnalyser();
    if (a && freqData) {
      a.getByteFrequencyData(freqData);
      var levels = [], step = freqData.length / METER_BARS, i;
      for (i = 0; i < METER_BARS; i++) levels.push(freqData[Math.floor(i * step)] / 255);
      paintMeter(levels);
    } else {
      paintMeter(null);
    }
    meterRaf = window.requestAnimationFrame ? window.requestAnimationFrame(meterLoop)
                                            : window.setTimeout(meterLoop, 80);
  }

  function openVolume() {
    var pop = document.getElementById('pop-volume');
    var btn = document.getElementById('btn-volume');
    if (!pop) return;
    buildMeter();
    pop.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    paintMeter(null);
    if (meterRaf === null) meterLoop();
  }

  function closeVolume() {
    var pop = document.getElementById('pop-volume');
    var btn = document.getElementById('btn-volume');
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function bindModals() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.getAttribute && t.getAttribute('data-close')) { closeModal(t.getAttribute('data-close')); return; }
        t = t.parentNode;
      }
    });
    document.getElementById('btn-help').onclick = function () { openModal('modal-help'); };
    document.getElementById('btn-volume').onclick = function () {
      var pop = document.getElementById('pop-volume');
      if (pop && pop.hidden) openVolume(); else closeVolume();
    };
    document.getElementById('btn-volume-close').onclick = closeVolume;
    var vr = document.getElementById('volume-range');
    vr.oninput = function () {
      volume = (parseInt(vr.value, 10) || 0) / 100;
      var els = document.querySelectorAll('audio, video');
      for (var i = 0; i < els.length; i++) els[i].volume = volume;
      paintMeter(null);
    };
    volume = (parseInt(vr.value, 10) || 0) / 100;

    /* 전체화면 — 관찰값은 우하단의 EN 옆 아이콘이다. */
    var fs = document.getElementById('btn-fullscreen');
    if (fs) {
      fs.onclick = function () {
        var d = document, el = d.documentElement;
        try {
          if (d.fullscreenElement || d.webkitFullscreenElement) {
            (d.exitFullscreen || d.webkitExitFullscreen).call(d);
          } else {
            (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
          }
        } catch (e) { /* F12 */ }
      };
    }
  }

  /* ── Hide Time · Review 플래그 ─────────────────────────── */

  var reviewFlags = {};
  var FLAG_KEY = 'sg2_review_flags';

  function loadFlags(session) {
    try {
      var raw = window.localStorage.getItem(FLAG_KEY + '.' + session);
      reviewFlags = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { reviewFlags = {}; }
  }

  function saveFlags(session) {
    try { window.localStorage.setItem(FLAG_KEY + '.' + session, JSON.stringify(reviewFlags)); } catch (e) {}
  }

  function bindSubbar(session) {
    var hide = document.getElementById('btn-hide-time');
    if (hide) {
      hide.onclick = function () { CLOCK.toggleTimeHidden(); paintTimer(CLOCK.display()); };
    }
    var rev = document.getElementById('btn-review');
    if (rev) {
      rev.onclick = function () {
        var sc = machine && machine.current();
        if (!sc) return;
        if (reviewFlags[sc.id]) delete reviewFlags[sc.id]; else reviewFlags[sc.id] = 1;
        saveFlags(session);
        syncActions(sc);
        try { STORE.pushEvent('review_flag', sc.id, { on: !!reviewFlags[sc.id] }); } catch (e) {}
      };
    }
  }

  /* Exit Test → 확인 후 상태를 저장하고 시험 목록으로 돌아간다. 진행은 재개 가능하게 남는다. */
  function bindExit() {
    document.getElementById('btn-exit').onclick = function () { openModal('modal-exit'); };
    document.getElementById('btn-exit-confirm').onclick = function () {
      try {
        STORE.flushAnswers();
        STORE.pushEvent('exit_test', machine && machine.current() ? machine.current().id : '', {});
      } catch (e) {}
      window.location.href = BASE + 'tests.html';
    };
  }

  function bindLifecycle() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        try { STORE.flushAnswers(); } catch (e) {}
        if (machine && machine.current()) { try { STORE.saveCursor(machine.current().id, machine.currentIndex(), machine.phaseIndex()); } catch (e) {} }
      }
    });
    window.addEventListener('beforeunload', function () { try { STORE.flushAnswers(); } catch (e) {} });
    // §5.3 — 10초 주기 자동저장
    window.setInterval(function () {
      if (!machine || !machine.current()) return;
      try {
        STORE.flushAnswers();
        STORE.saveCursor(machine.current().id, machine.currentIndex(), machine.phaseIndex());
      } catch (e) {}
    }, 10000);
  }

  /* ── 부팅 ───────────────────────────────────────────────── */

  function boot() {
    var url = EXAM.parseUrl(window.location.search, window.location.hash);
    var section = routeSection();
    var scope = scopeMode();

    loadOptional(OPTIONAL, function () {
      loadTiming(url.profile, function (t) {
        timing = t;
        screens = scopeScreens(buildScreens(t), section, scope);

        /* SET_ID 를 해시에 섞는다 — 팩의 최상위 key 집합은 set1/set9 가 거의 같아서
           이게 없으면 SET 1 세션을 SET 9 으로 "이어서 응시" 할 수 있게 된다.
           섹션 범위도 같은 이유로 섞는다: 같은 세션 id 로 full/section 을 오갈 때
           화면열 길이가 달라 cursor 가 엉뚱한 화면을 가리키게 된다. */
        var pack0 = contentPack();
        var contentHash = STORE.hashString(pack0
          ? SET_ID + ':' + (pack0.code || '') + ':' + JSON.stringify(Object.keys(pack0))
          : 'no-content');
        var timingHash = STORE.hashString(JSON.stringify(t) + '|' + scope + ':' + (section || 'all'));

        var active = STORE.activeSession();
        var session = url.sessionId || active || STORE.offlineSessionId();
        STORE.open(session);
        CLOCK.attachStore(STORE);

        var resumable = (session === active) && STORE.canResume(contentHash, timingHash).ok && !!STORE.cursor();
        var titleEl = document.getElementById('exam-title');
        var code = (pack0 && pack0.code) || url.testId;
        if (titleEl) titleEl.textContent = 'StudyGround ' + (code === 'SET1' ? 'NT-016' : code);

        if (resumable) {
          openModal('modal-resume');
          document.getElementById('btn-resume').onclick = function () { closeModal('modal-resume'); startRun(url, session, contentHash, timingHash, true, section); };
          document.getElementById('btn-restart').onclick = function () {
            closeModal('modal-resume');
            STORE.dropSession(session);
            var fresh = STORE.offlineSessionId();
            STORE.open(fresh);
            startRun(url, fresh, contentHash, timingHash, false, section);
          };
        } else {
          startRun(url, session, contentHash, timingHash, false, section);
        }
      });
    });
  }

  function startRun(url, session, contentHash, timingHash, resume, section) {
    var meta = STORE.meta();
    if (!meta || !meta.session) {
      STORE.saveMeta({
        session: session, examCode: url.testId, studentNo: '', startedAt: Date.now(),
        profile: url.profile, mode: url.mode, contentHash: contentHash, timingHash: timingHash,
        screenCount: screens.length, submittedAt: null, serverSession: null
      });
      meta = STORE.meta();
    }
    // mode 는 저장값이 이긴다(Story 1.8 AC5).
    var mode = meta.mode || url.mode;
    STORE.patchMeta({ screenCount: screens.length, mode: mode });

    machine = EXAM.create(screens, { mode: mode });
    SG_RENDER.setMount(document.getElementById('screen-mount'));

    /* 시작 지점 우선순위: 이어보기 > `#screen=` > 라우트 섹션의 첫 화면 > 0 */
    var startIndex = sectionStartIndex(screens, section);
    if (resume) {
      var plan = STORE.planResume(screens, STORE.cursor(), STORE.clocks(), CLOCK.now());
      startIndex = plan.screenIndex;
      machine.restoreTo(plan.screenIndex, plan.phaseIndex);
      STORE.pushEvent('reload', plan.screenId, { expired: plan.expiredKeys, notes: plan.notes });
    } else if (url.screenId) {
      var i = STORE.findScreenIndex(screens, url.screenId);
      if (i > 0) { startIndex = i; machine.restoreTo(i, 0); }
    } else if (startIndex > 0) {
      machine.restoreTo(startIndex, 0);
    }

    loadFlags(session);

    machine.onTransition(function (tr) {
      var sc = machine.current();
      syncSubbar(sc);
      syncHeader(sc, { mode: mode, sessionId: session });
      syncRoutePath(sc);
      closeVolume();
      machine.syncHash();
      if (!sc && machine.status() === 'submitting') {
        // 제출 단계는 Epic 3(exam-sync.js) 이 담당한다. 셸은 상태만 남긴다.
        STORE.enqueue('submit', { session: session, at: Date.now() });
      }
    });

    CLOCK.subscribe(function (d) { paintTimer(d); });

    document.getElementById('btn-advance').onclick = function () {
      if (machine.status() === 'submitting' || machine.status() === 'submitted') return;
      machine.next('manual');
    };

    bindModals();
    bindSubbar(session);
    bindExit();
    bindLifecycle();
    machine.installHistoryGuard();
    machine.start(startIndex);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    machine: function () { return machine; },
    screens: function () { return screens; },
    timing: function () { return timing; },
    volume: function () { return volume; }
  };
})();
