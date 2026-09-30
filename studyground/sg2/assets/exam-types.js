/* SMEAG · StudyGround 2.0 — exam-types.js
 * 목적: TestScreen 화면 계약(architecture.md 3.1)의 JSDoc 정본 + 런타임 검증기.
 * 의존 전역: 없음
 * 노출 전역: window.SG_TYPES
 *
 * 타입스크립트를 도입하지 않는다(P1). 대신 아래 JSDoc typedef 를 계약 정본으로 두고,
 * validateScreen() 이 같은 규칙을 런타임에서 실제로 검사한다. 문서와 코드가 갈라지지 않도록
 * 상수 배열(SCREEN_TYPES 등)이 typedef 의 유니언과 1:1 대응한다.
 */

/**
 * @typedef {"instruction"|"question"|"speaking"|"moduleEnd"|"hardwareCheck"|"review"} ScreenType
 * @typedef {"reading"|"listening"|"writing"|"speaking"} SectionId
 *
 * @typedef {Object} TimerSpec
 * @property {"countdown"|"response"|"prep"|"none"} mode
 * @property {"section"|"module"|"task"|"question"|"screen"} scope
 * @property {number} seconds
 * @property {"MM:SS"|"HH:MM:SS"} format
 * @property {"autoAdvance"|"stopRecord"|"startRecord"|null} onExpire
 * @property {boolean} [visible]        // hardwareCheck/moduleEnd 등 숨김 상한 타이머
 * @property {boolean} [sharedDeadline] // 같은 scope의 화면들이 하나의 deadline을 공유
 *
 * @typedef {Object} MediaSpec
 * @property {string} src               // resolveMedia() 통과 후 경로 ('media/...')
 * @property {string} [srcRaw]          // set1.js 원본 경로(디버그·역추적용)
 * @property {number} maxPlays          // 1 = 재생 1회 (확정)
 * @property {boolean} [autoplay]
 * @property {"audio"|"video"|"image"} [kind]
 *
 * @typedef {Object} SpeakingPhase
 * @property {"prompt"|"listen"|"read"|"prep"|"record"} name
 * @property {number} seconds           // 0 = 스킵(즉시 다음 phase)
 * @property {boolean} [selfPaced]      // true면 seconds 무시, 버튼으로만 진행
 * @property {MediaSpec} [media]
 * @property {"stopRecord"|"startRecord"|"autoAdvance"|null} [onExpire]
 *
 * @typedef {Object} ScreenCopy
 * @property {string} [titleEn] @property {string} [titleKo]
 * @property {string} [bodyEn]  @property {string} [bodyKo]
 * @property {string} [ctaEn]   @property {string} [ctaKo]
 *
 * @typedef {Object} TransferSpec
 * @property {boolean} enabled
 * @property {boolean} [editable]
 * @property {string[]} [targetScreenIds]
 *
 * @typedef {Object} TestScreen
 * @property {string}    id             // "{section}.{kind}.{moduleId}.{seq}" — 복구용 안정 키
 * @property {ScreenType} screenType
 * @property {SectionId} section
 * @property {number}    [module]       // 1-based 모듈 순번
 * @property {string}    [moduleId]     // 'R1' 'L2' 등 set1.js 원본 id
 * @property {string}    [blockKind]    // 원본 block.kind (렌더러 분기용)
 * @typedef {Object} ProgressSpec
 * @property {number} first             // 이 화면이 담는 첫 문항 번호 (1-based, 섹션 기준)
 * @property {number} last              // 마지막 문항 번호. style==="single" 이면 first 와 같다
 * @property {number} total             // 섹션 전체 문항 수 (분모)
 * @property {"single"|"range"} style   // 서브바 표기 — single: "Question f of t" / range: "Questions f-l of t"
 *
 * @property {ProgressSpec|{index:number,total:number}} [progress]
 * @property {string[]}  [questionIds]  // 이 화면이 담는 문항 id들 (복수 가능)
 * @property {TimerSpec|null} timer     // 표시 타이머(가장 좁은 scope). §3.5 우선순위
 * @property {TimerSpec[]} [timers]     // 좁은→넓은 순. 엔진 clocks 맵의 소스(§3.5 공존 규칙)
 * @property {"manual"|"auto"} advance
 * @property {MediaSpec} [audio]
 * @property {MediaSpec} [image]
 * @property {SpeakingPhase[]} [phases] // screenType==="speaking"
 * @property {boolean}   [allowBack]    // 모듈 내 문항 되돌아가기 허용
 * @property {TransferSpec} [transfer]  // moduleEnd의 transfer time (IELTS)
 * @property {string[]}  [controls]     // config directions[].controls 전달
 * @property {ScreenCopy} [copy]
 */

