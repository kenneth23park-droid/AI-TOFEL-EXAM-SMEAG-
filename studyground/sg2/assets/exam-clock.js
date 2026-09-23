/* SMEAG · StudyGround — exam-clock.js
 * 목적: 시험 타이머. architecture.md §5.5 정본 — 남은 초를 저장하지 않고
 *       절대 deadline(epoch ms)만 저장/비교한다. 탭 비활성·새로고침·크래시에도
 *       흘러간 시간이 정확히 반영된다.
 * 의존 전역: (선택) window.SG_STORE — 없으면 메모리 맵으로 degrade.
 * 노출 전역: window.SG_CLOCK
 *
 * 순수부(remainingSecAt / formatSec / pickVisibleKey)는 Date.now()·DOM 접근이
 * 없어 node에서 그대로 검증 가능하다(coding standards F9).
 */
(function (root) {
  'use strict';

  /* scope 우선순위 — architecture.md §3.5 "좁은 scope가 이긴다".
     숫자가 작을수록 좁다. 상단 pill 은 가장 좁은 scope 를 표시한다. */
  var SCOPE_RANK = { question: 0, screen: 1, task: 2, module: 3, section: 4 };

  var specs = {};       // key -> {seconds, mode, format, scope, visible, onExpire, fired, label}
  var memClocks = {};   // SG_STORE 미로드 시 폴백 저장소
  var store = null;     // {clocks(), saveClocks(map)}
  var offsetMs = 0;     // serverNowOffset — 시스템 시계 되돌림 방어(§5.5)
  var subs = [];
  var timerId = null;
  var lastNow = 0;      // 시계 역행 감지용
  var skewCb = null;

  var TICK_MS = 250;    // §5.5: rAF 대신 250ms 간격. MM:SS 표시에 충분.
  var DEFAULT_WARN_SEC = 60;

  /* ── 순수 함수 ───────────────────────────────────────────── */

  // deadline 과 기준 시각만으로 남은 초를 계산한다. 저장된 remaining 을 쓰지 않는다.
  function remainingSecAt(deadlineMs, nowMs) {
    if (deadlineMs === null || deadlineMs === undefined) return null;
    var r = Math.ceil((deadlineMs - nowMs) / 1000);
    return r > 0 ? r : 0;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 빨간 pill 은 MM:SS, 보라 RESPONSE TIME 박스는 HH:MM:SS (명세 확정).
  function formatSec(sec, format) {
    if (sec === null || sec === undefined) return '';
    var s = sec < 0 ? 0 : Math.floor(sec);
    if (format === 'HH:MM:SS') {
      return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
    }
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  function scopeRank(scope) {
    var r = SCOPE_RANK[scope];
    return r === undefined ? 9 : r;
  }

  /* 표시 대상 clock 하나를 고른다. visible:false 인 상한 타이머는 후보에서 빠지되
     만료 동작은 계속 살아 있다(§3.4 moduleEnd 상한 30초). */
  function pickVisibleKey(specMap, clockMap, nowMs) {
    var best = null, bestRank = 99;
    for (var k in specMap) {
      if (!specMap.hasOwnProperty(k)) continue;
      var sp = specMap[k];
      if (sp.visible === false) continue;
      if (clockMap[k] === null || clockMap[k] === undefined) continue;
      var rank = scopeRank(sp.scope);
      if (rank < bestRank) { bestRank = rank; best = k; }
    }
    return best;
  }

  /* ── 저장 계층 ───────────────────────────────────────────── */

  function clocks() {
    if (store && typeof store.clocks === 'function') {
      var m = store.clocks();
      return m || {};
    }
    return memClocks;
  }

  function saveClocks(m) {
    if (store && typeof store.saveClocks === 'function') { store.saveClocks(m); return; }
    memClocks = m;
  }

  function attachStore(s) { store = s || null; }

  /* ── 시각 ────────────────────────────────────────────────── */

  function now() { return Date.now() + offsetMs; }
  function setOffset(ms) { offsetMs = typeof ms === 'number' ? ms : 0; }
  function getOffset() { return offsetMs; }
  function onClockSkew(fn) { skewCb = fn; }

  /* ── 공개 API ────────────────────────────────────────────── */

  /* deadline 을 최초 1회만 만든다. 이미 있으면 절대 덮어쓰지 않는다 —
     재개 시 시간이 늘어나는 사고 방지(§5.3, Story 1.5 AC8). */
  function armClock(key, seconds, opts) {
    if (!key) return null;
    var o = opts || {};
    var prev = specs[key];
    specs[key] = {
      seconds: seconds,
      mode: o.mode || 'countdown',
      format: o.format || (o.mode === 'response' ? 'HH:MM:SS' : 'MM:SS'),
      scope: o.scope || 'screen',
      visible: o.visible === false ? false : true,
      warnAtSec: typeof o.warnAtSec === 'number' ? o.warnAtSec : DEFAULT_WARN_SEC,
      label: o.label || '',
      onExpire: o.onExpire || (prev && prev.onExpire) || null,
      // 새로고침 후 재-arm 이면 fired 는 다시 false 여야 만료가 "조용히" 1회 적용된다(§5.4-6).
      fired: prev ? prev.fired : false
    };
    var m = clocks();
    if (m[key] !== null && m[key] !== undefined) return m[key];
    m[key] = now() + (seconds || 0) * 1000;
    saveClocks(m);
    return m[key];
  }

  function remainingSec(key) {
    var m = clocks();
    var d = m[key];
    return remainingSecAt(d === undefined ? null : d, now());
  }

  function deadline(key) {
    var d = clocks()[key];
    return d === undefined ? null : d;
  }

  function hasClock(key) { return deadline(key) !== null; }

  function keys() {
    var out = [], m = clocks();
    for (var k in m) { if (m.hasOwnProperty(k)) out.push(k); }
    return out;
  }

  function clearClock(key) {
    var m = clocks();
    if (m.hasOwnProperty(key)) { delete m[key]; saveClocks(m); }
    delete specs[key];
  }

  /* moduleEnd 화면 진입 시 해당 scope 의 clock 을 만료 처리한다(Story 1.5 AC8). */
  function expireNow(key) {
    var m = clocks();
    if (!m.hasOwnProperty(key)) return false;
    m[key] = now();
    saveClocks(m);
    tickOnce();
    return true;
  }

  function specOf(key) { return specs[key] || null; }
  function allSpecs() { return specs; }

  // 표시용: 가장 좁은 scope 의 key / 남은 초 / 포맷 문자열 / 경고 여부
  function display() {
    var m = clocks();
    var k = pickVisibleKey(specs, m, now());
    if (!k) return null;
    var sp = specs[k];
    var rem = remainingSecAt(m[k], now());
    return {
      key: k, scope: sp.scope, mode: sp.mode, format: sp.format,
      remaining: rem, text: formatSec(rem, sp.format),
      warning: rem !== null && rem <= sp.warnAtSec
    };
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () {
      for (var i = 0; i < subs.length; i++) { if (subs[i] === fn) { subs.splice(i, 1); return; } }
    };
  }

  function notify(expired) {
    var d = display();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](d, expired); } catch (e) { /* F12: 구독자 오류로 시험을 멈추지 않는다 */ }
    }
  }

  /* 단일 tick 루프. 매 tick 마다 deadline 을 재계산하므로 throttle 된 탭에서도
     복귀 즉시 정확하다. onExpire 는 key 당 메모리 전용 fired 플래그로 1회만. */
  function tickOnce() {
    var n = now();
    if (lastNow && n < lastNow - 2000 && skewCb) {
      try { skewCb(lastNow - n); } catch (e) {}
    }
    lastNow = n;
    var m = clocks();
    var expired = [];
    for (var k in specs) {
      if (!specs.hasOwnProperty(k)) continue;
      var sp = specs[k];
      var d = m[k];
      if (d === null || d === undefined) continue;
      if (remainingSecAt(d, n) === 0 && !sp.fired) {
        sp.fired = true;
        expired.push(k);
      }
    }
    for (var i = 0; i < expired.length; i++) {
      var key = expired[i], s = specs[key];
      if (s && typeof s.onExpire === 'function') {
        try { s.onExpire(key, s); } catch (e) { /* F12 */ }
      }
    }
    notify(expired);
    return expired;
  }

  function start() {
    if (timerId !== null) return;
    lastNow = now();
    timerId = (root.setInterval || setInterval)(tickOnce, TICK_MS);
  }

  function stop() {
    if (timerId === null) return;
    (root.clearInterval || clearInterval)(timerId);
    timerId = null;
  }

  // 재개(새로고침) 시: 저장된 deadline 은 그대로 두고 spec 만 다시 등록하기 위한 헬퍼.
  function resetFired(key) { if (specs[key]) specs[key].fired = false; }

  // 테스트/새 시도 시작용. 저장된 deadline 까지 모두 버린다.
  function resetAll() {
    specs = {};
    memClocks = {};
    if (store && typeof store.saveClocks === 'function') store.saveClocks({});
    lastNow = 0;
  }

  root.SG_CLOCK = {
    SCOPE_RANK: SCOPE_RANK,
    TICK_MS: TICK_MS,
    // 순수
    remainingSecAt: remainingSecAt,
    formatSec: formatSec,
    pickVisibleKey: pickVisibleKey,
    scopeRank: scopeRank,
    // 저장 연결
    attachStore: attachStore,
    // 시각
    now: now, setOffset: setOffset, getOffset: getOffset, onClockSkew: onClockSkew,
    // clock
    armClock: armClock, remainingSec: remainingSec, deadline: deadline,
    hasClock: hasClock, keys: keys, clearClock: clearClock, expireNow: expireNow,
    specOf: specOf, allSpecs: allSpecs, resetFired: resetFired, resetAll: resetAll,
    // 표시/루프
    display: display, subscribe: subscribe, tickOnce: tickOnce, start: start, stop: stop
  };
})(typeof window !== 'undefined' ? window : this);
