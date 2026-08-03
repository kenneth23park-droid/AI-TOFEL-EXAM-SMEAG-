/* =============================================================
 * app/js/sections/speaking.js
 * window.SMEAG_SECTIONS.speaking — 스피킹 섹션 렌더러
 *
 * 담당 블록 kind: 'record-set'
 * 진행 시퀀스(문항별 자동):
 *   intro 오디오 1회 → [이미지 표시 → 문항 오디오 → 준비 카운트다운 →
 *   자동 녹음 시작 → 응답 카운트다운 → 자동 정지 → 저장] × 문항 수 →
 *   ctx.onReady() + ctx.onAutoAdvance()
 *
 * 마이크 불가 시에도 절대 시험을 멈추지 않는다.
 * 계약: renderBlock(ctx) -> { destroy() }
 * ============================================================= */
(function () {
  'use strict';

  window.SMEAG_SECTIONS = window.SMEAG_SECTIONS || {};

  /* ---------- 작은 DOM 헬퍼 ---------- */
  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }

  /* ---------- 전용 스타일 (sp- 접두사로 app.css 와 충돌 방지) ---------- */
  var STYLE_ID = 'smeag-speaking-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) { return; }
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.sp-instruction{color:#8a8aa0;font-size:14px;margin:0 0 14px}',
      '.sp-warn{background:#fff6e6;border:1px solid #f5a524;color:#8a5a00;border-radius:12px;padding:10px 14px;font-size:14px;font-weight:600;margin-bottom:14px}',
      '.sp-card{background:#fff;border:1px solid #ececf4;border-radius:16px;padding:18px;text-align:center}',
      '.sp-progress-label{font-size:13px;font-weight:700;color:#5b5ef4;margin-bottom:10px}',
      '.sp-img{max-width:100%;max-height:340px;border-radius:12px;display:none;margin:0 auto 14px}',
      '.sp-audio{margin:0 auto 14px;max-width:520px}',
      '.sp-status{font-size:16px;font-weight:700;color:#1c1c28;min-height:24px;margin-bottom:10px}',
      '.sp-big{font-size:44px;font-weight:800;line-height:1.1;color:#5b5ef4;min-height:52px;margin-bottom:10px;font-variant-numeric:tabular-nums}',
      '.sp-big.rec{color:#ff5a36}',
      '.sp-bar{height:10px;border-radius:6px;background:#ececf4;overflow:hidden;max-width:520px;margin:0 auto 12px}',
      '.sp-bar>i{display:block;height:100%;width:0;background:#5b5ef4;transition:width .12s linear}',
      '.sp-bar.rec>i{background:#ff5a36}',
      '.sp-recline{display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:700;color:#ff5a36;min-height:22px}',
      '.sp-recline .rec-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#ff5a36;animation:sp-blink 1s steps(1,end) infinite}',
      '@keyframes sp-blink{50%{opacity:.15}}',
      '.sp-note{font-size:12px;color:#8a8aa0;margin-top:10px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function encode(p) {
    if (window.SMEAG && typeof window.SMEAG.encodePath === 'function') {
      return window.SMEAG.encodePath(p);
    }
    return encodeURI(String(p || ''));
  }

  /* =============================================================
   * record-set
   * ============================================================= */
  function renderRecordSet(ctx) {
    var root = ctx.root, block = ctx.block, mod = ctx.module;
    var questions = block.questions || [];

    var dead = false;          // destroy 이후 모든 콜백 무시
    var timers = [];           // setInterval / setTimeout 핸들
    var players = [];          // SMEAG_AUDIO 인스턴스
    var recording = false;     // 현재 녹음 중인가
    var finished = false;

    /* ---------- 화면 ---------- */
    if (block.heading) { root.appendChild(E('h2', 'sp-heading', block.heading)); }
    if (block.instruction) { root.appendChild(E('p', 'sp-instruction', block.instruction)); }

    var warnBox = E('div', 'sp-warn');
    warnBox.style.display = 'none';
    root.appendChild(warnBox);

    var card = E('div', 'sp-card');
    var elProgress = E('div', 'sp-progress-label', '준비 중…');
    var elImg = document.createElement('img');
    elImg.className = 'sp-img';
    elImg.alt = '';
    var elAudio = E('div', 'sp-audio audio-box');
    var elStatus = E('div', 'sp-status', '안내 음성을 재생합니다.');
    var elBig = E('div', 'sp-big', '');
    var elBar = E('div', 'sp-bar');
    var elBarFill = document.createElement('i');
    elBar.appendChild(elBarFill);
    var elRec = E('div', 'sp-recline');
    var elNote = E('div', 'sp-note', '문항은 자동으로 진행됩니다. 녹음이 시작되면 마이크에 대고 말하세요.');

    card.appendChild(elProgress);
    card.appendChild(elImg);
    card.appendChild(elAudio);
    card.appendChild(elStatus);
    card.appendChild(elBig);
    card.appendChild(elBar);
    card.appendChild(elRec);
    card.appendChild(elNote);
    root.appendChild(card);

    function setBar(ratio, isRec) {
      elBarFill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
      elBar.className = isRec ? 'sp-bar rec' : 'sp-bar';
    }
    function setRecDot(show) {
      elRec.textContent = '';
      if (!show) { return; }
      elRec.appendChild(E('i', 'rec-dot'));
      elRec.appendChild(E('span', null, '녹음 중'));
    }
    function showWarn(msg) {
      warnBox.textContent = msg;
      warnBox.style.display = '';
    }

    /* ---------- 타이머 유틸 ---------- */
    function later(fn, ms) {
      var h = setTimeout(function () {
        if (dead) { return; }
        fn();
      }, ms);
      timers.push(h);
      return h;
    }
    function countdown(sec, onTick, onDone) {
      var total = Math.max(0, Number(sec) || 0);
      if (total <= 0) { later(onDone, 0); return; }
      var end = Date.now() + total * 1000;
      onTick(total, total);
      var h = setInterval(function () {
        if (dead) { clearInterval(h); return; }
        var remMs = end - Date.now();
        var rem = Math.max(0, remMs / 1000);
        onTick(Math.ceil(rem), total);
        if (remMs <= 0) {
          clearInterval(h);
          onDone();
        }
      }, 100);
      timers.push(h);
    }
    function clearTimers() {
      timers.forEach(function (h) { clearTimeout(h); clearInterval(h); });
      timers = [];
    }

    /* ---------- 오디오 재생 (끝나면 done()) ---------- */
    function playAudio(src, key, done) {
      elAudio.textContent = '';
      if (!src) { done(); return; }

      // 1회 재생 규칙: 이미 재생된 오디오는 건너뛴다.
      if (typeof ctx.hasPlayed === 'function' && ctx.hasPlayed(key)) { later(done, 300); return; }
      if (!window.SMEAG_AUDIO || typeof window.SMEAG_AUDIO.create !== 'function') { later(done, 300); return; }

      var fired = false;
      function once() {
        if (fired || dead) { return; }
        fired = true;
        done();
      }

      var p = window.SMEAG_AUDIO.create({
        src: encode(src),
        playKey: key,
        autoplay: true,
        onEnded: once,
        onBlocked: function () {
          if (dead) { return; }
          elStatus.textContent = '자동 재생이 차단되었습니다 — 재생 버튼을 눌러 주세요.';
        }
      });
      players.push(p);
      if (p && p.element) { elAudio.appendChild(p.element); }

      // 이미 재생 완료 상태로 생성된 경우(재진입 등) 멈추지 않도록 보정
      later(function () {
        if (p && typeof p.isDone === 'function' && p.isDone()) { once(); }
      }, 400);
    }

    /* ---------- 마이크 준비 ---------- */
    var micOk = false;
    function initMic() {
      return new Promise(function (resolve) {
        var R = window.SMEAG_REC;
        if (!R || typeof R.available !== 'function' || !R.available()) { resolve(false); return; }
        var pr;
        try { pr = R.requestPermission(); } catch (e) { resolve(false); return; }
        if (!pr || typeof pr.then !== 'function') { resolve(!!pr); return; }
        pr.then(function (ok) { resolve(!!ok); }, function () { resolve(false); });
      });
    }

    /* ---------- 진행 ---------- */
    function markAllSkipped() {
      questions.forEach(function (q) {
        ctx.setAnswer(q.id, { recorded: false, durationMs: 0, skipped: true });
      });
    }

    function runQuestion(i) {
      if (dead) { return; }
      if (i >= questions.length) { finish(); return; }
      var q = questions[i];

      elProgress.textContent = '문항 ' + (i + 1) + ' / ' + questions.length + ' (No. ' + q.no + ')';
      setBar(0, false);
      setRecDot(false);
      elBig.textContent = '';
      elBig.className = 'sp-big';

      if (q.image) {
        elImg.src = encode(q.image);
        elImg.style.display = 'block';
      } else {
        elImg.style.display = 'none';
      }

      elStatus.textContent = '음성을 잘 들으세요.';
      playAudio(q.audio, 'aud:' + q.id, function () { prepPhase(i, q); });
    }

    function prepPhase(i, q) {
      if (dead) { return; }
      elStatus.textContent = '준비하세요.';
      countdown(q.prepSec || 0, function (rem, total) {
        elBig.textContent = String(rem);
        elBig.className = 'sp-big';
        setBar(total ? (total - rem) / total : 1, false);
      }, function () { startRecording(i, q); });
    }

    function startRecording(i, q) {
      if (dead) { return; }
      if (!micOk || !window.SMEAG_REC) {
        respondPhase(i, q, false);
        return;
      }
      var pr;
      try { pr = window.SMEAG_REC.start(); } catch (e) { respondPhase(i, q, false); return; }
      if (!pr || typeof pr.then !== 'function') {
        recording = true;
        respondPhase(i, q, true);
        return;
      }
      pr.then(function () {
        if (dead) { return; }
        recording = true;
        respondPhase(i, q, true);
      }, function () {
        if (dead) { return; }
        respondPhase(i, q, false);
      });
    }

    function respondPhase(i, q, isRec) {
      if (dead) { return; }
      elStatus.textContent = isRec ? '지금 말하세요.' : '지금 말하세요. (녹음되지 않습니다)';
      setRecDot(isRec);
      countdown(q.respondSec || 0, function (rem, total) {
        elBig.textContent = String(rem);
        elBig.className = isRec ? 'sp-big rec' : 'sp-big';
        setBar(total ? (total - rem) / total : 1, isRec);
      }, function () { stopRecording(i, q, isRec); });
    }

    function stopRecording(i, q, isRec) {
      if (dead) { return; }
      setRecDot(false);
      elBig.textContent = '';
      elStatus.textContent = '저장 중…';

      function next() {
        if (dead) { return; }
        later(function () { runQuestion(i + 1); }, 600);
      }

      if (!isRec || !recording || !window.SMEAG_REC) {
        recording = false;
        ctx.setAnswer(q.id, { recorded: false, durationMs: 0, skipped: true });
        elStatus.textContent = '녹음 없이 다음 문항으로 넘어갑니다.';
        next();
        return;
      }

      var pr;
      try { pr = window.SMEAG_REC.stop(); } catch (e) { pr = null; }
      recording = false;

      if (!pr || typeof pr.then !== 'function') {
        ctx.setAnswer(q.id, { recorded: false, durationMs: 0, skipped: true });
        next();
        return;
      }

      pr.then(function (r) {
        if (dead) { return; }
        var dur = (r && r.durationMs) || 0;
        var blob = r && r.blob;
        if (!blob || !window.SMEAG_STORE || typeof window.SMEAG_STORE.putRecording !== 'function') {
          ctx.setAnswer(q.id, { recorded: false, durationMs: dur, skipped: true });
          elStatus.textContent = '저장하지 못했습니다 — 계속 진행합니다.';
          next();
          return;
        }
        var sp;
        try { sp = window.SMEAG_STORE.putRecording(ctx.attemptId, q.id, blob); } catch (e) { sp = null; }
        function after(ok) {
          if (dead) { return; }
          ctx.setAnswer(q.id, ok
            ? { recorded: true, durationMs: dur }
            : { recorded: false, durationMs: dur, skipped: true });
          elStatus.textContent = ok ? '녹음이 저장되었습니다.' : '저장하지 못했습니다 — 계속 진행합니다.';
          next();
        }
        if (sp && typeof sp.then === 'function') {
          /* putRecording 은 저장 성공 여부를 true/false 로 resolve 한다 */
          sp.then(function (ok) { after(ok !== false); }, function () { after(false); });
        } else {
          after(true);
        }
      }, function () {
        if (dead) { return; }
        ctx.setAnswer(q.id, { recorded: false, durationMs: 0, skipped: true });
        elStatus.textContent = '녹음을 마치지 못했습니다 — 계속 진행합니다.';
        next();
      });
    }

    function finish() {
      if (dead || finished) { return; }
      finished = true;
      elProgress.textContent = '완료';
      elStatus.textContent = '이 파트의 모든 문항이 끝났습니다.';
      elBig.textContent = '';
      setBar(1, false);
      setRecDot(false);
      elImg.style.display = 'none';
      if (window.SMEAG_REC && typeof window.SMEAG_REC.release === 'function') {
        try { window.SMEAG_REC.release(); } catch (e) { /* 무시 */ }
      }
      if (typeof ctx.onReady === 'function') { ctx.onReady(); }
      if (typeof ctx.onAutoAdvance === 'function') { later(ctx.onAutoAdvance, 900); }
    }

    /* ---------- 시작 ---------- */
    initMic().then(function (ok) {
      if (dead) { return; }
      micOk = ok;
      if (!micOk) {
        showWarn('마이크를 사용할 수 없어 스피킹은 건너뜁니다. 음성은 그대로 재생되며 시험은 계속 진행됩니다.');
        markAllSkipped();
      }
      elStatus.textContent = '안내 음성을 재생합니다.';
      playAudio(block.introAudio, 'aud:intro:' + (mod && mod.id), function () { runQuestion(0); });
    });

    /* ---------- 정리 ---------- */
    return {
      destroy: function () {
        dead = true;
        clearTimers();
        players.forEach(function (p) {
          try { if (p && typeof p.stop === 'function') { p.stop(); } } catch (e) { /* 무시 */ }
        });
        players = [];
        if (window.SMEAG_REC) {
          if (recording && typeof window.SMEAG_REC.stop === 'function') {
            try {
              var pr = window.SMEAG_REC.stop();
              if (pr && typeof pr.then === 'function') { pr.then(function () { }, function () { }); }
            } catch (e) { /* 무시 */ }
          }
          recording = false;
          if (typeof window.SMEAG_REC.release === 'function') {
            try { window.SMEAG_REC.release(); } catch (e) { /* 무시 */ }
          }
        }
      }
    };
  }

  /* =============================================================
   * 공개 렌더러
   * ============================================================= */
  window.SMEAG_SECTIONS.speaking = {
    renderBlock: function (ctx) {
      ensureStyle();
      var kind = ctx.block && ctx.block.kind;
      if (kind === 'record-set') { return renderRecordSet(ctx); }

      ctx.root.appendChild(E('p', 'sp-instruction', '표시할 수 없는 블록입니다. (' + String(kind) + ')'));
      if (typeof ctx.onReady === 'function') { ctx.onReady(); }
      return { destroy: function () { } };
    }
  };
})();
