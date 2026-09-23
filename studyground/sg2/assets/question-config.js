/* SMEAG StudyGround — 문항 교체(override) 저장소.
 *
 * audio-config.js 가 오디오를 원본 경로 기준으로 갈아끼우듯, 이 파일은 문항을
 * "SET id + 문항 id" 기준으로 갈아끼운다. 콘텐츠 팩(assets/set1.js·set9.js)은
 * 절대 건드리지 않는다 — 팩이 window 에 실리는 순간 이 스토어가 그 위에 덮어쓴다.
 *
 * 덮어쓸 수 있는 필드: prompt · choices[] · answer(선택지 번호 또는 빈칸 정답 단어) ·
 * hint(빈칸 앞글자) · sentence(insert 문장) · audio · image · note ·
 * timeLimitSec(이 문항의 제한시간, 초 — 없으면 timing 프로필의 모듈 값이 그대로 쓰인다)
 * 원본은 문항 객체의 __sgOrig 에 한 번만 보관하므로, 되돌리기(reset)는 언제나
 * 원본 그대로를 복원한다.
 *
 * 저장: localStorage['sg2_question_overrides_v1']
 *   { "set9::L1-3": { prompt:"…", choices:[…], answer:2, audio:"…", t:1699… } }
 *
 * 노출 전역: window.SG_QUESTIONS
 */
