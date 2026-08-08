/* SMEAG StudyGround — /api/tts 클라이언트.
 *
 * 관리자 화면에서 "문항 스크립트 → mp3" 를 부르는 얇은 층이다. 키는 서버(Vercel
 * 환경변수)에만 있고, 브라우저는 공용 토큰(SG_TTS_TOKEN)만 들고 있다.
 * 토큰은 이 기기의 localStorage 에 남는다 — 관리자 로그인과 같은 성격의 가림막이다.
 *
 * 노출 전역: window.SG_TTS_GEN
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'sg2_tts_token';
  var ENDPOINT = 'api/tts';

  /* 서버 목소리 목록을 못 받아도 UI 가 서도록 하는 기본 세트.
     tools/tts_google.py 로 SET 9 를 만들 때 쓴 12개와 같다. */
  var FALLBACK_VOICES = [
    { name: 'en-US-Neural2-C', lang: 'en-US', label: 'US · Ava (F)' },
    { name: 'en-US-Neural2-F', lang: 'en-US', label: 'US · Mia (F)' },
    { name: 'en-US-Neural2-E', lang: 'en-US', label: 'US · Emma (F)' },
    { name: 'en-US-Neural2-G', lang: 'en-US', label: 'US · Zoe (F)' },
    { name: 'en-US-Neural2-D', lang: 'en-US', label: 'US · Liam (M)' },
    { name: 'en-US-Neural2-J', lang: 'en-US', label: 'US · Mason (M)' },
    { name: 'en-US-Neural2-A', lang: 'en-US', label: 'US · Noah (M)' },
    { name: 'en-US-Neural2-I', lang: 'en-US', label: 'US · Ethan (M)' },
    { name: 'en-GB-Neural2-A', lang: 'en-GB', label: 'GB · Alice (F)' },
    { name: 'en-GB-Neural2-B', lang: 'en-GB', label: 'GB · Oliver (M)' },
    { name: 'en-GB-Neural2-D', lang: 'en-GB', label: 'GB · Henry (M)' },
    { name: 'en-AU-Neural2-A', lang: 'en-AU', label: 'AU · Lily (F)' }
  ];

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

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
          // 404/405/501 = 이 서버에 함수가 없다(로컬 정적 서버·파일 열기). 배포본에서만 돈다.
          var noFn = r.status === 404 || r.status === 405 || r.status === 501;
          var msg = (j && j.error) ||
            (noFn ? 'No /api/tts on this server — audio generation only runs on the deployed site.'
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

  var API = {
    FALLBACK_VOICES: FALLBACK_VOICES,

    hasToken: function () { return !!token(); },
    setToken: function (t) {
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
        else if (out.length && !/[:]$/.test(t)) {
          // 이어지는 줄은 앞 화자의 대사에 붙인다.
          out[out.length - 1].text += ' ' + t;
        } else {
          out.push({ speaker: 'Narrator', text: t });
        }
      });
      return out;
    },

    /** parseScript 결과에 등장하는 화자 이름들(등장 순서). */
    speakersOf: function (segs) {
      var seen = [], i;
      for (i = 0; i < segs.length; i++) if (seen.indexOf(segs[i].speaker) < 0) seen.push(segs[i].speaker);
      return seen;
    },

    /** 목소리 목록. 서버가 못 주면 기본 세트로 떨어진다. */
    listVoices: function () {
      return fetch(ENDPOINT, { headers: { 'x-sg-token': token() } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.voices || !j.voices.length) return FALLBACK_VOICES;
          return j.voices.map(function (v) {
            var known = FALLBACK_VOICES.filter(function (f) { return f.name === v.name; })[0];
            return { name: v.name, lang: v.lang, label: known ? known.label : (v.lang + ' · ' + v.name.split('-').pop() + ' (' + (v.gender || '').charAt(0) + ')') };
          });
        })
        .catch(function () { return FALLBACK_VOICES; });
    },

    /** segments: [{text, voice, lang?}] → { blob, file, chars, bytes } */
    generate: function (opts) {
      opts = opts || {};
      return post({
        segments: opts.segments,
        gapMs: opts.gapMs,
        rate: opts.rate,
        pitch: opts.pitch
      }).then(function (j) {
        var blob = b64ToBlob(j.audio, j.mime);
        var name = (opts.filename || 'generated') .replace(/[^\w.-]+/g, '-') + '.mp3';
        var file = new File([blob], name, { type: 'audio/mpeg' });
        return { blob: blob, file: file, chars: j.chars, bytes: j.bytes, segments: j.segments };
      });
    }
  };

  window.SG_TTS_GEN = API;
})();
