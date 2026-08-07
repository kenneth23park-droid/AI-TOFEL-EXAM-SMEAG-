/* StudyGround · admin back office script.
   Depends on: nothing (no bundler, no CDN, ES5 syntax only).
   Exposes: window.SG_ADMIN.
   Three jobs — the READING/LISTENING/WRITING tabs, per-question feedback saving,
   and the Speaking playback-speed toggle. Every one of them is an enhancement:
   with JavaScript off the tabs degrade to anchors and the cards post their form. */
(function () {
  'use strict';

  var LABEL = {
    en: { saved: 'Saved', failed: 'Save failed — retry' },
    ko: { saved: '저장됨', failed: '저장 실패 — 다시 시도' }
  };
  var words = LABEL[document.documentElement.lang] || LABEL.en;

  /* ── tabs ───────────────────────────────────────────────
     The active tab rides in the URL hash so a reload keeps it (Story 4.3 AC2). */
  var tabs = document.querySelectorAll('[data-tab]');
  var panels = document.querySelectorAll('[data-panel]');

  function activate(name) {
    var found = false;
    var i;
    for (i = 0; i < panels.length; i++) {
      var on = panels[i].getAttribute('data-panel') === name;
      if (on) { found = true; }
      panels[i].className = on ? 'tab-panel on' : 'tab-panel';
    }
    if (!found) { return false; }
    for (i = 0; i < tabs.length; i++) {
      var isOn = tabs[i].getAttribute('data-tab') === name;
      tabs[i].className = isOn ? 'tab on' : 'tab';
    }
    return true;
  }

  if (tabs.length) {
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', function (e) {
        e.preventDefault();
        var name = this.getAttribute('data-tab');
        if (activate(name) && window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + name);
        }
      });
    }
    var initial = (window.location.hash || '').replace('#', '');
    if (initial) { activate(initial); }
  }

  /* ── playback speed (Story 4.4 AC4) ─────────────────────── */
  var speedBox = document.querySelector('[data-speed-toggle]');
  if (speedBox) {
    var buttons = speedBox.querySelectorAll('[data-speed]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function () {
        var rate = parseFloat(this.getAttribute('data-speed'));
        var players = document.querySelectorAll('[data-audio]');
        for (var p = 0; p < players.length; p++) { players[p].playbackRate = rate; }
        for (var c = 0; c < buttons.length; c++) { buttons[c].className = 'btn small ghost'; }
        this.className = 'btn small ghost on';
      });
    }
  }

  /* ── per-question feedback (Story 4.5) ──────────────────── */
  var progressBox = document.getElementById('attempt-progress');

  function paintProgress(pct) {
    if (!progressBox) { return; }
    var state = pct === 0 ? 'zero' : (pct >= 100 ? 'full' : 'part');
    progressBox.className = 'progress full-w ' + state;
    progressBox.querySelector('.progress-bar i').style.width = pct + '%';
    progressBox.querySelector('.progress-v').textContent = pct + '%';
  }

  function clock() {
    var now = new Date();
    var hh = now.getHours() < 10 ? '0' + now.getHours() : '' + now.getHours();
    var mm = now.getMinutes() < 10 ? '0' + now.getMinutes() : '' + now.getMinutes();
    return hh + ':' + mm;
  }

  function say(form, message, isError) {
    var status = form.querySelector('.fb-status');
    if (!status) { return; }
    status.textContent = message;
    status.className = isError ? 'fb-status err' : 'fb-status';
    if (!isError) {
      /* The confirmation is transient; a failure banner stays until the next try. */
      window.setTimeout(function () {
        if (status.textContent === message) { status.textContent = ''; }
      }, 1500);
    }
  }

  function save(form) {
    var id = form.getAttribute('data-response');
    var area = form.querySelector('textarea[name="feedback"]');
    var scoreField = form.querySelector('input[name="score"]');
    var body = { feedback: area ? area.value : '', graded_by: 'teacher' };
    if (scoreField && scoreField.value !== '') { body.score = scoreField.value; }

    return fetch('/api/admin/responses/' + id + '/feedback', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) { throw new Error('HTTP ' + res.status); }
        return res.json();
      })
      .then(function (data) {
        say(form, words.saved + ' ' + clock(), false);
        paintProgress(data.feedback_progress);
      })
      .catch(function () {
        /* The typed text is never cleared — the teacher can retry in place (AC4). */
        say(form, words.failed, true);
      });
  }

  var forms = document.querySelectorAll('.fb-form');
  for (var f = 0; f < forms.length; f++) {
    (function (form) {
      var area = form.querySelector('textarea[name="feedback"]');
      if (!area || area.readOnly) { return; }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        save(form);
      });
      area.addEventListener('blur', function () { save(form); });
    })(forms[f]);
  }

  window.SG_ADMIN = { activate: activate, save: save };
})();
