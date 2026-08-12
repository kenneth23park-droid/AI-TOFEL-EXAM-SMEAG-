/* SMEAG · StudyGround 2.0 — exam-timing.js
 * 목적: 타이밍 규격(config/timing.<exam>.json) 로더 + 조회기 + 오프라인 내장 폴백.
 * 의존 전역: 없음
 * 노출 전역: window.SG_TIMING  (읽기: window.SG_TIMING_OVERRIDE)
 *
 * ── 값의 단일 소스 (Story 1.1 AC6 / architecture.md P6·F11) ────────────────────
 * 모든 초 단위 값은 이 config 가 정본이다. 런타임은 set1.js 의
 *   reading.timeLimitSec(2100) · W1/W2/W3.timeLimitSec(600) · question.prepSec/respondSec
 * 을 **읽지 않는다**. set1.js 는 콘텐츠(지문·문항·정답·미디어경로) 전용이다.
 * 실제 TOEFL 규격이 확인되면 JSON 숫자만 바꾸고 코드는 건드리지 않는다.
 *
 * ── 로딩 우선순위 (timing-spec.md 6절) ────────────────────────────────────────
 *   1) window.SG_TIMING_OVERRIDE            (개발/디버그 인라인 객체)
 *   2) fetch('config/timing.<exam>.json')   (best effort — file:// 에서는 실패가 정상)
 *   3) 내장 FALLBACK                        (아래 리터럴 = timing.toefl.json 사본)
 * 세션 시작 시 1회 로드해 메모리에 고정하고 세션 도중 재로딩하지 않는다(AC7).
 */
