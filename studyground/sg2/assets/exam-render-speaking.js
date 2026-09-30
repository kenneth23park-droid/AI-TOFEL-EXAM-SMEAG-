/* SMEAG · StudyGround — exam-render-speaking.js
 * 목적: screenType === "speaking" 렌더러. architecture.md §3.3 의 phases 배열을
 *       "분기 없는 단일 루프"로 실행하고, 보라색 RESPONSE TIME 박스(HH:MM:SS)를 그린다.
 * 의존 전역: window.SG_RENDER (필수), window.SG_CLOCK, window.SG_STORE,
 *            window.SG_MEDIA, window.SG_RECORDER  (없으면 각각 degrade)
 * 노출 전역: window.SG_SPEAKING  — 순수부(endCondition / nextPhase / initialState)는
 *            DOM·타이머·미디어 없이 node 에서 그대로 검증된다(coding standards F9).
 *
 * ── phase 종료조건표 (architecture.md §3.3 정본) ──────────────────────────
 *   selfPaced:true                              → 버튼 클릭만        ('button')
 *   재생 가능한 media 가 있고 seconds:0          → audio/video ended  ('media')
 *   seconds > 0                                  → deadline 도달      ('deadline')
 *   seconds === 0 && media 없음 && selfPaced 아님 → 즉시 통과         ('immediate')
 *
 * record phase 진입 시 SG_RECORDER.start(), 종료 시 .stop() 을 부른다.
 * 이 훅은 phase 이름이 'record' 인지만 보므로 TOEFL S1/S2 와 IELTS Part1/2/3 이
 * 완전히 같은 코드경로를 탄다. IELTS Part 2 는 prep.seconds 가 3 → 60 으로,
 * record.seconds 가 20/45 → 120 으로 바뀔 뿐 코드는 한 줄도 달라지지 않는다.
 *
 * ES5 문법만 사용한다(var / function / 문자열 연결).
 */
