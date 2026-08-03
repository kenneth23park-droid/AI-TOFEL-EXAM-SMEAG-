/* =============================================================
 * SMEAG TOEFL — 카운트다운 타이머 (담당 A) → window.SMEAG_TIMER
 *
 *   var t = SMEAG_TIMER.create({ seconds:600, onTick(rem), onExpire() });
 *   t.start(); t.pause(); t.resume(); t.stop(); t.remaining();
 *
 * setInterval 누적 오차를 피하려고 실제 시각(Date.now) 기준으로 계산한다.
 * 탭이 백그라운드로 갔다 와도 남은 시간이 정확하다.
 * ============================================================= */
(function () {
  'use strict';

  var TIMER = {};

  TIMER.create = function (opts) {
    opts = opts || {};
    var total = Math.max(0, Math.floor(Number(opts.seconds) || 0));
    var onTick = typeof opts.onTick === 'function' ? opts.onTick : function () { };
    var onExpire = typeof opts.onExpire === 'function' ? opts.onExpire : function () { };

    var remainMs = total * 1000;   // 정지 상태에서의 남은 시간
    var deadline = 0;              // 동작 중일 때의 종료 시각
    var handle = null;
    var state = 'idle';            // idle | running | paused | done
    var lastShown = -1;

    function calcRemainMs() {
      if (state === 'running') return Math.max(0, deadline - Date.now());
      return Math.max(0, remainMs);
    }

    function emitTick(force) {
      var sec = Math.ceil(calcRemainMs() / 1000);
      if (force || sec !== lastShown) {
        lastShown = sec;
        try { onTick(sec); } catch (e) { /* 콜백 오류가 타이머를 멈추지 않게 */ }
      }
      return sec;
    }

    function loop() {
      if (state !== 'running') return;
      var ms = calcRemainMs();
      emitTick(false);
      if (ms <= 0) {
        state = 'done';
        clear();
        remainMs = 0;
        try { onExpire(); } catch (e) { /* 무시 */ }
      }
    }

    function clear() {
      if (handle !== null) { clearInterval(handle); handle = null; }
    }

    var api = {};

    api.start = function () {
      if (state === 'running') return api;
      state = 'running';
      remainMs = (remainMs > 0 || total === 0) ? remainMs : total * 1000;
      deadline = Date.now() + remainMs;
      clear();
      handle = setInterval(loop, 250);
      emitTick(true);
      if (remainMs <= 0) loop();
      return api;
    };

    api.pause = function () {
      if (state !== 'running') return api;
      remainMs = calcRemainMs();
      state = 'paused';
      clear();
      emitTick(true);
      return api;
    };

    api.resume = function () {
      if (state !== 'paused') return api;
      state = 'running';
      deadline = Date.now() + remainMs;
      clear();
      handle = setInterval(loop, 250);
      emitTick(true);
      return api;
    };

    api.stop = function () {
      remainMs = calcRemainMs();
      state = 'done';
      clear();
      return api;
    };

    /* 남은 시간(초, 올림) */
    api.remaining = function () {
      return Math.ceil(calcRemainMs() / 1000);
    };

    /* 상태 문자열 (계약서 외 편의용) */
    api.state = function () { return state; };

    return api;
  };

  window.SMEAG_TIMER = TIMER;
})();
