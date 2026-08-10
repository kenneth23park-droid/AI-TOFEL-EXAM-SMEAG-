/* SMEAG · StudyGround 2.0 — shared UI script. No dependencies, no CDN. */
(function () {
  'use strict';

  // Language: EN default, KO toggle. Remembered in localStorage; shareable via ?lang=.
  var KEY = 'sg2_lang';
  var qs = new URLSearchParams(location.search);
  var lang = qs.get('lang') || localStorage.getItem(KEY) || 'en';
  if (lang !== 'ko') lang = 'en';
  document.documentElement.lang = lang;

  function setLang(next) {
    lang = next === 'ko' ? 'ko' : 'en';
    document.documentElement.lang = lang;
    localStorage.setItem(KEY, lang);
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lang === lang);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.lang button');
    if (b) { setLang(b.dataset.lang); return; }
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lang === lang);
    });
    // skill tabs on the practice page
    document.querySelectorAll('[data-skill-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('[data-skill-tab]').forEach(function (t) { t.classList.remove('on'); });
        tab.classList.add('on');
        var s = tab.dataset.skillTab;
        document.querySelectorAll('[data-skill-panel]').forEach(function (p) {
          p.classList.toggle('hide', p.dataset.skillPanel !== s);
        });
      });
    });
  });
})();

/* ── 표 → 카드 이름표 ──────────────────────────────────────────────
 * 좁은 화면에서 table.cardify 는 한 줄을 카드로 그리고(app.css), 각 칸은
 * 자기 이름표를 data-label 로 달고 다닌다. 표 머리글은 화면에서 사라지므로
 * 이름표도 KO/EN 을 따라가야 한다 — 두 언어를 모두 심어 두고 고르는 건
 * CSS(html[lang="ko"])가 한다. 행을 만드는 쪽에서 이렇게 쓴다:
 *   '<td ' + SG_LABEL('Size', '용량') + '>' + kb(r.size) + '</td>'  */
window.SG_LABEL = function (en, ko) {
  function a(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  return 'data-label="' + a(en) + '" data-label-ko="' + a(ko) + '"';
};

/* ── Read-aloud (TTS) ──────────────────────────────────────────────
 * Priority: bundled ElevenLabs mp3 (media/tts/<id>.mp3, generated offline
 * via tools/tts_generate.py) → else the browser's built-in speechSynthesis
 * (works offline, no API key). Exposed as window.SG_TTS. */
window.SG_TTS = (function () {
  'use strict';
  var index = null, loaded = false;
  function loadIndex() {
    if (loaded) return Promise.resolve(index);
    loaded = true;
    return fetch('media/tts/index.json').then(function (r) {
      return r.ok ? r.json() : {};
    }).then(function (j) { index = j || {}; return index; }).catch(function () { index = {}; return index; });
  }
  var current = null;
  function stop() {
    if (current && current.pause) { try { current.pause(); } catch (e) {} current = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  // Speak by id (checks bundled mp3) with text fallback to browser voice.
  function speak(id, text, btn) {
    stop();
    return loadIndex().then(function (idx) {
      var entry = id && idx[id];
      if (entry && entry.file) {
        var a = new Audio(entry.file);
        current = a;
        if (btn) { btn.dataset.state = 'playing'; a.onended = function () { btn.dataset.state = ''; }; }
        return a.play().catch(function () { return browserSpeak(text, btn); });
      }
      return browserSpeak(text, btn);
    });
  }
  function browserSpeak(text, btn) {
    if (!('speechSynthesis' in window) || !text) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.98;
    if (btn) { btn.dataset.state = 'playing'; u.onend = function () { btn.dataset.state = ''; }; }
    window.speechSynthesis.speak(u);
  }
  return { speak: speak, stop: stop };
})();