(function (root) {
  'use strict';

  var PLAYABLE = { audio: 1, video: 1 };

  /* ══════════════════════════════════════════════════════════════════
     1) 순수부 — DOM·타이머·미디어를 만지지 않는다. node 에서 그대로 테스트된다.
     ══════════════════════════════════════════════════════════════════ */

  /* MediaSpec.kind 판정. compile 단계에서 kind 가 이미 붙지만, 없으면 확장자로 추론한다. */
  function mediaKind(m) {
    if (!m) return null;
    if (m.kind) return m.kind;
    var MEDIA = root.SG_MEDIA;
    if (MEDIA && typeof MEDIA.kindOf === 'function') return MEDIA.kindOf(m.srcRaw || m.src);
    return null;
  }

  /* 문서와의 차이(의도): 'media 있고 seconds:0 → ended' 조건을 **재생 가능한**
     media(audio/video)로 한정한다. 이미지에는 ended 이벤트가 없어서, IELTS Part 2 의
     cue-card 이미지 phase 를 'media' 로 판정하면 영원히 끝나지 않기 때문이다.
     이미지는 종료조건이 아니라 화면에 계속 떠 있는 표시 자산으로 다룬다. */
  function isPlayable(m) { return !!(m && PLAYABLE[mediaKind(m)]); }

  /* phases[] 중 첫 cue card 를 돌려준다(IELTS Part 2). TOEFL phases 에는 cue 가 없어
     항상 null 이므로 cue 관련 DOM 이 아예 만들어지지 않는다 — 기존 동작 무변경. */
  function firstCue(phases) {
    var list = phases || [];
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].cue) return list[i].cue; }
    return null;
  }

  /* 즉시 통과하는 read phase(인터뷰) — 버튼으로 멈춰 세우지 않고, 지시문만 화면 진입
     순간부터 세워 둔다. cue card 를 가진 IELTS 의 selfPaced read 는 여기 걸리지 않는다. */
  function hasStandingRead(phases) {
    var list = phases || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && p.name === 'read' && endCondition(p) === 'immediate') return true;
    }
    return false;
  }

  function endCondition(phase) {
    if (!phase) return 'none';
    if (phase.selfPaced === true) return 'button';
    var sec = phase.seconds || 0;
    if (isPlayable(phase.media) && sec === 0) return 'media';
    if (sec > 0) return 'deadline';
    return 'immediate';
  }

  function enterActions(p, out) {
    if (!p) return;
    if (p.name === 'record') out.push('startRecord');
    if (isPlayable(p.media)) out.push('playMedia');
  }

  function leaveActions(p, out) {
    if (p && p.name === 'record') out.push('stopRecord');
  }

  /* 0-length(즉시 통과) phase 를 연속으로 건너뛰고 안착할 인덱스를 돌려준다. */
  function settle(phases, i, actions) {
    var guard = 0;
    while (i < phases.length && endCondition(phases[i]) === 'immediate' && guard < 1000) {
      enterActions(phases[i], actions);
      leaveActions(phases[i], actions);
      i += 1; guard += 1;
    }
    if (i < phases.length) enterActions(phases[i], actions);
    return i;
  }

  function result(phases, i, status, actions, changed) {
    return { phases: phases, phaseIndex: i, status: status, actions: actions, changed: changed };
  }

  function initialState(screen, phaseIndex) {
    return {
      phases: (screen && screen.phases) ? screen.phases : [],
      phaseIndex: typeof phaseIndex === 'number' && phaseIndex > 0 ? phaseIndex : 0,
      status: 'idle'
    };
  }

  /**
   * phases 단일 루프의 전이 함수. 순수 — 같은 입력에 항상 같은 출력.
   * @param {{phases:Array, phaseIndex:number, status:string}} state
   * @param {{type:'start'|'button'|'mediaEnded'|'expire'|'force'}} event
   * @returns {{phases:Array, phaseIndex:number, status:'idle'|'active'|'done',
   *            actions:string[], changed:boolean}}
   *          actions ⊂ {'startRecord','stopRecord','playMedia','screenDone'}
   */
  function nextPhase(state, event) {
    var phases = (state && state.phases) || [];
    var i = (state && typeof state.phaseIndex === 'number') ? state.phaseIndex : 0;
    var status = (state && state.status) || 'idle';
    var t = (event && event.type) || '';
    var actions = [];
    if (i < 0) i = 0;
    if (status === 'done') return result(phases, i, 'done', actions, false);

    if (t === 'start') {
      if (status === 'active') return result(phases, i, status, actions, false);
      if (i >= phases.length) { actions.push('screenDone'); return result(phases, i, 'done', actions, true); }
      var j = settle(phases, i, actions);
      if (j >= phases.length) { actions.push('screenDone'); return result(phases, j, 'done', actions, true); }
      return result(phases, j, 'active', actions, true);
    }

    if (status !== 'active') return result(phases, i, status, actions, false);

    var cond = endCondition(phases[i]);
    var ok = (t === 'force') ||
             (t === 'button' && cond === 'button') ||
             (t === 'mediaEnded' && cond === 'media') ||
             (t === 'expire' && cond === 'deadline');
    if (!ok) return result(phases, i, status, actions, false);

    leaveActions(phases[i], actions);
    var k = settle(phases, i + 1, actions);
    if (k >= phases.length) { actions.push('screenDone'); return result(phases, k, 'done', actions, true); }
    return result(phases, k, 'active', actions, true);
  }

  /* ══════════════════════════════════════════════════════════════════
     2) 렌더러 — 여기서부터 DOM 을 만진다.
     ══════════════════════════════════════════════════════════════════ */

  var doc = root.document || null;
  var active = null;   // 현재 화면 인스턴스 {dispose:fn, screenId:string}

  /* cue card 메모(Story 6.2 AC4). **답안이 아니다** — 세션 메모리에만 남기고
     SG_STORE/서버로 보내지 않는다. 화면을 벗어났다 돌아오면 같은 세션 안에서만 복원된다. */
  var memoByScreen = {};

  function CLOCK() { return root.SG_CLOCK || null; }
  function STORE() { return root.SG_STORE || null; }
  function REC() { return root.SG_RECORDER || null; }

  function el(tag, cls) { var n = doc.createElement(tag); if (cls) n.className = cls; return n; }

  function bi(tag, en, ko) {
    var R = root.SG_RENDER;
    if (R && typeof R.bilingual === 'function') return R.bilingual(tag, en, ko);
    var n = el(tag || 'p'); n.textContent = en; return n;
  }

  /* 반드시 SG_MEDIA.resolveMedia() 를 통과시킨다. 단, compile 이 이미 리맵+encodeURI 한
     src 를 다시 넣으면 '%' 가 '%25' 로 이중 인코딩되므로 원본 srcRaw 를 우선 넣는다. */
  function srcOf(m) {
    if (!m) return '';
    var MEDIA = root.SG_MEDIA;
    if (m.srcRaw && MEDIA && typeof MEDIA.resolveMedia === 'function') return MEDIA.resolveMedia(m.srcRaw);
    if (!m.srcRaw && MEDIA && typeof MEDIA.resolveMedia === 'function' && String(m.src || '').indexOf('%') < 0) {
      return MEDIA.resolveMedia(m.src);
    }
    return m.src || '';
  }

  function fmt(sec, format) {
    var C = CLOCK();
    if (C && typeof C.formatSec === 'function') return C.formatSec(sec, format || 'HH:MM:SS');
    return '--:--:--';
  }

  /* ── 녹음 시작 신호음(beep) ────────────────────────────────
     발주처 요구(2026-08-11): 질문이 끝나고 녹음이 시작되기 전에 "삐" 소리로 알린다.
     실제 TOEFL 과 같은 신호로, 응시자는 소리를 듣고 말하기 시작하면 된다.

     소리 파일을 쓰지 않고 WebAudio 로 합성한다 — 오프라인 응시에서도 404 가 없고
     tts-manifest 에 항목이 늘지 않는다(볼륨 테스트음과 같은 이유).

     신호음이 마이크에 녹음되지 않도록 **소리가 끝난 뒤에** 녹음을 연다. 같은 이유로
     응답 시계도 신호음이 끝난 뒤 건다 — 안 그러면 8초짜리 문항에서 0.4초를 잃는다. */
  var BEEP_HZ = 880;
  var BEEP_SEC = 0.28;
  var BEEP_GAP_MS = 120;      // 소리가 사라지고 마이크가 열리기까지의 여유

  function beepMs() { return Math.round(BEEP_SEC * 1000) + BEEP_GAP_MS; }

  function playBeep() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      var actx = new AC();
      var osc = actx.createOscillator();
      var gain = actx.createGain();
      var t0 = actx.currentTime;
      var peak = Math.max(0.0002, volume() * 0.25);
      osc.type = 'sine';
      osc.frequency.value = BEEP_HZ;
      // 사각파처럼 뚝 끊으면 '틱' 잡음이 난다. 짧은 어택·릴리스를 준다.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + BEEP_SEC);
      osc.connect(gain); gain.connect(actx.destination);
      osc.start(t0); osc.stop(t0 + BEEP_SEC + 0.02);
      osc.onended = function () { try { actx.close(); } catch (e) {} };
      return true;
    } catch (e) { return false; }
  }

  function volume() {
    var RT = root.SG_RUNTIME;
    if (RT && typeof RT.volume === 'function') {
      var v = RT.volume();
      if (typeof v === 'number' && v >= 0 && v <= 1) return v;
    }
    return 1;
  }

  function logEvent(type, screenId, detail) {
    var s = STORE();
    if (s && typeof s.pushEvent === 'function') { try { s.pushEvent(type, screenId, detail); } catch (e) {} }
  }

  /* FR8 — 오디오 1회 재생은 새로고침으로 재진입해도 소진 상태가 유지되어야 한다.
     이벤트 링버퍼(§5.2)에 소진 기록을 남기고 재진입 시 조회한다. */
  function markPlayed(screenId, phaseIndex) {
    logEvent('phase_media_played', screenId, { phaseIndex: phaseIndex });
  }

  function alreadyPlayed(screenId, phaseIndex) {
    var s = STORE();
    if (!s || typeof s.events !== 'function') return false;
    var evs = s.events() || [];
    for (var i = evs.length - 1; i >= 0; i--) {
      var e = evs[i];
      if (e && e.type === 'phase_media_played' && e.screenId === screenId &&
          e.detail && e.detail.phaseIndex === phaseIndex) return true;
    }
    return false;
  }

  /* phase 별 clock key. scope 접두는 'screen' 을 유지해 SG_STORE.planResume 의
     scopeOfKey() 해석과 충돌하지 않게 하고, target 은 화면 id 와 다르게 만들어
     복구 로직이 이 키를 화면 전진 신호로 오해하지 않게 한다. visible:false 이므로
     상단 pill(가장 좁은 visible scope) 선택에도 영향을 주지 않는다. */
  function phaseKey(screenId, idx) { return 'screen:' + screenId + '#p' + idx; }

  /* ── 인스턴스 ────────────────────────────────────────────── */

  function build(screen, ctx) {
    var engine = ctx && ctx.engine ? ctx.engine : null;
    var qid = (screen.questionIds && screen.questionIds[0]) || screen.id;
    var phases = screen.phases || [];
    var state = initialState(screen, ctx && ctx.phaseIndex);
    var disposed = false;
    var unsubClock = null, unsubTx = null, rafId = null;
    var audioEl = null;
    var armedKeys = [];
    var recording = false;
    var recordFailed = false;
    var recStartedAt = 0;        // 무음 경고를 언제부터 셀지 정하는 기준
    var silentWarned = false;
    var beepTimer = null;        // 신호음이 울리는 동안만 살아 있다
    var pendingArm = null;       // 신호음이 끝나고 걸 응답 시계 {index, phase}
    var advanceTimer = null;     // 응답 종료 후 자동 전진까지의 짧은 대기
    var stickyCaption = false;   // read/prompt 가 세운 지시문을 prep·record 내내 유지할지
    var micReady = false;        // 이 화면에서 마이크 스트림을 손에 쥐었는가
    var micWarming = false;      // 권한 요청이 진행 중인가(두 번 묻지 않기 위해)
    var micBannerUp = false;     // 지금 배너가 마이크 안내인가(다른 안내를 덮지 않기 위해)
    var armWaitTimer = null;     // 마이크가 열리기를 기다리는 동안의 폴링
    var armWaitedMs = 0;
    var gated = false;           // 권한을 못 잡아 문항을 아직 시작하지 못한 상태
    var gateTimer = null;

    /* ── DOM 골격 ── */
    var box = el('div', 'speaking-screen');

    /* 관찰(speaking-response-1830s.png): 화면 안에 진행표시가 없다.
       "Speaking | Question 8 of 11" 은 서브바(2행)가 그린다 — 여기서 중복 렌더하지 않는다. */

    var banner = el('div', 'speaking-banner');
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    box.appendChild(banner);

    /* 관찰: 지시문이 화면 최상단 중앙에 큰 굵은 글씨로 오고, 그 아래 화자 영상,
       그 아래 RESPONSE TIME 카드가 온다. 그래서 caption 을 stage 안이 아니라 stage 위에 둔다. */
    var caption = el('div', 'speaking-caption');
    box.appendChild(caption);

    var stage = el('div', 'speaking-stage');
    var portrait = null;
    if (screen.image && srcOf(screen.image)) {
      portrait = el('img', 'speaking-portrait');
      portrait.src = srcOf(screen.image);
      portrait.alt = '';
      stage.appendChild(portrait);
    }
    box.appendChild(stage);

    /* IELTS Part 2 cue card (phase.media.kind==='image').
       TOEFL 스피킹에는 cue 이미지가 없다. 예전에는 <img> 를 무조건 붙여 두고 hidden 으로
       숨겼는데, 그러면 src="" 인 img 가 11개 스피킹 화면 전부에 남아 렌더 스윕(F2)에서
       "bad media src" 로 잡혔다. 이제 실제 src 가 생길 때 만들어 stage 바로 뒤(= 예전과
       같은 자리)에 끼워 넣는다. 빈 slot div 를 대신 두면 안 된다 — .speaking-screen 은
       gap:18px 인 flex column 이라 빈 자식도 간격을 하나 더 만든다. */
    var cueImg = null;
    function showCue(src) {
      if (!src) return;
      if (!cueImg) {
        cueImg = el('img', 'speaking-cue');
        cueImg.alt = '';
        box.insertBefore(cueImg, stage.nextSibling);
      }
      cueImg.src = src;
      cueImg.hidden = false;
    }

    /* ── cue card 패널 (Story 6.2 AC3) ──
       phase.cue 가 있는 화면(IELTS Part 2)에만 만들어진다. read → prep → record 내내
       화면에 남아 있어야 하므로 phase 별 렌더가 아니라 화면 골격에 한 번만 붙인다.
       전용 CSS 를 새로 만들지 않고 exam.css 의 기존 박스/불릿/텍스트영역 클래스를 재사용한다
       (exam.css 블록 소유권을 침범하지 않기 위함 — coding standards). */
    var cueSpec = firstCue(phases);
    var memoEl = null;
    // 이 시점의 box 는 head/banner/stage/cueImg 까지다 — 아래 dock·review 보다 앞에 놓인다.
    if (cueSpec) box.appendChild(buildCuePanel(cueSpec, screen.id));

    function buildCuePanel(cue, screenId) {
      var panel = el('div', 'speaking-cuecard wr-situation');

      var lab = el('div', 'wr-situation-label');
      lab.textContent = 'CUE CARD';
      panel.appendChild(lab);

      var topic = bi('p', cue.topicEn || '', cue.topicKo || cue.topicEn || '');
      topic.className = 'wr-situation-text';
      panel.appendChild(topic);

      var bullets = cue.bullets || [];
      if (bullets.length) {
        var ul = el('ul', 'wr-bullets-list');
        for (var i = 0; i < bullets.length; i++) {
          var ko = (cue.bulletsKo && cue.bulletsKo[i]) || bullets[i];
          ul.appendChild(bi('li', bullets[i], ko));
        }
        panel.appendChild(ul);
      }

      var memoLab = bi('div', 'You can make notes here. Notes are not submitted and are not marked.',
        '여기에 메모할 수 있습니다. 메모는 제출되지 않으며 채점 대상이 아닙니다.');
      memoLab.className = 'wr-bullets-label';
      panel.appendChild(memoLab);

      memoEl = doc.createElement('textarea');
      memoEl.className = 'wr-textarea speaking-memo';
      memoEl.setAttribute('rows', '5');
      memoEl.setAttribute('spellcheck', 'false');
      memoEl.placeholder = 'Notes (not submitted)';
      memoEl.value = memoByScreen[screenId] || '';
      memoEl.oninput = function () { memoByScreen[screenId] = memoEl.value; };
      panel.appendChild(memoEl);

      return panel;
    }

    var dock = el('div', 'speaking-dock');
    var rbox = el('div', 'response-box');     // .response-box 는 base 블록(Story 1.7) 소유
    rbox.hidden = true;
    /* 관찰: 헤더는 라벤더 배경 + 흰 대문자 "RESPONSE TIME" 뿐이다. 마이크 아이콘은
       헤더가 아니라 흰 본문의 숫자 왼쪽에 있고, base 블록의 .response-time::before 가 그린다.
       그래서 여기서 이모지를 넣지 않는다(넣으면 아이콘이 둘이 된다). */
    var rlabel = el('span', 'response-label');
    rlabel.appendChild(bi('span', 'RESPONSE TIME', '응답 시간'));
    var rtime = el('span', 'response-time');
    rtime.textContent = fmt(0, 'HH:MM:SS');
    var meter = el('div', 'speaking-meter');
    var meterFill = el('i', 'speaking-meter-fill');
    meter.appendChild(meterFill);
    rbox.appendChild(rlabel); rbox.appendChild(rtime); rbox.appendChild(meter);
    dock.appendChild(rbox);

    var prepChip = el('div', 'speaking-prep');
    prepChip.hidden = true;
    var prepLab = bi('span', 'Get ready', '준비하세요');
    var prepTime = el('span', 'speaking-prep-time');
    prepChip.appendChild(prepLab); prepChip.appendChild(prepTime);
    dock.appendChild(prepChip);

    var actions = el('div', 'speaking-actions');
    var btn = el('button', 'btn primary speaking-btn');
    btn.type = 'button';
    btn.hidden = true;
    actions.appendChild(btn);
    dock.appendChild(actions);
    box.appendChild(dock);

    var review = el('div', 'speaking-review');
    review.hidden = true;
    box.appendChild(review);

    /* ── 헬퍼 ── */

    function setBanner(en, ko, tone) {
      while (banner.firstChild) banner.removeChild(banner.firstChild);
      banner.appendChild(bi('span', en, ko));
      banner.className = 'speaking-banner' + (tone ? ' is-' + tone : '');
      banner.hidden = false;
    }

    function setCaption(en, ko) {
      while (caption.firstChild) caption.removeChild(caption.firstChild);
      caption.appendChild(bi('p', en, ko));
    }

    function setButton(en, ko, onClick) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.appendChild(bi('span', en, ko));
      btn.onclick = onClick;
      btn.hidden = false;
    }

    function persistCursor() {
      var s = STORE();
      if (!s || typeof s.saveCursor !== 'function') return;
      var si = engine && typeof engine.currentIndex === 'function' ? engine.currentIndex() : 0;
      try { s.saveCursor(screen.id, si, state.phaseIndex); } catch (e) {}
    }

    /* engine.phaseNext() 를 쓰지 않는 이유(의도된 차이):
       그 API 는 phaseIndex 를 정확히 1 씩만 올리고 마지막 phase 에서 화면을 자동 전진시킨다.
       settle() 은 0-length phase 를 여러 개 한 번에 건너뛸 수 있으므로 phase 커서는
       SG_STORE.saveCursor 로 직접 남긴다. localStorage 직접 접근은 없다. */

    /* 스피킹은 응시자가 누를 것이 없다 — 응답 시간이 끝나면 실제 시험처럼 스스로 넘어간다.
       녹음 저장(stopRecording 의 콜백)이 끝날 틈을 주려고 잠깐만 머문다. */
    var ADVANCE_MS = 1500;
    var ADVANCE_MS_NOTICE = 6000;   // 안내(중단·이미 녹음됨)를 읽을 시간은 준다
    var advanceMs = ADVANCE_MS;

    function cancelAdvance() {
      if (advanceTimer !== null && root.clearTimeout) { try { root.clearTimeout(advanceTimer); } catch (e) {} }
      advanceTimer = null;
    }

    function autoAdvance() {
      if (advanceTimer !== null) return;   // 이미 예약돼 있으면 두 번 걸지 않는다
      function go() {
        advanceTimer = null;
        if (disposed) return;
        if (engine && typeof engine.next === 'function') engine.next('auto');
      }
      if (root.setTimeout) advanceTimer = root.setTimeout(go, advanceMs);
      else go();
    }

    function markNotSubmit(reason) {
      var R = REC();
      var value = R ? R.NOT_SUBMIT : 'NOT SUBMIT';
      var extra = { notSubmit: true, recorded: false, media: '', reason: reason };
      if (engine && typeof engine.answer === 'function') {
        try { engine.answer(qid, value, extra); return; } catch (e) {}
      }
      var s = STORE();
      if (s && typeof s.upsertAnswer === 'function') { s.upsertAnswer(qid, value, extra); s.flushAnswers(); }
    }

    /* ── 타이머 ── */

    function armPhaseClock(idx, phase) {
      var C = CLOCK();
      if (!C || !phase || !(phase.seconds > 0)) return;
      var key = phaseKey(screen.id, idx);
      armedKeys.push(key);
      C.armClock(key, phase.seconds, {
        mode: phase.name === 'record' ? 'response' : 'countdown',
        format: phase.name === 'record' ? 'HH:MM:SS' : 'MM:SS',
        scope: 'screen',
        visible: false,
        warnAtSec: 0,
        onExpire: function () { if (!disposed) fire('expire'); }
      });
    }

    function remainingOf(idx) {
      var C = CLOCK();
      if (!C) return 0;
      var r = C.remainingSec(phaseKey(screen.id, idx));
      return typeof r === 'number' ? r : 0;
    }

    function paint() {
      if (disposed) return;
      var i = state.phaseIndex;
      var p = state.phases[i];
      if (!p) return;
      // 신호음이 우는 동안은 시계가 아직 안 걸렸다 — 0 이 아니라 만 시간을 보여준다.
      if (p.name === 'record') rtime.textContent = fmt(pendingArm ? (p.seconds || 0) : remainingOf(i), 'HH:MM:SS');
      else if (p.name === 'prep' && p.seconds > 0) prepTime.textContent = fmt(remainingOf(i), 'MM:SS');
    }

    /* 마이크가 살아 있다는 증거는 이 띠 하나뿐이다 — 응시자는 자기 답을 되들을 수
     * 없으므로(AC6), 말하는 동안 눈금이 움직이는 것을 보고 안심해야 한다.
     * 눈금이 끝까지 잠자코 있으면 5초 뒤에 말로도 알린다. */
    var SILENT_GRACE_MS = 5000;

    function pumpMeter() {
      if (disposed) return;
      var R = REC();
      var lv = (recording && R && typeof R.level === 'function') ? R.level() : 0;
      meterFill.style.width = Math.round(lv * 100) + '%';
      meter.className = 'speaking-meter' +
        (recording ? ' is-armed' : '') +
        (lv > 0.06 ? ' is-live' : '');

      if (recording && !silentWarned && !recordFailed && recStartedAt &&
          R && typeof R.peak === 'function' &&
          (Date.now() - recStartedAt) > SILENT_GRACE_MS &&
          R.peak() < (R.SILENT_PEAK || 0.03)) {
        silentWarned = true;
        setBanner('No sound is reaching the microphone. Speak up, or check that the right input device is selected and not muted.',
                  '마이크로 소리가 들어오지 않습니다. 더 크게 말하거나, 입력 장치가 맞는지·음소거는 아닌지 확인하세요.', 'error');
        logEvent('record_silent', screen.id, { qid: qid });
      }
      if (root.requestAnimationFrame) rafId = root.requestAnimationFrame(pumpMeter);
    }

    /* ── 오디오 ── */

    function stopAudio() {
      if (!audioEl) return;
      try { audioEl.onended = null; audioEl.pause(); } catch (e) {}
      if (audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
      audioEl = null;
    }

    function playPhaseMedia(idx, phase) {
      stopAudio();
      if (!isPlayable(phase.media)) return;
      // maxPlays 1 (확정) — 재진입해도 소진 상태를 유지한다(FR8).
      if (alreadyPlayed(screen.id, idx)) {
        setBanner('This audio has already been played once and cannot be replayed.',
                  '이 오디오는 이미 1회 재생되어 다시 들을 수 없습니다.', 'warn');
        // 렌더 도중 재귀 진입을 피해 다음 틱으로 미룬다.
        if (root.setTimeout) root.setTimeout(function () { fire('mediaEnded'); }, 0);
        else fire('mediaEnded');
        return;
      }
      audioEl = doc.createElement('audio');
      audioEl.src = srcOf(phase.media);
      audioEl.preload = 'auto';
      audioEl.volume = volume();
      audioEl.className = 'speaking-audio';
      audioEl.setAttribute('controlsList', 'nodownload noplaybackrate');
      audioEl.onended = function () {
        stage.classList.remove('is-playing');
        markPlayed(screen.id, idx);
        fire('mediaEnded');
      };
      audioEl.onerror = function () {
        // 오프라인·404 여도 시험을 멈추지 않는다(F12). 다음 phase 로 넘긴다.
        stage.classList.remove('is-playing');
        setBanner('The audio could not be loaded. Continuing to the next step.',
                  '오디오를 불러오지 못했습니다. 다음 단계로 넘어갑니다.', 'warn');
        markPlayed(screen.id, idx);
        fire('mediaEnded');
      };
      stage.appendChild(audioEl);
      stage.classList.add('is-playing');
      var pr = audioEl.play();
      if (pr && typeof pr['catch'] === 'function') {
        pr['catch'](function () {
          // 자동재생 차단 → 명시적 재생 버튼으로 degrade
          stage.classList.remove('is-playing');
          setButton('Play audio', '오디오 재생', function () {
            btn.hidden = true;
            stage.classList.add('is-playing');
            try { audioEl.play(); } catch (e) {}
          });
        });
      }
    }

    /* ── 마이크 확보 ──
     * 권한 창은 응답 시간 안에서 떠서는 안 된다. 학생이 Allow 를 누르는 몇 초가
     * 그대로 답변 시간에서 깎이기 때문이다(관찰된 실제 사고).
     * 그래서 화면에 들어서자마자 — read·listen·prep 이 도는 동안 — 미리 열어 두고,
     * 그래도 안 열렸으면 응답 시계를 걸지 않고 열릴 때까지 기다린다. */

    var MIC_WAIT_MAX_MS = 8000;   // 그래도 안 열리면 시험을 세우지 않고 진행한다
    var MIC_WAIT_STEP_MS = 200;

    function micBanner(en, ko, tone) {
      setBanner(en, ko, tone);
      micBannerUp = true;
    }

    function clearMicBanner() {
      if (!micBannerUp) return;   // 중단 안내 같은 다른 배너는 건드리지 않는다
      banner.hidden = true;
      micBannerUp = false;
    }

    function prewarmMic() {
      var R = REC();
      if (disposed || micReady || micWarming) return;
      if (!R || typeof R.requestPermission !== 'function') return;
      if (typeof R.isSupported === 'function' && !R.isSupported()) return;
      micWarming = true;
      R.requestPermission(function (e) {
        micWarming = false;
        if (disposed) return;
        if (e) {
          logEvent('mic_prewarm_failed', screen.id, { qid: qid, code: e.code || '' });
          if (!gated) {
            micBanner('Allow the microphone. Your answer cannot be recorded until you do — look for the browser prompt near the address bar.',
                      '마이크를 허용하세요. 허용하기 전에는 답변이 녹음되지 않습니다 — 주소창 근처의 허용 창을 확인하세요.', 'error');
          }
          return;
        }
        micReady = true;
        logEvent('mic_ready', screen.id, { qid: qid });
        if (gated) { openGate(); return; }
        clearMicBanner();
      });
    }

    /* ── 권한 게이트 ──
     * 이어보기·딥링크(planResume, ?screen=, ?goq=)는 마이크 점검 화면을 지나치지 않고
     * 끊긴 스피킹 문항에 곧장 착지한다. 그 자리에서 마이크를 못 잡았다면 문항을
     * 시작하지 않는다 — 마이크 없는 스피킹 문항은 빈 파일 하나를 남길 뿐이다.
     * 하드웨어 점검 화면과 같은 규칙이다(건너뛰기 없음). 시계를 걸지 않으므로
     * 여기서 서 있는 동안 응답 시간은 1초도 줄지 않는다. */

    var GATE_POLL_MS = 2000;

    /* 지금 손에 살아 있는 마이크가 있는가. exam-recorder 의 liveStream 과 같은 판정이다 —
       트랙이 죽었거나(ended) 다른 앱이 물고 있으면(muted) 없는 것으로 본다. */
    function micHeld() {
      var R = REC();
      if (!R || typeof R.getStream !== 'function') return false;
      var st = R.getStream();
      if (!st) return false;
      if (typeof st.getAudioTracks !== 'function') return true;
      var ts = st.getAudioTracks();
      return !!(ts.length && ts[0].readyState !== 'ended' && ts[0].muted !== true);
    }

    function cancelGatePoll() {
      if (gateTimer !== null && root.clearTimeout) { try { root.clearTimeout(gateTimer); } catch (e) {} }
      gateTimer = null;
    }

    /* 학생이 주소창 자물쇠에서 권한을 푸는 경우, 브라우저는 우리에게 알려 주지 않는다.
       스스로 주기적으로 다시 잡아 봐야 게이트가 열린다. */
    function pollGate() {
      cancelGatePoll();
      if (!root.setTimeout || disposed || !gated) return;
      gateTimer = root.setTimeout(function () {
        gateTimer = null;
        if (disposed || !gated) return;
        if (micHeld()) { micReady = true; openGate(); return; }
        micWarming = false;
        prewarmMic();
        pollGate();
      }, GATE_POLL_MS);
    }

    function showGate() {
      if (gated) return;
      gated = true;
      rbox.hidden = true;
      logEvent('mic_gate', screen.id, { qid: qid });
      setCaption('Microphone required', '마이크가 필요합니다');
      micBanner('This question cannot start until your microphone is on. Select Allow microphone below, then choose "Allow while visiting the site" in the browser prompt. If no prompt appears, select the lock icon in the address bar and allow the microphone. Your response time has not started.',
                '마이크가 켜져야 이 문항이 시작됩니다. 아래 Allow microphone 을 누르고, 브라우저 창에서 "Allow while visiting the site" 를 고르세요. 창이 뜨지 않으면 주소창의 자물쇠 아이콘에서 마이크를 허용하세요. 응답 시간은 아직 시작되지 않았습니다.', 'error');
      setButton('Allow microphone', '마이크 허용', function () { micWarming = false; prewarmMic(); });
      pollGate();
    }

    function openGate() {
      if (!gated) return;
      gated = false;
      cancelGatePoll();
      clearMicBanner();
      btn.hidden = true;
      logEvent('mic_gate_open', screen.id, { qid: qid });
      startPhases();
    }

    function cancelArmWait() {
      if (armWaitTimer !== null && root.clearTimeout) { try { root.clearTimeout(armWaitTimer); } catch (e) {} }
      armWaitTimer = null;
    }

    /* 응답 시계는 마이크가 실제로 열린 뒤에 건다. startRecording 의 재시도(1초 x 5)가
       늦게 성공해도 잃는 시간이 없다. 끝내 못 열면 MIC_WAIT_MAX_MS 뒤에 그냥 걸어
       시험을 계속한다 — 이 문항은 이미 NOT SUBMIT 으로 표시돼 있다. */
    function armWhenMicLive() {
      if (disposed || !pendingArm) return;
      if (recording) {
        clearMicBanner();
        armPhaseClock(pendingArm.index, pendingArm.phase);
        pendingArm = null;
        cancelArmWait();
        paint();
        return;
      }
      if (armWaitedMs >= MIC_WAIT_MAX_MS || !root.setTimeout) {
        logEvent('record_clock_forced', screen.id, { qid: qid, waitedMs: armWaitedMs });
        armPhaseClock(pendingArm.index, pendingArm.phase);
        pendingArm = null;
        cancelArmWait();
        paint();
        return;
      }
      if (armWaitedMs === 0) {
        micBanner('Waiting for the microphone. Your response time starts when it opens — select Allow if your browser asks.',
                  '마이크를 기다리는 중입니다. 마이크가 열려야 응답 시간이 시작됩니다 — 브라우저가 물으면 Allow 를 누르세요.', 'warn');
      }
      cancelArmWait();
      armWaitTimer = root.setTimeout(function () {
        armWaitTimer = null;
        armWaitedMs += MIC_WAIT_STEP_MS;
        armWhenMicLive();
      }, MIC_WAIT_STEP_MS);
    }

    /* ── 녹음 ── */

    /* record phase 진입 → 신호음 → (소리가 끝나면) 마이크 열기 + 응답 시계.
       AudioContext 가 없어 소리가 안 나는 브라우저에서도 순서와 타이밍은 같다 —
       들리느냐만 다르고 시험 진행은 한 갈래로 유지한다. */
    function beepThenRecord() {
      var audible = playBeep();
      logEvent('record_beep', screen.id, { qid: qid, audible: audible });
      function run() {
        beepTimer = null;
        if (disposed) return;
        startRecording();
        armWaitedMs = 0;
        armWhenMicLive();
      }
      if (root.setTimeout) beepTimer = root.setTimeout(run, beepMs());
      else run();
    }

    function cancelBeep() {
      if (beepTimer !== null && root.clearTimeout) { try { root.clearTimeout(beepTimer); } catch (e) {} }
      beepTimer = null;
      pendingArm = null;
    }

    /* 마이크가 한 번 실패했다고 문항을 포기하지 않는다 — 응답 시간이 남아 있는 동안
     * 조용히 다시 연다(권한이 늦게 허용되거나 장치가 잠깐 물린 경우가 대부분이다). */
    var RETRY_MS = 1000, RETRY_MAX = 5;
    var retryTimer = null, retryLeft = RETRY_MAX;

    function cancelRetry() {
      if (retryTimer !== null && root.clearTimeout) { try { root.clearTimeout(retryTimer); } catch (e) {} }
      retryTimer = null;
    }

    function scheduleRetry() {
      if (retryLeft <= 0 || disposed || retryTimer !== null || !root.setTimeout) return;
      retryLeft -= 1;
      retryTimer = root.setTimeout(function () {
        retryTimer = null;
        if (disposed || recording) return;
        startRecording(true);
      }, RETRY_MS);
    }

    function startRecording(isRetry) {
      var R = REC();
      recordFailed = false;
      if (!isRetry) { retryLeft = RETRY_MAX; cancelRetry(); }
      if (!R || !R.isSupported()) {
        recordFailed = true;
        markNotSubmit('unsupported');
        setBanner('Recording is not supported in this browser. This question is marked NOT SUBMIT and the test continues.',
                  '이 브라우저는 녹음을 지원하지 않습니다. 이 문항은 NOT SUBMIT 으로 표시되고 시험은 계속됩니다.', 'error');
        rbox.classList.remove('is-recording');
        return;
      }
      var p = R.start(qid, function (e) {
        if (disposed) return;
        if (e) {
          recordFailed = true;
          recording = false;
          rbox.classList.remove('is-recording');
          markNotSubmit(e.code || 'recorder_error');
          if (retryLeft > 0) {
            setBanner('Microphone did not open — retrying. Keep speaking; allow the microphone if your browser asks.',
                      '마이크가 열리지 않아 다시 시도합니다. 계속 말씀하세요. 브라우저가 물으면 마이크를 허용하세요.', 'error');
            scheduleRetry();
          } else {
            setBanner('Microphone is unavailable (' + (e.code || 'error') + '). This question is marked NOT SUBMIT and the test continues.',
                      '마이크를 사용할 수 없습니다 (' + (e.code || 'error') + '). 이 문항은 NOT SUBMIT 으로 표시되고 시험은 계속됩니다.', 'error');
          }
          logEvent('record_failed', screen.id, { qid: qid, code: e.code || '', retryLeft: retryLeft });
          return;
        }
        cancelRetry();
        micReady = true;
        recording = true;
        recStartedAt = Date.now();
        silentWarned = false;
        rbox.classList.add('is-recording');
        logEvent('record_start', screen.id, { qid: qid, retried: retryLeft < RETRY_MAX });
      });
      if (p && typeof p['catch'] === 'function') p['catch'](function () {});
    }

    function stopRecording() {
      var R = REC();
      // 신호음이 울리는 사이에 phase 가 끝났다면(force·강제전진) 마이크를 열지 않는다.
      cancelBeep();
      cancelRetry();
      if (!R || !recording) { recording = false; recStartedAt = 0; rbox.classList.remove('is-recording'); return; }
      recording = false;
      recStartedAt = 0;
      rbox.classList.remove('is-recording');
      var p = R.stop(function (e, res) {
        if (e) {
          logEvent('record_error', screen.id, { qid: qid, code: e.code || '' });
          markNotSubmit(e.code || 'stop_failed');
          if (!disposed) {
            setBanner('The recording could not be saved. This question is marked NOT SUBMIT.',
                      '녹음을 저장하지 못했습니다. 이 문항은 NOT SUBMIT 으로 표시됩니다.', 'error');
          }
          return;
        }
        logEvent('record_stop', screen.id, { qid: qid, ms: res.durationMs, mime: res.mime,
                                             saved: res.saved, peak: res.peak, silent: res.silent });
        if (!disposed) showPreview(res);
      });
      if (p && typeof p['catch'] === 'function') p['catch'](function () {});
    }

    /* AC6 — 실제 시험처럼 자기 답을 다시 듣지 못한다. 녹음됐다는 사실만 알린다. */
    function showPreview(res) {
      while (review.firstChild) review.removeChild(review.firstChild);
      if (res && res.silent) {
        // 파일은 남았지만 소리가 담기지 않았다. 나중에 "왜 안 들리지" 로 끝나지 않도록 지금 말한다.
        review.appendChild(bi('p', 'The recording was saved, but almost no sound was picked up. Check your microphone before the next question.',
                                 '녹음은 저장되었지만 소리가 거의 잡히지 않았습니다. 다음 문항 전에 마이크를 확인하세요.'));
      } else {
        review.appendChild(bi('p', 'Your response has been recorded. You cannot record again.',
                                 '응답이 녹음되었습니다. 다시 녹음할 수는 없습니다.'));
      }
      review.hidden = false;
    }

    /* ── phase 적용 (분기 없는 단일 루프의 "실행" 절반) ── */

    function applyActions(list) {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a === 'startRecord') beepThenRecord();
        else if (a === 'stopRecord') stopRecording();
        // 'playMedia' 는 안착한 phase 를 그릴 때 처리한다(중간에 건너뛴 phase 는 재생 대상이 아니다).
        // 'screenDone' 은 renderPhase 에서 처리한다.
      }
    }

    function renderPhase() {
      var i = state.phaseIndex;
      btn.hidden = true;
      prepChip.hidden = true;
      rbox.hidden = true;
      if (cueImg) cueImg.hidden = true;
      stage.classList.remove('is-playing');

      if (state.status === 'done') {
        setCaption('Your response time has ended.', '응답 시간이 종료되었습니다.');
        persistCursor();
        autoAdvance();
        return;
      }

      var p = state.phases[i];
      if (!p) return;
      persistCursor();
      logEvent('phase_enter', screen.id, { phaseIndex: i, name: p.name });

      // 이미지 media 는 종료조건이 아니라 표시 자산이다(IELTS Part 2 cue card).
      if (p.media && mediaKind(p.media) === 'image') {
        showCue(srcOf(p.media));
      } else if (cueSpec && cueSpec.image) {
        // cue card 그림은 read/prep/record 내내 남는다(§6.2 AC3).
        showCue(srcOf(cueSpec.image));
      }

      if (p.name === 'read') {
        // 관찰된 문구 그대로. 따옴표는 프레임과 같은 ASCII 아포스트로피(’ 아님).
        setCaption("Please answer the interviewer's questions.", '면접관의 질문에 답하세요.');
        stickyCaption = true;
        if (endCondition(p) === 'button') setButton('Continue', '계속', function () { fire('button'); });
      } else if (p.name === 'listen') {
        /* 인터뷰 지시문이 이미 서 있으면 덮지 않는다 — 관찰(1830s)에서 인터뷰어 영상이 도는
           동안에도 상단 지시문은 그대로다. 그런 지시문이 없는 S1 에서만 청취 안내를 쓴다. */
        if (!stickyCaption) setCaption('Listen carefully. The audio plays only once.', '잘 들으세요. 오디오는 한 번만 재생됩니다.');
      } else if (p.name === 'prompt') {
        setCaption('Read the prompt.', '문제를 읽으세요.');
        stickyCaption = true;
        if (endCondition(p) === 'button') setButton('Continue', '계속', function () { fire('button'); });
      } else if (p.name === 'prep') {
        // 지시문이 이미 서 있으면 덮지 않는다 — "Get ready" 는 prep 칩이 따로 말한다.
        if (!stickyCaption) setCaption('Get ready to speak.', '말할 준비를 하세요.');
        if (p.seconds > 0) { prepChip.hidden = false; }
        /* AC6 — 준비시간 조기 종료. cue card 가 있는 긴 준비시간(IELTS Part 2, 60초)에만
           버튼을 낸다. TOEFL 의 3초 prep 에는 cue 가 없어 버튼이 생기지 않는다(회귀 없음).
           'force' 는 endCondition 과 무관하게 다음 phase(record)로 넘긴다. */
        if (p.cue && p.seconds > 0) {
          setButton('Start speaking now', '지금 말하기 시작', function () { fire('force'); });
        }
      }

      /* record 전 어느 phase 에서든 마이크를 미리 잡아 둔다 — 학생이 뒤늦게 허용해
         주었거나, 앞 문항에서 스트림이 끊겼을 수 있다. 이미 쥐고 있으면 아무 일도
         일어나지 않는다(권한 창을 두 번 띄우지 않는다). */
      if (p.name !== 'record' && recordIndex() >= 0) prewarmMic();

      if (p.name === 'record') {
        /* 관찰(1830s): 녹음 중에도 상단 지시문은 "Please answer the interviewer's questions." 그대로다.
           그래서 read/prompt 가 세운 지시문은 유지하고, 그런 지시문이 없었던 경우
           (S1 Listen and Repeat 처럼 listen → record 로 바로 가는 흐름)에만 안내를 새로 쓴다. */
        if (!stickyCaption) setCaption('Speak into your microphone now.', '지금 마이크에 말하세요.');
        rbox.hidden = false;
      }

      /* record 의 응답 시계는 신호음이 끝난 뒤에 건다(beepThenRecord 가 건다).
         여기서 걸어 버리면 아직 마이크가 열리지도 않은 0.4초가 응답 시간에서 깎인다. */
      if (p.name === 'record' && beepTimer !== null) pendingArm = { index: i, phase: p };
      else if (p.name === 'record' && !recording) {
        // 신호음 없이 곧장 들어온 경로. 여기서도 마이크가 열린 뒤에 시계를 건다.
        pendingArm = { index: i, phase: p };
        armWaitedMs = 0;
        armWhenMicLive();
      } else armPhaseClock(i, p);
      if (isPlayable(p.media)) playPhaseMedia(i, p);
      paint();
    }

    /* 단일 진입점. 모든 종료 이벤트(버튼/미디어/타이머/강제)가 여기로 모인다. */
    function fire(type) {
      if (disposed) return;
      var out = nextPhase(state, { type: type });
      if (!out.changed) return;
      stopAudio();
      state = { phases: out.phases, phaseIndex: out.phaseIndex, status: out.status };
      applyActions(out.actions);
      renderPhase();
    }

    /* ── 새로고침 복구 (§5.4-7) ── */

    function recordIndex() {
      for (var i = 0; i < phases.length; i++) { if (phases[i] && phases[i].name === 'record') return i; }
      return -1;
    }

    function detectInterrupted() {
      var C = CLOCK();
      var ri = recordIndex();
      if (!C || ri < 0) return false;
      // 새로 진입한 화면에는 phase clock 이 존재할 수 없다. 있다면 이전 세션의 잔재다.
      return C.hasClock(phaseKey(screen.id, ri));
    }

    function begin() {
      /* 인터뷰 지시문은 phase 에 안착하지 않고 지나가므로(즉시 통과), 화면에 들어서는
         이 자리에서 세운다. 이후 listen·prep·record 가 덮지 않는다. */
      if (hasStandingRead(phases)) {
        setCaption("Please answer the interviewer's questions.", '면접관의 질문에 답하세요.');
        stickyCaption = true;
      }
      if (detectInterrupted()) {
        var s = STORE();
        var prev = (s && typeof s.getAnswer === 'function') ? s.getAnswer(qid) : null;
        if (prev && prev.recorded) {
          setBanner('This question has already been recorded. You cannot record it again.',
                    '이 문항은 이미 녹음되었습니다. 다시 녹음할 수 없습니다.', 'warn');
        } else {
          markNotSubmit('interrupted');
          setBanner('Your recording was interrupted by a reload. Any partial recording has been kept and this question cannot be recorded again.',
                    '새로고침으로 녹음이 중단되었습니다. 부분 녹음은 보존되며 이 문항은 다시 녹음할 수 없습니다.', 'warn');
          logEvent('record_interrupted', screen.id, { qid: qid });
        }
        state = { phases: phases, phaseIndex: phases.length, status: 'done' };
        advanceMs = ADVANCE_MS_NOTICE;
        renderPhase();
        return;
      }
      /* 아직 record 까지 갈 길이 남아 있을 때 권한 창을 띄운다.
         못 잡으면 문항을 시작하지 않고 게이트에서 기다린다. */
      if (recordIndex() >= 0) {
        if (micHeld()) micReady = true;
        prewarmMic();
        if (!micReady) { showGate(); return; }
      }
      startPhases();
    }

    function startPhases() {
      if (disposed) return;
      var out = nextPhase(state, { type: 'start' });
      state = { phases: out.phases, phaseIndex: out.phaseIndex, status: out.status };
      applyActions(out.actions);
      renderPhase();
    }

    /* ── 수명주기 ── */

    function dispose() {
      if (disposed) return;
      disposed = true;
      stopAudio();
      cancelBeep();
      cancelRetry();
      cancelAdvance();
      cancelArmWait();
      cancelGatePoll();
      var R = REC();
      if (R && R.isRecording()) { try { R.abort(); } catch (e) {} }
      recording = false;
      if (unsubClock) { try { unsubClock(); } catch (e) {} unsubClock = null; }
      if (unsubTx) { try { unsubTx(); } catch (e) {} unsubTx = null; }
      if (rafId !== null && root.cancelAnimationFrame) { root.cancelAnimationFrame(rafId); rafId = null; }
      var C = CLOCK();
      if (C) { for (var i = 0; i < armedKeys.length; i++) { try { C.clearClock(armedKeys[i]); } catch (e) {} } }
      armedKeys = [];
    }

    var C0 = CLOCK();
    if (C0 && typeof C0.subscribe === 'function') unsubClock = C0.subscribe(function () { paint(); });
    if (engine && typeof engine.onTransition === 'function') {
      unsubTx = engine.onTransition(function () {
        var cur = engine.current();
        if (!cur || cur.id !== screen.id) dispose();
      });
    }
    if (root.requestAnimationFrame) rafId = root.requestAnimationFrame(pumpMeter);

    return { node: box, start: begin, dispose: dispose, screenId: screen.id,
             phaseIndex: function () { return state.phaseIndex; },
             status: function () { return state.status; } };
  }

  function renderSpeaking(screen, ctx) {
    if (!doc || !screen) return null;
    if (active && typeof active.dispose === 'function') { try { active.dispose(); } catch (e) {} }
    active = null;
    var inst = build(screen, ctx || {});
    active = inst;
    // SG_RENDER.render() 가 반환 노드를 마운트에 붙인 "뒤" 첫 phase 를 시작해야
    // 자동재생·포커스가 문서에 붙은 상태에서 일어난다.
    if (root.setTimeout) root.setTimeout(function () { if (active === inst) inst.start(); }, 0);
    else inst.start();
    return inst.node;
  }

  if (root.SG_RENDER && typeof root.SG_RENDER.register === 'function') {
    root.SG_RENDER.register('speaking', renderSpeaking);
  }

  root.SG_SPEAKING = {
    // 순수 (node 검증 대상)
    endCondition: endCondition,
    firstCue: firstCue,
    isPlayable: isPlayable,
    mediaKind: mediaKind,
    nextPhase: nextPhase,
    initialState: initialState,
    beepMs: beepMs,
    BEEP_HZ: BEEP_HZ,
    BEEP_SEC: BEEP_SEC,
    // 렌더
    render: renderSpeaking,
    phaseKey: phaseKey,
    active: function () { return active; }
  };
})(typeof window !== 'undefined' ? window : this);
