/* SMEAG · StudyGround 2.0 — exam-compile.js
 * 목적: 콘텐츠 팩(window.SMEAG_SET1) + 타이밍 config → TestScreen[] 시퀀스로 컴파일.
 * 의존 전역: window.SG_TYPES (makeScreen/validateScreen), window.SG_MEDIA (resolveMedia)
 * 노출 전역: window.SG_COMPILE
 *
 * 계약 (architecture.md 4.1):
 *  - 순수 함수. Math.random()/Date.now()/DOM/네트워크 접근 없음 → 재컴파일해도 같은 id 가 나온다.
 *  - 입력을 변형하지 않는다. set1.js 는 read-only.
 *  - 섹션 순서는 timing.sectionOrder 를 따르고 set.sections[] 배열 순서는 무시한다.
 *  - 모든 초 단위 값은 config 에서 온다(F11). set1.js 의 timeLimitSec/prepSec/respondSec 은 읽지 않는다.
 *  - 실패는 throw 가 아니라 warnings[] 다 — 오프라인에서 시험이 멈추면 안 된다(F12).
 *
 * id 규칙: "{section}.{kind}.{moduleId}.{seq}"  예) listening.q.L1.03 · listening.audio.L1.02
 *          seq 는 kind 별로 따로 매긴다 — audio 화면이 끼어들어도 .q. 번호는 밀리지 않는다.
 *          합성 화면 3종만 고정 id: intro.volume · speaking.hardware · review.submit
 *
 * progress 계약 (2026-08-07 실측 반영):
 *   { first, last, total, style:"single"|"range", index }
 *   서브바 좌측 표기가 섹션마다 다르다 — Listening/Speaking 은 "Question 25 of 32"(단일),
 *   Reading 은 "Questions 1-10 of 35"(범위). 한 화면이 담는 문항이 2개 이상이면 range 다.
 *   total 은 언제나 **섹션 전체 문항 수**. index 는 구 렌더러 호환용으로 first 와 같다.
 */
