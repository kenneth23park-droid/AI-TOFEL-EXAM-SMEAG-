/* SMEAG StudyGround — 문항 교체(override) 저장소.
 *
 * audio-config.js 가 오디오를 원본 경로 기준으로 갈아끼우듯, 이 파일은 문항을
 * "SET id + 문항 id" 기준으로 갈아끼운다. 콘텐츠 팩(assets/set1.js·set9.js)은
 * 절대 건드리지 않는다 — 팩이 window 에 실리는 순간 이 스토어가 그 위에 덮어쓴다.
 *
 * 덮어쓸 수 있는 필드: prompt · choices[] · answer(index) · audio · image · note
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
  var FIELDS = ['prompt', 'choices', 'answer', 'audio', 'image', 'note'];

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
    return n;
  }

  var API = {
    FIELDS: FIELDS,

    get: function (setId, qid) { return data[k(setId, qid)] || null; },
    isOverridden: function (setId, qid) { return !!data[k(setId, qid)]; },
    list: function (setId) {
      var pre = setId ? String(setId).toLowerCase() + '::' : null;
      return Object.keys(data).filter(function (key) { return !pre || key.indexOf(pre) === 0; });
    },
    count: function (setId) { return API.list(setId).length; },

    /** 부분 저장. 값이 null/undefined 인 필드는 "원본 유지"를 뜻한다. */
    set: function (setId, qid, patch) {
      var key = k(setId, qid), cur = data[key] || {};
      FIELDS.forEach(function (f) {
        if (patch[f] === undefined) return;
        if (patch[f] === null || patch[f] === '') delete cur[f];
        else cur[f] = (f === 'choices' && Array.isArray(patch[f])) ? patch[f].slice() : patch[f];
      });
      var live = FIELDS.some(function (f) { return cur[f] !== undefined; });
      if (live) { cur.t = Date.now(); data[key] = cur; } else { delete data[key]; }
      save(); emit();
      return live;
    },
    reset: function (setId, qid) { delete data[k(setId, qid)]; save(); emit(); },
    resetAll: function (setId) {
      API.list(setId).forEach(function (key) { delete data[key]; });
      save(); emit();
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

  /* 이 사이트의 팩 두 개는 항상 후킹해 둔다. 파일이 없으면 아무 일도 없다. */
  API.hookGlobals({ SMEAG_SET1: 'set1', SMEAG_SET9: 'set9' });
})();