(function () {
  'use strict';

  var LS_KEY = 'sg2_question_overrides_v1';
  /* answer 는 문항 종류에 따라 뜻이 다르다 — 객관식(mcq·insert)은 선택지 번호,
     빈칸(cloze 의 blank)은 정답 단어 그 자체다. hint 는 빈칸의 앞글자,
     sentence 는 insert 문항이 끼워 넣을 문장. */
  var FIELDS = ['prompt', 'choices', 'answer', 'hint', 'sentence',
                'audio', 'image', 'note', 'timeLimitSec'];
  /* 문항이 아니라 "블록의 머리"에 붙는 것 — 각 Task 첫 문항 앞에서 흐르는 안내 방송이다.
     script 는 화면에 적히는 지시문이자 음성을 다시 만들 때 쓰는 대본이고,
     introAudio 는 그 방송 음원의 경로다. 문항 override 와 같은 저장소를 쓰되
     대상 id 만 다르다 — 'set9-S1-intro' 처럼 블록(모듈)마다 하나씩. */
  var INTRO_FIELDS = ['script', 'introAudio'];
  var ALL_FIELDS = FIELDS.concat(INTRO_FIELDS);

  var data = {};            // "set::qid" -> patch
  var packs = [];           // 이미 적용한 팩들 [{pack, setId}] — 변경 시 재적용
  var listeners = [];

  try { data = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { data = {}; }
  if (typeof data !== 'object') data = {};

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* quota/private */ }
  }
  function emit() {
    packs.forEach(function (p) { applyPack(p.pack, p.setId); });
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function k(setId, qid) { return String(setId || '').toLowerCase() + '::' + String(qid || ''); }

  /* ── 팩 순회 ─────────────────────────────────────────────── */
  function eachQuestion(pack, fn) {
    if (!pack || !pack.sections) return;
    pack.sections.forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (block) {
          (block.questions || []).forEach(function (q) { fn(q, block, mod, sec); });
        });
      });
    });
  }

  /* 안내 방송을 가진 블록만 순회한다. id 는 SET 과 모듈에서 만든다 —
     콘텐츠 팩에 적혀 있지 않아도 늘 같은 이름이 나오도록. */
  function introId(setId, modId) {
    return String(setId || '').toLowerCase() + '-' + String(modId || '') + '-intro';
  }
  function eachIntro(pack, setId, fn) {
    if (!pack || !pack.sections) return;
    pack.sections.forEach(function (sec) {
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (block) {
          if (!block || !block.introAudio) return;
          fn(introId(setId, mod.id), block, mod, sec);
        });
      });
    });
  }

  function snapshotIntro(block) {
    if (block.__sgOrigIntro) return block.__sgOrigIntro;
    var o = {};
    INTRO_FIELDS.forEach(function (f) { o[f] = block[f]; });
    try {
      Object.defineProperty(block, '__sgOrigIntro', { value: o, enumerable: false, writable: false });
    } catch (e) { block.__sgOrigIntro = o; }
    return o;
  }

  function snapshot(q) {
    if (q.__sgOrig) return q.__sgOrig;
    var o = {};
    FIELDS.forEach(function (f) {
      o[f] = f === 'choices' && Array.isArray(q[f]) ? q[f].slice() : q[f];
    });
    try {
      Object.defineProperty(q, '__sgOrig', { value: o, enumerable: false, writable: false });
    } catch (e) { q.__sgOrig = o; }
    return o;
  }

  /* 팩 하나에 현재 override 를 반영한다. 항상 원본 복원 → 패치 적용 순서라
     여러 번 호출해도 결과가 같다(멱등). */
  function applyPack(pack, setId) {
    if (!pack) return 0;
    var n = 0;
    eachQuestion(pack, function (q) {
      var orig = snapshot(q);
      FIELDS.forEach(function (f) {
        var v = orig[f];
        q[f] = (f === 'choices' && Array.isArray(v)) ? v.slice() : v;
      });
      var patch = data[k(setId, q.id)];
      if (!patch) return;
      FIELDS.forEach(function (f) {
        if (patch[f] === undefined || patch[f] === null) return;
        q[f] = (f === 'choices' && Array.isArray(patch[f])) ? patch[f].slice() : patch[f];
      });
      q.__sgOverridden = true;
      n++;
    });
    // 되돌려진 문항의 표시 플래그 정리
    eachQuestion(pack, function (q) { if (!data[k(setId, q.id)]) delete q.__sgOverridden; });
    // 안내 방송도 같은 방식으로 — 원본 복원 뒤 패치를 얹는다(멱등).
    eachIntro(pack, setId, function (id, block) {
      var orig = snapshotIntro(block);
      INTRO_FIELDS.forEach(function (f) { block[f] = orig[f]; });
      var patch = data[k(setId, id)];
      if (!patch) { delete block.__sgOverridden; return; }
      INTRO_FIELDS.forEach(function (f) {
        if (patch[f] === undefined || patch[f] === null) return;
        block[f] = patch[f];
      });
      block.__sgOverridden = true;
      n++;
    });
    return n;
  }

  var API = {
    FIELDS: FIELDS,
    INTRO_FIELDS: INTRO_FIELDS,

    get: function (setId, qid) { return data[k(setId, qid)] || null; },
    isOverridden: function (setId, qid) { return !!data[k(setId, qid)]; },
    list: function (setId) {
      var pre = setId ? String(setId).toLowerCase() + '::' : null;
      return Object.keys(data).filter(function (key) { return !pre || key.indexOf(pre) === 0; });
    },
    count: function (setId) { return API.list(setId).length; },
    /** 이 SET 의 교체분 지문(指紋). 시험 셸이 "이어서 응시" 가능 여부를 판정할 때
     *  콘텐츠 해시에 섞는다 — 문항이나 제한시간이 바뀌면 옛 세션을 이어받지 않는다. */
    signature: function (setId) {
      var keys = API.list(setId).sort();
      return keys.map(function (key) {
        var p = data[key] || {};
        return key + '@' + (p.t || 0) + '#' + ALL_FIELDS.filter(function (f) { return p[f] !== undefined; }).join('.');
      }).join('|');
    },

    /** 부분 저장. 값이 null/undefined 인 필드는 "원본 유지"를 뜻한다. */
    set: function (setId, qid, patch) {
      var key = k(setId, qid), cur = data[key] || {};
      var had = !!data[key], prev = {};
      ALL_FIELDS.forEach(function (f) { prev[f] = cur[f]; });
      ALL_FIELDS.forEach(function (f) {
        if (patch[f] === undefined) return;
        if (patch[f] === null || patch[f] === '') delete cur[f];
        else cur[f] = (f === 'choices' && Array.isArray(patch[f])) ? patch[f].slice() : patch[f];
      });
      var live = ALL_FIELDS.some(function (f) { return cur[f] !== undefined; });
      if (live) { cur.t = Date.now(); data[key] = cur; } else { delete data[key]; }
      save(); emit();
      // 개발자가 나중에 읽을 수 있게 바뀐 필드만 한 줄씩 남긴다(admin-log.html).
      if (window.SG_LOG) {
        var next = {}; ALL_FIELDS.forEach(function (f) { next[f] = live ? cur[f] : undefined; });
        SG_LOG.diff({ set: setId, target: qid, fields: ALL_FIELDS, before: prev, after: next,
                      action: had ? (live ? 'update' : 'delete') : 'create' });
      }
      return live;
    },
    reset: function (setId, qid) {
      var prev = data[k(setId, qid)];
      delete data[k(setId, qid)]; save(); emit();
      if (window.SG_LOG && prev) {
        SG_LOG.add({ set: setId, action: 'delete', target: qid, note: 'reverted to the original question',
                     before: prev });
      }
    },
    resetAll: function (setId) {
      var n = API.list(setId).length;
      API.list(setId).forEach(function (key) { delete data[key]; });
      save(); emit();
      if (window.SG_LOG) SG_LOG.add({ set: setId, action: 'reset', target: '(all questions)',
                                      note: n + ' overrides removed' });
    },

    exportJson: function (setId) {
      var out = {};
      API.list(setId).forEach(function (key) { out[key] = data[key]; });
      return JSON.stringify({ version: 1, questions: out }, null, 2);
    },
    importJson: function (text) {
      var j; try { j = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON.'); }
      var m = (j && j.questions) || j;
      if (!m || typeof m !== 'object') throw new Error('No "questions" map found.');
      Object.keys(m).forEach(function (key) {
        if (key.indexOf('::') < 0) return;
        data[key] = m[key];
      });
      save(); emit();
      if (window.SG_LOG) SG_LOG.add({ action: 'import', target: '(questions)',
                                      note: Object.keys(m).length + ' overrides imported' });
      return Object.keys(m).length;
    },

    /** 렌더 전에 팩에 반영하고, 이후 변경도 이 팩에 계속 따라붙게 등록한다. */
    applyPack: function (pack, setId) {
      if (!pack) return 0;
      var known = packs.some(function (p) { return p.pack === pack && p.setId === setId; });
      if (!known) packs.push({ pack: pack, setId: setId });
      return applyPack(pack, setId);
    },
    eachQuestion: eachQuestion,
    eachIntro: eachIntro,
    introId: introId,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /** 아직 로드되지 않은 콘텐츠 팩까지 잡는다.
     *  window.SMEAG_SET9 = {...} 대입 순간에 가로채 override 를 먼저 입힌다 —
     *  exam-runtime 처럼 팩을 나중에 <script> 로 붙이는 화면을 위한 것. */
    hookGlobals: function (map) {
      Object.keys(map).forEach(function (name) {
        var setId = map[name];
        if (window[name]) { API.applyPack(window[name], setId); return; }
        var store;
        try {
          Object.defineProperty(window, name, {
            configurable: true,
            get: function () { return store; },
            set: function (v) { store = v; if (v) API.applyPack(v, setId); }
          });
        } catch (e) { /* 이미 정의됨 — 로드 후 applyPack 을 직접 부를 것 */ }
      });
    }
  };

  window.SG_QUESTIONS = API;

  /* 이 사이트의 팩은 항상 후킹해 둔다. 파일이 없으면 아무 일도 없다. */
  API.hookGlobals({ SMEAG_SET1: 'set1', SMEAG_SET9: 'set9', SMEAG_SET10: 'set10', SMEAG_SET11: 'set11', SMEAG_SET12: 'set12', SMEAG_SET2: 'set2', SMEAG_SET3: 'set3' });
})();
