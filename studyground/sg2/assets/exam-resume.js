/* SMEAG · StudyGround — exam-resume.js
 * 목적: 정전 복구. 화면이 넘어갈 때마다 스냅샷(체크포인트)을 남기고, 다시 켰을 때
 *       "어디로 돌아갈지"를 학생이 고르게 한다.
 * 의존 전역: window.SG_LDB(로컬 DB), window.SG_CLOUD(클라우드) — 둘 다 선택.
 * 노출 전역: window.SG_RESUME
 *
 * 왜 체크포인트인가 —
 *   전원이 끊기면 beforeunload 도 pagehide 도 오지 않는다. 마지막으로 디스크에
 *   닿은 상태가 곧 복구 지점이다. 커서 하나만 저장해 두면 "꺼지기 직전"밖에 못
 *   고른다. 화면 전환마다 한 벌(커서 + 시계 남은시간 + 답안)을 통째로 남겨 두면
 *   두 스텝, 세 스텝 뒤로도 갈 수 있다.
 *
 * 시계 처리 —
 *   저장된 deadline 은 절대 epoch 다. 정전 30분 뒤 그대로 복원하면 모든 시계가
 *   이미 만료돼 있다. 그래서 체크포인트에는 "그 순간 남아 있던 시간(remain)"을
 *   같이 적고, 되감을 때 now + remain 으로 다시 건다. 정전으로 흘러간 시간은
 *   학생 탓이 아니므로 돌려준다. (자리를 비운 경우는 기존대로 소모된다 —
 *   그 경로는 '이어서 응시'이고 여기를 지나지 않는다.)
 *
 * 순수부(optionsFor / pick / rebaseClocks / courseStartIndex)는 DOM·타이머를 만지지
 * 않아 node 에서 그대로 돌려볼 수 있다(coding standards F9).
 */
