/* SMEAG StudyGround — /api/tts 클라이언트.
 *
 * 관리자 화면에서 "문항 스크립트 → mp3" 를 부르는 얇은 층이다. 키는 서버(Vercel
 * 환경변수)에만 있고, 브라우저는 공용 토큰(SG_TTS_TOKEN)만 들고 있다.
 * 토큰은 이 기기의 localStorage 에 남는다 — 관리자 로그인과 같은 성격의 가림막이다.
 *
 * 엔진은 다섯이고 기본은 ElevenLabs 다 — 시험 음성 정본이 전부 그 계정의 목소리로
 * 만들어졌고, 이미 있는 세트의 한 문항만 다른 엔진으로 다시 만들면 그 문항만 목소리가
 * 튄다. 새 세트를 통째로 지을 때는 어느 엔진이든 처음부터 끝까지 한 엔진으로 가면 된다
 * (api/tts.js 머리말). 모델·목소리 목록은 서버가 알려준다. 서버에 닿지 못하면 아래
 * FALLBACK 으로 화면만 서고, 생성 버튼은 이유를 말해 준다.
 *
 * 노출 전역: window.SG_TTS_GEN
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'sg2_tts_token';
  var KEYS_KEY = 'sg2_tts_keys';     // { providerId: {key, region} }
  var ENDPOINT = 'api/tts';

  /* 엔진 키 보관.
   *
   * 기본은 여전히 서버 환경변수다 — 정적 사이트라 프런트에 키를 심으면 그대로 공개된다.
   * 다만 환경변수가 없는 기기에서도 관리자가 자기 키로 바로 쓸 수 있어야 해서, 이 기기의
   * localStorage 에만 두고 요청 헤더로 한 번씩 실어 보낸다.
   *
   * 이 방식의 한계를 분명히 해 둔다: localStorage 는 같은 출처의 스크립트와 이 기기를
   * 쓰는 사람이면 읽을 수 있다. 공용 PC 에 넣지 말고, 팀이 함께 쓸 키라면 서버
   * 환경변수에 두는 편이 맞다. 화면에는 마스킹해서만 보여준다. */
  function allKeys() {
    try { return JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function keyOf(pid) {
    pid = pid || 'elevenlabs';
    var e = allKeys()[pid];
    return (e && e.key) || '';
  }
  function saveKey(pid, key) {
    var all = allKeys();
    if (key) all[pid] = { key: String(key).trim() };
    else delete all[pid];
    try { localStorage.setItem(KEYS_KEY, JSON.stringify(all)); } catch (e) {}
    catalogCache = null;            // ready 판정이 달라지므로 목록을 다시 받는다
  }
  /** 화면 표시용. 앞 4·뒤 4 만 남긴다 — 어느 키인지 알아볼 수는 있고, 새어 나가지는 않는다. */
  function maskKey(k) {
    k = String(k || '');
    if (!k) return '';
    if (k.length <= 10) return k.slice(0, 2) + '••••';
    return k.slice(0, 4) + '••••••••' + k.slice(-4);
  }
  /** 이 기기에 붙여넣은 키가 있으면 그것만 실어 보낸다. */
  function credHeaders(pid) {
    var h = {};
    var k = keyOf(pid || 'elevenlabs');
    if (k) h['x-sg-key'] = k;
    return h;
  }

  /* 서버 목록을 못 받았을 때 화면을 세우기 위한 최소 세트.
     SET 9 배역표(config/set9-voice-casting.json)의 13인 그대로다 — 시험 음성 정본을
     만든 voice_id 이므로, 한 문항을 다시 만들어도 나머지와 같은 목소리가 나온다.
     계정이 다르면 이 id 는 맞지 않는다. 그때는 서버에서 받은 목록이 이 자리를 대신한다. */
  var FALLBACK_VOICES = [
    { id: 'FGY2WhTYpPnrIDTdsKH5', lang: 'en-US', label: 'US · Ava (F) — Laura' },
    { id: 'EXAVITQu4vr4xnSDxMaL', lang: 'en-US', label: 'US · Emma (F) — Sarah' },
    { id: 'XrExE9yKIg1WjnnlVkGX', lang: 'en-US', label: 'US · Mia (F) — Matilda' },
    { id: 'cgSgspJ2msm6clMCkdW9', lang: 'en-US', label: 'US · Zoe (F) — Jessica' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', lang: 'en-US', label: 'US · Liam (M) — Liam' },
    { id: 'cjVigY5qzO86Huf0OWal', lang: 'en-US', label: 'US · Mason (M) — Eric' },
    { id: 'nPczCjzI2devNBz1zQrb', lang: 'en-US', label: 'US · Ethan (M) — Brian' },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', lang: 'en-US', label: 'US · Noah (M) — Roger' },
    { id: 'Xb7hH8MSUJpSbSDYk0k2', lang: 'en-GB', label: 'GB · Alice (F) — Alice' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', lang: 'en-GB', label: 'GB · Ivy (F) — Lily' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', lang: 'en-GB', label: 'GB · Henry (M) — George' },
    { id: 'onwK4e9ZLuTAKqWW03F9', lang: 'en-GB', label: 'GB · Oliver (M) — Daniel' },
    { id: 'VyyyOgRmsqOzaZXnKWnI', lang: 'en-AU', label: 'AU · Lily (F) — Sunny' }
  ];
  /* 서버가 안 뜬 상태에서도 화면이 서야 해서, 엔진 목록은 여기에도 한 벌 적어 둔다.
     값은 api/tts.js 의 ENGINES 와 같아야 한다 — 어긋나면 화면이 없는 모델을 보여 준다.
     ready:false 로 두는 것이 핵심이다. 서버에 닿아야 진짜 상태를 안다. */
  var FALLBACK = {
    providers: [
      { id: 'elevenlabs', label: 'ElevenLabs',
        models: ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_v3'],
        defaultModel: 'eleven_flash_v2_5', langs: [], speed: { min: 0.7, max: 1.2 },
        free: '가입 시 무료 크레딧, 이후 유료', envVar: 'ELEVENLABS_API_KEY' },
      { id: 'openai', label: 'OpenAI',
        models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
        defaultModel: 'gpt-4o-mini-tts', langs: [], speed: { min: 0.25, max: 4 },
        free: '무료 없음 · 1M자 약 $12(gpt-4o-mini-tts)', envVar: 'OPENAI_API_KEY' },
      { id: 'google', label: 'Google Cloud TTS',
        models: ['v1'], defaultModel: 'v1',
        langs: ['en-US', 'en-GB', 'en-AU', 'en-IN'], speed: { min: 0.25, max: 4 },
        free: '월 100만자 무료(Standard)', envVar: 'GOOGLE_TTS_API_KEY' },
      { id: 'deepgram', label: 'Deepgram Aura',
        models: ['aura-2', 'aura'], defaultModel: 'aura-2', langs: [], speed: { min: 1, max: 1 },
        free: '가입 시 $200 크레딧', envVar: 'DEEPGRAM_API_KEY' },
      /* 무료 한도가 있는 유일한 엔진 — 화면이 FREE 로 표시한다(freeTier). WAV 로 내준다. */
      { id: 'qwen', label: 'Qwen TTS',
        models: ['qwen3-tts-flash', 'qwen-tts'], defaultModel: 'qwen3-tts-flash',
        langs: [], speed: { min: 1, max: 1 }, mime: 'audio/wav', ext: 'wav', freeTier: true,
        free: '신규 계정 무료 한도(모델당 100만 토큰 · 90일)', envVar: 'DASHSCOPE_API_KEY' }
    ].map(function (p) {
      if (!p.mime) p.mp3 = 'native';
      p.mime = p.mime || 'audio/mpeg'; p.ext = p.ext || 'mp3';
      p.gap = false; p.acceptsKey = true;
      p.ready = false; p.envReady = false; p.note = 'server unreachable';
      return p;
    }),
    voices: { elevenlabs: FALLBACK_VOICES },
    langs: []
  };

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function noFn(status) { return status === 404 || status === 405 || status === 501; }

  function post(payload) {
    var h = { 'Content-Type': 'application/json', 'x-sg-token': token() };
    var cred = credHeaders(payload && payload.provider);
    for (var n in cred) if (cred.hasOwnProperty(n)) h[n] = cred[n];
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) {
          var msg = (j && j.error) ||
            (noFn(r.status) ? 'No /api/tts on this server — audio generation only runs on the deployed site.'
                            : 'HTTP ' + r.status);
          var err = new Error(msg); err.status = r.status; throw err;
        }
        return j;
      });
    });
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), n = bin.length, buf = new Uint8Array(n);
    for (var i = 0; i < n; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime || 'audio/mpeg' });
  }

  function label(v) {
    if (v.label) return v.label;
    var bits = [];
    if (v.lang) bits.push(v.lang);
    bits.push(v.name || v.id);
    var g = (v.gender || '').charAt(0).toUpperCase();
    return bits.join(' · ') + (g ? ' (' + g + ')' : '');
  }

  var catalogCache = null;

  var API = {
    FALLBACK_VOICES: FALLBACK_VOICES,

    hasToken: function () { return !!token(); },
    /** 이 브라우저에 저장된 공용 토큰. /api/generate 도 같은 토큰으로 열리므로
     *  관리자 화면이 꺼내 쓴다(assets/set-generate.js 의 adminToken). */
    getToken: function () { return token(); },

    /* 엔진 키 — 화면이 쓰는 표면. 값 자체는 이 모듈 밖으로 원문 그대로 나가지 않는다. */
    hasKey: function (pid) { return !!keyOf(pid); },
    keyMask: function (pid) { return maskKey(keyOf(pid)); },
    setKey: function (pid, key) { saveKey(pid, key); },
    clearKey: function (pid) { saveKey(pid, ''); },
    setToken: function (t) {
      catalogCache = null;
      try { t ? localStorage.setItem(TOKEN_KEY, String(t).trim()) : localStorage.removeItem(TOKEN_KEY); }
      catch (e) {}
    },

    /** 대본 텍스트 → 세그먼트.
     *  "Speaker 1: 안녕" 처럼 앞에 화자 이름을 쓰면 화자별로 나뉘고,
     *  없으면 전체가 한 화자로 간다. 빈 줄은 무시한다. */
    parseScript: function (text) {
      var out = [];
      String(text || '').split(/\r?\n/).forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        /* 화자 표시는 대문자로 시작하는 낱말 1~3개다(M · W · Narrator · Professor Kim).
           문장 한가운데의 콜론까지 표시로 보면 강의 한 대목이 통째로 화자가 된다 —
           SET 12 L2 'So the takeaway is this: ...' 가 그렇게 화자로 잡혀 배역이 갈렸다.
           낱말마다 첫 글자가 대문자여야 한다는 조건 하나로 그 줄들이 걸러진다. */
        var m = /^([A-Z][A-Za-z0-9._'-]{0,15}(?: [A-Z0-9][A-Za-z0-9._'-]{0,15}){0,2}):\s*(.+)$/.exec(t);
        if (m) out.push({ speaker: m[1].trim(), text: m[2].trim() });
        else if (out.length && !/[:]$/.test(t)) out[out.length - 1].text += ' ' + t;
        else out.push({ speaker: 'Narrator', text: t });
      });
      return out;
    },
    speakersOf: function (segs) {
      var seen = [], i;
      for (i = 0; i < segs.length; i++) if (seen.indexOf(segs[i].speaker) < 0) seen.push(segs[i].speaker);
      return seen;
    },

    /** 엔진·언어·모델·목소리 목록. mp3 를 그대로 내주는 엔진만 서버가 싣는다. */
    catalog: function (langs) {
      if (catalogCache) return Promise.resolve(catalogCache);
      var q = langs && langs.length ? ('?lang=' + encodeURIComponent(langs.join(','))) : '';
      return fetch(ENDPOINT + q, { headers: { 'x-sg-token': token() } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.providers) return FALLBACK;
          Object.keys(j.voices || {}).forEach(function (p) {
            j.voices[p] = (j.voices[p] || []).map(function (v) {
              return { id: v.id || v.name, name: v.name, lang: v.lang, gender: v.gender,
                       family: v.family, label: label(v) };
            });
          });
          /* 서버는 자기 환경변수만 보고 ready 를 매긴다. 이 기기에 붙여넣은 키는
             서버가 모르므로 여기서 얹어 준다. 카탈로그 요청에 키를 실어 보내지 않는 건
             의도적이다 — 목록을 받는 것뿐인데 키가 네트워크를 오갈 이유가 없다. */
          (j.providers || []).forEach(function (p) {
            if (p.envReady === undefined) p.envReady = p.ready;
            if (!p.local && p.acceptsKey && !p.envReady && keyOf(p.id)) {
              p.ready = true;
              p.byLocalKey = true;
              p.note = '';
            }
          });
          catalogCache = j;
          return j;
        })
        .catch(function () { return FALLBACK; });
    },
    /** 로컬 키로만 열린 엔진의 목소리 목록을 그 키로 받아 카탈로그에 채워 넣는다.
     *  서버가 카탈로그를 만들 때는 이 키를 몰라 voices[pid] 가 비어 있다. */
    loadVoicesWithKey: function (cat, pid, langs) {
      if (!cat || !pid || !keyOf(pid)) return Promise.resolve(cat);
      if ((cat.voices && cat.voices[pid] || []).length) return Promise.resolve(cat);
      var q = '?provider=' + encodeURIComponent(pid) +
              (langs && langs.length ? '&lang=' + encodeURIComponent(langs.join(',')) : '');
      var h = { 'x-sg-token': token() };
      var cred = credHeaders(pid);
      for (var n in cred) if (cred.hasOwnProperty(n)) h[n] = cred[n];
      return fetch(ENDPOINT + q, { headers: h })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var list = (j && j.voices && j.voices[pid]) || [];
          if (list.length) {
            cat.voices = cat.voices || {};
            cat.voices[pid] = list.map(function (v) {
              return { id: v.id || v.name, name: v.name, lang: v.lang, gender: v.gender,
                       family: v.family, label: label(v) };
            });
          }
          return cat;
        })
        .catch(function () { return cat; });
    },

    /** 고를 수 있는 목소리. ElevenLabs 의 model 은 목소리를 가르지 않고(같은 목소리를
     *  어느 모델로도 읽는다), 언어는 다국어 모델이 자동 판별하므로 필터가 남는 건
     *  액센트 표시뿐이다. 걸러서 비면 전체를 돌려준다 — 빈 목록은 화면을 못 세운다. */
    voicesFor: function (cat, providerId, lang) {
      var all = (cat.voices && cat.voices[providerId || 'elevenlabs']) || [];
      if (!lang) return all;
      var hit = all.filter(function (v) { return !v.lang || v.lang === lang; });
      return hit.length ? hit : all;
    },
    /** 이전 버전 호환 — 목소리 목록만 평평하게. */
    listVoices: function () {
      return API.catalog().then(function (c) {
        return (c.voices && c.voices.elevenlabs) || FALLBACK_VOICES;
      });
    },

    /** segments: [{text, voice}] → { blob, file, chars, bytes, provider, model } */
    generate: function (opts) {
      opts = opts || {};
      return post({
        provider: opts.provider, model: opts.model, lang: opts.lang,
        segments: opts.segments, gapMs: opts.gapMs, rate: opts.rate, pitch: opts.pitch
      }).then(function (j) {
        /* 엔진마다 내주는 형식이 다르다(Qwen 은 WAV). mp3 로 못 박아 두면 파일 이름과
           속이 어긋나서, 나중에 배포한 뒤에야 안 들린다는 것을 알게 된다. */
        var mime = j.mime || 'audio/mpeg';
        var ext = j.ext || (/wav/i.test(mime) ? 'wav' : 'mp3');
        var blob = b64ToBlob(j.audio, mime);
        var name = (opts.filename || 'generated').replace(/[^\w.-]+/g, '-') + '.' + ext;
        var file = new File([blob], name, { type: mime });
        return { blob: blob, file: file, mime: mime, ext: ext, chars: j.chars, bytes: j.bytes,
                 segments: j.segments, provider: j.provider, model: j.model, gapApplied: j.gapApplied };
      });
    }
  };

  window.SG_TTS_GEN = API;
})();
