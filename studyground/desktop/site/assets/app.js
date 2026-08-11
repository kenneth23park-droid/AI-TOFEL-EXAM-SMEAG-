/* SMEAG · StudyGround 2.0 — shared UI script. No dependencies, no CDN. */
(function () {
  'use strict';

  // Language: English only. The KO toggle is gone, so nothing may flip
  // <html lang> away from 'en' — the [data-ko] markup stays hidden by app.css.
  document.documentElement.lang = 'en';

  document.addEventListener('DOMContentLoaded', function () {
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
  function findEntry(id, idx) {
    if (!id || !idx) return null;
    if (idx[id]) return idx[id];
    var lower = String(id).toLowerCase();
    for (var k in idx) {
      if (Object.prototype.hasOwnProperty.call(idx, k) && String(k).toLowerCase() === lower) {
        return idx[k];
      }
    }
    return null;
  }
  // Speak by id (checks bundled mp3) with text fallback to browser voice.
  function speak(id, text, btn) {
    stop();
    return loadIndex().then(function (idx) {
      var entry = id && findEntry(id, idx);
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