(function (root) {
  'use strict';

  var MAX_BACK = 3;            // 되감기는 세 스텝까지 연다

  /* ── 순수부 ──────────────────────────────────────────────── */

  /* 체크포인트에 담을 시계: key → 그 순간 남은 ms. 음수는 0 으로 눕힌다. */
  function remainOf(clockMap, nowMs) {
    var out = {}, k, d;
    for (k in (clockMap || {})) {
      if (!clockMap.hasOwnProperty(k)) continue;
      d = clockMap[k];
      if (d === null || d === undefined) continue;
      out[k] = Math.max(0, d - nowMs);
    }
    return out;
  }

  /* 되감기 시점에 다시 거는 deadline: now + 그때 남아 있던 시간. */
  function rebaseClocks(remain, nowMs) {
    var out = {}, k;
    for (k in (remain || {})) {
      if (!remain.hasOwnProperty(k)) continue;
      out[k] = nowMs + Math.max(0, remain[k]);
    }
    return out;
  }

  /* 학생에게 보여줄 선택지. 체크포인트가 모자라면 그 줄은 아예 내지 않는다 —
     "2스텝 전"이라고 해 놓고 같은 자리로 보내면 학생이 속는다. */
  function optionsFor(checkpoints, opts) {
    var list = (checkpoints || []).slice().sort(function (a, b) { return a.step - b.step; });
    var o = opts || {};
    var out = [];
    var n = list.length;

    if (n > 0) {
      out.push({ kind: 'last', back: 0, step: list[n - 1].step, checkpoint: list[n - 1],
                 label: 'Right before it shut down', labelKo: '꺼지기 직전' });
    }
    for (var b = 2; b <= MAX_BACK; b++) {
      var i = n - b;
      if (i < 0) continue;
      out.push({ kind: 'back', back: b, step: list[i].step, checkpoint: list[i],
                 label: b + ' steps back', labelKo: b + '스텝 전' });
    }
    if (o.section) {
      out.push({ kind: 'course', section: o.section,
                 label: 'Restart this course', labelKo: '이 코스 처음부터' });
    }
    out.push({ kind: 'fresh', label: 'Start the whole test over', labelKo: '전체 다시' });
    return out;
  }

  function pick(checkpoints, choice) {
    if (!choice) return null;
    if (choice.checkpoint) return choice.checkpoint;
    var list = (checkpoints || []).slice().sort(function (a, b) { return a.step - b.step; });
    if (choice.kind === 'last') return list[list.length - 1] || null;
    if (choice.kind === 'back') {
      var i = list.length - (choice.back || 1);
      return i >= 0 ? list[i] : null;
    }
    return null;
  }

  /* 한 코스(영역)의 첫 화면. '이 코스 처음부터' 가 여기로 보낸다. */
  function courseStartIndex(screens, section) {
    if (!screens || !section) return 0;
    for (var i = 0; i < screens.length; i++) {
      if (screens[i] && screens[i].section === section) return i;
    }
    return 0;
  }

  /* 그 코스에 속한 문항 답안만 지운다 — 다른 영역까지 날리면 안 된다. */
  function answersOutsideSection(answers, screens, section) {
    var keep = {}, drop = {}, i, j, ids;
    for (i = 0; i < (screens || []).length; i++) {
      var sc = screens[i];
      if (!sc || sc.section !== section) continue;
      ids = sc.questionIds || [];
      for (j = 0; j < ids.length; j++) drop[ids[j]] = true;
    }
    for (var qid in (answers || {})) {
      if (!answers.hasOwnProperty(qid)) continue;
      if (!drop[qid]) keep[qid] = answers[qid];
    }
    return keep;
  }

  /* ── 기록 ────────────────────────────────────────────────── */

  var step = 0;
  var session = null;

  function attach(sessionId, startStep) {
    session = sessionId;
    step = typeof startStep === 'number' ? startStep : 0;
    return step;
  }

  function currentStep() { return step; }

  /* 스냅샷은 반드시 복사본이어야 한다. SG_STORE.answers() 는 살아 있는 캐시를 그대로
     돌려주고 upsertAnswer 가 그 안의 레코드를 제자리에서 고친다 — 참조로 담으면 열 벌을
     떠도 전부 "지금 답안" 하나를 가리켜, 되감기가 아무것도 되돌리지 못한다. */
  function copyAnswers(src) {
    var out = {}, qid, rec, k;
    for (qid in (src || {})) {
      if (!src.hasOwnProperty(qid)) continue;
      rec = src[qid];
      if (rec && typeof rec === 'object') {
        var c = {};
        for (k in rec) { if (rec.hasOwnProperty(k)) c[k] = rec[k]; }
        out[qid] = c;
      } else {
        out[qid] = rec;
      }
    }
    return out;
  }

  function copyMap(src) {
    var out = {}, k;
    for (k in (src || {})) { if (src.hasOwnProperty(k)) out[k] = src[k]; }
    return out;
  }

  /* 화면이 바뀔 때마다 한 벌. 로컬 DB 에 먼저, 그다음 클라우드 큐에 넣는다 —
     순서가 중요하다. 클라우드가 죽어 있어도 로컬에는 이미 있어야 한다. */
  function capture(machine, storeApi, nowMs) {
    if (!machine || !storeApi) return null;
    var sc = null;
    try { sc = machine.current(); } catch (e) { sc = null; }
    if (!sc) return null;

    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var clocks = {}, answers = {};
    try { clocks = copyMap(storeApi.clocks()); } catch (e) {}
    try { answers = copyAnswers(storeApi.answers()); } catch (e) {}

    step += 1;
    var entry = {
      step: step,
      screenId: sc.id,
      screenIndex: machine.currentIndex(),
      phaseIndex: typeof machine.phaseIndex === 'function' ? machine.phaseIndex() : 0,
      section: sc.section || '',
      cursor: { screenId: sc.id, screenIndex: machine.currentIndex(),
                phaseIndex: typeof machine.phaseIndex === 'function' ? machine.phaseIndex() : 0 },
      clocks: clocks,
      remain: remainOf(clocks, now),
      answers: answers,
      ts: now
    };

    if (root.SG_LDB && typeof root.SG_LDB.putCheckpoint === 'function') {
      try { root.SG_LDB.putCheckpoint(session, entry); } catch (e) {}
    }
    if (root.SG_CLOUD && typeof root.SG_CLOUD.pushCheckpoint === 'function') {
      try {
        root.SG_CLOUD.pushCheckpoint(entry);
        root.SG_CLOUD.pushState(entry.cursor, clocks, entry.step);
      } catch (e) {}
    }
    return entry;
  }

  /* ── 되돌리기 ────────────────────────────────────────────── */

  /* 지우기 전에 한 벌 뜬다. 되감기도 코스 재시작도 "지금 답안"을 버리는 동작이라
     잘못 누른 학생에게 돌아갈 자리를 남겨야 한다(SG_LDB.arch). 로컬 DB 가 없으면
     조용히 건너뛴다 — 백업 실패가 시험을 멈추면 안 된다(F12). */
  function backup(storeApi, reason, cb) {
    var done = typeof cb === 'function' ? cb : function () {};
    var sess = session || (storeApi && storeApi.current ? storeApi.current() : null);
    if (!sess || !root.SG_LDB || typeof root.SG_LDB.archiveSession !== 'function') { done(null, null); return; }
    /* 스냅샷은 지금, 동기로 뜬다 — 지운 뒤에 뜨면 빈 백업본이 남는다. */
    var snap = {};
    try { snap.answers = JSON.parse(JSON.stringify(storeApi.answers() || {})); } catch (e) { snap.answers = {}; }
    try { snap.clocks = JSON.parse(JSON.stringify(storeApi.clocks() || {})); } catch (e1) { snap.clocks = {}; }
    try { snap.cursor = storeApi.cursor() || null; } catch (e2) { snap.cursor = null; }
    try { snap.meta = storeApi.meta() || {}; } catch (e3) { snap.meta = {}; }
    var local = null;
    try { local = storeApi.serializeSession ? storeApi.serializeSession(sess) : null; } catch (e4) {}

    try { root.SG_LDB.archiveSession(sess, reason || 'backup', { snapshot: snap, local: local, step: step }, done); }
    catch (e5) { done(e5, null); }
  }

  /* 고른 체크포인트를 SG_STORE 에 도로 심는다. 화면 복귀는 셸이 맡는다 —
     여기서는 "상태"만 되돌리고 DOM 은 건드리지 않는다. */
  function applyCheckpoint(storeApi, cp, nowMs) {
    if (!storeApi || !cp) return null;
    backup(storeApi, 'rewind_step_' + (cp.step || 0));
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var clocks = cp.remain ? rebaseClocks(cp.remain, now) : (cp.clocks || {});
    try { storeApi.saveClocks(clocks); } catch (e) {}
    try {
      // 복사본을 심는다 — 원본을 그대로 넣으면 이후 입력이 체크포인트를 고쳐 버린다.
      var answers = copyAnswers(cp.answers);
      // 답안은 통째로 교체한다 — 되감기는 "그 순간으로 돌아간다"는 뜻이다.
      storeApi.saveMeta(storeApi.meta());          // meta 는 그대로 둔다(세션·모드)
      var cache = storeApi.answers();
      for (var qid in cache) { if (cache.hasOwnProperty(qid) && !answers.hasOwnProperty(qid)) delete cache[qid]; }
      for (var q2 in answers) { if (answers.hasOwnProperty(q2)) cache[q2] = answers[q2]; }
      storeApi.flushAnswers();
    } catch (e2) {}
    try {
      storeApi.saveCursor(cp.cursor ? cp.cursor.screenId : cp.screenId,
                          cp.cursor ? cp.cursor.screenIndex : cp.screenIndex,
                          cp.cursor ? cp.cursor.phaseIndex : cp.phaseIndex);
    } catch (e3) {}
    try { storeApi.pushEvent('resume_rewind', cp.screenId, { step: cp.step }); } catch (e4) {}

    if (root.SG_LDB) {
      try {
        root.SG_LDB.saveAnswers(session, cp.answers || {});
        root.SG_LDB.saveClocks(session, clocks);
        root.SG_LDB.saveCursor(session, cp.cursor || null);
      } catch (e5) {}
    }
    step = cp.step;
    return { screenIndex: cp.cursor ? cp.cursor.screenIndex : cp.screenIndex,
             phaseIndex: cp.cursor ? cp.cursor.phaseIndex : cp.phaseIndex,
             clocks: clocks };
  }

  /* '이 코스 처음부터' — 그 영역의 답안만 버리고 첫 화면으로. 시계는 그 영역 것만
     지운다. 다른 영역의 남은 시간은 건드리지 않는다. */
  function applyCourseRestart(storeApi, screens, section) {
    if (!storeApi) return null;
    backup(storeApi, 'course_restart_' + (section || ''));
    var idx = courseStartIndex(screens, section);
    try {
      var kept = answersOutsideSection(storeApi.answers(), screens, section);
      var cache = storeApi.answers();
      for (var qid in cache) { if (cache.hasOwnProperty(qid) && !kept.hasOwnProperty(qid)) delete cache[qid]; }
      storeApi.flushAnswers();
    } catch (e) {}
    try {
      var clocks = storeApi.clocks() || {}, k;
      for (k in clocks) {
        if (!clocks.hasOwnProperty(k)) continue;
        if (String(k).indexOf(':' + section) >= 0) delete clocks[k];
      }
      storeApi.saveClocks(clocks);
    } catch (e2) {}
    try {
      storeApi.saveCursor(screens && screens[idx] ? screens[idx].id : '', idx, 0);
      storeApi.pushEvent('resume_course_restart', section || '', {});
    } catch (e3) {}
    return { screenIndex: idx, phaseIndex: 0 };
  }

  root.SG_RESUME = {
    MAX_BACK: MAX_BACK,
    // 순수
    remainOf: remainOf, rebaseClocks: rebaseClocks, optionsFor: optionsFor, pick: pick,
    courseStartIndex: courseStartIndex, answersOutsideSection: answersOutsideSection,
    // 기록·복구
    attach: attach, step: currentStep, capture: capture, backup: backup,
    applyCheckpoint: applyCheckpoint, applyCourseRestart: applyCourseRestart
  };
})(typeof window !== 'undefined' ? window : this);
