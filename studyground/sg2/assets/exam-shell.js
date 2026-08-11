/* SMEAG · MockTest — exam-shell.js
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

  /* 업로드로 만든 세트(admin-set-import.html)는 저장소에 커밋된 파일이 없고
     assets/set-store.js 가 부팅할 때 window.SMEAG_<SLUG> 로 올린다. 그래서 여기서는
     이름 규칙만 알면 되고, 아는 세트 목록을 미리 갖고 있을 필요가 없다. */
  function globalFor(id) {
    return SET_IDS[id] || 'SMEAG_' + String(id || '').toUpperCase();
  }

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
    if (/^[a-z0-9]+$/.test(explicit)) return explicit;
    var routed = String(ROUTE.set || '').toLowerCase();
    if (/^[a-z0-9]+$/.test(routed)) return routed;
    return setFromTestId(query('testId'));
  }

  var SET_ID = currentSetId();

  /* 선택된 팩의 전역. 로드 실패 시 set1 로 폴백한다. */
  function contentPack() {
    var p = window[globalFor(SET_ID)] || window.SMEAG_SET1 || null;
    /* 렌더러들은 문항 본문을 콘텐츠 팩에서 되찾는다. 어떤 팩이 활성인지 알려주는
       유일한 채널이 이 전역이다. 설정하지 않으면 렌더러가 SMEAG_SET1 로 폴백하므로
       set9 에서 listening/writing 화면이 placeholder 로 떨어진다. */
    window.SG_CONTENT_PACK = p;
    return p;
  }

  var OPTIONAL = ['assets/exam-types.js', 'assets/exam-timing.js', 'assets/exam-media.js',
                  'assets/exam-compile.js',
                  /* 업로드로 만든 세트를 전역에 올린다. set-import.js 는 팩 helper 를 붙이기 위한 것.
                     둘 다 없어도 커밋된 팩(set1/set9)은 그대로 뜬다. */
                  'assets/set-import.js', 'assets/set-store.js', 'assets/set-media.js',
                  'assets/' + SET_ID + '.js',
                  /* 섹션 렌더러 — 각자 SG_RENDER.register() 로 자기를 등록한다.
                     아직 없는 파일은 onerror 로 건너뛰므로 순서·존재 여부에 의존하지 않는다. */
                  'assets/exam-recorder.js',
                  'assets/exam-render-instruction.js',
                  'assets/exam-render-listening.js',
                  'assets/exam-render-reading.js',
                  'assets/exam-render-writing.js',
                  'assets/exam-render-speaking.js',
                  /* 관리자 전용 화면 이동·문항 편집 패널. 로그인 전에는 아무 것도 그리지 않는다. */
                  'assets/exam-admin-nav.js',
                  /* 제출 직후 채점·결과 업로드용. 없으면 제출은 그대로 끝나고 리뷰만 안 뜬다.
                     sg-band.js 는 그 채점 결과를 제출 화면에서 바로 밴드로 펴는 데 쓴다. */
                  'assets/sg-auth.js',
                  'assets/sg-results.js',
                  'assets/sg-band.js'];

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
    var only = [], i, submit = null;
    for (i = 0; i < list.length; i++) {
      if (list[i].section === section) only.push(list[i]);
      else if (list[i].screenType === 'review') submit = list[i];
    }
    if (!only.length) return list;
    /* 제출 화면은 마지막 섹션(writing) 뒤에만 붙어 있다. 한 영역만 응시할 때도
       "확인 후 제출" 로 끝나야 하므로, 잘라낸 화면열에 없으면 뒤에 이어 붙인다. */
    if (submit && only[only.length - 1].screenType !== 'review') only.push(submit);
    return only;
  }

  /* 문항 id → 그 문항이 실린 화면의 인덱스. 없으면 -1. */
  function screenIndexOfQuestion(list, qid) {
    if (!qid) return -1;
    for (var i = 0; i < list.length; i++) {
      var ids = list[i] && list[i].questionIds;
      if (ids && ids.indexOf(qid) >= 0) return i;
    }
    return -1;
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

  /* ── 화면 안의 문항 이동 ───────────────────────────────────
     리딩은 지문 한 편이 화면 하나지만 학생에게는 문항을 하나씩 보여 준다.
     그 렌더러(exam-render-reading.js)가 window.SG_SCREEN_NAV 를 올려 두면,
     Next/Back 은 화면을 넘기기 전에 먼저 이 nav 에게 묻는다. 다른 섹션 렌더러는
     이 전역을 지우지 않으므로 화면 id 가 지금 화면과 같을 때만 인정한다. */
  function screenNav() {
    var nav = window.SG_SCREEN_NAV;
    var sc = machine && machine.current();
    if (!nav || !sc || nav.screenId !== sc.id) return null;
    return nav;
  }

  function sectionLabel(section) {
    var s = String(section || '');
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ── 관리자 검수 모드 ──────────────────────────────────────
     관리자로 로그인해 있으면(assets/admin-session.js — 'admin' 은 모든 SET) 상단바의
     Back·Next 를 섹션과 화면 종류에 상관없이 늘 세워 둔다. 스피킹 녹음 화면과 안내
     방송 화면처럼 학생에게는 진행 버튼이 없는 자리에서도 앞뒤로 넘겨 봐야 모든 섹션을
     끝까지 검수할 수 있기 때문이다. 학생 화면은 로그인 전과 완전히 같다 — can() 이
     거짓이면 아래 분기는 하나도 돌지 않는다. */
  function adminOn() {
    var A = window.SG_ADMIN;
    return !!(A && typeof A.can === 'function' && A.can(SET_ID));
  }

  /* 화면 사이의 역방향 이동은 학생에게 없다(Story 1.4 AC3). 관리자만 엔진의
     adminJumpTo 로 앞 화면에 되돌아간다. */
  function adminStep(delta) {
    if (!machine || !adminOn()) return false;
    if (typeof machine.adminJumpTo !== 'function') return false;
    if (!machine.adminJumpTo(machine.currentIndex() + delta, 'admin_jump')) return false;
    machine.syncHash();
    if (window.SG_EXAM_ADMIN && window.SG_EXAM_ADMIN.paint) {
      try { window.SG_EXAM_ADMIN.paint(); } catch (e) {}
    }
    return true;
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
    /* 화면 안에서 문항을 하나씩 넘기는 중이면 그 문항 번호가 곧 진행 표시다
       ("Questions 31-35 of 50" 이 아니라 "Question 31 of 50"). */
    var nav = screenNav();
    var p = (nav && typeof nav.progress === 'function' && nav.progress()) || screen.progress;
    if (p) {
      if (window.SG_TYPES && window.SG_TYPES.formatProgress) {
        text = (document.documentElement.lang === 'ko' && window.SG_TYPES.formatProgressKo)
          ? window.SG_TYPES.formatProgressKo(p)
          : window.SG_TYPES.formatProgress(p);
      } else if (typeof p.index === 'number') {
        text = 'Question ' + p.index + ' of ' + p.total;
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
    /* 스피킹 Task 안내 방송 화면(speaking.intro.*)에는 진행 버튼을 두지 않는다
       (2026-08-11 발주처 요구). 방송이 끝나면 렌더러가 스스로 다음 화면으로 넘긴다 —
       버튼이 있으면 안내를 끝까지 듣지 않고 눌러 버린다. 방송이 실패해 갈 곳이 없어지면
       exam-render-instruction.js 가 이 버튼을 다시 꺼낸다. */
    var I = window.SG_INSTRUCTION;
    var announcement = !!(I && typeof I.isAnnouncement === 'function' && I.isAnnouncement(screen));
    var showAdvance = !speakingLive && !announcement;

    /* 관리자 검수 모드 — 섹션·화면 종류를 가리지 않고 Back·Next 를 세운다. */
    var admin = adminOn();
    if (admin) { showBack = true; showAdvance = true; }

    function set(id, on) { var b = document.getElementById(id); if (b) b.hidden = !on; }
    set('btn-volume', showVolume);
    set('btn-help', showHelp);
    set('btn-review', showReview);
    set('btn-back', showBack);
    set('btn-advance', showAdvance);

    /* Back — 학생에게 열리는 것은 "같은 화면 안의 앞 문항" 뿐이다: 리딩은 지문 한 편의
       문항을 하나씩 보여 주므로 그 안에서는 되돌아갈 수 있어야 한다. 첫 문항에서는 비활성.
       관리자는 화면 자체를 되돌릴 수 있으므로 첫 화면에서만 비활성이다. */
    var back = document.getElementById('btn-back');
    if (back) {
      var nav0 = screenNav();
      var inScreen = !!(nav0 && typeof nav0.canPrev === 'function' && nav0.canPrev());
      back.disabled = !inScreen && !(admin && machine && machine.currentIndex() > 0);
      back.classList.toggle('is-admin', admin && !inScreen);
    }
    var adv = document.getElementById('btn-advance');
    if (adv) adv.classList.toggle('is-admin', admin && (speakingLive || announcement));

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
        var isOn = !!(d.fullscreenElement || d.webkitFullscreenElement);
        /* 이 버튼은 학생의 뜻이다. 나가겠다고 눌렀으면 자동 복귀도 함께 끈다 —
           안 그러면 다음 클릭에서 sg-fullscreen 이 도로 전체화면으로 끌고 간다. */
        if (window.SG_FS) {
          if (isOn) SG_FS.release(); else SG_FS.armAndEnter();
          return;
        }
        try {
          if (isOn) {
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

  /* Exit Test → 관리자 승인이 있어야 나간다. 학생 혼자서는 시험을 못 뜨고, 감독하는
     선생님이 관리자 아이디·비밀번호를 넣어야 답안을 저장하고 시험 목록으로 돌아간다.
     확인만 하고 관리자 세션은 만들지 않는다(SG_ADMIN.verify) — 학생 기기에 권한을
     남기면 그 뒤로 문항 편집 패널까지 열리기 때문이다. 진행은 재개 가능하게 남는다. */
  function bindExit() {
    var modal = document.getElementById('modal-exit');
    var confirmBtn = document.getElementById('btn-exit-confirm');
    var gate = buildExitGate(modal, confirmBtn);

    document.getElementById('btn-exit').onclick = function () {
      gate.reset();
      openModal('modal-exit');
      gate.focus();
    };
    confirmBtn.onclick = function () {
      var who = gate.check();
      if (!who) return;                       // 틀리면 모달에 그대로 머문다.
      try {
        STORE.flushAnswers();
        STORE.pushEvent('exit_test', machine && machine.current() ? machine.current().id : '',
          { approved_by: who.id });
      } catch (e) {}
      window.location.href = BASE + 'tests.html';
    };
  }

  /* Exit 모달에 관리자 아이디·비밀번호 칸을 붙인다. 마크업은 시험 페이지마다 같아서
     HTML 을 여섯 벌 고치는 대신 여기서 한 번에 그린다. */
  function buildExitGate(modal, confirmBtn) {
    var card = modal.querySelector('.exam-modal-card');
    var actions = modal.querySelector('.exam-modal-actions');
    var box = document.createElement('div');
    box.className = 'exam-exit-auth';
    box.innerHTML =
      '<p class="exam-exit-err" id="exit-admin-err" hidden>Wrong admin ID or password.</p>' +
      '<label>Admin ID' +
        '<input type="text" id="exit-admin-id" autocomplete="off" autocapitalize="none"' +
        ' autocorrect="off" spellcheck="false"></label>' +
      '<label>Password' +
        '<input type="password" id="exit-admin-pw" autocomplete="off"></label>';
    card.insertBefore(box, actions);

    var idEl = box.querySelector('#exit-admin-id');
    var pwEl = box.querySelector('#exit-admin-pw');
    var errEl = box.querySelector('#exit-admin-err');
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
    });

    // 안내 문구도 "누구든 나갈 수 있다"에서 "관리자가 열어 준다"로 바꾼다.
    var note = card.querySelector('p');
    if (note) {
      note.innerHTML = '<span data-en>An administrator must approve this exit. ' +
        'Your answers and remaining time are saved — this session can be resumed later.</span>';
    }

    return {
      reset: function () {
        idEl.value = ''; pwEl.value = ''; errEl.hidden = true;
      },
      focus: function () { setTimeout(function () { idEl.focus(); }, 30); },
      /** 맞으면 계정 객체, 아니면 null(오류 문구를 켠다). */
      check: function () {
        var A = window.SG_ADMIN;
        var who = A && A.verify ? A.verify(idEl.value, pwEl.value) : null;
        if (!who) { errEl.hidden = false; pwEl.value = ''; pwEl.focus(); return null; }
        return who;
      }
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
        /* 관리자 교체분(문항 내용·문항별 제한시간)도 해시에 섞는다 — 바뀐 뒤에는
           옛 세션을 "이어서 응시" 하지 않고 새로 시작해야 바뀐 값이 반영된다. */
        var ovr = window.SG_QUESTIONS ? SG_QUESTIONS.signature(SET_ID) : '';
        var contentHash = STORE.hashString(pack0
          ? SET_ID + ':' + (pack0.code || '') + ':' + JSON.stringify(Object.keys(pack0)) + ':' + ovr
          : 'no-content');
        var timingHash = STORE.hashString(JSON.stringify(t) + '|' + scope + ':' + (section || 'all'));

        var active = STORE.activeSession();
        var session = url.sessionId || active || STORE.offlineSessionId();
        STORE.open(session);
        CLOCK.attachStore(STORE);

        /* `?goq=` · `#screen=` 은 "이 화면을 지금 열어라"는 관리자 진입이다 — 이어보기보다 우선한다.
           안내 방송 화면에는 문항이 없어 goq 로는 짚을 수 없어서 `#screen=` 으로 들어온다. */
        var can = STORE.canResume(contentHash, timingHash);
        var resumable = (session === active) && !query('goq') && !url.screenId &&
                        can.ok && !!STORE.cursor();

        /* 이어볼 수 없는 활성 세션은 재사용하지 않고 새 세션을 연다.
           세트·응시 범위가 달라진 경우(전체 → 리딩만 등) 화면 id 는 그대로라서,
           같은 세션을 다시 쓰면 옛 시계(남은 시간)와 답안이 새 응시에 섞인다.
           URL 로 세션을 지정했거나 한 번도 시작한 적 없는 세션은 건드리지 않는다. */
        if (!can.ok && can.reason !== 'no_meta' && !url.sessionId && session === active) {
          session = STORE.offlineSessionId();
          STORE.open(session);
        }
        var titleEl = document.getElementById('exam-title');
        var code = (pack0 && pack0.code) || url.testId;
        if (titleEl) titleEl.textContent = 'MockTest ' + (code === 'SET1' ? 'NT-016' : code);

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

  /* ── 제출 직후 ──────────────────────────────────────────────
   * 셸이 하는 일은 셋이다. (1) 로컬 기록에 제출 시각을 박는다 — 이게 없으면
   * 성적표(sg-results.js)가 이 응시를 "아직 시험 중"으로 보고 건너뛴다.
   * (2) 로그인해 있으면 채점 결과 사본을 Supabase 로 올린다. (3) 리뷰로 가는
   * 문을 그린다. 셋 다 실패해도 응시 기록 자체는 기기에 그대로 남는다. */
  function finishScreen(session) {
    var mount = document.getElementById('screen-mount');
    if (!mount) return;

    // 끝난 시험에 Continue·타이머가 남아 있으면 안 된다.
    ['btn-advance', 'btn-review', 'btn-back', 'exam-time', 'exam-subbar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    var scored = null;
    try {
      if (window.SG_RESULTS) scored = SG_RESULTS.score(SG_RESULTS.pack(query('testId') || SET_ID), STORE.answers());
    } catch (e) { scored = null; }

    var line = scored && scored.total
      ? scored.score + ' / ' + scored.total + ' (' + scored.percent + '%)'
      : '';

    mount.innerHTML =
      /* 좌우 여백은 밴드 표 때문에 있다 — 폭이 좁으면 점수 칸이 화면 끝에 붙어
         Overall 옆의 CEFR 이 잘린다(390px 에서 확인). */
      '<div class="exam-done" style="max-width:640px;margin:64px auto;padding:0 18px;text-align:center">' +
        '<h2 style="font-size:26px;margin:0 0 10px">' +
          '<span data-en>Your test has been submitted.</span><span data-ko>제출이 완료되었습니다.</span></h2>' +
        (line ? '<p style="font-size:34px;font-weight:850;margin:18px 0">' + line + '</p>' +
                /* 밴드가 나오면 이 줄은 지운다 — 아래에 네 영역 점수가 그려지고 나면
                   "자동 채점 문항 기준" 은 방금 그린 표와 어긋나 보인다. */
                '<p id="done-auto-note" style="opacity:.7;font-size:13px;margin:0 0 6px">' +
                  '<span data-en>Auto-scored questions only. Writing and Speaking are scored by AI first, then confirmed by a teacher.</span>' +
                  '<span data-ko>자동 채점 문항 기준입니다. 라이팅·스피킹은 AI 가 먼저 채점하고 선생님이 확정합니다.</span></p>'
              : '<p style="opacity:.7"><span data-en>Your answers are saved.</span><span data-ko>답안이 저장되었습니다.</span></p>') +
        '<p id="done-sync" style="opacity:.6;font-size:12px;margin:14px 0"></p>' +
        '<div id="done-bands" hidden style="margin:18px auto 0;max-width:420px;text-align:left"></div>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">' +
          '<a class="exam-btn primary" href="review.html?session=' + encodeURIComponent(session) + '">' +
            '<span data-en>Review my answers</span><span data-ko>내 답안 리뷰</span></a>' +
          '<a class="exam-btn" href="dashboard.html">' +
            '<span data-en>My results</span><span data-ko>내 성적</span></a>' +
        '</div>' +
      '</div>';

    var note = document.getElementById('done-sync');
    function say(en, ko) {
      if (note) note.innerHTML = '<span data-en>' + en + '</span><span data-ko>' + ko + '</span>';
    }
    if (!window.SG_RESULTS || !window.SG_AUTH || !SG_AUTH.user()) {
      say('Saved on this device.', '이 기기에 저장되었습니다.');
      return;
    }
    /* push() 는 답안 → 스피킹 녹음 → AI 채점을 이 순서로 건다. 셋 다 여기서
       끝까지 기다린다(waitScore). 예전에는 채점을 걸어만 두고 화면을 넘겼는데,
       학생이 곧바로 창을 닫으면 그 요청이 끊겨 채점이 반만 되곤 했다. 지금은
       제출 화면에 남아 진행(몇/몇)을 보여 주고, 끝나면 그 자리에서 밴드를 편다. */
    say('Uploading your answers and recordings…', '답안과 녹음을 올리는 중…');
    SG_RESULTS.push({
      waitScore: true,
      onProgress: function (done, total) {
        say('Scoring Writing and Speaking… ' + done + ' / ' + total,
            '라이팅·스피킹 채점 중… ' + done + ' / ' + total);
      }
    }).then(function (r) {
      if (r && r.failed) {
        say('Saved on this device. It will upload when you are online.',
            '이 기기에 저장했습니다. 온라인이 되면 올라갑니다.');
        return null;
      }
      say('Saved to your account. Building your score report…',
          '계정에 저장되었습니다. 성적을 정리하는 중…');
      /* 채점이 서버에서 거절당했으면(설정 누락·권한) 그렇게 말한다. "잠시 후 확인하세요"
         라고 해 두면 학생은 몇 번이고 새로고침하고, 우리는 무엇이 고장났는지 모른다.
         답안은 이미 올라갔으므로 잃은 것은 없다 — 늦어지는 것뿐이다. */
      var why = r && r.scored && r.scored.error;
      return showBands(session).then(function (b) {
        if (b) return;
        // 밴드를 못 그린 경우에도 화면이 "정리하는 중" 에서 멈춰 있으면 안 된다.
        if (why) {
          say('Your answers are saved, but scoring is unavailable right now (' + why +
                '). A teacher will score this test.',
              '답안은 저장되었지만 지금 채점을 할 수 없습니다 (' + why +
                '). 선생님이 채점합니다.');
          return;
        }
        say('Saved to your account. Check My results in a few minutes.',
            '계정에 저장되었습니다. 잠시 후 내 성적에서 확인하세요.');
      });
    }).catch(function () {
      say('Saved on this device.', '이 기기에 저장되었습니다.');
    });

    /* 방금 채점된 W·S 까지 얹어 네 영역 밴드를 제출 화면에 바로 그린다.
       채점이 하나도 안 됐으면(키 없음·녹음 없음 등) 아무 것도 그리지 않고
       "잠시 후 내 성적에서" 로 돌아간다 — 빈 표를 보여 주는 것보다 낫다. */
    function showBands(sess) {
      var box = document.getElementById('done-bands');
      if (!box || !window.SG_BAND) return Promise.resolve(null);
      return SG_RESULTS.get(sess).then(function (row) {
        if (!row) return null;
        return SG_RESULTS.bandOf(row).then(function (b) {
          if (!b || b.overall === null) return null;
          var LABELS = { reading: 'Reading', listening: 'Listening',
                         writing: 'Writing', speaking: 'Speaking' };
          var html = '';
          SG_BAND.SKILLS.forEach(function (skill) {
            var s = (b.sections || {})[skill] || {};
            var waiting = s.band === null || s.band === undefined;
            html +=
              '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
                'padding:7px 2px;border-bottom:1px solid rgba(128,128,128,.22)">' +
                '<span style="font-size:14px">' + LABELS[skill] + '</span>' +
                '<span style="font-weight:800;font-size:17px' + (waiting ? ';opacity:.45' : '') + '">' +
                  SG_BAND.fmt(s.band) +
                '</span>' +
              '</div>';
          });
          html +=
            '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 2px 0">' +
              '<span style="font-size:14px;font-weight:700">Overall</span>' +
              '<span style="font-weight:850;font-size:22px">' + SG_BAND.fmt(b.overall) +
                (b.cefr ? ' <span style="font-size:12px;font-weight:600;opacity:.6">' + b.cefr + '</span>' : '') +
              '</span>' +
            '</div>';
          box.innerHTML = html;
          box.hidden = false;
          var auto = document.getElementById('done-auto-note');
          if (auto) auto.hidden = true;
          if (b.draft) {
            say('Scored. Writing and Speaking are AI drafts — a teacher confirms them later.',
                '채점이 끝났습니다. 라이팅·스피킹은 AI 초안이며 선생님이 나중에 확정합니다.');
          } else {
            say('Scored.', '채점이 끝났습니다.');
          }
          return b;
        });
      })['catch'](function () { return null; });
    }
  }

  function finishUp(session) {
    if (machine && machine.status() !== 'submitted') {
      try { machine.markSubmitted(); } catch (e) { STORE.patchMeta({ submittedAt: Date.now() }); }
    } else {
      STORE.patchMeta({ submittedAt: Date.now() });
    }
    try { STORE.flushAnswers(); } catch (e) {}
    finishScreen(session);
  }

  function startRun(url, session, contentHash, timingHash, resume, section) {
    var meta = STORE.meta();
    if (!meta || !meta.session) {
      STORE.saveMeta({
        session: session, examCode: url.testId, setCode: SET_ID.toUpperCase(),
        studentNo: '', startedAt: Date.now(),
        profile: url.profile, mode: url.mode, contentHash: contentHash, timingHash: timingHash,
        screenCount: screens.length, submittedAt: null, serverSession: null
      });
      meta = STORE.meta();
    }
    // mode 는 저장값이 이긴다(Story 1.8 AC5).
    var mode = meta.mode || url.mode;
    STORE.patchMeta({ screenCount: screens.length, mode: mode });
    // 어느 세트를 봤는지는 기록에 남아야 한다 — 모의고사 목록이 "응시함"을 이걸로 가린다.
    // 이미 적혀 있으면 건드리지 않는다(옛 응시를 이어보는 중일 수 있다).
    if (!meta.setCode) STORE.patchMeta({ setCode: SET_ID.toUpperCase() });

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
    } else if (query('goq')) {
      /* `?goq=<문항 id>` — 관리자 페이지(admin-questions.html)의 "시험 화면에서 열기".
         화면 id 를 알 필요 없이 문항 id 만으로 그 문항이 실린 화면에서 시작한다. */
      var gi = screenIndexOfQuestion(screens, query('goq'));
      if (gi > 0) { startIndex = gi; machine.restoreTo(gi, 0); }
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
      /* 제출은 화면이 사라지는 전이다(to === null). 엔진은 제출해도 커서를 옮기지
         않으므로 machine.current() 는 마지막 화면 그대로다 — 여기서 화면이 아니라
         전이의 도착지를 봐야 하는 이유이고, to 를 안 보던 동안은 이 가지가 한 번도
         돌지 않아 제출 기록이 남지 않았다. */
      if (!tr.to && machine.status() === 'submitting') {
        // 서버 전송은 Epic 3(exam-sync.js) 의 아웃박스가 담당한다.
        STORE.enqueue('submit', { session: session, at: Date.now() });
        // 채점·결과 저장·리뷰 안내는 여기서 끝낸다 — 서버가 없어도 학생은 결과를 본다.
        finishUp(session);
      }
    });

    CLOCK.subscribe(function (d) { paintTimer(d); });

    document.getElementById('btn-advance').onclick = function () {
      if (machine.status() === 'submitting' || machine.status() === 'submitted') return;
      /* 화면 안에 아직 안 본 문항이 남았으면 화면을 넘기지 않는다 — 다음 문항을 편다.
         마지막 문항이면 next() 가 false 라 그대로 다음 화면(=다음 지문)으로 간다. */
      var nav = screenNav();
      if (nav && typeof nav.next === 'function' && nav.next()) return;
      /* 스피킹 녹음·안내 방송 화면에서는 학생용 next() 가 렌더러 흐름과 얽혀 있다.
         관리자가 누른 것이라면 그 흐름을 기다리지 않고 다음 화면으로 건너뛴다. */
      if (machine.next('manual')) return;
      adminStep(1);
    };

    var backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.onclick = function () {
        var nav = screenNav();
        if (nav && typeof nav.canPrev === 'function' && nav.canPrev()) { nav.prev(); return; }
        adminStep(-1);
      };
    }

    bindModals();
    bindSubbar(session);
    bindExit();
    bindLifecycle();
    machine.installHistoryGuard();
    machine.start(startIndex);

    /* 관리자 패널 — 파일이 없거나 관리자 로그인이 없으면 아무 일도 하지 않는다. */
    if (window.SG_EXAM_ADMIN && typeof window.SG_EXAM_ADMIN.mount === 'function') {
      try { window.SG_EXAM_ADMIN.mount({ set: SET_ID, runtime: window.SG_RUNTIME }); } catch (e) {}
    }

    /* 시험 도중에 ⚙(Ctrl+Alt+A)로 로그인하거나 로그아웃해도 상단바가 즉시 따라간다. */
    if (window.SG_ADMIN && typeof window.SG_ADMIN.onChange === 'function') {
      window.SG_ADMIN.onChange(function () {
        var sc = machine && machine.current();
        if (sc) syncActions(sc);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    machine: function () { return machine; },
    screens: function () { return screens; },
    setId: function () { return SET_ID; },
    /* 화면 안에서 문항이 바뀌었을 때 렌더러가 부른다 — 진행 표시와 Back 상태를 다시 맞춘다.
       (엔진 전이가 아니라 화면 내부 이동이라 onTransition 이 돌지 않는다.) */
    syncNav: function () {
      var sc = machine && machine.current();
      if (!sc) return false;
      syncSubbar(sc);
      syncActions(sc);
      return true;
    },
    /* 현재 화면을 그대로 다시 그린다 — 관리자 편집이 콘텐츠 팩을 고친 뒤 쓴다. */
    rerender: function () {
      if (!machine || !machine.current()) return false;
      window.SG_RENDER.render(machine.current(),
        { engine: machine, mode: machine.mode(), phaseIndex: machine.phaseIndex() });
      return true;
    },
    timing: function () { return timing; },
    volume: function () { return volume; }
  };
})();