(function () {
  'use strict';

  var SCREEN_TYPES = ['instruction', 'question', 'speaking', 'moduleEnd', 'hardwareCheck', 'review'];
  var SECTION_IDS = ['reading', 'listening', 'writing', 'speaking'];
  var TIMER_MODES = ['countdown', 'response', 'prep', 'none'];
  var TIMER_SCOPES = ['section', 'module', 'task', 'question', 'screen'];
  var TIMER_FORMATS = ['MM:SS', 'HH:MM:SS'];
  var ON_EXPIRE = ['autoAdvance', 'stopRecord', 'startRecord', null];
  var ADVANCE = ['manual', 'auto'];
  var PHASE_NAMES = ['prompt', 'listen', 'read', 'prep', 'record'];
  var PROGRESS_STYLES = ['single', 'range'];

  var DEFAULT_MAX_PLAYS = 1; // 관찰값: Listening 오디오는 1회 재생 (Story 1.2 AC5)

  var devMode = false;

  function has(list, v) {
    for (var i = 0; i < list.length; i++) { if (list[i] === v) return true; }
    return false;
  }

  function isObj(v) { return !!v && typeof v === 'object' && !(v instanceof Array); }
  function isPosNum(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }

  /* TimerSpec 단독 검증. prefix 는 에러 문자열에 붙는 위치 표시. */
  function validateTimer(t, prefix, out) {
    if (!isObj(t)) { out.push(prefix + ': timer must be an object or null'); return; }
    if (!has(TIMER_MODES, t.mode)) out.push(prefix + '.mode invalid: ' + t.mode);
    if (!has(TIMER_SCOPES, t.scope)) out.push(prefix + '.scope invalid: ' + t.scope);
    if (!isPosNum(t.seconds)) out.push(prefix + '.seconds must be a number >= 0');
    if (!has(TIMER_FORMATS, t.format)) out.push(prefix + '.format invalid: ' + t.format);
    if (!has(ON_EXPIRE, t.onExpire === undefined ? null : t.onExpire)) {
      out.push(prefix + '.onExpire invalid: ' + t.onExpire);
    }
  }

  /* progress 검증 — 서브바 진행표시(관찰값: "Question 25 of 32" / "Questions 1-10 of 35")의 소스.
     신규 스키마 {first,last,total,style} 를 정본으로 하되, 컴파일러가 아직 갱신되지 않은
     구간을 위해 레거시 {index,total} 도 계속 통과시킨다(normalizeProgress 가 흡수한다). */
  function validateProgress(p, out) {
    if (!isObj(p)) { out.push('progress must be an object'); return; }
    var isLegacy = (p.first === undefined && p.style === undefined && p.last === undefined);
    if (isLegacy) {
      if (!isPosNum(p.index) || !isPosNum(p.total)) {
        out.push('progress must be {first,last,total,style} (legacy {index,total} also accepted)');
      }
      return;
    }
    if (!isPosNum(p.first)) out.push('progress.first must be a number >= 0');
    if (!isPosNum(p.last)) out.push('progress.last must be a number >= 0');
    if (!isPosNum(p.total)) out.push('progress.total must be a number >= 0');
    if (!has(PROGRESS_STYLES, p.style)) out.push('progress.style invalid: ' + p.style);
    if (isPosNum(p.first) && isPosNum(p.last) && p.last < p.first) {
      out.push('progress.last must be >= progress.first');
    }
    if (p.style === 'single' && isPosNum(p.first) && isPosNum(p.last) && p.first !== p.last) {
      out.push('progress.style "single" requires first === last');
    }
  }

  /* 두 스키마를 하나로 흡수한다. 표시 계층(셸 서브바)은 이것만 쓴다. */
  function normalizeProgress(p) {
    if (!isObj(p)) return null;
    if (isPosNum(p.first) && isPosNum(p.total)) {
      var last = isPosNum(p.last) ? p.last : p.first;
      return {
        first: p.first, last: last, total: p.total,
        style: has(PROGRESS_STYLES, p.style) ? p.style : (last > p.first ? 'range' : 'single')
      };
    }
    if (isPosNum(p.index) && isPosNum(p.total)) {
      return { first: p.index, last: p.index, total: p.total, style: 'single' };
    }
    return null;
  }

  /* 관찰된 문구 그대로. 사본을 여기저기 두지 않도록 포매터를 타입 모듈이 소유한다. */
  function formatProgress(p) {
    var n = normalizeProgress(p);
    if (!n) return '';
    if (n.style === 'range') return 'Questions ' + n.first + '-' + n.last + ' of ' + n.total;
    return 'Question ' + n.first + ' of ' + n.total;
  }

  function formatProgressKo(p) {
    var n = normalizeProgress(p);
    if (!n) return '';
    if (n.style === 'range') return n.first + '-' + n.last + '번 / 전체 ' + n.total + '문항';
    return n.first + '번 / 전체 ' + n.total + '문항';
  }

  function validateMedia(m, prefix, out) {
    if (!isObj(m)) { out.push(prefix + ' must be an object'); return; }
    if (typeof m.src !== 'string' || !m.src) out.push(prefix + '.src missing');
    if (!isPosNum(m.maxPlays)) out.push(prefix + '.maxPlays must be a number >= 0');
  }

  /**
   * 화면 계약 위반 사유를 문자열 배열로 반환한다. 위반 없으면 빈 배열.
   * throw 하지 않는다 — 호출자(makeScreen)가 dev/prod 정책을 결정한다(F12).
   * @param {TestScreen} s
   * @returns {string[]}
   */
  function validateScreen(s) {
    var out = [];
    if (!isObj(s)) return ['screen must be an object'];

    // (e) id 누락
    if (typeof s.id !== 'string' || !s.id) out.push('id is required (stable recovery key)');
    if (!has(SCREEN_TYPES, s.screenType)) out.push('screenType invalid: ' + s.screenType);
    if (!has(SECTION_IDS, s.section)) out.push('section invalid: ' + s.section);
    // (d) advance 값
    if (!has(ADVANCE, s.advance)) out.push('advance invalid: ' + s.advance);

    var t = (s.timer === undefined) ? null : s.timer;

    // (a) instruction 은 타이머를 갖지 않는다
    if (s.screenType === 'instruction' && t !== null) {
      out.push('instruction screen must have timer === null');
    }

    if (t !== null) {
      validateTimer(t, 'timer', out);
      // moduleEnd / hardwareCheck 상한 타이머는 scope 가 반드시 screen
      if ((s.screenType === 'moduleEnd' || s.screenType === 'hardwareCheck') && t.scope !== 'screen') {
        out.push(s.screenType + ' timer.scope must be "screen", got: ' + t.scope);
      }
      // (b) question 은 countdown 만
      if (s.screenType === 'question' && t.mode !== 'countdown') {
        out.push('question screen timer.mode must be "countdown", got: ' + t.mode);
      }
      // format 제약 (Story 1.2 AC4)
      if (s.screenType === 'question' && t.format !== 'MM:SS') {
        out.push('question screen timer.format must be "MM:SS", got: ' + t.format);
      }
      // (c) speaking 화면 타이머는 response 모드
      if (s.screenType === 'speaking' && t.mode !== 'response') {
        out.push('speaking screen timer.mode must be "response", got: ' + t.mode);
      }
    }

    if (s.timers !== undefined) {
      if (!(s.timers instanceof Array)) out.push('timers must be an array');
      else {
        for (var ti = 0; ti < s.timers.length; ti++) validateTimer(s.timers[ti], 'timers[' + ti + ']', out);
        if (s.timers.length && t !== null && s.timers[0] !== t) {
          out.push('timers[0] must be the same object as timer (narrowest scope wins, §3.5)');
        }
      }
    }

    if (s.screenType === 'speaking') {
      if (!(s.phases instanceof Array) || !s.phases.length) {
        out.push('speaking screen requires a non-empty phases[]');
      } else {
        var sawRecord = false;
        for (var i = 0; i < s.phases.length; i++) {
          var p = s.phases[i];
          if (!isObj(p)) { out.push('phases[' + i + '] must be an object'); continue; }
          if (!has(PHASE_NAMES, p.name)) out.push('phases[' + i + '].name invalid: ' + p.name);
          if (!isPosNum(p.seconds)) out.push('phases[' + i + '].seconds must be a number >= 0');
          if (p.media !== undefined) validateMedia(p.media, 'phases[' + i + '].media', out);
          if (p.name === 'record') {
            sawRecord = true;
            // record phase 는 HH:MM:SS 표기 화면에서만 의미가 있다(관찰값, AC4)
            if (t !== null && t.format !== 'HH:MM:SS') {
              out.push('speaking screen with a record phase must use timer.format "HH:MM:SS"');
            }
          }
        }
        if (!sawRecord) out.push('speaking screen requires a "record" phase');
      }
    } else if (s.phases !== undefined) {
      out.push('phases[] is only valid on speaking screens');
    }

    if (s.audio !== undefined) validateMedia(s.audio, 'audio', out);
    if (s.image !== undefined) validateMedia(s.image, 'image', out);

    if (s.questionIds !== undefined && !(s.questionIds instanceof Array)) {
      out.push('questionIds must be an array');
    }
    if (s.progress !== undefined) validateProgress(s.progress, out);
    return out;
  }

  /* MediaSpec 정규화 — maxPlays 기본값 1 (AC5). */
  function makeMedia(spec) {
    if (!spec || !spec.src) return undefined;
    var m = {
      src: spec.src,
      maxPlays: (typeof spec.maxPlays === 'number') ? spec.maxPlays : DEFAULT_MAX_PLAYS
    };
    if (spec.srcRaw) m.srcRaw = spec.srcRaw;
    if (spec.kind) m.kind = spec.kind;
    if (spec.autoplay !== undefined) m.autoplay = !!spec.autoplay;
    return Object.freeze(m);
  }

  var FIELDS = ['id', 'screenType', 'section', 'module', 'moduleId', 'blockKind', 'progress',
    'questionIds', 'timer', 'timers', 'advance', 'audio', 'image', 'phases',
    'allowBack', 'transfer', 'controls', 'copy', 'timerStartsOnAudioEnd'];

  /**
   * TestScreen 팩토리. 계약 위반 시 dev 모드면 throw, 운영 모드면 warn + 안전 기본값으로 degrade.
   * 반환 객체는 Object.freeze 된다(Story 1.2 AC2) — 상태머신이 화면을 변형하지 못하게.
   * @param {Object} spec
   * @returns {TestScreen}
   */
  function makeScreen(spec) {
    var s = {};
    var i;
    for (i = 0; i < FIELDS.length; i++) {
      if (spec[FIELDS[i]] !== undefined) s[FIELDS[i]] = spec[FIELDS[i]];
    }
    if (s.timer === undefined) s.timer = null;
    if (s.advance === undefined) s.advance = 'manual';
    if (s.audio) s.audio = makeMedia(s.audio);
    if (s.image) s.image = makeMedia(s.image);

    var errs = validateScreen(s);
    if (errs.length) {
      var msg = 'SG_TYPES.makeScreen contract violation on "' + (s.id || '(no id)') + '": ' + errs.join('; ');
      if (devMode) throw new Error(msg);
      // 운영 degrade: 시험을 멈추지 않는다(F12). 가장 안전한 형태 = 타이머 없이 수동 진행.
      if (typeof console !== 'undefined' && console.warn) console.warn(msg);
      s.timer = null;
      if (s.timers) delete s.timers;
      if (!has(ADVANCE, s.advance)) s.advance = 'manual';
    }

    if (s.phases) Object.freeze(s.phases);
    if (s.timer) Object.freeze(s.timer);
    if (s.timers) Object.freeze(s.timers);
    if (s.questionIds) Object.freeze(s.questionIds);
    if (s.copy) Object.freeze(s.copy);
    if (s.progress) Object.freeze(s.progress);
    return Object.freeze(s);
  }

  window.SG_TYPES = {
    SCREEN_TYPES: SCREEN_TYPES,
    SECTION_IDS: SECTION_IDS,
    TIMER_MODES: TIMER_MODES,
    TIMER_SCOPES: TIMER_SCOPES,
    TIMER_FORMATS: TIMER_FORMATS,
    ON_EXPIRE: ON_EXPIRE,
    ADVANCE: ADVANCE,
    PHASE_NAMES: PHASE_NAMES,
    PROGRESS_STYLES: PROGRESS_STYLES,
    DEFAULT_MAX_PLAYS: DEFAULT_MAX_PLAYS,
    validateScreen: validateScreen,
    validateProgress: function (p) { var o = []; validateProgress(p, o); return o; },
    normalizeProgress: normalizeProgress,
    formatProgress: formatProgress,
    formatProgressKo: formatProgressKo,
    validateTimer: function (t) { var o = []; validateTimer(t, 'timer', o); return o; },
    makeScreen: makeScreen,
    makeMedia: makeMedia,
    setDevMode: function (on) { devMode = !!on; },
    isDevMode: function () { return devMode; }
  };
})();
