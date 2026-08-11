/* SMEAG StudyGround — /api/tts 클라이언트.
 *
 * 관리자 화면에서 "문항 스크립트 → mp3" 를 부르는 얇은 층이다. 키는 서버(Vercel
 * 환경변수)에만 있고, 브라우저는 공용 토큰(SG_TTS_TOKEN)만 들고 있다.
 * 토큰은 이 기기의 localStorage 에 남는다 — 관리자 로그인과 같은 성격의 가림막이다.
 *
 * 엔진(google · elevenlabs · azure · openai · kokoro)·언어·모델·목소리 목록은
 * 서버가 알려준다. 프런트에 목록을 복제하지 않으려는 것 — 키가 설정된 엔진만 열린다.
 * 서버에 닿지 못하면 아래 FALLBACK 으로 화면만 서고, 생성 버튼은 이유를 말해 준다.
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
  function keyOf(pid) { var e = allKeys()[pid]; return (e && e.key) || ''; }
  function regionOf(pid) { var e = allKeys()[pid]; return (e && e.region) || ''; }
  function saveKey(pid, key, region) {
    var all = allKeys();
    if (key) all[pid] = { key: String(key).trim(), region: String(region || '').trim() };
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
  /** 선택한 엔진의 키만 실어 보낸다. 쓰지도 않을 다른 키까지 보낼 이유가 없다. */
  function credHeaders(pid) {
    var h = {};
    if (!pid) return h;
    var k = keyOf(pid); if (k) h['x-sg-key'] = k;
    var r = regionOf(pid); if (r) h['x-sg-region'] = r;
    return h;
  }

  /* 서버 목록을 못 받았을 때 화면을 세우기 위한 최소 세트.
     tools/tts_google.py 로 SET 9 를 만들 때 쓴 12개와 같다. */
  var FALLBACK_VOICES = [
    { id: 'en-US-Neural2-C', lang: 'en-US', label: 'US · Ava (F)' },
    { id: 'en-US-Neural2-F', lang: 'en-US', label: 'US · Mia (F)' },
    { id: 'en-US-Neural2-E', lang: 'en-US', label: 'US · Emma (F)' },
    { id: 'en-US-Neural2-G', lang: 'en-US', label: 'US · Zoe (F)' },
    { id: 'en-US-Neural2-D', lang: 'en-US', label: 'US · Liam (M)' },
    { id: 'en-US-Neural2-J', lang: 'en-US', label: 'US · Mason (M)' },
    { id: 'en-US-Neural2-A', lang: 'en-US', label: 'US · Noah (M)' },
    { id: 'en-US-Neural2-I', lang: 'en-US', label: 'US · Ethan (M)' },
    { id: 'en-GB-Neural2-A', lang: 'en-GB', label: 'GB · Alice (F)' },
    { id: 'en-GB-Neural2-B', lang: 'en-GB', label: 'GB · Oliver (M)' },
    { id: 'en-GB-Neural2-D', lang: 'en-GB', label: 'GB · Henry (M)' },
    { id: 'en-AU-Neural2-A', lang: 'en-AU', label: 'AU · Lily (F)' }
  ];
  var FALLBACK = {
    providers: [{ id: 'google', label: 'Google Cloud TTS', mp3: 'native', gap: true,
                  free: '월 100만자 무료 티어', models: ['Neural2'], defaultModel: 'Neural2',
                  langs: ['en-US', 'en-GB', 'en-AU'], ready: false, note: 'server unreachable' }],
    voices: { google: FALLBACK_VOICES },
    langs: ['en-US', 'en-GB', 'en-AU']
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

    /* 엔진 키 — 화면이 쓰는 표면. 값 자체는 이 모듈 밖으로 원문 그대로 나가지 않는다. */
    hasKey: function (pid) { return !!keyOf(pid); },
    keyMask: function (pid) { return maskKey(keyOf(pid)); },
    regionOf: function (pid) { return regionOf(pid); },
    setKey: function (pid, key, region) { saveKey(pid, key, region); },
    clearKey: function (pid) { saveKey(pid, '', ''); },
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
        var m = /^([A-Za-z][A-Za-z0-9 ._'-]{0,24}):\s*(.+)$/.exec(t);
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

    /** 엔진+언어+모델에 맞는 목소리만 추린다.
     *  비면 조건을 단계적으로 푼다 — 모델 먼저, 그래도 없으면 언어까지.
     *  (언어를 끝까지 붙들면 "그 언어에 그 모델이 없다"는 이유로 빈 목록이 나온다.) */
    voicesFor: function (cat, providerId, lang, model) {
      var all = (cat.voices && cat.voices[providerId]) || [];
      function byLang(v) { return !lang || !v.lang || v.lang === lang; }
      function byModel(v) {
        if (!model || !v.family) return true;
        if (providerId === 'google') return v.family.toLowerCase().indexOf(model.toLowerCase()) >= 0;
        return true;                      // 다른 엔진의 model 은 목소리를 가르지 않는다
      }
      var strict = all.filter(function (v) { return byLang(v) && byModel(v); });
      if (strict.length) return strict;
      var langOnly = all.filter(byLang);
      return langOnly.length ? langOnly : all;
    },
    /** 이전 버전 호환 — google 목소리만 평평하게. */
    listVoices: function () {
      return API.catalog().then(function (c) { return (c.voices && c.voices.google) || FALLBACK_VOICES; });
    },

    /** segments: [{text, voice}] → { blob, file, chars, bytes, provider, model } */
    generate: function (opts) {
      opts = opts || {};
      return post({
        provider: opts.provider, model: opts.model, lang: opts.lang,
        segments: opts.segments, gapMs: opts.gapMs, rate: opts.rate, pitch: opts.pitch
      }).then(function (j) {
        var blob = b64ToBlob(j.audio, j.mime);
        var name = (opts.filename || 'generated').replace(/[^\w.-]+/g, '-') + '.mp3';
        var file = new File([blob], name, { type: 'audio/mpeg' });
        return { blob: blob, file: file, chars: j.chars, bytes: j.bytes,
                 segments: j.segments, provider: j.provider, model: j.model, gapApplied: j.gapApplied };
      });
    }
  };

  window.SG_TTS_GEN = API;
})();
