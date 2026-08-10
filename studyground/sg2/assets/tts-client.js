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
  var ENDPOINT = 'api/tts';

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
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sg-token': token() },
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
          catalogCache = j;
          return j;
        })
        .catch(function () { return FALLBACK; });
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
