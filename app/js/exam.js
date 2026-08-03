/* =============================================================
 * SMEAG TOEFL — 시험 진행 컨트롤러 (담당 E)
 *
 * 역할: 블록 단위 페이지 진행 · 진행률/타이머/문항 팔레트 관리 ·
 *       SMEAG_SECTIONS[id].renderBlock(ctx) 호출 · 종료 시 채점/저장/동기화.
 *
 * ES module 아님 — <script src> 로 로드되어 window.SMEAG_EXAM 을 정의한다.
 * ============================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------
   * 0. 최소 유틸 (util.js 가 있으면 그걸 쓰고, 없으면 자체 폴백)
   * ------------------------------------------------------------- */
  var U = window.SMEAG || {};

  function esc(s) {
    if (U.esc) return U.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(sec) {
    if (U.fmtTime) return U.fmtTime(sec);
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function el(tag, attrs, kids) {
    if (U.el) return U.el(tag, attrs, kids);
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------
   * 1. 내부 상태
   * ------------------------------------------------------------- */
  var SET = window.SMEAG_SET1 || null;
  var STORE = window.SMEAG_STORE || null;

  var flow = [];          // 전체 블록을 한 줄로 편 목록
  var totalQuestions = 0; // 91
  var idx = -1;           // 현재 flow 인덱스
  var attempt = null;
  var live = null;        // 현재 렌더러 인스턴스 {destroy}
  var ready = false;      // 현재 블록에서 '다음' 활성 여부
  var timer = null;       // SMEAG_TIMER 인스턴스
  var timerScopeKey = ''; // 현재 타이머가 걸린 범위 키 (섹션/모듈)
  var timerLeft = {};     // 범위 키 → 남은 초. 범위를 오갈 때 시간이 되살아나지 않게 한다.
  var elapsedTick = null; // 경과시간 누적 인터벌
  var submitting = false; // 정상 제출 중 → beforeunload 경고 끔
  var started = false;    // 시험 본편 시작 여부
  var advanceGuard = false; // onAutoAdvance 중복 방지

  /* 되돌아가기 금지 섹션 */
  function isLocked(sectionId) {
    return sectionId === 'listening' || sectionId === 'speaking';
  }

  /* ---------------------------------------------------------------
   * 2. flow 구성
   * ------------------------------------------------------------- */
  function buildFlow() {
    flow = [];
    if (!SET) return;
    SET.sections.forEach(function (sec, si) {
      (sec.modules || []).forEach(function (mod, mi) {
        (mod.blocks || []).forEach(function (blk, bi) {
          flow.push({
            si: si, mi: mi, bi: bi,
            section: sec, module: mod, block: blk
          });
        });
      });
    });
    totalQuestions = 0;
    flow.forEach(function (f) { totalQuestions += (f.block.questions || []).length; });
  }

  function findFlowIndex(cursor) {
    if (!cursor) return -1;
    for (var i = 0; i < flow.length; i++) {
      var f = flow[i];
      if (f.section.id === cursor.sectionId &&
          f.module.id === cursor.moduleId &&
          f.bi === (cursor.blockIndex | 0)) return i;
    }
    /* 모듈까지만 맞아도 첫 블록으로 */
    for (var j = 0; j < flow.length; j++) {
      if (flow[j].section.id === cursor.sectionId) return j;
    }
    return -1;
  }

  function isSectionLast(i) {
    return i >= 0 && i < flow.length &&
      (i === flow.length - 1 || flow[i + 1].section.id !== flow[i].section.id);
  }

  function firstIndexOfSection(si) {
    for (var i = 0; i < flow.length; i++) if (flow[i].si === si) return i;
    return -1;
  }

  function firstIndexAfterModule(i) {
    var cur = flow[i];
    for (var j = i + 1; j < flow.length; j++) {
      if (flow[j].module.id !== cur.module.id) return j;
    }
    return flow.length; // 끝
  }

  function firstIndexAfterSection(i) {
    var cur = flow[i];
    for (var j = i + 1; j < flow.length; j++) {
      if (flow[j].section.id !== cur.section.id) return j;
    }
    return flow.length;
  }

  /* ---------------------------------------------------------------
   * 3. 답안 상태
   * ------------------------------------------------------------- */
  function getAnswer(qid) {
    try { return STORE.getAnswer(qid); } catch (e) { return undefined; }
  }

  function isAnswered(qid) {
    var v = getAnswer(qid);
    if (v === undefined || v === null || v === '') return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return true;
    if (Array.isArray(v)) {
      return v.some(function (t) { return t != null && String(t).trim() !== ''; });
    }
    if (typeof v === 'object') return !!(v.recorded || v.skipped);
    return true;
  }

  function answeredCount() {
    var n = 0;
    flow.forEach(function (f) {
      (f.block.questions || []).forEach(function (q) { if (isAnswered(q.id)) n++; });
    });
    return n;
  }

  /* ---------------------------------------------------------------
   * 4. 상단 바 / 팔레트 / 하단 바 그리기
   * ------------------------------------------------------------- */
  function paintTop() {
    var f = flow[idx];
    if (!f) return;
    $('exSetTitle').textContent = (SET && SET.title) || 'TOEFL';
    $('exWhere').textContent =
      (f.section.labelKo || f.section.label) + ' · ' + (f.module.label || f.module.id) +
      (f.block.heading ? ' · ' + f.block.heading : '');

    var done = answeredCount();
    var pct = totalQuestions ? Math.round(done / totalQuestions * 100) : 0;
    $('exProgFill').style.width = pct + '%';
    $('exProgText').textContent = done + ' / ' + totalQuestions + ' 문항 (' + pct + '%)';
  }

  function paintPalette() {
    var box = $('exPalette');
    box.innerHTML = '';
    var f = flow[idx];
    if (!f) return;
    var locked = isLocked(f.section.id);

    var curModId = null;
    flow.forEach(function (g, gi) {
      if (g.si !== f.si) return;
      if (g.module.id !== curModId) {
        curModId = g.module.id;
        box.appendChild(el('em', { text: g.module.label || g.module.id }));
      }
      (g.block.questions || []).forEach(function (q) {
        var cls = isAnswered(q.id) ? 'done' : '';
        if (gi === idx) cls += ' cur';
        if (locked) cls += ' lock';
        var b = el('b', {
          class: cls.trim(),
          text: String(q.no != null ? q.no : ''),
          title: q.id + (locked ? ' (되돌아가기 불가)' : '')
        });
        if (!locked) {
          b.addEventListener('click', function () { goTo(gi); });
        }
        box.appendChild(b);
      });
    });
  }

  function paintFoot() {
    var f = flow[idx];
    if (!f) return;
    var prev = $('exPrev'), next = $('exNext'), note = $('exFootNote');
    var locked = isLocked(f.section.id);
    var atSectionStart = idx === firstIndexOfSection(f.si);

    prev.disabled = locked || atSectionStart;
    prev.title = locked ? '이 섹션은 이전 문항으로 돌아갈 수 없습니다.' : '';

    if (idx === flow.length - 1) next.textContent = '시험 종료';
    else if (isSectionLast(idx)) next.textContent = '섹션 제출';
    else next.textContent = '다음';

    next.disabled = !ready;
    note.textContent = ready ? '' : '이 화면의 진행이 끝나면 다음으로 넘어갈 수 있습니다.';
  }

  function paintAll() { paintTop(); paintPalette(); paintFoot(); }

  /* ---------------------------------------------------------------
   * 5. 타이머
   * ------------------------------------------------------------- */
  function stopTimer() {
    /* 범위를 벗어날 때 남은 시간을 보관한다. 보관하지 않으면 '이전'→'다음' 을
       반복하는 것만으로 제한시간이 매번 처음부터 다시 시작된다. */
    if (timer && timerScopeKey) {
      try { timerLeft[timerScopeKey] = timer.remaining(); } catch (e) {}
    }
    if (timer) { try { timer.stop(); } catch (e) {} }
    timer = null;
    timerScopeKey = '';
    var t = $('exTime');
    t.hidden = true;
    t.classList.remove('warn');
  }

  /* 현재 블록에 적용되는 시간 제한을 찾는다. 모듈 제한이 섹션 제한보다 우선. */
  function timerSpecFor(f) {
    if (f.module && f.module.timeLimitSec) {
      return { key: 'mod:' + f.section.id + '/' + f.module.id, seconds: f.module.timeLimitSec, scope: 'module' };
    }
    if (f.section && f.section.timeLimitSec) {
      return { key: 'sec:' + f.section.id, seconds: f.section.timeLimitSec, scope: 'section' };
    }
    return null;
  }

  function syncTimer() {
    var f = flow[idx];
    if (!f) return;
    var spec = timerSpecFor(f);

    if (!spec) { stopTimer(); return; }
    if (timer && timerScopeKey === spec.key) return; // 같은 범위 → 계속 진행

    stopTimer();
    if (!window.SMEAG_TIMER) return;

    timerScopeKey = spec.key;

    /* 이미 이 범위에 머문 적이 있으면 남은 시간부터 이어간다. 0 이하면 즉시 만료 처리. */
    var left = Object.prototype.hasOwnProperty.call(timerLeft, spec.key)
      ? timerLeft[spec.key] : spec.seconds;
    var box = $('exTime');
    box.hidden = false;
    box.textContent = fmtTime(left);
    if (left <= 0) { onTimeExpired(spec.scope); return; }

    timer = window.SMEAG_TIMER.create({
      seconds: left,
      onTick: function (remaining) {
        box.textContent = fmtTime(remaining);
        if (remaining <= 60) box.classList.add('warn');
      },
      onExpire: function () {
        box.textContent = '00:00';
        onTimeExpired(spec.scope);
      }
    });
    timer.start();
  }

  function onTimeExpired(scope) {
    var f = flow[idx];
    if (!f) return;
    stopTimer();
    var target = scope === 'module' ? firstIndexAfterModule(idx) : firstIndexAfterSection(idx);
    toast(scope === 'module' ? '시간이 종료되어 다음 파트로 이동합니다.' : '시간이 종료되어 다음 섹션으로 이동합니다.');
    if (target >= flow.length) finish();
    else goTo(target, true);
  }

  /* 섹션별 경과시간 누적 */
  function startElapsedTick() {
    if (elapsedTick) return;
    var n = 0;
    elapsedTick = setInterval(function () {
      var f = flow[idx];
      if (!f || !attempt) return;
      attempt.elapsed = attempt.elapsed || {};
      attempt.elapsed[f.section.id] = (attempt.elapsed[f.section.id] || 0) + 1;
      n++;
      if (n % 10 === 0) { try { STORE.save(attempt); } catch (e) {} }
    }, 1000);
  }

  function stopElapsedTick() {
    if (elapsedTick) clearInterval(elapsedTick);
    elapsedTick = null;
    if (attempt) { try { STORE.save(attempt); } catch (e) {} }
  }

  /* ---------------------------------------------------------------
   * 6. 블록 렌더링
   * ------------------------------------------------------------- */
  function destroyLive() {
    if (live && typeof live.destroy === 'function') {
      try { live.destroy(); } catch (e) { console.warn('[exam] destroy 실패', e); }
    }
    live = null;
  }

  function goTo(i, silent) {
    if (i < 0 || i >= flow.length) return;
    destroyLive();
    idx = i;
    ready = false;
    advanceGuard = false;
    renderCurrent();
    if (!silent) window.scrollTo(0, 0);
  }

  function renderCurrent() {
    var f = flow[idx];
    if (!f) return;
    var root = $('exBody');
    root.innerHTML = '';

    /* 커서 저장 */
    try {
      STORE.setCursor({
        sectionId: f.section.id,
        moduleId: f.module.id,
        blockIndex: f.bi,
        questionIndex: 0
      });
      attempt = STORE.current() || attempt;
    } catch (e) {}

    syncTimer();
    paintAll();

    var renderer = (window.SMEAG_SECTIONS || {})[f.section.id];
    if (!renderer || typeof renderer.renderBlock !== 'function') {
      root.appendChild(el('div', {
        class: 'ex-missing',
        html: '이 섹션 렌더러를 불러오지 못했습니다.<br><small>' +
              esc(f.section.id) + ' · ' + esc(f.module.label || f.module.id) +
              ' — 다음으로 넘어갈 수 있습니다.</small>'
      }));
      setReady(true);
      return;
    }

    var ctx = {
      root: root,
      section: f.section,
      module: f.module,
      block: f.block,
      attemptId: attempt ? attempt.id : null,
      getAnswer: function (qid) { return getAnswer(qid); },
      setAnswer: function (qid, response) {
        try { STORE.setAnswer(qid, response); } catch (e) {}
        paintTop();
        paintPalette();
      },
      hasPlayed: function (key) {
        try { return !!STORE.hasPlayed(key); } catch (e) { return false; }
      },
      markPlayed: function (key) {
        try { STORE.markPlayed(key); } catch (e) {}
      },
      onReady: function () { setReady(true); },
      onAutoAdvance: function () {
        if (advanceGuard) return;
        advanceGuard = true;
        setReady(true);
        goNext(true);
      }
    };

    try {
      live = renderer.renderBlock(ctx) || null;
    } catch (e) {
      console.error('[exam] renderBlock 오류', e);
      root.innerHTML = '';
      root.appendChild(el('div', {
        class: 'ex-missing',
        html: '이 섹션 렌더러를 불러오지 못했습니다.<br><small>화면을 그리는 중 오류가 발생했습니다 — 다음으로 넘어갈 수 있습니다.</small>'
      }));
      setReady(true);
    }
  }

  function setReady(v) {
    ready = !!v;
    paintFoot();
  }

  /* ---------------------------------------------------------------
   * 7. 이동 / 종료
   * ------------------------------------------------------------- */
  function goPrev() {
    var f = flow[idx];
    if (!f || isLocked(f.section.id)) return;
    if (idx === firstIndexOfSection(f.si)) return;
    goTo(idx - 1);
  }

  function goNext(auto) {
    if (!auto && !ready) return;

    if (idx === flow.length - 1) {
      if (auto || confirm('시험을 종료하고 제출하시겠습니까? 제출 후에는 답안을 수정할 수 없습니다.')) finish();
      return;
    }
    if (!auto && isSectionLast(idx)) {
      if (!confirm('이 섹션을 제출하고 다음 섹션으로 이동합니다. 되돌아올 수 없습니다.')) return;
    }
    goTo(idx + 1);
  }

  function finish() {
    if (submitting) return;
    submitting = true;
    destroyLive();
    stopTimer();
    stopElapsedTick();

    showPanel(
      '<h2>채점 중입니다…</h2><p>답안을 저장하고 결과를 계산하고 있습니다. 창을 닫지 마세요.</p>',
      []
    );

    var report = null;
    try {
      report = window.SMEAG_GRADE ? window.SMEAG_GRADE.run(attempt) : null;
    } catch (e) {
      console.error('[exam] 채점 실패', e);
      report = null;
    }

    var saved = null;
    try { saved = STORE.submit(report); } catch (e) { console.error('[exam] 제출 저장 실패', e); }
    var finalAttempt = saved || attempt;
    var attemptId = finalAttempt ? finalAttempt.id : '';

    var done = function () {
      location.replace('results.html?attempt=' + encodeURIComponent(attemptId));
    };

    var sync = window.SMEAG_SYNC;
    var canSync = false;
    try { canSync = !!(sync && sync.enabled && sync.enabled()); } catch (e) { canSync = false; }

    if (!canSync) { done(); return; }

    var settled = false;
    var go = function () { if (!settled) { settled = true; done(); } };
    setTimeout(go, 12000); // 동기화가 늦어도 결과 화면으로

    try {
      Promise.resolve(sync.push(finalAttempt)).then(go, go);
    } catch (e) { go(); }
  }

  /* ---------------------------------------------------------------
   * 8. 오버레이 (모달 · 안내화면 · 토스트)
   * ------------------------------------------------------------- */
  function showPanel(innerHtml, buttons) {
    var ov = $('exOverlay');
    ov.innerHTML = '';
    var panel = el('div', { class: 'ex-panel', html: innerHtml });
    if (buttons && buttons.length) {
      var acts = el('div', { class: 'ex-actions' });
      buttons.forEach(function (b) {
        acts.appendChild(el('button', {
          class: 'ex-btn' + (b.primary ? ' primary' : ''),
          type: 'button',
          text: b.label,
          onclick: b.onClick
        }));
      });
      panel.appendChild(acts);
    }
    ov.appendChild(panel);
    ov.hidden = false;
  }

  function hidePanel() {
    var ov = $('exOverlay');
    ov.hidden = true;
    ov.innerHTML = '';
  }

  function toast(msg) {
    var t = el('div', {
      class: 'ex-toast',
      text: msg
    });
    t.setAttribute('style',
      'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#1c1c28;' +
      'color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;z-index:200;box-shadow:0 8px 24px #0004');
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  /* ---------------------------------------------------------------
   * 9. 안내 화면 / 이어하기
   * ------------------------------------------------------------- */
  function sectionSummaryHtml() {
    if (!SET) return '';
    var rows = SET.sections.map(function (sec) {
      var n = 0;
      (sec.modules || []).forEach(function (m) {
        (m.blocks || []).forEach(function (b) { n += (b.questions || []).length; });
      });
      var limit = sec.timeLimitSec
        ? fmtTime(sec.timeLimitSec)
        : (sec.modules || []).some(function (m) { return m.timeLimitSec; }) ? '파트별 제한' : '제한 없음';
      return '<li><b>' + esc(sec.labelKo || sec.label) + '</b> — ' + n + '문항 · ' + esc(limit) + '</li>';
    }).join('');
    return '<ul>' + rows + '</ul>';
  }

  function showIntro(mode) {
    var micWarn = (window.SMEAG_REC && window.SMEAG_REC.available && window.SMEAG_REC.available())
      ? ''
      : '<div class="ex-warn">이 브라우저에서는 녹음을 사용할 수 없습니다. 스피킹은 건너뛴 것으로 기록되고 시험은 계속 진행됩니다.</div>';

    showPanel(
      '<h2>' + esc((SET && SET.title) || 'TOEFL 모의고사') + '</h2>' +
      '<p>시작 전 아래 내용을 확인하세요.</p>' +
      sectionSummaryHtml() +
      '<div class="ex-note">' +
      '· 오디오는 <b>단 한 번만</b> 재생됩니다. 조용한 곳에서 헤드폰 사용을 권장합니다.<br>' +
      '· 리스닝·스피킹은 <b>이전 문항으로 되돌아갈 수 없습니다.</b><br>' +
      '· 스피킹에는 <b>마이크 권한</b>이 필요합니다.<br>' +
      '· 답안은 입력 즉시 자동 저장되며, 새로고침해도 이어서 응시할 수 있습니다.' +
      '</div>' + micWarn +
      '<p style="font-size:13px;color:#8a8aa0">아래 버튼을 눌러야 오디오 자동 재생이 허용됩니다.</p>',
      [{
        label: mode === 'resume' ? '이어서 시작' : '시험 시작',
        primary: true,
        onClick: function () { beginExam(mode); }
      }]
    );
  }

  function beginExam(mode) {
    if (mode === 'resume') {
      try { attempt = STORE.resume() || STORE.current(); } catch (e) { attempt = null; }
    }
    if (!attempt) {
      try { attempt = STORE.start(); } catch (e) { attempt = null; }
    }
    if (!attempt) {
      showPanel('<h2>시작할 수 없습니다</h2><p>답안 저장소를 초기화하지 못했습니다. 브라우저의 저장소 설정을 확인해 주세요.</p>', []);
      return;
    }

    hidePanel();
    $('examShell').hidden = false;
    started = true;
    startElapsedTick();

    var target = findFlowIndex(attempt.cursor);
    goTo(target >= 0 ? target : 0);
  }

  function showResumeModal(cur) {
    var where = '';
    if (cur.cursor) {
      var f = flow[findFlowIndex(cur.cursor)];
      if (f) where = (f.section.labelKo || f.section.label) + ' · ' + (f.module.label || f.module.id);
    }
    showPanel(
      '<h2>이어서 응시하시겠습니까?</h2>' +
      '<p>진행 중이던 시험이 있습니다.' + (where ? ' 마지막 위치: <b>' + esc(where) + '</b>' : '') + '</p>' +
      '<div class="ex-warn">‘새로 시작’을 고르면 진행 중이던 답안은 삭제됩니다.</div>',
      [
        { label: '새로 시작', onClick: function () {
            if (!confirm('진행 중이던 답안을 모두 버리고 새로 시작합니다. 계속할까요?')) return;
            attempt = null;
            showIntro('new');
          } },
        { label: '이어하기', primary: true, onClick: function () { showIntro('resume'); } }
      ]
    );
  }

  /* ---------------------------------------------------------------
   * 10. 부팅
   * ------------------------------------------------------------- */
  function bindShell() {
    $('exPrev').addEventListener('click', function () { goPrev(); });
    $('exNext').addEventListener('click', function () { goNext(false); });
    $('exExit').addEventListener('click', function () {
      if (!confirm('시험을 중단하고 나가시겠습니까? 지금까지의 답안은 저장되어 나중에 이어서 응시할 수 있습니다.')) return;
      destroyLive();
      stopTimer();
      stopElapsedTick();
      submitting = true; // 의도적 이탈 → 경고 생략
      location.href = 'index.html';
    });

    window.addEventListener('beforeunload', function (e) {
      if (!started || submitting) return;
      e.preventDefault();
      e.returnValue = '시험이 진행 중입니다.';
      return '시험이 진행 중입니다.';
    });

    /* 뒤로가기로 되돌아온 경우(bfcache) — 커서 기준으로 다시 그린다 */
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted || !started) return;
      try { attempt = STORE.current() || attempt; } catch (err) {}
      var t = findFlowIndex(attempt && attempt.cursor);
      goTo(t >= 0 ? t : idx);
    });
  }

  function init() {
    if (!SET || !STORE) {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:system-ui">필수 스크립트를 불러오지 못했습니다. ' +
        '(set1.js / store.js) 파일 위치를 확인해 주세요.</div>';
      return;
    }
    buildFlow();
    bindShell();

    var cur = null;
    try { cur = STORE.current(); } catch (e) { cur = null; }

    if (cur) showResumeModal(cur);
    else showIntro('new');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------------------------------------------------------------
   * 11. 공개 API (디버깅/외부 제어용 — 계약 외 추가분)
   * ------------------------------------------------------------- */
  window.SMEAG_EXAM = {
    goTo: goTo,
    next: function () { goNext(false); },
    prev: goPrev,
    finish: finish,
    state: function () {
      var f = flow[idx];
      return {
        index: idx,
        total: flow.length,
        sectionId: f ? f.section.id : null,
        moduleId: f ? f.module.id : null,
        blockIndex: f ? f.bi : null,
        ready: ready,
        answered: answeredCount(),
        totalQuestions: totalQuestions
      };
    }
  };
})();
