/* SMEAG StudyGround — tts-plan.js : "이 세트를 소리로 만들려면 무엇을 어떻게 부르는가".
 *
 * 대본을 음성으로 만드는 일에서 네트워크를 타지 않는 부분만 모았다. 어느 자리를
 * 읽어야 하는지(jobsFrom), 누구 목소리로 읽는지(caster), 한 번에 얼마씩 보내는지
 * (segmentsFor · batches). 실제로 부르는 것은 assets/tts-client.js 다.
 *
 * 왜 갈라 뒀나 — 여기가 틀리면 돈이 나간 뒤에야 안다. 화면 안에 두면 브라우저를 띄워야
 * 확인할 수 있어서, 판정만 떼어 node 로 검산한다(tests/test_tts_plan.js).
 *
 * 배역(caster)
 *   화자 이름 → 목소리를 **세트 전체에서 한 벌** 로 잡는다. 같은 "M" 이 문항마다 다른
 *   사람이면 리스닝이 성립하지 않는다. 남/여 표시가 있는 화자는 그 성별 풀에서 고른다 —
 *   "M: … W: …" 는 대본이 이미 남녀를 정해 둔 것이라, 목소리가 그걸 뒤집으면 안 된다.
 *
 * 자르기(segmentsFor · batches)
 *   서버는 한 번에 20토막·6000자까지 받는다(api/tts.js). 강의 대본은 그보다 길어서
 *   잘라 보내고 받은 mp3 를 순서대로 이어 붙인다. 같은 화자가 이어지는 줄은 먼저 합쳐
 *   요청 수를 줄이고, 상한을 넘는 토막은 문장 경계에서 나눈다 — 문장 중간에서 자르면
 *   그 자리에서 억양이 끊긴다.
 *
 * ES5 문법만 쓴다(빌드 단계 없음). dup-core.js 와 같은 UMD 껍데기.
 */
(function (root, factory) {
  var api = factory();
  root.SG_TTS_PLAN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* api/tts.js 의 상한과 같아야 한다. 여기가 크면 400 을 받고, 작으면 요청만 늘어난다. */
  var MAX_SEG = 20, MAX_CHARS = 6000, MAX_ONE = 1200;

  /** 화자 표시가 붙은 대본 → [{speaker, text}]. tts-client.parseScript 와 같은 규칙이다. */
  function parseScript(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var m = /^([A-Za-z][A-Za-z0-9 ._'-]{0,24}):\s*(.+)$/.exec(t);
      if (m) out.push({ speaker: m[1].trim(), text: m[2].trim() });
      else if (out.length && !/[:]$/.test(t)) out[out.length - 1].text += ' ' + t;
      else out.push({ speaker: 'Narrator', text: t });
    });
    return out;
  }

  /* ── 무엇을 읽어야 하는가 ──────────────────────────────────────────────
   * 팩을 훑어 "가리키는 mp3 경로가 있고, 그 자리에 읽을 대본도 있는" 곳을 모은다.
   * 경로가 없으면 만들어도 걸 데가 없고, 대본이 없으면 읽을 것이 없다.
   *
   * resolve 는 경로를 오버라이드 키로 바꾸는 함수다(브라우저에서는
   * SG_AUDIO_INDEX.resolve). 키가 다른 관리자 화면과 어긋나면, 만들어 놓고도
   * 시험 화면에서 걸리지 않는다 — 그래서 그 규칙을 여기서 새로 만들지 않고 받아 쓴다.
   */
  function jobsFrom(pack, resolve) {
    var out = [], seen = {};
    var key = resolve || function (p) { return p; };
    function add(path, script, label) {
      if (!path || !script || !String(script).trim()) return;
      var k = key(path);
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ key: k, path: path, script: String(script), label: label, chars: String(script).length });
    }
    ((pack && pack.sections) || []).forEach(function (sec) {
      // 읽어야 하는 것은 리스닝과 스피킹뿐이다. 리딩·라이팅에는 음원 자리가 없다.
      if (sec.id !== 'listening' && sec.id !== 'speaking') return;
      (sec.modules || []).forEach(function (mod) {
        (mod.blocks || []).forEach(function (blk) {
          var head = ((mod.label || mod.id || '') + ' · ' + (blk.heading || '')).trim();
          /* 안내 방송이 먼저다 — 대본을 두 이름으로 두는 팩이 있어서(introScript 와
             script) 있는 쪽을 쓴다. 안내를 block.script 로 읽고 나면 아래의
             add(blk.audio, blk.script) 는 같은 대본을 다른 경로에 또 붙일 수 있는데,
             스피킹 블록에는 blk.audio 가 없어서 실제로는 겹치지 않는다. */
          add(blk.introAudio, blk.introScript || blk.script, head + ' Instructions');
          add(blk.audio, blk.script, head);
          (blk.questions || []).forEach(function (q) {
            add(q.audio, q.script, (head + ' ' + (q.id || '')).trim());
          });
        });
      });
    });
    return out;
  }

  /* ── 배역 ─────────────────────────────────────────────────────────── */
  function caster(voices) {
    var list = (voices || []).filter(function (v) { return v && v.id; });
    var map = {}, pools = {}, at = {};
    function pool(name) {
      if (pools[name]) return pools[name];
      var f = name === 'any' ? list : list.filter(function (v) {
        return String(v.gender || '').toLowerCase().indexOf(name) === 0;
      });
      pools[name] = f.length ? f : list;
      at[name] = 0;
      return pools[name];
    }
    return function (speaker) {
      if (!list.length) return '';
      if (map[speaker]) return map[speaker];
      var s = String(speaker || '').toLowerCase();
      var want = /^(m|male|man|mr|boy|professor|prof)\b/.test(s) ? 'male'
               : /^(w|f|female|woman|ms|mrs|girl)\b/.test(s) ? 'female' : 'any';
      var p = pool(want);
      map[speaker] = p[(at[want]++) % p.length].id;
      return map[speaker];
    };
  }

  /* ── 자르기 ───────────────────────────────────────────────────────── */
  function segmentsFor(script, cast) {
    var raw = parseScript(script), segs = [];
    raw.forEach(function (s) {
      var last = segs[segs.length - 1];
      if (last && last.speaker === s.speaker && (last.text.length + s.text.length + 1) <= MAX_ONE) {
        last.text += ' ' + s.text;
        return;
      }
      var t = s.text;
      while (t.length > MAX_ONE) {
        var cut = t.lastIndexOf(' ', MAX_ONE);
        var dot = t.lastIndexOf('. ', MAX_ONE);
        if (dot > MAX_ONE * 0.5) cut = dot + 1;
        if (cut <= 0) cut = MAX_ONE;
        segs.push({ speaker: s.speaker, text: t.slice(0, cut).trim() });
        t = t.slice(cut).trim();
      }
      if (t) segs.push({ speaker: s.speaker, text: t });
    });
    return segs.map(function (s) { return { text: s.text, voice: cast ? cast(s.speaker) : '' }; });
  }

  function batches(segs) {
    var out = [], cur = [], chars = 0;
    (segs || []).forEach(function (s) {
      if (cur.length && (cur.length >= MAX_SEG || (chars + s.text.length) > MAX_CHARS)) {
        out.push(cur); cur = []; chars = 0;
      }
      cur.push(s); chars += s.text.length;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  return {
    MAX_SEG: MAX_SEG, MAX_CHARS: MAX_CHARS, MAX_ONE: MAX_ONE,
    parseScript: parseScript, jobsFrom: jobsFrom, caster: caster,
    segmentsFor: segmentsFor, batches: batches
  };
});
