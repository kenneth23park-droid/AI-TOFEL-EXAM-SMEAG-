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
