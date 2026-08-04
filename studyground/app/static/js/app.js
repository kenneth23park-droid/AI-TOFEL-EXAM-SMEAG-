/* StudyGround — bundled UI script. No dependencies, no CDN. */
(function () {
  'use strict';

  /* Clickable score rows (keyboard accessible). */
  document.querySelectorAll('.row-link').forEach(function (row) {
    var go = function () { window.location.href = row.dataset.href; };
    row.addEventListener('click', go);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  /* AI re-score — POSTs to the API, then repaints the feedback blocks in place. */
  var btn = document.getElementById('rescore-btn');
  if (!btn) return;

  var flash = document.getElementById('rescore-flash');
  var list = document.getElementById('feedback-list');
  var modeTag = document.getElementById('fb-mode');

  var SCOPES = ['overall', 'reading', 'listening', 'speaking', 'writing'];
  var LABEL = {
    en: { overall: 'Overall', reading: 'Reading', listening: 'Listening',
          speaking: 'Speaking', writing: 'Writing',
          strengths: 'Strengths', improvements: 'To improve',
          offline: 'rule-based', online: 'LLM' },
    ko: { overall: '종합', reading: '리딩', listening: '리스닝',
          speaking: '스피킹', writing: '라이팅',
          strengths: '잘한 점', improvements: '개선할 점',
          offline: '규칙 기반', online: 'LLM' }
  };

  function say(message, isError) {
    flash.textContent = message;
    flash.classList.toggle('err', !!isError);
    flash.hidden = false;
  }

  function bullets(title, items, cls) {
    if (!items || !items.length) return '';
    var lis = items.map(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      return li.outerHTML;
    }).join('');
    return '<div class="fb-block ' + cls + '"><h4>' + title + '</h4><ul>' + lis + '</ul></div>';
  }

  function repaint(feedback, lang) {
    var words = LABEL[lang] || LABEL.en;
    var byScope = {};
    feedback.forEach(function (f) { byScope[f.scope] = f; });

    var html = SCOPES.map(function (scope) {
      var f = byScope[scope];
      if (!f) return '';
      var head = document.createElement('h3');
      head.textContent = words[scope] || scope;
      var sum = document.createElement('p');
      sum.className = 'fb-sum';
      sum.textContent = f.summary || '';
      return '<article class="fb ' + (scope === 'overall' ? 'overall' : '') + '">' +
        head.outerHTML + sum.outerHTML +
        bullets(words.strengths, f.strengths, 'good') +
        bullets(words.improvements, f.improvements, 'warn') +
        '</article>';
    }).join('');

    list.innerHTML = html;
  }

  btn.addEventListener('click', function () {
    var attempt = btn.dataset.attempt;
    var lang = btn.dataset.lang || 'en';
    var words = LABEL[lang] || LABEL.en;

    btn.disabled = true;
    btn.textContent = btn.dataset.busy;
    flash.hidden = true;

    fetch('/api/attempts/' + attempt + '/rescore?lang=' + encodeURIComponent(lang), {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        repaint(data.feedback || [], lang);
        var modeWord = words[data.mode] || data.mode;
        if (modeTag) modeTag.textContent = modeWord;
        say(btn.dataset.done.replace('{mode}', modeWord));
        if (data.fell_back && data.note) say(data.note, true);
      })
      .catch(function (err) {
        say(btn.dataset.failed + ' (' + err.message + ')', true);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = btn.dataset.idle;
      });
  });
})();
