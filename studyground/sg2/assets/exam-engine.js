/* SMEAG · StudyGround — exam-engine.js
 * 목적: 시험 상태머신. architecture.md §2 의 전이(버튼/타이머 만료/오디오 ended)를
 *       처리하고 이벤트를 남긴다. DOM 은 만들지 않는다 — 렌더는 window.SG_RENDER 로 위임하고,
 *       렌더러가 아직 로드되지 않았어도 엔진은 계속 동작한다(no-op 폴백).
 * 의존 전역: window.SG_CLOCK, window.SG_STORE (둘 다 없으면 최소 폴백으로 degrade)
 *            window.SG_RENDER (선택)
 * 노출 전역: window.SG_EXAM
 *
 * URL 계약(Story 1.8):
 *   exam-runtime.html?testId=SET1&sessionId=..&mode=exam|practice&exam=toefl|ielts#screen={id}
 *   레퍼런스 /en/test-nt/{section}?testId=..&sessionId=..&mode=..&section=.. 을 정적 사이트로 매핑한 것.
 *   `profile` 은 `exam` 의 별칭으로 함께 받는다.
 */
(function (root) {
  'use strict';

  var NARROW = { question: 0, screen: 1, task: 2, module: 3, section: 4 };

  function warn(msg, e) { if (root.console && root.console.warn) root.console.warn('[SG_EXAM] ' + msg, e || ''); }

  function clockApi() { return root.SG_CLOCK || null; }
  function storeApi() { return root.SG_STORE || null; }

  /* 렌더러 미로드 시에도 엔진이 죽지 않도록 하는 유일한 진입점. */
  function callRender(screen, ctx) {
    var R = root.SG_RENDER;
    if (!R || typeof R.render !== 'function') return null;
    try { return R.render(screen, ctx); } catch (e) { warn('render failed', e); return null; }
  }

  /* ── 순수 헬퍼 ───────────────────────────────────────────── */

  // 화면과 타이머 스펙으로 clock key 를 만든다. module/task/section 은 같은 키를
  // 공유하므로 여러 화면이 하나의 deadline 을 쓴다(§3.5 sharedDeadline).
  function clockKeyFor(screen, timer) {
    if (!screen || !timer) return null;
    var scope = timer.scope || 'screen';
    if (scope === 'module' || scope === 'task') return scope + ':' + (screen.moduleId || screen.section || screen.id);
    if (scope === 'section') return 'section:' + (screen.section || screen.id);
    return scope + ':' + screen.id;
  }

  function timersOf(screen) {
    var out = [];
    if (!screen) return out;
    if (screen.timer) out.push(screen.timer);
    if (screen.timers && screen.timers.length) {
      for (var i = 0; i < screen.timers.length; i++) { if (screen.timers[i]) out.push(screen.timers[i]); }
    }
    return out;
  }

  function parseUrl(search, hash) {
    var q = {}, i, kv, parts;
    parts = String(search || '').replace(/^\?/, '').split('&');
    for (i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      kv = parts[i].split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
    }
    var profile = q.exam || q.profile || 'toefl';
    if (profile !== 'toefl' && profile !== 'ielts') {
      warn('unknown exam profile "' + profile + '"; falling back to toefl');
      profile = 'toefl';
    }
    var mode = q.mode === 'practice' ? 'practice' : 'exam';
    var screenId = null;
    var h = String(hash || '').replace(/^#/, '');
    if (h.indexOf('screen=') === 0) screenId = decodeURIComponent(h.slice(7));
    return {
      testId: q.testId || 'SET1',
      sessionId: q.sessionId || null,
      mode: mode,
      profile: profile,
      section: q.section || null,
      screenId: screenId
    };
  }

  /* ── 상태머신 ────────────────────────────────────────────── */

  function create(screens, opts) {
    var o = opts || {};
    var list = screens && screens.length ? screens : [];
    var idx = 0;
    var phaseIndex = 0;
    var state = 'not_started';           // not_started|in_progress|submitting|submitted
    var mode = o.mode === 'practice' ? 'practice' : 'exam';
    var transitionCbs = [];
    var listeners = [];                  // 부수 이벤트(record/expire warning 등)
    var armedKeys = {};                  // 이 세션에서 arm 한 clock key
    var destroyed = false;

    function store() { return storeApi(); }
    function clock() { return clockApi(); }

    function log(type, detail) {
      var s = store();
      if (s && typeof s.pushEvent === 'function') {
        try { s.pushEvent(type, list[idx] ? list[idx].id : '', detail === undefined ? '' : detail); } catch (e) {}
      }
    }

    function emit(type, payload) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i]({ type: type, payload: payload, screen: list[idx] || null }); } catch (e) {}
      }
    }

    function fireTransition(from, to, reason) {
      var at = Date.now();
      for (var i = 0; i < transitionCbs.length; i++) {
        try { transitionCbs[i]({ from: from, to: to, reason: reason, at: at }); } catch (e) { warn('onTransition threw', e); }
      }
    }

    function current() { return list[idx] || null; }
    function currentIndex() { return idx; }
    function status() { return state; }

    function questionIdsOf(screen) {
      if (!screen) return [];
      if (screen.questionIds && screen.questionIds.length) return screen.questionIds;
      return [];
    }

    /* 만료 처리 — architecture.md §3.5 우선순위.
       현재 화면 자신의 scope 만료면 그 화면의 onExpire 를 따르고,
       그보다 넓은 scope(module/task/section) 만료는 moduleEnd 로의 강제 전이다. */
    function handleExpire(key, spec) {
      log('timer_expire', { key: key, scope: spec.scope, action: spec.onExpire_action || spec.action || '' });
      var screen = current();
      var action = spec.action || 'autoAdvance';
      var ownTimers = timersOf(screen), i, ownScope = null;
      for (i = 0; i < ownTimers.length; i++) {
        if (clockKeyFor(screen, ownTimers[i]) === key) { ownScope = ownTimers[i].scope || 'screen'; break; }
      }
      var wide = (spec.scope === 'module' || spec.scope === 'task' || spec.scope === 'section');

      if (mode === 'practice' && action === 'autoAdvance') {
        // Story 1.8 AC4 — 연습 모드는 자동전환 대신 경고 배지만 띄운다.
        emit('expire_warning', { key: key, scope: spec.scope });
        return;
      }
      if (action === 'stopRecord') { emit('stop_record', { key: key }); return; }
      if (action === 'startRecord') { emit('start_record', { key: key }); return; }

      if (wide && (ownScope === null || NARROW[ownScope] < NARROW[spec.scope])) {
        var target = findModuleEnd(key.split(':')[1]);
        if (target >= 0) { goTo(target, 'expire'); return; }
      }
      next('expire');
    }

    function findModuleEnd(scopeTarget) {
      for (var j = idx; j < list.length; j++) {
        var s = list[j];
        if (!s || s.screenType !== 'moduleEnd') continue;
        if (s.moduleId === scopeTarget || s.section === scopeTarget || String(s.id).indexOf(scopeTarget) >= 0) return j;
      }
      return -1;
    }

    /* 화면 진입 시 clock 을 arm 한다. armClock 은 같은 key 가 있으면 덮어쓰지 않으므로
       재개해도 시간이 늘어나지 않는다(§5.3). */
    function armScreenClocks(screen) {
      var c = clock();
      if (!c || !screen) return;
      var ts = timersOf(screen);
      for (var i = 0; i < ts.length; i++) {
        var t = ts[i];
        if (!t || t.mode === 'none') continue;
        var key = clockKeyFor(screen, t);
        if (!key) continue;
        var action = t.onExpire || 'autoAdvance';
        c.armClock(key, t.seconds, {
          mode: t.mode || 'countdown',
          format: t.format || (t.mode === 'response' ? 'HH:MM:SS' : 'MM:SS'),
          scope: t.scope || 'screen',
          visible: t.visible === false ? false : true,
          warnAtSec: typeof t.warnAtSec === 'number' ? t.warnAtSec : 60,
          onExpire: function (k, sp) { handleExpire(k, sp); }
        });
        // spec 에 action 을 남겨 handleExpire 가 참조한다.
        var sp = c.specOf(key);
        if (sp) sp.action = action;
        armedKeys[key] = true;
      }
    }

    // 화면 이탈 시 그 화면 전용(question/screen) clock 은 버린다. module/task/section 은 유지.
    function releaseScreenClocks(screen) {
      var c = clock();
      if (!c || !screen) return;
      var ts = timersOf(screen);
      for (var i = 0; i < ts.length; i++) {
        var scope = ts[i] && ts[i].scope;
        if (scope === 'question' || scope === 'screen') {
          var key = clockKeyFor(screen, ts[i]);
          if (key) { c.clearClock(key); delete armedKeys[key]; }
        }
      }
    }

    function persistCursor() {
      var s = store(), sc = current();
      if (s && sc && typeof s.saveCursor === 'function') {
        try { s.saveCursor(sc.id, idx, phaseIndex); } catch (e) {}
      }
    }

    function enter(from, reason) {
      var sc = current();
      phaseIndex = (from && sc && from === sc.id) ? phaseIndex : 0;
      persistCursor();
      log('screen_enter', { screenType: sc ? sc.screenType : '', reason: reason });

      // moduleEnd 진입 = 그 모듈의 시간이 끝났다는 뜻. 해당 scope clock 을 만료 처리한다.
      if (sc && sc.screenType === 'moduleEnd') {
        var c = clock();
        if (c) {
          var tgt = sc.moduleId || sc.section;
          if (tgt) { c.expireNow('module:' + tgt); c.expireNow('task:' + tgt); }
        }
      }
      armScreenClocks(sc);
      callRender(sc, { engine: machine, mode: mode, phaseIndex: phaseIndex });
      fireTransition(from, sc ? sc.id : null, reason);
      emit('screen', { screen: sc, index: idx });
    }

    /* 전진 전용. 역방향 이동 API 는 의도적으로 존재하지 않는다(Story 1.4 AC3). */
    function goTo(nextIdx, reason) {
      if (destroyed) return false;
      if (nextIdx <= idx) return false;
      if (nextIdx >= list.length) return finish(reason);
      var prev = current();
      releaseScreenClocks(prev);
      idx = nextIdx;
      enter(prev ? prev.id : null, reason || 'manual');
      return true;
    }

    function finish(reason) {
      var prev = current();
      state = 'submitting';
      log('submitting', { reason: reason });
      fireTransition(prev ? prev.id : null, null, reason || 'manual');
      emit('submitting', {});
      return true;
    }

    function next(reason) {
      if (destroyed) return false;
      var r = reason || 'manual';
      if (r !== 'manual' && r !== 'expire') return false;
      if (state === 'submitted' || state === 'submitting') return false;
      if (state === 'not_started') return false;
      var sc = current();
      // advance:"manual" 화면에서는 타이머 만료로 넘어가지 않는다(Story 1.4 AC2).
      if (sc && sc.advance === 'manual' && r === 'expire') return false;
      if (idx + 1 >= list.length) return finish(r);
      return goTo(idx + 1, r);
    }

    // 오디오/영상 ended 트리거. maxPlays 1 소진 → 다음 단계로(§2).
    function audioEnded(srcId) {
      if (destroyed || state !== 'in_progress') return false;
      var sc = current();
      log('audio_ended', { src: srcId || '' });
      emit('audio_ended', { src: srcId || '' });
      if (sc && sc.advance === 'auto') return next('manual');
      return false;
    }

    // speaking phases 진행. 렌더러가 phase 를 끝냈을 때 호출한다.
    function phaseNext() {
      if (destroyed || state !== 'in_progress') return false;
      var sc = current();
      var phases = sc && sc.phases ? sc.phases : null;
      if (!phases) return next('manual');
      if (phaseIndex + 1 < phases.length) {
        phaseIndex += 1;
        persistCursor();
        log('phase_enter', { phaseIndex: phaseIndex, name: phases[phaseIndex].name });
        emit('phase', { phaseIndex: phaseIndex, phase: phases[phaseIndex] });
        return true;
      }
      return next('manual');
    }

    function answer(qid, value, extra) {
      if (destroyed) return false;
      if (state === 'submitted') return false;   // 중복 제출 방지(AC7)
      var sc = current();
      var ids = questionIdsOf(sc);
      var ok = false;
      for (var i = 0; i < ids.length; i++) { if (ids[i] === qid) { ok = true; break; } }
      if (!ok) throw new Error('Question "' + qid + '" does not belong to screen "' + (sc ? sc.id : 'none') + '".');
      var s = store();
      if (s && typeof s.upsertAnswer === 'function') s.upsertAnswer(qid, value, extra);
      log('answer', { qid: qid });
      emit('answer', { qid: qid, value: value });
      return true;
    }

    function markSubmitted() {
      state = 'submitted';
      var s = store();
      if (s && typeof s.patchMeta === 'function') s.patchMeta({ submittedAt: Date.now() });
      log('submit', {});
      emit('submitted', {});
      return true;
    }

    function snapshot() {
      var s = store();
      return {
        session: s && s.current ? s.current() : null,
        screenId: current() ? current().id : null,
        screenIndex: idx,
        phaseIndex: phaseIndex,
        status: state,
        mode: mode,
        screenCount: list.length,
        answeredCount: s && s.answeredCount ? s.answeredCount() : 0
      };
    }

    function start(startIndex) {
      if (state === 'submitted') return false;
      idx = typeof startIndex === 'number' && startIndex >= 0 && startIndex < list.length ? startIndex : idx;
      state = 'in_progress';
      enter(null, 'start');
      var c = clock();
      if (c) c.start();
      return true;
    }

    /* 복구 전용 진입점(§5.4). 부팅 시 1회만 쓴다 — 시험 중 역방향 이동에는 쓰지 않는다. */
    function restoreTo(screenIndex, phase) {
      if (state !== 'not_started') return false;
      if (typeof screenIndex !== 'number' || screenIndex < 0 || screenIndex >= list.length) return false;
      idx = screenIndex;
      phaseIndex = phase || 0;
      return true;
    }

    function onTransition(fn) {
      if (typeof fn === 'function') transitionCbs.push(fn);
      return function () {
        for (var i = 0; i < transitionCbs.length; i++) { if (transitionCbs[i] === fn) { transitionCbs.splice(i, 1); return; } }
      };
    }

    function on(fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () {
        for (var i = 0; i < listeners.length; i++) { if (listeners[i] === fn) { listeners.splice(i, 1); return; } }
      };
    }

    /* 브라우저 뒤로가기 흡수(Story 1.4 AC3). 화면은 유지되고 URL 만 남는다. */
    function installHistoryGuard() {
      if (!root.history || !root.addEventListener) return false;
      try { root.history.pushState({ sg: 1 }, '', root.location.href); } catch (e) { return false; }
      root.addEventListener('popstate', function () {
        try { root.history.pushState({ sg: 1 }, '', root.location.href); } catch (e) {}
        log('back_blocked', {});
        emit('back_blocked', {});
      });
      return true;
    }

    function syncHash() {
      var sc = current();
      if (!sc || !root.history || !root.history.replaceState) return;
      try {
        root.history.replaceState(root.history.state, '', root.location.pathname + root.location.search + '#screen=' + encodeURIComponent(sc.id));
      } catch (e) {}
    }

    function destroy() {
      destroyed = true;
      transitionCbs = [];
      listeners = [];
      var c = clock();
      if (c) c.stop();
    }

    var machine = {
      current: current, currentIndex: currentIndex, screens: function () { return list; },
      status: status, mode: function () { return mode; },
      start: start, next: next, answer: answer, audioEnded: audioEnded, phaseNext: phaseNext,
      phaseIndex: function () { return phaseIndex; },
      markSubmitted: markSubmitted, snapshot: snapshot, restoreTo: restoreTo,
      onTransition: onTransition, on: on,
      installHistoryGuard: installHistoryGuard, syncHash: syncHash, destroy: destroy,
      clockKeyFor: clockKeyFor
    };
    return machine;
  }

  root.SG_EXAM = {
    create: create,
    parseUrl: parseUrl,
    clockKeyFor: clockKeyFor,
    NARROW: NARROW
  };
})(typeof window !== 'undefined' ? window : this);