(function () {
  'use strict';

  var SCHEMA_MAJOR = 1;
  var DEFAULT_PROFILE = 'toefl';
  var PROFILE_KEY = 'sg2_exam_profile';

  /* 내장 폴백 — config/timing.toefl.json 과 동일한 수치의 사본.
   * provenance.entries[] 만 비웠다(런타임이 읽지 않는 문서용 메타이고, 파일 크기를 줄이기 위해).
   * 값을 바꿀 때는 JSON 파일과 이 리터럴을 **함께** 바꿔야 한다 —
   * studyground/tests/test_compile_screens.js 가 두 값의 동일성을 검사한다. */
  var FALLBACK = {
    "schemaVersion": "1.0.0",
    "exam": {"id": "toefl-nt", "label": "New TOEFL", "labelKo": "뉴토플", "scoreScale": "toefl120", "scale": {"sectionMax": 30, "totalMax": 120, "step": 1, "bandLabel": "CEFR"}, "contentRef": "window.SMEAG_SET1"},
    "sectionOrder": ["reading", "listening", "writing", "speaking"],
    "defaults": {"timerScope": "module", "timerFormat": "MM:SS", "onExpire": "autoAdvance", "advance": "manual", "audioMaxPlays": 1, "instructionMaxSec": null, "graceSec": 0, "warnAtSec": 60},
    "sections": {
      "listening": {
        "id": "listening",
        "label": "Listening",
        "labelKo": "리스닝",
        "screenType": "question",
        "timerScope": "question",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": {"maxPlays": 1, "autoPlay": true, "replayAllowed": false},
        // 사진·선택지가 한 화면에 있고 그 화면에서 mp3 가 재생된다. config/timing.toefl.json
        // 과 반드시 같아야 한다 — sg2 는 오프라인으로도 돌아가므로 JSON 을 못 읽으면 이
        // 내장본이 쓰인다. 여기 빠져 있으면 오프라인에서만 옛 분리 화면으로 되돌아간다.
        "audioOnQuestionScreen": true,
        "questionCountSource": "content",
        "sectionSec": null,
        "modules": [
          {"id": "L1", "contentRef": "listening.modules[id=L1]", "taskType": null, "allocatedSec": 1080, "perQuestionSec": 20, "onExpire": "autoAdvance", "moduleEndScreen": "moduleEnd.listening", "introAudioSelfPaced": null},
          {"id": "L2", "contentRef": "listening.modules[id=L2]", "taskType": null, "allocatedSec": 900, "perQuestionSec": 20, "onExpire": "autoAdvance", "moduleEndScreen": "moduleEnd.listening", "introAudioSelfPaced": null}
        ],
        "tasks": null,
        "taskTypes": null,
        "fallbackPerQuestionSec": 20,
        "promptOnScreen": false,
        "phases": []
      },
      "speaking": {
        "id": "speaking",
        "label": "Speaking",
        "labelKo": "스피킹",
        "screenType": "speaking",
        "timerScope": "screen",
        "timerFormat": "HH:MM:SS",
        "onExpire": "stopRecord",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": null,
        "modules": [
          {"id": "S1", "contentRef": "speaking.modules[id=S1]", "taskType": "listenAndRepeat", "allocatedSec": null, "perQuestionSec": null, "onExpire": null, "moduleEndScreen": null, "introAudioSelfPaced": true},
          {"id": "S2", "contentRef": "speaking.modules[id=S2]", "taskType": "interview", "allocatedSec": null, "perQuestionSec": null, "onExpire": null, "moduleEndScreen": null, "introAudioSelfPaced": true}
        ],
        "tasks": null,
        "taskTypes": {
          "listenAndRepeat": {"id": "listenAndRepeat", "label": "Listen and Repeat", "mediaType": "audio", "promptSelfPaced": false, "listenReplays": 1, "prepSec": 2, "responseSec": 12, "responseSecByIndex": [8, 8, 10, 10, 10, 12, 12], "responseSecMin": null, "responseSecMax": null, "recording": true, "onExpire": "stopRecord"},
          "interview": {"id": "interview", "label": "Take an Interview", "mediaType": "video", "promptSelfPaced": true, "listenReplays": 1, "prepSec": 3, "responseSec": 45, "responseSecByIndex": null, "responseSecMin": null, "responseSecMax": null, "recording": true, "onExpire": "stopRecord"}
        },
        "fallbackPerQuestionSec": null,
        "phases": []
      },
      "reading": {
        "id": "reading",
        "label": "Reading",
        "labelKo": "리딩",
        "screenType": "question",
        "timerScope": "module",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": 1800,
        "modules": [
          {"id": "R1", "contentRef": "reading.modules[id=R1]", "taskType": null, "allocatedSec": 1200, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": "moduleEnd.reading", "introAudioSelfPaced": null},
          {"id": "R2", "contentRef": "reading.modules[id=R2]", "taskType": null, "allocatedSec": 600, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": "moduleEnd.reading", "introAudioSelfPaced": null}
        ],
        "tasks": null,
        "taskTypes": null,
        "fallbackPerQuestionSec": null,
        "phases": []
      },
      "writing": {
        "id": "writing",
        "label": "Writing",
        "labelKo": "라이팅",
        "screenType": "question",
        "timerScope": "task",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": null,
        "modules": [],
        "tasks": [
          {"id": "W1", "contentRef": "writing.modules[id=W1]", "taskKind": "build-set", "perTaskSec": 420, "minWords": null, "onExpire": "autoAdvance", "moduleEndScreen": "taskEnd.writing"},
          {"id": "W2", "contentRef": "writing.modules[id=W2]", "taskKind": "email", "perTaskSec": 420, "minWords": 80, "onExpire": "autoAdvance", "moduleEndScreen": "taskEnd.writing"},
          {"id": "W3", "contentRef": "writing.modules[id=W3]", "taskKind": "academicDiscussion", "perTaskSec": 600, "minWords": 100, "onExpire": "autoAdvance", "moduleEndScreen": "taskEnd.writing"}
        ],
        "taskTypes": null,
        "fallbackPerQuestionSec": null,
        "phases": []
      }
    },
    "directions": [
      {"id": "adjustVolume", "label": "Adjusting the Volume", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "reading", "module": null}, "maxSec": null, "advance": "manual", "controls": ["playTestAudio", "volume", "continue"]},
      {"id": "adjustMic", "label": "Adjusting the Microphone", "labelKo": "마이크 조절", "screenType": "hardwareCheck", "insertAt": {"position": "beforeSection", "section": "reading", "module": null}, "maxSec": null, "advance": "manual", "controls": ["micTest", "continue"]},
      {"id": "listeningDirections", "label": "Listening Section Directions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "listening", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "moduleEnd.listening", "label": "End of Module", "screenType": "moduleEnd", "insertAt": {"position": "betweenModules", "section": "listening", "module": null}, "maxSec": null, "advance": "manual", "controls": ["continue"]},
      {"id": "hardwareCheck", "label": "Hardware Check", "screenType": "hardwareCheck", "insertAt": {"position": "beforeSection", "section": "speaking", "module": null}, "maxSec": null, "advance": "manual", "controls": ["micTest", "speakerTest", "continue"]},
      {"id": "speakingDirections", "label": "Speaking Section Directions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "speaking", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "readingDirections", "label": "Reading Section Directions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "reading", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "moduleEnd.reading", "label": "End of Module 1", "screenType": "moduleEnd", "insertAt": {"position": "betweenModules", "section": "reading", "module": "R1"}, "maxSec": null, "advance": "manual", "controls": ["continue"]},
      {"id": "writingDirections", "label": "Writing Section Directions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "writing", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "taskEnd.writing", "label": "End of Task", "screenType": "moduleEnd", "insertAt": {"position": "betweenModules", "section": "writing", "module": null}, "maxSec": null, "advance": "manual", "controls": ["continue"]},
      {"id": "submitConfirm", "label": "Submit Test", "screenType": "review", "insertAt": {"position": "afterSection", "section": "writing", "module": null}, "maxSec": null, "advance": "manual", "controls": ["submit"]}
    ],
    "provenance": {"levels": {"observed": "57분53초 화면녹화에서 직접 확인된 값/동작", "official": "시험 주관사가 공개한 공식 규격", "content": "studyground/sg2/assets/set1.js 콘텐츠 파일에서 그대로 가져온 값", "assumed": "가설값 — 검증 전까지 임시로 사용. 반드시 재확인 필요", "spec": "발주처 확정 규격서 — _compare/TOEFL Test set up-최종수정사항.docx. 실측(observed)과 충돌하면 이쪽이 이긴다"}, "entries": []}
  };

  /* 내장 폴백 (IELTS) — config/timing.ielts.json 과 동일한 수치의 사본. Story 6.1 AC4.
   * TOEFL 폴백과 **키 구조가 100% 같아야** 한다(AC6 구조 드리프트 방지).
   * provenance.entries[] 만 비운 것도 TOEFL 폴백과 동일한 이유다.
   * 값을 바꿀 때는 JSON 파일과 이 리터럴을 함께 바꾼다 —
   * studyground/tests/test_compile_ielts.js 가 두 값의 동일성을 검사한다. */
  var FALLBACK_IELTS = {
    "schemaVersion": "1.0.0",
    "exam": {"id": "ielts-academic", "label": "IELTS Academic", "labelKo": "아이엘츠 아카데믹", "scoreScale": "ielts9", "scale": {"sectionMax": 9, "totalMax": 9, "step": 0.5, "bandLabel": "Band"}, "contentRef": null},
    "sectionOrder": ["listening", "reading", "writing", "speaking"],
    "defaults": {"timerScope": "section", "timerFormat": "MM:SS", "onExpire": "autoAdvance", "advance": "manual", "audioMaxPlays": 1, "instructionMaxSec": null, "graceSec": 0, "warnAtSec": 120},
    "sections": {
      "listening": {
        "id": "listening",
        "label": "Listening",
        "labelKo": "리스닝",
        "screenType": "question",
        "timerScope": "section",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": {"maxPlays": 1, "autoPlay": true, "replayAllowed": false},
        // IELTS 는 timerScope 가 section 이라 애초에 오디오/답변을 나누지 않는다.
        // 값이 아니라 키의 존재가 계약이다 — 두 프로파일의 키 집합은 같아야 하고
        // (Story 6.1 AC1), 그래야 한쪽에만 생긴 설정을 테스트가 잡아낸다.
        "audioOnQuestionScreen": false,
        "questionCountSource": "content",
        "sectionSec": 1800,
        "modules": [
          {"id": "P1", "contentRef": "listening.modules[id=P1]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null},
          {"id": "P2", "contentRef": "listening.modules[id=P2]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null},
          {"id": "P3", "contentRef": "listening.modules[id=P3]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null},
          {"id": "P4", "contentRef": "listening.modules[id=P4]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null}
        ],
        "tasks": null,
        "taskTypes": null,
        "fallbackPerQuestionSec": null,
        "promptOnScreen": true,
        "phases": [
          {"id": "transferTime", "label": "Transfer your answers to the answer sheet", "screenType": "instruction", "position": "afterSection", "seconds": 600, "onExpire": "autoAdvance", "advance": "manual", "appliesTo": "paperBased"}
        ]
      },
      "reading": {
        "id": "reading",
        "label": "Reading",
        "labelKo": "리딩",
        "screenType": "question",
        "timerScope": "section",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": 3600,
        "modules": [
          {"id": "PASSAGE1", "contentRef": "reading.modules[id=PASSAGE1]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null},
          {"id": "PASSAGE2", "contentRef": "reading.modules[id=PASSAGE2]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null},
          {"id": "PASSAGE3", "contentRef": "reading.modules[id=PASSAGE3]", "taskType": null, "allocatedSec": null, "perQuestionSec": null, "onExpire": "autoAdvance", "moduleEndScreen": null, "introAudioSelfPaced": null}
        ],
        "tasks": null,
        "taskTypes": null,
        "fallbackPerQuestionSec": null,
        "phases": []
      },
      "writing": {
        "id": "writing",
        "label": "Writing",
        "labelKo": "라이팅",
        "screenType": "question",
        "timerScope": "section",
        "timerFormat": "MM:SS",
        "onExpire": "autoAdvance",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": 3600,
        "modules": [],
        "tasks": [
          {"id": "TASK1", "contentRef": "writing.modules[id=TASK1]", "taskKind": "graphDescription", "perTaskSec": 1200, "minWords": 150, "onExpire": "autoAdvance", "moduleEndScreen": null},
          {"id": "TASK2", "contentRef": "writing.modules[id=TASK2]", "taskKind": "essay", "perTaskSec": 2400, "minWords": 250, "onExpire": "autoAdvance", "moduleEndScreen": null}
        ],
        "taskTypes": null,
        "fallbackPerQuestionSec": null,
        "phases": []
      },
      "speaking": {
        "id": "speaking",
        "label": "Speaking",
        "labelKo": "스피킹",
        "screenType": "speaking",
        "timerScope": "module",
        "timerFormat": "MM:SS",
        "onExpire": "stopRecord",
        "audio": null,
        "questionCountSource": "content",
        "sectionSec": null,
        "modules": [
          {"id": "SP1", "contentRef": "speaking.modules[id=SP1]", "taskType": "part1", "allocatedSec": 300, "perQuestionSec": null, "onExpire": null, "moduleEndScreen": null, "introAudioSelfPaced": true},
          {"id": "SP2", "contentRef": "speaking.modules[id=SP2]", "taskType": "part2", "allocatedSec": 240, "perQuestionSec": null, "onExpire": null, "moduleEndScreen": null, "introAudioSelfPaced": true},
          {"id": "SP3", "contentRef": "speaking.modules[id=SP3]", "taskType": "part3", "allocatedSec": 300, "perQuestionSec": null, "onExpire": null, "moduleEndScreen": null, "introAudioSelfPaced": true}
        ],
        "tasks": null,
        "taskTypes": {
          "part1": {"id": "part1", "label": "Introduction and Interview", "mediaType": "audio", "promptSelfPaced": false, "listenReplays": 1, "prepSec": 0, "responseSec": 30, "responseSecByIndex": null, "responseSecMin": null, "responseSecMax": null, "recording": true, "onExpire": "stopRecord"},
          "part2": {"id": "part2", "label": "Long Turn (Cue Card)", "mediaType": "audio", "promptSelfPaced": false, "listenReplays": 1, "prepSec": 60, "responseSec": 120, "responseSecByIndex": null, "responseSecMin": 60, "responseSecMax": 120, "recording": true, "onExpire": "stopRecord"},
          "part3": {"id": "part3", "label": "Discussion", "mediaType": "audio", "promptSelfPaced": false, "listenReplays": 1, "prepSec": 0, "responseSec": 45, "responseSecByIndex": null, "responseSecMin": null, "responseSecMax": null, "recording": true, "onExpire": "stopRecord"}
        },
        "fallbackPerQuestionSec": null,
        "phases": []
      }
    },
    "directions": [
      {"id": "adjustVolume", "label": "Adjusting the Volume", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "listening", "module": null}, "maxSec": null, "advance": "manual", "controls": ["playTestAudio", "volume", "continue"]},
      {"id": "adjustMic", "label": "Adjusting the Microphone", "labelKo": "마이크 조절", "screenType": "hardwareCheck", "insertAt": {"position": "beforeSection", "section": "listening", "module": null}, "maxSec": null, "advance": "manual", "controls": ["micTest", "continue"]},
      {"id": "listeningDirections", "label": "Listening Test Instructions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "listening", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "readingDirections", "label": "Reading Test Instructions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "reading", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "writingDirections", "label": "Writing Test Instructions", "screenType": "instruction", "insertAt": {"position": "beforeSection", "section": "writing", "module": null}, "maxSec": null, "advance": "manual", "controls": ["begin"]},
      {"id": "hardwareCheck", "label": "Hardware Check", "screenType": "hardwareCheck", "insertAt": {"position": "beforeSection", "section": "speaking", "module": null}, "maxSec": null, "advance": "manual", "controls": ["micTest", "speakerTest", "continue"]},
      {"id": "cueCardPrep", "label": "You have one minute to prepare", "screenType": "instruction", "insertAt": {"position": "betweenModules", "section": "speaking", "module": "SP1"}, "maxSec": 60, "advance": "auto", "controls": ["continue"]},
      {"id": "submitConfirm", "label": "Submit Test", "screenType": "review", "insertAt": {"position": "afterSection", "section": "speaking", "module": null}, "maxSec": null, "advance": "manual", "controls": ["submit"]}
    ],
    "provenance": {"levels": {"observed": "57분53초 화면녹화에서 직접 확인된 값/동작 (IELTS 파일에는 해당 없음)", "official": "IELTS(British Council / IDP / Cambridge)가 공개한 공식 시험 규격", "content": "콘텐츠 파일에서 그대로 가져온 값", "assumed": "가설값 — 검증 전까지 임시로 사용. 반드시 재확인 필요", "spec": "발주처 확정 규격서. 실측(observed)과 충돌하면 이쪽이 이긴다 — IELTS 프로파일에는 현재 해당 항목 없음"}, "entries": []}
  };

  /* 프로파일 → 내장 폴백. 여기 없는 프로파일은 DEFAULT_PROFILE 로 degrade 한다(AC5). */
  var BUILTINS = { toefl: FALLBACK, ielts: FALLBACK_IELTS };

  var state = {
    cfg: null,      // 세션 고정 config
    source: null,   // 'override' | 'fetch' | 'builtin'
    profile: null,
    warnings: [],
    loading: false,
    queue: [],
    patched: 0     // 이번 로드에 적용된 사용자 조정값 개수
  };

  var warnedPaths = {}; // get() 경고는 경로당 1회만 (AC4)
  var PATCH_KEY = 'sg2_timing_patch'; // { "<profile>": { "<path>": <숫자 초> } }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[SG_TIMING] ' + msg);
  }

  function isObj(v) { return !!v && typeof v === 'object' && !(v instanceof Array); }

  /* --- 조회 -------------------------------------------------------------- */

  /* 'sections.reading.modules[id=R1].allocatedSec' 를 토큰 배열로 쪼갠다.
   * 지원: .key / [0] 숫자인덱스 / [key=value] 술어. */
  function tokenize(path) {
    var out = [];
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var br = p.indexOf('[');
      if (br < 0) { out.push({ k: p }); continue; }
      if (br > 0) out.push({ k: p.slice(0, br) });
      var rest = p.slice(br);
      while (rest.length) {
        var end = rest.indexOf(']');
        if (end < 0) break;
        var inner = rest.slice(1, end);
        var eq = inner.indexOf('=');
        if (eq < 0) out.push({ i: parseInt(inner, 10) });
        else out.push({ pk: inner.slice(0, eq), pv: inner.slice(eq + 1) });
        rest = rest.slice(end + 1);
      }
    }
    return out;
  }

  /* 없는 키에 throw 하지 않고 null 을 반환한다(F12 — 예외로 시험을 멈추지 않는다).
   * 호출형태 3가지: get() → 고정 config / get(path) / get(cfg, path). */
  function get(a, b) {
    var cfg, path;
    if (a === undefined) return state.cfg;
    if (typeof a === 'string') { cfg = state.cfg; path = a; }
    else { cfg = a; path = b; }
    if (path === undefined) return cfg;
    if (!cfg) { warn('get("' + path + '") called before load(); returning null'); return null; }

    var toks = tokenize(path);
    var cur = cfg;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (cur === null || cur === undefined) { cur = undefined; break; }
      if (t.k !== undefined) {
        cur = isObj(cur) ? cur[t.k] : undefined;
      } else if (t.i !== undefined) {
        cur = (cur instanceof Array) ? cur[t.i] : undefined;
      } else {
        var found;
        if (cur instanceof Array) {
          for (var j = 0; j < cur.length; j++) {
            if (cur[j] && String(cur[j][t.pk]) === t.pv) { found = cur[j]; break; }
          }
        } else if (isObj(cur)) {
          found = cur[t.pv];
        }
        cur = found;
      }
    }
    if (cur === undefined) {
      if (!warnedPaths[path]) { warnedPaths[path] = 1; warn('no value at "' + path + '" — returning null'); }
      return null;
    }
    return cur;
  }

  /* --- 사용자 조정값(패치) ------------------------------------------------
   * config JSON 은 정본으로 두고, 강사가 화면에서 바꾼 초는 localStorage 패치로만 얹는다.
   * 로드 우선순위의 맨 마지막 단계 — override/fetch/builtin 중 무엇이 실렸든 그 위에 적용된다.
   * 형태: { "<profile>": { "sections.reading.modules[id=R1].allocatedSec": 1200 } }
   * 경로는 get() 과 같은 문법이고, 없는 경로는 무시하고 경고만 남긴다(F12). */

  function readPatch(profile) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(PATCH_KEY);
      if (!raw) return {};
      var all = JSON.parse(raw);
      return isObj(all) && isObj(all[profile]) ? all[profile] : {};
    } catch (e) { return {}; }
  }

  function writePatch(profile, map) {
    try {
      if (!window.localStorage) return false;
      var all = {};
      var raw = window.localStorage.getItem(PATCH_KEY);
      if (raw) { try { all = JSON.parse(raw) || {}; } catch (e) { all = {}; } }
      if (map && countKeys(map)) all[profile] = map; else delete all[profile];
      window.localStorage.setItem(PATCH_KEY, JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  }

  function countKeys(o) {
    var n = 0;
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) n++; }
    return n;
  }

  /* 경로가 가리키는 자리에 값을 쓴다. 마지막 토큰의 부모까지 get() 과 같은 방식으로 걸어간다.
   * 부모나 키가 없으면 아무것도 만들지 않고 false — 오타 난 경로가 config 를 오염시키지 않는다. */
  function setAt(cfg, path, value) {
    var toks = tokenize(path);
    if (!toks.length) return false;
    var last = toks[toks.length - 1];
    // 대상은 객체의 키(.k) 또는 배열의 원소([i]) 뿐이다. [k=v] 로 끝나는 경로는 값 자리가 아니다.
    if (last.k === undefined && last.i === undefined) return false;
    var cur = cfg;
    for (var i = 0; i < toks.length - 1; i++) {
      var t = toks[i];
      if (cur === null || cur === undefined) return false;
      if (t.k !== undefined) { cur = isObj(cur) ? cur[t.k] : undefined; }
      else if (t.i !== undefined) { cur = (cur instanceof Array) ? cur[t.i] : undefined; }
      else {
        var found;
        if (cur instanceof Array) {
          for (var j = 0; j < cur.length; j++) {
            if (cur[j] && String(cur[j][t.pk]) === t.pv) { found = cur[j]; break; }
          }
        } else if (isObj(cur)) { found = cur[t.pv]; }
        cur = found;
      }
    }
    if (last.i !== undefined) {
      if (!(cur instanceof Array) || last.i < 0 || last.i >= cur.length) return false;
      cur[last.i] = value;
      return true;
    }
    if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, last.k)) return false;
    cur[last.k] = value;
    return true;
  }

  function applyPatch(cfg, profile) {
    var map = readPatch(profile);
    var paths = [];
    for (var k in map) { if (Object.prototype.hasOwnProperty.call(map, k)) paths.push(k); }
    if (!paths.length) return { cfg: cfg, applied: 0, warnings: [] };
    var w = [], n = 0;
    for (var i = 0; i < paths.length; i++) {
      if (setAt(cfg, paths[i], map[paths[i]])) n++;
      else w.push('timing patch path "' + paths[i] + '" not found in config; ignored');
    }
    if (n) w.push(n + ' timing value(s) overridden by local adjustments');
    return { cfg: cfg, applied: n, warnings: w };
  }

  /* 한 값을 조정한다. localStorage 에 남기고 이미 로드된 세션 config 에도 즉시 반영해
   * 호출한 화면이 새로고침 없이 다시 그릴 수 있게 한다.
   * value 가 null 이면 그 경로의 조정을 지우지만, 되돌린 값은 다음 로드부터 보인다. */
  function setPatchValue(path, value, profile) {
    var prof = profile || state.profile || profileFromLocation();
    var map = readPatch(prof);
    if (value === null || value === undefined) delete map[path];
    else map[path] = value;
    var ok = writePatch(prof, map);
    if (value !== null && value !== undefined && state.cfg) setAt(state.cfg, path, value);
    return ok;
  }

  function getPatch(profile) { return readPatch(profile || state.profile || profileFromLocation()); }

  /* 전부 원래 규격으로. 세션 config 는 이미 덮어써졌으므로 호출자가 새로고침해야 한다. */
  function clearPatch(profile) { return writePatch(profile || state.profile || profileFromLocation(), null); }

  /* --- 검증 (timing-spec.md 6절 표) --------------------------------------- */

  function majorOf(v) { return parseInt(String(v || '').split('.')[0], 10); }

  /* 반환: {fatal:boolean, warnings:string[]}. fatal 이면 호출자가 내장 폴백으로 degrade. */
  function validate(cfg) {
    var w = [];
    if (!isObj(cfg)) return { fatal: true, warnings: ['config is not an object'] };
    if (majorOf(cfg.schemaVersion) !== SCHEMA_MAJOR) {
      return { fatal: true, warnings: ['schemaVersion "' + cfg.schemaVersion + '" != major ' + SCHEMA_MAJOR] };
    }
    if (!(cfg.sectionOrder instanceof Array) || !cfg.sectionOrder.length) {
      return { fatal: true, warnings: ['sectionOrder missing or empty'] };
    }
    if (!isObj(cfg.sections)) return { fatal: true, warnings: ['sections missing'] };

    var dirIds = {}, i, j;
    var dirs = (cfg.directions instanceof Array) ? cfg.directions : [];
    for (i = 0; i < dirs.length; i++) dirIds[dirs[i].id] = 1;

    for (i = 0; i < cfg.sectionOrder.length; i++) {
      var sid = cfg.sectionOrder[i];
      var sec = cfg.sections[sid];
      if (!sec) { w.push('sectionOrder has "' + sid + '" but sections.' + sid + ' is missing'); continue; }
      var units = (sec.modules instanceof Array ? sec.modules : []).concat(sec.tasks instanceof Array ? sec.tasks : []);
      for (j = 0; j < units.length; j++) {
        var u = units[j];
        if (u.moduleEndScreen && !dirIds[u.moduleEndScreen]) {
          w.push(sid + '.' + u.id + '.moduleEndScreen "' + u.moduleEndScreen + '" is not a directions[].id');
        }
        var secs = [u.allocatedSec, u.perQuestionSec, u.perTaskSec];
        for (var k = 0; k < secs.length; k++) {
          if (secs[k] !== null && secs[k] !== undefined && !(typeof secs[k] === 'number' && secs[k] > 0)) {
            w.push(sid + '.' + u.id + ' has a non-positive time value; defaults will be used');
          }
        }
      }
      if (isObj(sec.taskTypes)) {
        for (var tt in sec.taskTypes) {
          if (!Object.prototype.hasOwnProperty.call(sec.taskTypes, tt)) continue;
          var T = sec.taskTypes[tt];
          if (!(typeof T.responseSec === 'number' && T.responseSec > 0)) {
            w.push(sid + '.taskTypes.' + tt + '.responseSec is not a positive number');
          }
        }
      }
    }
    for (i = 0; i < dirs.length; i++) {
      var d = dirs[i];
      if (d.insertAt && d.insertAt.section && !cfg.sections[d.insertAt.section]) {
        w.push('directions[' + d.id + '].insertAt.section "' + d.insertAt.section + '" does not exist; screen skipped');
      }
    }
    return { fatal: false, warnings: w };
  }

  /* --- 로딩 -------------------------------------------------------------- */

  function profileFromLocation() {
    try {
      var q = String(window.location.search || '');
      var m = q.match(/[?&]exam=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      var stored = window.localStorage && window.localStorage.getItem(PROFILE_KEY);
      if (stored) return stored;
    } catch (e) { /* file:// 또는 storage 차단 — 기본값으로 진행 */ }
    return DEFAULT_PROFILE;
  }

  function settle(cfg, source, profile, warnings) {
    /* 패치는 사본에만 적용한다 — builtin 은 BUILTINS 리터럴을 공유하므로 원본을 건드리면
     * 다음 로드/다른 프로파일까지 오염된다. 사본 비용은 config 크기라 무시할 수준이다. */
    try { cfg = JSON.parse(JSON.stringify(cfg)); } catch (e) { /* 순환 없음 — 실패하면 원본 그대로 */ }
    var patched = applyPatch(cfg, profile);
    cfg = patched.cfg;
    warnings = (warnings || []).concat(patched.warnings);
    state.patched = patched.applied;
    state.cfg = cfg;
    state.source = source;
    state.profile = profile;
    state.warnings = warnings || [];
    state.loading = false;
    if (source === 'builtin') warn('using builtin fallback timing config (offline or fetch failed)');
    for (var i = 0; i < state.warnings.length; i++) warn(state.warnings[i]);
    var q = state.queue; state.queue = [];
    for (var j = 0; j < q.length; j++) q[j](cfg, meta());
  }

  function meta() {
    return { source: state.source, profile: state.profile, warnings: state.warnings.slice(0) };
  }

  function builtinFor(profile) {
    // 프로파일별 내장 사본(BUILTINS). 없는 프로파일이면 구조가 같은 기본 프로파일로 degrade 하고 경고한다(AC5).
    if (!Object.prototype.hasOwnProperty.call(BUILTINS, profile)) {
      return { cfg: BUILTINS[DEFAULT_PROFILE], warnings: ['no builtin fallback for profile "' + profile + '"; using ' + DEFAULT_PROFILE] };
    }
    return { cfg: BUILTINS[profile], warnings: [] };
  }

  /* 알려진 프로파일인가. fetch 경로에서 존재하지 않는 프로파일을 조기에 걸러
     'config/timing.nonsense.json' 요청을 만들지 않는다(AC5). */
  function knownProfile(p) { return Object.prototype.hasOwnProperty.call(BUILTINS, p); }

  function profileList() {
    var out = [];
    for (var k in BUILTINS) { if (Object.prototype.hasOwnProperty.call(BUILTINS, k)) out.push(k); }
    return out;
  }

  /* 프로파일을 저장한다. 다음 세션의 profileFromLocation() 이 읽는다(AC3). */
  function setProfile(p) {
    try { if (window.localStorage) window.localStorage.setItem(PROFILE_KEY, String(p)); } catch (e) {}
    return p;
  }

  /**
   * 세션 1회 로드. 이미 로드됐으면 캐시를 즉시 콜백한다(AC7).
   * @param {string} [profile] 'toefl' | 'ielts' — 생략 시 ?exam= → localStorage → 'toefl'
   * @param {function(Object, Object)} [cb] cb(cfg, meta)
   */
  function load(profile, cb) {
    if (typeof profile === 'function') { cb = profile; profile = null; }
    cb = cb || function () {};
    if (state.cfg) { cb(state.cfg, meta()); return; }
    if (state.loading) { state.queue.push(cb); return; }

    var prof = profile || profileFromLocation();
    var profWarn = null;
    if (!knownProfile(prof)) {
      // AC5 — 존재하지 않는 프로파일은 fetch 하지 않고 기본 프로파일로 폴백 + warn.
      profWarn = 'unknown exam profile "' + prof + '"; falling back to "' + DEFAULT_PROFILE + '"';
      warn(profWarn);
      prof = DEFAULT_PROFILE;
    }
    state.loading = true;
    state.queue.push(cb);

    function withProfWarn(list) { return profWarn ? [profWarn].concat(list || []) : (list || []); }

    // 1) override
    if (isObj(window.SG_TIMING_OVERRIDE)) {
      var vo = validate(window.SG_TIMING_OVERRIDE);
      if (!vo.fatal) { settle(window.SG_TIMING_OVERRIDE, 'override', prof, withProfWarn(vo.warnings)); return; }
      vo.warnings.push('SG_TIMING_OVERRIDE failed validation; ignoring');
      warn(vo.warnings.join('; '));
    }

    // 2) fetch (best effort — file:// 에서는 실패가 정상 경로)
    var fell = function (why) {
      var b = builtinFor(prof);
      settle(b.cfg, 'builtin', prof, withProfWarn(b.warnings.concat([why])));
    };
    if (typeof window.fetch !== 'function') { fell('fetch() unavailable'); return; }

    try {
      window.fetch('config/timing.' + prof + '.json', { cache: 'force-cache' })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
          return res.json();
        })
        .then(function (json) {
          var v = validate(json);
          if (v.fatal) { fell('config validation failed: ' + v.warnings.join('; ')); return; }
          settle(json, 'fetch', prof, withProfWarn(v.warnings));
        })
        ['catch'](function (err) { fell('fetch failed: ' + (err && err.message ? err.message : err)); });
    } catch (e) {
      fell('fetch threw: ' + (e && e.message ? e.message : e));
    }
  }

  /* fetch 없이 즉시 내장값을 고정한다. node 테스트·긴급 폴백용. */
  function loadBuiltin(profile) {
    var prof = profile || DEFAULT_PROFILE;
    var b = builtinFor(prof);
    settle(b.cfg, 'builtin', prof, b.warnings);
    return state.cfg;
  }

  /* --- 점수 스케일 표시 (Story 6.1 / FR55 프런트 몫) -----------------------
   * 실제 환산은 백엔드 app/scoring/scale.py 가 한다(Story 6.4). 프런트는
   * exam.scoreScale / exam.scale 을 읽어 **표기만** 전환한다. 계산하지 않는다. */

  function examCfg(cfg) { return (cfg || state.cfg || {}).exam || {}; }

  function scoreScale(cfg) { return examCfg(cfg).scoreScale || 'toefl120'; }

  function scaleInfo(cfg) {
    var sc = examCfg(cfg).scale;
    if (isObj(sc)) return sc;
    return { sectionMax: 30, totalMax: 120, step: 1, bandLabel: 'CEFR' };
  }

  /* 총점 표기 문자열.
   *   toefl120 → "98/120 · B2"  (grade 없으면 "98/120")
   *   ielts9   → "Band 7.0"
   * value 가 숫자가 아니면 '' 를 돌려준다(호출자가 '채점 중' 등으로 처리). */
  function formatScore(value, grade, cfg) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    var info = scaleInfo(cfg);
    var half = info.step === 0.5;
    var num = half ? (Math.round(value * 2) / 2).toFixed(1) : String(Math.round(value));
    if (scoreScale(cfg) === 'ielts9') return (info.bandLabel || 'Band') + ' ' + num;
    var s = num + '/' + info.totalMax;
    return grade ? s + ' · ' + grade : s;
  }

  /* 'config: builtin' 배지 (Story 1.1 AC5). 셸이 명시적으로 호출한다 — 자동 삽입 없음. */
  function mountBadge(host) {
    if (state.source !== 'builtin' || !host || !host.appendChild) return null;
    var el = document.createElement('div');
    el.className = 'sg-config-badge';
    el.setAttribute('data-en', 'config: builtin');
    el.setAttribute('data-ko', '설정: 내장값');
    el.textContent = 'config: builtin';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;font-size:11px;opacity:.55;' +
      'color:var(--muted);background:var(--card);border:1px solid var(--line);' +
      'border-radius:var(--radius);padding:2px 8px;pointer-events:none;z-index:9';
    host.appendChild(el);
    return el;
  }

  window.SG_TIMING = {
    SCHEMA_MAJOR: SCHEMA_MAJOR,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    FALLBACK: FALLBACK,
    FALLBACK_IELTS: FALLBACK_IELTS,
    BUILTINS: BUILTINS,
    load: load,
    loadBuiltin: loadBuiltin,
    knownProfile: knownProfile,
    profiles: profileList,
    setProfile: setProfile,
    scoreScale: scoreScale,
    scaleInfo: scaleInfo,
    formatScore: formatScore,
    get: get,
    getPatch: getPatch,
    setPatchValue: setPatchValue,
    clearPatch: clearPatch,
    patched: function () { return state.patched || 0; },
    validate: validate,
    config: function () { return state.cfg; },
    source: function () { return state.source; },
    profile: function () { return state.profile; },
    profileFromLocation: profileFromLocation,
    warnings: function () { return state.warnings.slice(0); },
    mountBadge: mountBadge,
    _reset: function () { // 테스트 전용 — 세션 고정 해제
      state = { cfg: null, source: null, profile: null, warnings: [], loading: false, queue: [], patched: 0 };
      warnedPaths = {};
    }
  };
})();