(function () {
  'use strict';

  var DEFAULT_ORDER = ['listening', 'speaking', 'reading', 'writing'];

  /* 합성 화면의 고정 id (config directions[].id → screen id). */
  var FIXED_ID = { adjustVolume: 'intro.volume', adjustMic: 'intro.microphone',
                   hardwareCheck: 'speaking.hardware', submitConfirm: 'review.submit' };

  /* 안내 화면 문구. EN 기본 / KO 토글 (F5 — 한국어 하드코딩 금지가 아니라 EN·KO 동시 작성). */
  var DIR_COPY = {
    adjustVolume: {
      bodyEn: 'Use the volume control to set a comfortable listening level. You may adjust the volume at any time during the test.',
      bodyKo: '볼륨 조절 버튼으로 편안한 음량을 설정하세요. 시험 중에는 언제든지 볼륨을 조절할 수 있습니다.'
    },
    adjustMic: {
      // 문구는 렌더러가 레퍼런스대로 그린다. 본문은 비워 두고 제목만 config 의 label 을 쓴다.
      bodyEn: '',
      bodyKo: ''
    },
    listeningDirections: {
      bodyEn: 'In this section you will listen to short responses, conversations, announcements and academic talks. Each audio plays once. Answer each question before the time for that question runs out.',
      bodyKo: '이 섹션에서는 단문 응답, 대화, 공지, 학술 강의를 듣습니다. 오디오는 한 번만 재생됩니다. 각 문항의 제한 시간이 끝나기 전에 답하세요.'
    },
    speakingDirections: {
      bodyEn: 'In this section you will speak into your microphone. Your responses are recorded. You will hear or read a prompt, get a short preparation time, and then speak until the response time ends.',
      bodyKo: '이 섹션에서는 마이크에 말합니다. 응답은 녹음됩니다. 문제를 듣거나 읽은 뒤 짧은 준비 시간이 주어지며, 응답 시간이 끝날 때까지 말하면 됩니다.'
    },
    readingDirections: {
      bodyEn: 'In this section you will read passages, messages and short texts, and answer the questions that follow. You may move between questions within a module while time remains.',
      bodyKo: '이 섹션에서는 지문, 메시지, 짧은 글을 읽고 이어지는 문항에 답합니다. 모듈 시간이 남아 있는 동안 문항 사이를 이동할 수 있습니다.'
    },
    writingDirections: {
      bodyEn: 'In this section you will build sentences and write an email and an academic discussion response. Each task has its own time limit.',
      bodyKo: '이 섹션에서는 문장을 만들고, 이메일과 학술 토론 응답을 작성합니다. 각 과제마다 제한 시간이 따로 있습니다.'
    },
    hardwareCheck: {
      bodyEn: 'Test your microphone and speakers before the Speaking section begins. Speak at your normal volume and confirm that the level meter responds.',
      bodyKo: '스피킹 섹션 시작 전에 마이크와 스피커를 점검하세요. 평소 목소리로 말하고 레벨 미터가 반응하는지 확인하세요.'
    },
    submitConfirm: {
      bodyEn: 'Review your answers and submit the test. You cannot change your answers after submitting.',
      bodyKo: '답안을 확인한 뒤 시험을 제출하세요. 제출 후에는 답안을 변경할 수 없습니다.'
    }
  };

  var CTA = {
    begin: { en: 'Begin', ko: '시작' },
    continue: { en: 'Continue', ko: '계속' },
    submit: { en: 'Submit', ko: '제출' }
  };

  var SECTION_LABEL_KO = { listening: '리스닝', speaking: '스피킹', reading: '리딩', writing: '라이팅' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isArr(v) { return v instanceof Array; }
  function isNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  /* --- config 접근 (없으면 null, throw 금지) -------------------------------- */

  function secCfgOf(cfg, id) { return (cfg && cfg.sections && cfg.sections[id]) || null; }

  function unitCfgOf(secCfg, unitId) {
    var lists = [secCfg && secCfg.modules, secCfg && secCfg.tasks], i, j;
    for (i = 0; i < lists.length; i++) {
      if (!isArr(lists[i])) continue;
      for (j = 0; j < lists[i].length; j++) { if (lists[i][j].id === unitId) return lists[i][j]; }
    }
    return null;
  }

  function dirCfgOf(cfg, id) {
    var d = (cfg && cfg.directions) || [];
    for (var i = 0; i < d.length; i++) { if (d[i].id === id) return d[i]; }
    return null;
  }

  function pick() { // 첫 번째 non-null/undefined 인자
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== null && arguments[i] !== undefined) return arguments[i];
    }
    return null;
  }

  /* --- MediaSpec 생성 (리맵은 SG_MEDIA 한 곳에서만 — C3) --------------------- */

  function mediaOf(raw, maxPlays, warnings, where) {
    if (!raw) return undefined;
    if (!window.SG_MEDIA.isMapped(raw)) {
      warnings.push('unmapped media path at ' + where + ': ' + raw);
    }
    return {
      src: window.SG_MEDIA.resolveMedia(raw),
      srcRaw: raw,
      kind: window.SG_MEDIA.kindOf(raw) || undefined,
      maxPlays: isNum(maxPlays) ? maxPlays : 1
    };
  }

  /* --- cue card (IELTS Speaking Part 2) ------------------------------------
   * 콘텐츠의 q.cueCard 를 phase.cue 로 정규화한다. 형태:
   *   { topicEn, topicKo, bullets:[..], bulletsKo:[..], image:'경로' }
   * TOEFL 콘텐츠에는 이 필드가 없어 항상 null 을 돌려준다(경로 자체가 실행되지 않는다). */
  function cueOf(raw, warnings, where) {
    if (!raw || typeof raw !== 'object') return undefined;
    var cue = {
      topicEn: String(raw.topicEn || raw.topic || ''),
      topicKo: String(raw.topicKo || raw.topicEn || raw.topic || ''),
      bullets: isArr(raw.bullets) ? raw.bullets.slice(0) : [],
      bulletsKo: isArr(raw.bulletsKo) ? raw.bulletsKo.slice(0) : []
    };
    var img = raw.image ? mediaOf(raw.image, 1, warnings, where + '/cue') : undefined;
    if (img) cue.image = img;
    return cue;
  }

  /* --- 타이머 -------------------------------------------------------------- */

  /* 한 문제 화면에 걸리는 clock 들을 좁은 scope → 넓은 scope 순으로 만든다(§3.5).
   * timer(표시용) = clocks[0], 나머지는 timers[] 로 넘겨 엔진의 clocks 맵이 공존시킨다. */
  function buildClocks(cfg, secCfg, unit) {
    var fmt = pick(secCfg.timerFormat, cfg.defaults && cfg.defaults.timerFormat, 'MM:SS');
    var onExpire = pick(unit && unit.onExpire, secCfg.onExpire, cfg.defaults && cfg.defaults.onExpire, 'autoAdvance');
    var scope = pick(secCfg.timerScope, cfg.defaults && cfg.defaults.timerScope, 'module');
    var out = [];

    var perQ = pick(unit && unit.perQuestionSec, secCfg.fallbackPerQuestionSec);
    if (scope === 'question' && isNum(perQ)) {
      out.push({ mode: 'countdown', scope: 'question', seconds: perQ, format: fmt, onExpire: onExpire, visible: true });
    }
    if (unit && isNum(unit.allocatedSec)) {
      out.push({ mode: 'countdown', scope: 'module', seconds: unit.allocatedSec, format: fmt, onExpire: onExpire, visible: true, sharedDeadline: true });
    }
    if (unit && isNum(unit.perTaskSec)) {
      out.push({ mode: 'countdown', scope: 'task', seconds: unit.perTaskSec, format: fmt, onExpire: onExpire, visible: true, sharedDeadline: true });
    }
    if (isNum(secCfg.sectionSec)) {
      /* 섹션 시계는 더 좁은 시계가 있을 때만 숨긴다.
       * TOEFL reading 은 module 시계가 있으므로 종전과 같이 visible:false 다(회귀 없음).
       * IELTS reading/listening 은 섹션 시계가 유일하므로 이것이 표시 시계가 된다
       *  — Reading 3지문 60분 단일 카운트다운(§6). */
      out.push({ mode: 'countdown', scope: 'section', seconds: secCfg.sectionSec, format: fmt, onExpire: onExpire, visible: out.length === 0, sharedDeadline: true });
    }
    return out;
  }

  /* --- 합성(안내) 화면 ------------------------------------------------------ */

  function ctaOf(controls) {
    var c = isArr(controls) ? controls : [];
    for (var i = c.length - 1; i >= 0; i--) { if (CTA[c[i]]) return CTA[c[i]]; }
    return CTA.continue;
  }

  function directionScreen(cfg, dir, sectionId) {
    var id = FIXED_ID[dir.id] || (sectionId + '.directions');
    var copyRow = DIR_COPY[dir.id] || {};
    var cta = ctaOf(dir.controls);
    var timer = null;
    if (isNum(dir.maxSec) && dir.screenType !== 'instruction') {
      // instruction 은 계약상 timer===null (Story 1.2 AC3-a). 상한은 hardwareCheck/moduleEnd 에만.
      timer = { mode: 'countdown', scope: 'screen', seconds: dir.maxSec, format: 'MM:SS', onExpire: 'autoAdvance', visible: false };
    }
    return window.SG_TYPES.makeScreen({
      id: id,
      screenType: dir.screenType,
      section: sectionId,
      timer: timer,
      timers: timer ? [timer] : undefined,
      advance: pick(dir.advance, cfg.defaults && cfg.defaults.advance, 'manual'),
      controls: isArr(dir.controls) ? dir.controls.slice(0) : undefined,
      copy: {
        titleEn: dir.label,
        titleKo: dir.labelKo || dir.label,
        bodyEn: copyRow.bodyEn || '',
        bodyKo: copyRow.bodyKo || '',
        ctaEn: cta.en,
        ctaKo: cta.ko
      }
    });
  }

  /* moduleEnd / taskEnd. 문구는 AC4: "Your time for {label} has ended." */
  function moduleEndScreen(cfg, dir, sectionId, moduleId, moduleIndex, moduleLabel) {
    var timer = isNum(dir.maxSec)
      ? { mode: 'countdown', scope: 'screen', seconds: dir.maxSec, format: 'MM:SS', onExpire: 'autoAdvance', visible: false }
      : null;
    var cta = ctaOf(dir.controls);
    return window.SG_TYPES.makeScreen({
      id: sectionId + '.moduleEnd.' + moduleId,
      screenType: 'moduleEnd',
      section: sectionId,
      module: moduleIndex,
      moduleId: moduleId,
      timer: timer,
      timers: timer ? [timer] : undefined,
      advance: pick(dir.advance, 'manual'),
      controls: isArr(dir.controls) ? dir.controls.slice(0) : undefined,
      copy: {
        titleEn: dir.label,
        titleKo: dir.labelKo || dir.label,
        bodyEn: 'Your time for ' + moduleLabel + ' has ended.',
        bodyKo: moduleLabel + ' 시간이 종료되었습니다.',
        ctaEn: cta.en,
        ctaKo: cta.ko
      }
    });
  }

  /* --- 섹션 phase 화면 (IELTS transfer time) --------------------------------
   * config 의 sections.<id>.phases[] 항목 하나 = 화면 하나.
   * 현재 유일한 사용처는 IELTS Listening 의 transfer time(10분)이다.
   * TOEFL 의 모든 섹션은 phases:[] 이므로 이 경로가 실행되지 않는다(회귀 없음).
   *
   * 화면 계약: instruction 은 timer===null 이어야 하므로(exam-types.js AC3-a)
   * config 의 screenType 이 'instruction' 이어도 **moduleEnd** 로 컴파일한다.
   * transfer:{enabled,editable} 가 붙으면 instruction 렌더러의 moduleEnd 분기가
   * 이전 답안 편집 패널을 그린다(§3.4). */
  function sectionPhaseScreen(cfg, secCfg, ph, sectionId, targetIds) {
    var fmt = pick(secCfg.timerFormat, cfg.defaults && cfg.defaults.timerFormat, 'MM:SS');
    if (fmt !== 'MM:SS' && fmt !== 'HH:MM:SS') fmt = 'MM:SS';
    var timer = {
      mode: 'countdown', scope: 'screen', seconds: ph.seconds, format: fmt,
      onExpire: pick(ph.onExpire, 'autoAdvance'), visible: true
    };
    var mins = Math.round(ph.seconds / 60);
    return window.SG_TYPES.makeScreen({
      id: sectionId + '.transfer.' + ph.id,
      screenType: 'moduleEnd',
      section: sectionId,
      timer: timer,
      timers: [timer],
      advance: pick(ph.advance, cfg.defaults && cfg.defaults.advance, 'manual'),
      controls: ['finishEarly'],
      transfer: { enabled: true, editable: true, targetScreenIds: targetIds.slice(0) },
      copy: {
        titleEn: ph.label || 'Transfer your answers',
        titleKo: ph.labelKo || '답안 옮겨 적기',
        bodyEn: 'You have ' + mins + ' minutes to check and transfer your answers. No audio is played during this time.',
        bodyKo: '답안을 확인하고 옮겨 적을 시간 ' + mins + '분이 주어집니다. 이 시간에는 오디오가 재생되지 않습니다.',
        ctaEn: 'Finish early',
        ctaKo: '조기 종료'
      }
    });
  }

  /* --- block.kind → 화면들 (architecture.md 4.2 매핑표 7종) ------------------ */

  function qIds(block) {
    var out = [], qs = isArr(block.questions) ? block.questions : [];
    for (var i = 0; i < qs.length; i++) out.push(qs[i].id);
    return out;
  }

  /* 블록 1개 = 화면 1개 (cloze / passage / chat / free-write) */
  function singleScreenBlock(ctx, block) {
    return [ctx.mk({
      blockKind: block.kind,
      questionIds: qIds(block),
      questionCount: (block.questions || []).length,
      advance: 'manual',
      allowBack: true
    })];
  }

  /* 문항 1개 = 화면 1개 (build-set: writing W1 드래그 배열 10문항) */
  function perQuestionBlock(ctx, block) {
    var out = [], qs = block.questions || [];
    for (var i = 0; i < qs.length; i++) {
      out.push(ctx.mk({
        blockKind: block.kind,
        questionIds: [qs[i].id],
        questionCount: 1,
        advance: 'manual',
        allowBack: true
      }));
    }
    return out;
  }

  /* audio-set 2종 (4.2):
   *  perQuestionAudio:true  → 문항마다 오디오+삽화
   *  블록 오디오            → 오디오는 블록 첫 화면에만(1회 재생), 삽화는 블록 내내 유지
   *
   * ── 오디오 화면 / 답변 화면 분리 (2026-08-07 실측) ─────────────────────────
   * 녹화 700s 프레임(docs/reference/screens/listening-audio-700s.png)은
   *   'Listening | Question 25 of 32' + 화자 사진 + 'Listen to an academic talk.'
   * 만 있고 **선택지도 타이머도 없다**. 900s 프레임(listening-question-900s.png)은
   * 같은 서브바에 선택지 4개 + 타이머 00:13 이 있다. 즉 StudyGround 는 오디오 재생과
   * 답변을 별개 화면으로 다룬다. 따라서 오디오가 붙는 자리마다 blockKind 'audio-play'
   * 화면(타이머 null · advance auto)을 만들고, 답변 화면에는 오디오를 싣지 않는다.
   *
   * audio-play 화면은 questionIds 를 갖지 않는다 — 가지면 buildIndex 의
   * byQuestionId 가 중복되어 'duplicate question id across screens' 경고가 난다.
   * 대신 progress 만 다음 문항 번호로 채워 서브바 표기를 유지한다(실측 프레임과 동일).
   *
   * 분리 조건은 secCfg.timerScope === 'question' 이다. 문항마다 답변 시계가 따로 도는
   * 시험에서만 "듣기 → 답하기" 가 물리적으로 분리되기 때문이다. IELTS Listening 은
   * timerScope 가 'section' 이고 30분 단일 시계 아래 **들으면서 답하는** 구조라 분리하지
   * 않는다 → 출력 무변경.
   *
   * ── 분리 해제 (2026-08-10 spec) ────────────────────────────────────────────
   * secCfg.audioOnQuestionScreen 이 true 면 위 분리를 끈다(TOEFL). 사진과 선택지가
   * 함께 있는 한 화면에서 오디오가 재생되어야 한다는 발주처 요구다 — 근거는
   * config/timing.toefl.json provenance "sections.listening.audioOnQuestionScreen".
   * 이때 답변 시계는 화면 진입이 아니라 **오디오가 끝난 뒤** 시작해야 하므로
   * 화면에 timerStartsOnAudioEnd:true 를 달아 엔진에 알린다(exam-engine.js armScreenClocks). */
  function audioSetBlock(ctx, block) {
    var out = [], qs = block.questions || [], i;
    var maxPlays = pick(ctx.secCfg.audio && ctx.secCfg.audio.maxPlays, ctx.cfg.defaults && ctx.cfg.defaults.audioMaxPlays, 1);
    var autoPlay = !!(ctx.secCfg.audio && ctx.secCfg.audio.autoPlay);
    var splitAudio = pick(ctx.secCfg.timerScope, ctx.cfg.defaults && ctx.cfg.defaults.timerScope) === 'question'
      && !ctx.secCfg.audioOnQuestionScreen;
    for (i = 0; i < qs.length; i++) {
      var q = qs[i];
      var where = ctx.sectionId + '/' + ctx.moduleId + '/' + q.id;
      var rawAudio = block.perQuestionAudio ? q.audio : (i === 0 ? block.audio : null);
      var rawImage = block.perQuestionAudio ? q.image : block.image;
      var image = mediaOf(rawImage, 1, ctx.warnings, where);
      var audio = mediaOf(rawAudio, maxPlays, ctx.warnings, where);
      if (audio) audio.autoplay = autoPlay;
      if (audio && splitAudio) {
        out.push(ctx.mk({
          kind: 'audio',
          blockKind: 'audio-play',
          questionCount: 0,
          advance: 'auto',
          allowBack: false,
          timer: null,
          audio: audio,
          image: image,
          copy: {
            titleEn: block.heading || 'Listen to the audio.',
            titleKo: block.headingKo || block.heading || '오디오를 들으세요.',
            bodyEn: 'Listen carefully to the audio.',
            bodyKo: '오디오를 주의 깊게 들으세요.'
          }
        }));
      }
      out.push(ctx.mk({
        blockKind: block.kind,
        questionIds: [q.id],
        questionCount: 1,
        advance: 'auto',
        allowBack: false,
        audio: splitAudio ? undefined : audio,
        image: image,
        timerStartsOnAudioEnd: (audio && !splitAudio && ctx.secCfg.audioOnQuestionScreen) ? true : undefined
      }));
    }
    return out;
  }

  /* record-set (speaking): introAudio → instruction 화면 1개 + 문항마다 speaking 화면 */
  function recordSetBlock(ctx, block) {
    var out = [], qs = block.questions || [], i;
    var tt = null;
    var typeId = ctx.unitCfg && ctx.unitCfg.taskType;
    if (typeId && ctx.secCfg.taskTypes) tt = ctx.secCfg.taskTypes[typeId] || null;
    if (!tt) {
      ctx.warnings.push('no taskType config for ' + ctx.sectionId + '.' + ctx.moduleId + ' (taskType=' + typeId + '); speaking timings degrade to 0s');
      tt = { prepSec: 0, responseSec: 0, listenReplays: 1, promptSelfPaced: false, onExpire: 'stopRecord' };
    }
    var fmt = pick(ctx.secCfg.timerFormat, 'HH:MM:SS');
    /* record phase 를 가진 speaking 화면은 계약상 HH:MM:SS 여야 한다(exam-types.js AC4).
     * IELTS config 의 speaking.timerFormat 은 'MM:SS' 라 그대로 쓰면 전 화면이
     * validateScreen 위반으로 degrade(타이머 제거)된다 — 여기서 교정하고 경고만 남긴다.
     * TOEFL 은 이미 HH:MM:SS 이므로 이 분기를 타지 않는다(출력 무변경). */
    if (fmt !== 'HH:MM:SS') {
      ctx.warnings.push('speaking timerFormat "' + fmt + '" is not allowed on record screens; using HH:MM:SS');
      fmt = 'HH:MM:SS';
    }
    var onExpire = pick(tt.onExpire, ctx.secCfg.onExpire, 'stopRecord');

    /* 문항별 답변 시간. TOEFL Speaking Task 1(listenAndRepeat)은 문장마다 시간이 다르다 —
     * 1~2번 8초 / 3~5번 10초 / 6~7번 12초 (최종수정사항.docx). config 의
     * taskTypes.<t>.responseSecByIndex[] 가 있으면 그 인덱스를 쓰고, 범위를 넘어가면
     * responseSec 로 떨어진다. byIndex 가 없는 taskType(interview·IELTS)은 종전과 동일. */
    var byIndex = (tt.responseSecByIndex && tt.responseSecByIndex.length) ? tt.responseSecByIndex : null;
    function responseSecAt(index) {
      if (byIndex && typeof byIndex[index] === 'number') return byIndex[index];
      return pick(tt.responseSec, 0);
    }

    if (block.introAudio) {
      out.push(window.SG_TYPES.makeScreen({
        id: ctx.sectionId + '.intro.' + ctx.moduleId,
        screenType: 'instruction',
        section: ctx.sectionId,
        module: ctx.moduleIndex,
        moduleId: ctx.moduleId,
        blockKind: block.kind,
        timer: null,
        advance: 'manual', // introAudioSelfPaced:true — 안내 오디오를 듣고 응시자가 시작한다
        audio: mediaOf(block.introAudio, 1, ctx.warnings, ctx.sectionId + '/' + ctx.moduleId + '/intro'),
        copy: {
          titleEn: block.heading || (ctx.moduleLabel + ' Directions'),
          titleKo: ctx.moduleLabel + ' 안내',
          bodyEn: block.instruction || '',
          bodyKo: '',
          ctaEn: CTA.begin.en,
          ctaKo: CTA.begin.ko
        }
      }));
    }

    for (i = 0; i < qs.length; i++) {
      var q = qs[i];
      var where = ctx.sectionId + '/' + ctx.moduleId + '/' + q.id;
      var phases = [];
      /* cue card 는 콘텐츠에서 온다(IELTS Part 2). TOEFL 문항에는 q.cueCard 가 없으므로
       * 아래 분기가 전혀 실행되지 않는다 — TOEFL phases 출력은 종전과 바이트 단위로 같다. */
      var cue = cueOf(q.cueCard, ctx.warnings, where);
      // §3.3: TOEFL 도 항상 prep phase 를 갖는다. seconds:0 인 phase 는 엔진이 즉시 통과시킨다.
      if (tt.promptSelfPaced) phases.push({ name: 'read', seconds: 0, selfPaced: true });
      else if (cue) phases.push({ name: 'read', seconds: 0, selfPaced: true, cue: cue });
      var listenMedia = mediaOf(q.audio, tt.listenReplays, ctx.warnings, where);
      if (listenMedia) phases.push({ name: 'listen', seconds: 0, media: listenMedia });
      var prepPhase = { name: 'prep', seconds: pick(tt.prepSec, 0), onExpire: 'startRecord' };
      if (cue) prepPhase.cue = cue;
      phases.push(prepPhase);
      var respondSec = responseSecAt(i);
      phases.push({ name: 'record', seconds: respondSec, onExpire: onExpire });

      var timer = {
        mode: 'response', scope: 'screen', seconds: respondSec,
        format: fmt, onExpire: onExpire, visible: true
      };
      out.push(ctx.mk({
        screenType: 'speaking',
        blockKind: block.kind,
        questionIds: [q.id],
        questionCount: 1,
        advance: 'auto',
        allowBack: false,
        timer: timer,
        timers: [timer],
        phases: phases,
        image: mediaOf(q.image, 1, ctx.warnings, where)
      }));
    }
    return out;
  }

  var BLOCK_COMPILERS = {
    cloze: singleScreenBlock,
    passage: singleScreenBlock,
    chat: singleScreenBlock,
    'free-write': singleScreenBlock,
    'build-set': perQuestionBlock,
    'audio-set': audioSetBlock,
    'record-set': recordSetBlock
  };

  /* --- 메인 --------------------------------------------------------------- */

  /**
   * @param {Object} set    window.SMEAG_SET1 형태의 콘텐츠 팩 (read-only)
   * @param {Object} timing config/timing.<exam>.json 파싱 결과
   * @param {Object} [opts] { profile:'toefl'|'ielts', lang:'en'|'ko' }
   * @returns {{screens: Array, index: Object, warnings: string[]}}
   */
  function compileScreens(set, timing, opts) {
    opts = opts || {};
    var warnings = [];
    var screens = [];
    var cfg = timing || (window.SG_TIMING && window.SG_TIMING.FALLBACK) || null;

    if (!cfg) { warnings.push('no timing config; nothing compiled'); return { screens: [], index: emptyIndex(), warnings: warnings }; }
    if (!set || !isArr(set.sections)) { warnings.push('no content pack; nothing compiled'); return { screens: [], index: emptyIndex(), warnings: warnings }; }

    /* 문항별 제한시간 오버라이드(assets/question-config.js 가 문항 객체에 실어 둔
       timeLimitSec)를 화면 조립 때 꺼내 쓰기 위한 인덱스다. 오버라이드가 없으면
       이 맵은 그냥 쓰이지 않는다 — 기존 타이밍 계산은 한 글자도 바뀌지 않는다. */
    var qById = {};
    for (var qs_i = 0; qs_i < set.sections.length; qs_i++) {
      var qs_sec = set.sections[qs_i], qs_mods = isArr(qs_sec.modules) ? qs_sec.modules : [];
      for (var qs_j = 0; qs_j < qs_mods.length; qs_j++) {
        var qs_blocks = isArr(qs_mods[qs_j].blocks) ? qs_mods[qs_j].blocks : [];
        for (var qs_k = 0; qs_k < qs_blocks.length; qs_k++) {
          var qs_list = isArr(qs_blocks[qs_k].questions) ? qs_blocks[qs_k].questions : [];
          for (var qs_l = 0; qs_l < qs_list.length; qs_l++) qById[qs_list[qs_l].id] = qs_list[qs_l];
        }
      }
    }

    var order = isArr(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : DEFAULT_ORDER;
    var dirs = isArr(cfg.directions) ? cfg.directions : [];
    var si, i, j;

    for (si = 0; si < order.length; si++) {
      var sectionId = order[si];
      var secCfg = secCfgOf(cfg, sectionId);
      var setSection = findSection(set, sectionId);
      if (!secCfg) { warnings.push('sectionOrder has "' + sectionId + '" but no config section; skipped'); continue; }
      if (!setSection) { warnings.push('no content for section "' + sectionId + '"; skipped'); continue; }

      // beforeSection 안내 화면 (config 배열 순서 = 표시 순서)
      for (i = 0; i < dirs.length; i++) {
        if (dirs[i].insertAt && dirs[i].insertAt.position === 'beforeSection' && dirs[i].insertAt.section === sectionId) {
          screens.push(directionScreen(cfg, dirs[i], sectionId));
        }
      }

      var total = countQuestions(setSection);
      var seen = 0;
      var mods = isArr(setSection.modules) ? setSection.modules : [];
      var qScreenIds = [];  // 이 섹션의 문항 화면 id — transfer 화면의 편집 대상
      var sectionStart = screens.length;

      for (i = 0; i < mods.length; i++) {
        var mod = mods[i];
        var unit = unitCfgOf(secCfg, mod.id);
        if (!unit) warnings.push('no timing config for module/task "' + sectionId + '.' + mod.id + '"; section defaults used');
        var clocks = buildClocks(cfg, secCfg, unit);
        var seqs = {};   // kind 별 채번 — 'q' 는 종전 번호를 그대로 유지한다

        var ctx = {
          cfg: cfg, secCfg: secCfg, unitCfg: unit, sectionId: sectionId,
          moduleId: mod.id, moduleIndex: i + 1, moduleLabel: mod.label || mod.id,
          warnings: warnings
        };
        /* 문제 화면 팩토리 — id 채번·progress 누적·기본 타이머를 한 곳에서 처리한다. */
        ctx.mk = function (spec) {
          var kind = spec.kind || 'q';
          seqs[kind] = (seqs[kind] || 0) + 1;
          var s = {
            id: sectionId + '.' + kind + '.' + mod.id + '.' + pad2(seqs[kind]),
            screenType: spec.screenType || 'question',
            section: sectionId,
            module: ctx.moduleIndex,
            moduleId: mod.id,
            blockKind: spec.blockKind,
            advance: spec.advance,
            questionIds: spec.questionIds,
            allowBack: spec.allowBack,
            audio: spec.audio,
            image: spec.image,
            phases: spec.phases,
            copy: spec.copy,
            timerStartsOnAudioEnd: spec.timerStartsOnAudioEnd
          };
          if (spec.timer !== undefined) { s.timer = spec.timer; s.timers = spec.timers; }
          else { s.timer = clocks.length ? clocks[0] : null; if (clocks.length) s.timers = clocks; }

          /* 관리자가 이 문항만 다른 제한시간을 준 경우(§ admin-questions.html).
             화면이 문항 하나를 담을 때만 적용하고, 모듈 전체가 공유하는 clocks 배열은
             건드리지 않도록 이 화면 몫으로 복제해서 바꾼다. */
          var oneQ = isArr(s.questionIds) && s.questionIds.length === 1 ? qById[s.questionIds[0]] : null;
          var over = oneQ && isNum(oneQ.timeLimitSec) && oneQ.timeLimitSec > 0 ? oneQ.timeLimitSec : null;
          if (over && s.timers && s.timers.length) {
            s.timers = s.timers.map(function (t) {
              if (t.scope !== 'question' && t.scope !== 'screen') return t;
              var c = {}; for (var kk in t) if (t.hasOwnProperty(kk)) c[kk] = t[kk];
              c.seconds = over;
              return c;
            });
            s.timer = s.timers[0];
          } else if (over && s.timer && (s.timer.scope === 'question' || s.timer.scope === 'screen')) {
            var t1 = {}; for (var k2 in s.timer) if (s.timer.hasOwnProperty(k2)) t1[k2] = s.timer[k2];
            t1.seconds = over;
            s.timer = t1; s.timers = [t1];
          }
          /* progress — 실측 서브바 표기(§ 파일 머리말). qn>1 이면 범위 표기다. */
          if (total) {
            var qn = spec.questionCount || 0;
            var first = Math.min(seen + 1, total);
            var last = qn > 1 ? Math.min(seen + qn, total) : first;
            s.progress = {
              index: first,            // 하위호환(구 렌더러) — first 와 같다
              first: first,
              last: last,
              total: total,
              style: qn > 1 ? 'range' : 'single'
            };
          }
          seen += (spec.questionCount || 0);
          return window.SG_TYPES.makeScreen(s);
        };

        var blocks = isArr(mod.blocks) ? mod.blocks : [];
        for (j = 0; j < blocks.length; j++) {
          var fn = BLOCK_COMPILERS[blocks[j].kind];
          if (!fn) { warnings.push('unknown block.kind "' + blocks[j].kind + '" in ' + sectionId + '.' + mod.id + '; block skipped'); continue; }
          screens = screens.concat(fn(ctx, blocks[j]));
        }

        // 모듈/태스크 종료 화면 — 삽입 대상은 config 의 moduleEndScreen 이 가리키는 directions[].id
        if (unit && unit.moduleEndScreen) {
          var dir = dirCfgOf(cfg, unit.moduleEndScreen);
          if (!dir) warnings.push('moduleEndScreen "' + unit.moduleEndScreen + '" not found in directions[]; screen omitted');
          else screens.push(moduleEndScreen(cfg, dir, sectionId, mod.id, i + 1, mod.label || mod.id));
        }
      }

      // 섹션 phase 화면(IELTS transfer time) — afterSection 안내 화면보다 앞선다.
      var phList = isArr(secCfg.phases) ? secCfg.phases : [];
      if (phList.length) {
        for (i = sectionStart; i < screens.length; i++) {
          if (screens[i].screenType === 'question' && screens[i].questionIds && screens[i].questionIds.length) {
            qScreenIds.push(screens[i].id);
          }
        }
      }
      for (i = 0; i < phList.length; i++) {
        var ph = phList[i];
        if (!ph || ph.position !== 'afterSection') continue;
        if (!isNum(ph.seconds)) { warnings.push('section phase "' + sectionId + '.' + (ph && ph.id) + '" has no positive seconds; screen omitted'); continue; }
        if (ph.appliesTo === 'paperBased' && opts.delivery === 'computer') {
          warnings.push('section phase "' + sectionId + '.' + ph.id + '" is paperBased only; skipped for delivery=computer');
          continue;
        }
        screens.push(sectionPhaseScreen(cfg, secCfg, ph, sectionId, qScreenIds));
      }

      // afterSection 안내/제출 화면
      for (i = 0; i < dirs.length; i++) {
        if (dirs[i].insertAt && dirs[i].insertAt.position === 'afterSection' && dirs[i].insertAt.section === sectionId) {
          screens.push(directionScreen(cfg, dirs[i], sectionId));
        }
      }
    }

    return { screens: screens, index: buildIndex(screens, warnings), warnings: warnings };
  }

  function findSection(set, id) {
    for (var i = 0; i < set.sections.length; i++) { if (set.sections[i].id === id) return set.sections[i]; }
    return null;
  }

  function countQuestions(section) {
    var n = 0, mods = isArr(section.modules) ? section.modules : [], i, j;
    for (i = 0; i < mods.length; i++) {
      var blocks = isArr(mods[i].blocks) ? mods[i].blocks : [];
      for (j = 0; j < blocks.length; j++) n += (blocks[j].questions || []).length;
    }
    return n;
  }

  function emptyIndex() {
    return { byId: {}, byQuestionId: {}, bySection: {}, byModule: {}, counts: { screens: 0, questions: 0, byScreenType: {}, bySection: {} } };
  }

  function buildIndex(screens, warnings) {
    var ix = emptyIndex(), i, j;
    for (i = 0; i < screens.length; i++) {
      var s = screens[i];
      if (ix.byId[s.id] !== undefined) warnings.push('duplicate screen id: ' + s.id);
      ix.byId[s.id] = i;
      if (!ix.bySection[s.section]) ix.bySection[s.section] = [];
      ix.bySection[s.section].push(s.id);
      if (s.moduleId) {
        if (!ix.byModule[s.moduleId]) ix.byModule[s.moduleId] = [];
        ix.byModule[s.moduleId].push(s.id);
      }
      ix.counts.byScreenType[s.screenType] = (ix.counts.byScreenType[s.screenType] || 0) + 1;
      ix.counts.bySection[s.section] = (ix.counts.bySection[s.section] || 0) + 1;
      var qs = s.questionIds || [];
      for (j = 0; j < qs.length; j++) {
        if (ix.byQuestionId[qs[j]] !== undefined) warnings.push('duplicate question id across screens: ' + qs[j]);
        ix.byQuestionId[qs[j]] = s.id;
        ix.counts.questions += 1;
      }
    }
    ix.counts.screens = screens.length;
    return ix;
  }

  window.SG_COMPILE = {
    compileScreens: compileScreens,
    cueOf: cueOf,
    BLOCK_COMPILERS: BLOCK_COMPILERS,
    FIXED_ID: FIXED_ID
  };
})();
