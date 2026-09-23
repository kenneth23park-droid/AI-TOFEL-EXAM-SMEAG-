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

    /* ── DOM 골격 ── */
    var box = el('div', 'speaking-screen');

    var head = el('div', 'speaking-head');
    var prog = el('span', 'speaking-progress');
    if (screen.progress) {
      prog.appendChild(bi('span',
        'Question ' + screen.progress.index + ' of ' + screen.progress.total,
        screen.progress.index + '번 / 전체 ' + screen.progress.total + '문항'));
    }
    head.appendChild(prog);
    box.appendChild(head);

    var banner = el('div', 'speaking-banner');
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    box.appendChild(banner);

    var stage = el('div', 'speaking-stage');
    var portrait = null;
    if (screen.image && srcOf(screen.image)) {
      portrait = el('img', 'speaking-portrait');
      portrait.src = srcOf(screen.image);
      portrait.alt = '';
      stage.appendChild(portrait);
    }
    var caption = el('div', 'speaking-caption');
    stage.appendChild(caption);
    box.appendChild(stage);

    var cueImg = el('img', 'speaking-cue');   // IELTS Part 2 cue card (phase.media.kind==='image')
    cueImg.alt = '';
    cueImg.hidden = true;
    box.appendChild(cueImg);

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
    var rlabel = el('span', 'response-label');
    rlabel.appendChild(bi('span', '🎤 Response Time', '🎤 응답 시간'));
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
       (a) settle() 은 0-length phase 를 여러 개 한 번에 건너뛸 수 있고,
       (b) AC6 은 마지막 phase 뒤에 "미리듣기 + Next 만" 남기라고 요구한다.
       그래서 phase 커서는 SG_STORE.saveCursor 로 직접 남기고, 화면 전진은
       응시자의 Next(engine.next('manual')) 로만 일으킨다. localStorage 직접 접근은 없다. */

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
      if (p.name === 'record') rtime.textContent = fmt(remainingOf(i), 'HH:MM:SS');
      else if (p.name === 'prep' && p.seconds > 0) prepTime.textContent = fmt(remainingOf(i), 'MM:SS');
    }

    function pumpMeter() {
      if (disposed) return;
      var R = REC();
      var lv = (recording && R && typeof R.level === 'function') ? R.level() : 0;
      meterFill.style.width = Math.round(lv * 100) + '%';
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

    /* ── 녹음 ── */

    function startRecording() {
      var R = REC();
      recordFailed = false;
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
          setBanner('Microphone is unavailable (' + (e.code || 'error') + '). This question is marked NOT SUBMIT and the test continues.',
                    '마이크를 사용할 수 없습니다 (' + (e.code || 'error') + '). 이 문항은 NOT SUBMIT 으로 표시되고 시험은 계속됩니다.', 'error');
          logEvent('record_failed', screen.id, { qid: qid, code: e.code || '' });
          return;
        }
        recording = true;
        rbox.classList.add('is-recording');
        logEvent('record_start', screen.id, { qid: qid });
      });
      if (p && typeof p['catch'] === 'function') p['catch'](function () {});
    }

    function stopRecording() {
      var R = REC();
      if (!R || !recording) { recording = false; rbox.classList.remove('is-recording'); return; }
      recording = false;
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
        logEvent('record_stop', screen.id, { qid: qid, ms: res.durationMs, mime: res.mime, saved: res.saved });
        if (!disposed) showPreview(res);
      });
      if (p && typeof p['catch'] === 'function') p['catch'](function () {});
    }

    /* AC6 — 미리듣기는 제공하되 재녹음은 불가(timing.allowRerecord 기본 false). */
    function showPreview(res) {
      while (review.firstChild) review.removeChild(review.firstChild);
      review.appendChild(bi('p', 'Your response has been recorded. You cannot record again.',
                               '응답이 녹음되었습니다. 다시 녹음할 수는 없습니다.'));
      if (res && res.blob && root.URL && root.URL.createObjectURL) {
        var a = doc.createElement('audio');
        a.controls = true;
        a.className = 'speaking-preview';
        try { a.src = root.URL.createObjectURL(res.blob); } catch (e) {}
        a.volume = volume();
        review.appendChild(a);
      }
      review.hidden = false;
    }

    /* ── phase 적용 (분기 없는 단일 루프의 "실행" 절반) ── */

    function applyActions(list) {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a === 'startRecord') startRecording();
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
      cueImg.hidden = true;
      stage.classList.remove('is-playing');

      if (state.status === 'done') {
        setCaption('Your response time has ended.', '응답 시간이 종료되었습니다.');
        setButton('Next', '다음', function () {
          if (engine && typeof engine.next === 'function') engine.next('manual');
        });
        persistCursor();
        return;
      }

      var p = state.phases[i];
      if (!p) return;
      persistCursor();
      logEvent('phase_enter', screen.id, { phaseIndex: i, name: p.name });

      // 이미지 media 는 종료조건이 아니라 표시 자산이다(IELTS Part 2 cue card).
      if (p.media && mediaKind(p.media) === 'image') {
        cueImg.src = srcOf(p.media);
        cueImg.hidden = false;
      } else if (cueSpec && cueSpec.image) {
        // cue card 그림은 read/prep/record 내내 남는다(§6.2 AC3).
        cueImg.src = srcOf(cueSpec.image);
        cueImg.hidden = false;
      }

      if (p.name === 'read') {
        setCaption('Please answer the interviewer’s questions.', '면접관의 질문에 답하세요.');
        if (endCondition(p) === 'button') setButton('Continue', '계속', function () { fire('button'); });
      } else if (p.name === 'listen') {
        setCaption('Listen carefully. The audio plays only once.', '잘 들으세요. 오디오는 한 번만 재생됩니다.');
      } else if (p.name === 'prompt') {
        setCaption('Read the prompt.', '문제를 읽으세요.');
        if (endCondition(p) === 'button') setButton('Continue', '계속', function () { fire('button'); });
      } else if (p.name === 'prep') {
        setCaption('Get ready to speak.', '말할 준비를 하세요.');
        if (p.seconds > 0) { prepChip.hidden = false; }
        /* AC6 — 준비시간 조기 종료. cue card 가 있는 긴 준비시간(IELTS Part 2, 60초)에만
           버튼을 낸다. TOEFL 의 3초 prep 에는 cue 가 없어 버튼이 생기지 않는다(회귀 없음).
           'force' 는 endCondition 과 무관하게 다음 phase(record)로 넘긴다. */
        if (p.cue && p.seconds > 0) {
          setButton('Start speaking now', '지금 말하기 시작', function () { fire('force'); });
        }
      } else if (p.name === 'record') {
        setCaption('Speak into your microphone now.', '지금 마이크에 말하세요.');
        rbox.hidden = false;
      }

      armPhaseClock(i, p);
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
        renderPhase();
        return;
      }
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
    // 렌더
    render: renderSpeaking,
    phaseKey: phaseKey,
    active: function () { return active; }
  };
})(typeof window !== 'undefined' ? window : this);
