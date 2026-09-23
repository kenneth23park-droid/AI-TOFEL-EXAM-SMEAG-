/* SMEAG · StudyGround — exam-render-instruction.js
 * 목적: 안내 계열 화면 4종 렌더러. Story 2.1.
 *       instruction / moduleEnd / hardwareCheck / review 를 SG_RENDER 에 등록한다.
 * 의존 전역: window.SG_RENDER (필수), window.SG_STORE, window.SG_MEDIA,
 *            window.SG_RUNTIME(선택 — timing config), window.SMEAG_SET1(선택 — 문항 수/본문),
 *            window.SG_LISTEN(선택 — 1회재생 오디오 유닛; exam-render-listening.js 가 노출)
 * 노출 전역: window.SG_INSTRUCTION (테스트·자가진단용 순수 헬퍼 모음)
 *
 * 설계 메모:
 *  - instruction 화면은 계약상 timer===null 이다(exam-types.js AC3-a). 여기서 타이머를
 *    만들지 않는다. 진행은 화면 안 CTA 또는 상단바 Continue 버튼(둘 다 engine.next)로만.
 *  - 모든 문구는 data-en / data-ko 이중 표기(F5). app.css 의 [data-ko]{display:none} 규칙이
 *    언어 토글을 처리하므로 여기서 lang 을 읽지 않는다.
 *  - 실패는 throw 하지 않는다(F12). 마이크가 없어도 "Continue without microphone" 으로 진행된다.
 */
(function (root) {
  'use strict';

  var doc = root.document || null;

  /* localStorage 키 — Story 2.1 AC3 이 이 이름을 정본으로 지정했다. */
  var VOLUME_KEY = 'sg2_volume';
  var DEFAULT_VOLUME = 0.8;

  /* 볼륨 테스트음. 콘텐츠 오디오를 쓰면 문항이 사전 노출되므로 쓰지 않는다.
   * WebAudio 합성음이 1순위(파일 불필요·오프라인 안전), AudioContext 가 없을 때만
   * 문제 노출이 없는 안내 음원으로 폴백한다. */
  var TEST_TONE_HZ = 440;
  var TEST_TONE_SEC = 1.2;
  var TEST_AUDIO_FALLBACK = 'TOEFL MOCK TEST  SET 1/SET 1 AUDIO/SPEAKING/Listen and Repeat Instructions.mp3';

  /* 화면 id 는 exam-compile.js FIXED_ID 가 정본이다. 리터럴 중복을 피해 거기서 읽고,
   * 컴파일러 미로드 시에만 같은 값을 폴백으로 쓴다. */
  function fixedId(name, dflt) {
    var F = root.SG_COMPILE && root.SG_COMPILE.FIXED_ID;
    return (F && F[name]) || dflt;
  }

  function warn(msg, e) { if (root.console && root.console.warn) root.console.warn('[SG_INSTRUCTION] ' + msg, e || ''); }
  function store() { return root.SG_STORE || null; }

  /* ── DOM 헬퍼 ───────────────────────────────────────────── */

  function el(tag, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  // EN/KO 이중 노드. SG_RENDER.bilingual 이 정본이며 여기서는 얇게 감싸기만 한다.
  function bi(tag, en, ko) {
    var R = root.SG_RENDER;
    if (R && typeof R.bilingual === 'function') return R.bilingual(tag, en, ko === undefined || ko === null ? en : ko);
    var n = el(tag);
    var a = el('span'); a.setAttribute('data-en', ''); a.textContent = en;
    var b = el('span'); b.setAttribute('data-ko', ''); b.textContent = ko === undefined || ko === null ? en : ko;
    n.appendChild(a); n.appendChild(b);
    return n;
  }

  function biInto(node, en, ko) {
    var a = el('span'); a.setAttribute('data-en', ''); a.textContent = en;
    var b = el('span'); b.setAttribute('data-ko', ''); b.textContent = ko === undefined || ko === null ? en : ko;
    node.appendChild(a); node.appendChild(b);
    return node;
  }

  function button(cls, en, ko) {
    var b = el('button', cls);
    b.type = 'button';
    return biInto(b, en, ko);
  }

  function card() { return el('section', 'instr-card'); }

  /* ── 볼륨 (AC3) ─────────────────────────────────────────── */

  function readVolume() {
    var v = DEFAULT_VOLUME;
    try {
      var raw = root.localStorage ? root.localStorage.getItem(VOLUME_KEY) : null;
      if (raw !== null && raw !== undefined && raw !== '') {
        var n = parseFloat(raw);
        if (!isNaN(n) && n >= 0 && n <= 1) v = n;
      }
    } catch (e) { /* private mode 등 — 기본값으로 degrade */ }
    return v;
  }

  /* 슬라이더 값을 현재 DOM 의 모든 오디오/비디오와 상단바 모달 슬라이더에 반영하고 저장한다.
   * 이후 렌더되는 오디오는 exam-render-listening.js 가 readVolume() 을 다시 읽는다. */
  function applyVolume(v) {
    var vol = typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
    try { if (root.localStorage) root.localStorage.setItem(VOLUME_KEY, String(vol)); } catch (e) {}
    if (!doc) return vol;
    var media = doc.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) {
      try { media[i].volume = vol; } catch (e) {}
    }
    var vr = doc.getElementById('volume-range');
    if (vr) vr.value = String(Math.round(vol * 100));
    return vol;
  }

  /* 테스트음 재생. 재생 횟수 제한 없음(AC3) — 소진 플래그를 남기지 않는다. */
  function playTestTone(volume, onDone) {
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (Ctx) {
      try {
        var ctx = new Ctx();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = TEST_TONE_HZ;
        // 클릭음 방지용 어택/릴리즈. gain 이 슬라이더 값을 그대로 받는다.
        var t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(volume, t0 + 0.05);
        gain.gain.setValueAtTime(volume, t0 + TEST_TONE_SEC - 0.1);
        gain.gain.linearRampToValueAtTime(0.0001, t0 + TEST_TONE_SEC);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + TEST_TONE_SEC);
        osc.onended = function () {
          try { ctx.close(); } catch (e) {}
          if (onDone) onDone(null);
        };
        return true;
      } catch (e) { warn('WebAudio test tone failed; falling back to file', e); }
    }
    // 폴백: 번들 안내 음원(문항 노출 없음).
    try {
      var src = root.SG_MEDIA ? root.SG_MEDIA.resolveMedia(TEST_AUDIO_FALLBACK) : '';
      if (!src) { if (onDone) onDone(new Error('No test audio available.')); return false; }
      var a = new root.Audio(src);
      a.volume = volume;
      a.onended = function () { if (onDone) onDone(null); };
      var p = a.play();
      if (p && p['catch']) p['catch'](function (err) { if (onDone) onDone(err); });
      return true;
    } catch (e2) {
      if (onDone) onDone(e2);
      return false;
    }
  }

  /* ── 공통 스캐폴드 ──────────────────────────────────────── */

  function copyOf(screen) { return (screen && screen.copy) || {}; }

  function titleNode(screen, enOverride, koOverride) {
    var c = copyOf(screen);
    return bi('h1', enOverride || c.titleEn || '', koOverride || c.titleKo || c.titleEn || '');
  }

  function bodyNode(screen, enOverride, koOverride) {
    var c = copyOf(screen);
    var en = enOverride || c.bodyEn || '';
    var ko = koOverride || c.bodyKo || en;
    if (!en && !ko) return null;
    var p = bi('p', en, ko);
    p.className = 'instr-body';
    return p;
  }

  /* CTA. 렌더러는 다음 화면을 정하지 않는다 — engine.next('manual') 만 호출한다. */
  function ctaNode(screen, ctx, cls) {
    var c = copyOf(screen);
    var b = button('exam-btn primary ' + (cls || 'instr-cta'),
      c.ctaEn || 'Continue', c.ctaKo || c.ctaEn || '계속');
    b.onclick = function () {
      if (b.disabled) return;
      if (ctx && ctx.engine && typeof ctx.engine.next === 'function') ctx.engine.next('manual');
    };
    return b;
  }

  /* 화면을 떠날 때 정리할 작업을 등록한다. 렌더러에 unmount 훅이 없으므로
   * 엔진의 전이 콜백을 1회용으로 쓴다(마이크 스트림·rAF 루프 누수 방지). */
  function onLeave(ctx, fn) {
    if (!ctx || !ctx.engine || typeof ctx.engine.onTransition !== 'function') return function () {};
    var off = ctx.engine.onTransition(function () {
      try { fn(); } catch (e) { warn('cleanup failed', e); }
      if (typeof off === 'function') off();
    });
    return off;
  }

  /* ── instruction ────────────────────────────────────────── */

  /* Adjusting the Volume (녹화 02:30 확정) — 슬라이더 + Play Test Audio. */
  function volumePanel() {
    var box = el('div', 'instr-volume');
    var vol = readVolume();

    var lab = bi('label', 'Volume', '음량');
    lab.className = 'instr-vol-label';
    box.appendChild(lab);

    var row = el('div', 'instr-vol-row');
    var range = el('input', 'instr-vol-range');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = String(Math.round(vol * 100));
    range.id = 'instr-volume-range';
    range.setAttribute('aria-label', 'Volume');

    var pct = el('span', 'instr-vol-pct');
    pct.textContent = Math.round(vol * 100) + '%';

    range.oninput = function () {
      var v = (parseInt(range.value, 10) || 0) / 100;
      pct.textContent = Math.round(v * 100) + '%';
      applyVolume(v);
    };

    row.appendChild(range);
    row.appendChild(pct);
    box.appendChild(row);

    var play = button('exam-btn instr-testaudio', 'Play Test Audio', '테스트 음향 재생');
    var status = el('p', 'instr-vol-status muted');
    biInto(status, 'You can play the test sound as many times as you like.',
      '테스트 음향은 원하는 만큼 반복해서 들을 수 있습니다.');
    play.onclick = function () {
      var v = (parseInt(range.value, 10) || 0) / 100;
      applyVolume(v);
      play.disabled = true;
      playTestTone(v, function (err) {
        play.disabled = false;
        if (err) {
          while (status.firstChild) status.removeChild(status.firstChild);
          biInto(status, 'Test sound could not be played. Check your device volume and try again.',
            '테스트 음향을 재생하지 못했습니다. 기기 음량을 확인한 뒤 다시 시도하세요.');
        }
      });
    };
    box.appendChild(play);
    box.appendChild(status);

    applyVolume(vol);
    return box;
  }

  /* Speaking Directions 의 11문항·2유형 표(녹화 22:00 확정).
   * 유형·응답시간은 timing config 의 sections.speaking.taskTypes 에서,
   * 문항 수는 콘텐츠(SMEAG_SET1)에서 유도한다 — config 에 문항 수를 넣지 않는다(F11/AC5). */
  function speakingTaskConfig() {
    var t = null;
    if (root.SG_RUNTIME && typeof root.SG_RUNTIME.timing === 'function') t = root.SG_RUNTIME.timing();
    if (!t && root.SG_TIMING && typeof root.SG_TIMING.config === 'function') t = root.SG_TIMING.config();
    if (!t && root.SG_TIMING && root.SG_TIMING.FALLBACK) t = root.SG_TIMING.FALLBACK;
    return (t && t.sections && t.sections.speaking) || null;
  }

  function speakingRows() {
    var sec = speakingTaskConfig();
    var rows = [];
    if (!sec || !sec.modules) return rows;
    var counts = questionCountsByModule('speaking');
    for (var i = 0; i < sec.modules.length; i++) {
      var m = sec.modules[i];
      var tt = (sec.taskTypes && m.taskType && sec.taskTypes[m.taskType]) || null;
      rows.push({
        moduleId: m.id,
        label: (tt && tt.label) || m.taskType || m.id,
        count: counts[m.id] || 0,
        responseSec: tt && typeof tt.responseSec === 'number' ? tt.responseSec : null,
        prepSec: tt && typeof tt.prepSec === 'number' ? tt.prepSec : null
      });
    }
    return rows;
  }

  // 콘텐츠에서 모듈별 문항 수를 센다(questionCountSource:"content").
  function questionCountsByModule(sectionId) {
    var out = {};
    var set = root.SMEAG_SET1;
    if (!set || !set.sections) return out;
    for (var i = 0; i < set.sections.length; i++) {
      if (set.sections[i].id !== sectionId) continue;
      var mods = set.sections[i].modules || [];
      for (var j = 0; j < mods.length; j++) {
        var n = 0, blocks = mods[j].blocks || [];
        for (var k = 0; k < blocks.length; k++) n += (blocks[k].questions || []).length;
        out[mods[j].id] = n;
      }
    }
    return out;
  }

  function speakingTable() {
    var rows = speakingRows();
    if (!rows.length) return null;
    var wrap = el('div', 'instr-table-wrap');
    var t = el('table', 'instr-table');
    var thead = el('thead');
    var tr = el('tr');
    var heads = [
      ['Task type', '유형'],
      ['Questions', '문항 수'],
      ['Preparation', '준비 시간'],
      ['Response time', '응답 시간']
    ];
    for (var h = 0; h < heads.length; h++) {
      var th = el('th');
      biInto(th, heads[h][0], heads[h][1]);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = el('tbody');
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      total += r.count;
      var row = el('tr');
      var c1 = el('td'); c1.textContent = r.label; row.appendChild(c1);
      var c2 = el('td'); c2.textContent = String(r.count); row.appendChild(c2);
      var c3 = el('td'); c3.textContent = r.prepSec === null ? '—' : r.prepSec + ' s'; row.appendChild(c3);
      var c4 = el('td'); c4.textContent = r.responseSec === null ? '—' : r.responseSec + ' s'; row.appendChild(c4);
      tbody.appendChild(row);
    }
    var totalRow = el('tr', 'instr-table-total');
    var tc1 = el('td'); biInto(tc1, 'Total', '합계'); totalRow.appendChild(tc1);
    var tc2 = el('td'); tc2.textContent = String(total); totalRow.appendChild(tc2);
    var tc3 = el('td'); tc3.textContent = ''; totalRow.appendChild(tc3);
    var tc4 = el('td'); tc4.textContent = ''; totalRow.appendChild(tc4);
    tbody.appendChild(totalRow);
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  /* Directions 화면의 introAudio(FR16) — 1회 재생. 소진 관리는 listening 렌더러의
   * 공용 유닛(window.SG_LISTEN.makeAudioUnit)에 위임한다. 없으면 배지로 degrade. */
  function introAudioNode(screen, ctx) {
    if (!screen.audio || !screen.audio.src) return null;
    var L = root.SG_LISTEN;
    if (L && typeof L.makeAudioUnit === 'function') {
      return L.makeAudioUnit({
        media: screen.audio,
        image: screen.image || null,
        screenId: screen.id,
        captionEn: 'Directions — plays once',
        captionKo: '안내 음성 — 1회 재생',
        engine: ctx && ctx.engine,
        onEnded: null
      });
    }
    var b = el('p', 'exam-badge');
    biInto(b, 'Audio unavailable', '오디오를 재생할 수 없습니다');
    return b;
  }

  function renderInstruction(screen, ctx) {
    var wrap = card();
    wrap.appendChild(titleNode(screen));

    var body = bodyNode(screen);
    if (body) wrap.appendChild(body);

    var audioNode = introAudioNode(screen, ctx);
    if (audioNode) wrap.appendChild(audioNode);

    if (screen.id === fixedId('adjustVolume', 'intro.volume')) {
      wrap.appendChild(volumePanel());
    }

    if (screen.section === 'speaking' && String(screen.id).indexOf('.directions') >= 0) {
      var tbl = speakingTable();
      if (tbl) wrap.appendChild(tbl);
    }

    var actions = el('div', 'instr-actions');
    actions.appendChild(ctaNode(screen, ctx));
    wrap.appendChild(actions);

    // instruction 은 self-paced 다(AC2). 타이머가 남아 있으면 계약 위반이므로 로그만 남긴다.
    if (screen.timer) warn('instruction screen "' + screen.id + '" unexpectedly carries a timer');
    return wrap;
  }

  /* ── moduleEnd ──────────────────────────────────────────── */

  // writing 은 모듈이 아니라 태스크 단위다(config 의 taskEnd.writing).
  function unitWords(screen) {
    if (screen && screen.section === 'writing') return { en: 'Task', ko: '과제' };
    return { en: 'Module', ko: '모듈' };
  }

  // 다음 모듈이 실제로 존재하는지 화면열에서 확인한다(마지막 모듈에서 거짓말하지 않도록).
  function hasFollowingUnit(ctx, screen) {
    if (!ctx || !ctx.engine || typeof ctx.engine.screens !== 'function') return false;
    var list = ctx.engine.screens() || [];
    var n = screen.module;
    if (typeof n !== 'number') return false;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s && s.section === screen.section && s.module === n + 1) return true;
    }
    return false;
  }

  function moduleEndCopy(screen, ctx) {
    var u = unitWords(screen);
    var n = typeof screen.module === 'number' ? screen.module : null;
    var isTransfer = !!(screen.transfer && screen.transfer.enabled);

    if (isTransfer) {
      var c = copyOf(screen);
      return {
        titleEn: c.titleEn || 'Transfer your answers',
        titleKo: c.titleKo || '답안 옮겨 적기',
        bodyEn: c.bodyEn || 'You now have time to transfer your answers.',
        bodyKo: c.bodyKo || '이제 답안을 옮겨 적을 시간입니다.'
      };
    }

    var titleEn = n === null ? (copyOf(screen).titleEn || 'End of ' + u.en) : 'End of ' + u.en + ' ' + n;
    var titleKo = n === null ? (copyOf(screen).titleKo || u.ko + ' 종료') : u.ko + ' ' + n + ' 종료';
    var bodyEn, bodyKo;
    if (n === null) {
      bodyEn = copyOf(screen).bodyEn || 'Your time for this section has ended.';
      bodyKo = copyOf(screen).bodyKo || bodyEn;
    } else if (hasFollowingUnit(ctx, screen)) {
      bodyEn = 'Your time for ' + u.en + ' ' + n + ' has ended. Continue to ' + u.en + ' ' + (n + 1) + '.';
      bodyKo = u.ko + ' ' + n + ' 시간이 종료되었습니다. ' + u.ko + ' ' + (n + 1) + '(으)로 계속하세요.';
    } else {
      bodyEn = 'Your time for ' + u.en + ' ' + n + ' has ended. Continue to the next section.';
      bodyKo = u.ko + ' ' + n + ' 시간이 종료되었습니다. 다음 섹션으로 계속하세요.';
    }
    return { titleEn: titleEn, titleKo: titleKo, bodyEn: bodyEn, bodyKo: bodyKo };
  }

  /* §3.4 transfer.editable === true 일 때만 붙는 이전 문항 답안 편집 패널.
   * IELTS Listening transfer time 겸용. 엔진의 answer() 는 "현재 화면 소속 문항"만
   * 받으므로 여기서는 SG_STORE.upsertAnswer 로 직접 기록한다(localStorage 직접접근 아님). */
  function transferTargets(screen, ctx) {
    var ids = (screen.transfer && screen.transfer.targetScreenIds) || null;
    var list = (ctx && ctx.engine && typeof ctx.engine.screens === 'function') ? (ctx.engine.screens() || []) : [];
    var out = [], i, j;
    if (ids && ids.length) {
      for (i = 0; i < ids.length; i++) {
        for (j = 0; j < list.length; j++) { if (list[j] && list[j].id === ids[i]) { out.push(list[j]); break; } }
      }
      return out;
    }
    // targetScreenIds 미지정 시: 같은 섹션의 앞선 문항 화면 전부.
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || s.id === screen.id) { if (s && s.id === screen.id) break; else continue; }
      if (s.section !== screen.section) continue;
      if (s.screenType !== 'question') continue;
      if (!s.questionIds || !s.questionIds.length) continue;
      out.push(s);
    }
    return out;
  }

  function lookupQuestion(qid) {
    var set = root.SMEAG_SET1;
    if (!set || typeof set.findQuestion !== 'function') return null;
    try { return set.findQuestion(qid); } catch (e) { return null; }
  }

  function transferPanel(screen, ctx) {
    var targets = transferTargets(screen, ctx);
    var st = store();
    var wrap = el('div', 'instr-transfer');
    var h = bi('h2', 'Your answers', '내 답안');
    h.className = 'instr-transfer-title';
    wrap.appendChild(h);

    var hint = bi('p', 'You may still change these answers until the time above runs out.',
      '위 시간이 끝날 때까지 답안을 수정할 수 있습니다.');
    hint.className = 'muted instr-transfer-hint';
    wrap.appendChild(hint);

    var list = el('ol', 'instr-transfer-list');
    var count = 0;
    for (var i = 0; i < targets.length; i++) {
      var qids = targets[i].questionIds || [];
      for (var j = 0; j < qids.length; j++) {
        var item = transferItem(qids[j], st);
        if (item) { list.appendChild(item); count += 1; }
      }
    }
    if (!count) {
      var none = bi('p', 'No answers to transfer.', '옮겨 적을 답안이 없습니다.');
      none.className = 'muted';
      wrap.appendChild(none);
      return wrap;
    }
    wrap.appendChild(list);
    return wrap;
  }

  function transferItem(qid, st) {
    var hit = lookupQuestion(qid);
    var q = hit ? hit.q : null;
    var li = el('li', 'instr-transfer-item');

    var lab = el('div', 'instr-transfer-qid');
    lab.textContent = qid;
    li.appendChild(lab);

    var saved = st && typeof st.getAnswer === 'function' ? st.getAnswer(qid) : null;
    var savedValue = saved ? saved.v : null;

    if (q && q.choices && q.choices.length) {
      var opts = el('div', 'instr-transfer-opts');
      for (var i = 0; i < q.choices.length; i++) {
        (function (idx) {
          var l = el('label', 'opt');
          var input = el('input');
          input.type = 'radio';
          input.name = 'transfer-' + qid;
          input.value = String(idx);
          if (savedValue === idx) input.checked = true;
          input.onchange = function () {
            if (st && typeof st.upsertAnswer === 'function') {
              st.upsertAnswer(qid, idx, { source: 'transfer' });
              if (typeof st.flushAnswers === 'function') st.flushAnswers();
              if (typeof st.pushEvent === 'function') st.pushEvent('transfer_edit', qid, { value: idx });
            }
          };
          var sp = el('span');
          sp.textContent = q.choices[idx];
          l.appendChild(input); l.appendChild(sp);
          opts.appendChild(l);
        })(i);
      }
      li.appendChild(opts);
    } else {
      var input2 = el('input', 'instr-transfer-text');
      input2.type = 'text';
      input2.value = savedValue === null || savedValue === undefined ? '' : String(savedValue);
      input2.oninput = function () {
        if (st && typeof st.upsertAnswer === 'function') st.upsertAnswer(qid, input2.value, { source: 'transfer' });
      };
      input2.onblur = function () {
        if (st && typeof st.flushAnswers === 'function') st.flushAnswers();
      };
      li.appendChild(input2);
    }
    return li;
  }

  /* transfer time 잔여시간 표시(Story 6.3 AC2).
   * 상단바 pill 도 같은 시계를 그리지만, 이 화면은 "남은 시간 안에 답을 고치는" 화면이라
   * 편집 목록 바로 위에도 시간을 둔다. 시계는 엔진이 arm 한 것을 읽기만 한다. */
  function transferCountdown(screen, ctx) {
    var C = root.SG_CLOCK;
    var box = el('div', 'instr-transfer-hint');
    var lab = bi('span', 'Time remaining ', '남은 시간 ');
    var val = el('strong', 'instr-transfer-time');
    val.style.fontVariantNumeric = 'tabular-nums';
    box.appendChild(lab);
    box.appendChild(val);
    if (!C || !screen.timer) {
      val.textContent = '--:--';
      return box;
    }
    var key = (root.SG_EXAM && typeof root.SG_EXAM.clockKeyFor === 'function')
      ? root.SG_EXAM.clockKeyFor(screen, screen.timer)
      : 'screen:' + screen.id;
    var fmt = screen.timer.format || 'MM:SS';
    function paint() {
      var rem = C.remainingSec(key);
      val.textContent = C.formatSec(typeof rem === 'number' ? rem : screen.timer.seconds, fmt);
    }
    paint();
    var off = (typeof C.subscribe === 'function') ? C.subscribe(paint) : null;
    if (off) onLeave(ctx, off);
    return box;
  }

  /* Finish early — 확인 단계를 거친다(AC4). 별도 모달 컴포넌트가 없으므로
   * 같은 카드 안에서 2단계 확인으로 처리한다(전용 CSS 불필요). */
  function transferActions(screen, ctx) {
    var actions = el('div', 'instr-actions');
    var c = copyOf(screen);
    var finish = button('exam-btn primary instr-cta', c.ctaEn || 'Finish early', c.ctaKo || '조기 종료');
    var confirmRow = el('div', 'instr-transfer-hint');
    confirmRow.style.display = 'none';
    var q = bi('p', 'Finish the transfer time now? Your answers will be final and you cannot come back to this screen.',
      '지금 전사 시간을 끝낼까요? 답안이 확정되며 이 화면으로 돌아올 수 없습니다.');
    var yes = button('exam-btn primary', 'Yes, finish now', '네, 지금 끝냅니다');
    var no = button('exam-btn', 'Cancel', '취소');
    confirmRow.appendChild(q);
    confirmRow.appendChild(yes);
    confirmRow.appendChild(no);

    finish.onclick = function () { finish.disabled = true; confirmRow.style.display = ''; };
    no.onclick = function () { confirmRow.style.display = 'none'; finish.disabled = false; };
    yes.onclick = function () {
      var st = store();
      if (st && typeof st.flushAnswers === 'function') { try { st.flushAnswers(); } catch (e) { warn('flush failed', e); } }
      if (st && typeof st.pushEvent === 'function') { try { st.pushEvent('transfer_finish_early', screen.id, {}); } catch (e) {} }
      if (ctx && ctx.engine && typeof ctx.engine.next === 'function') ctx.engine.next('manual');
    };

    actions.appendChild(finish);
    actions.appendChild(confirmRow);
    return actions;
  }

  function renderModuleEnd(screen, ctx) {
    var c = moduleEndCopy(screen, ctx);
    var isTransfer = !!(screen.transfer && screen.transfer.enabled);
    var wrap = card();
    wrap.className = 'instr-card instr-moduleend';
    wrap.appendChild(bi('h1', c.titleEn, c.titleKo));
    var p = bi('p', c.bodyEn, c.bodyKo);
    p.className = 'instr-body';
    wrap.appendChild(p);

    if (isTransfer) wrap.appendChild(transferCountdown(screen, ctx));

    if (screen.transfer && screen.transfer.editable === true) {
      wrap.appendChild(transferPanel(screen, ctx));
    }

    if (isTransfer) {
      // 만료 시점의 답안이 최종이다(AC3) — 화면을 떠날 때 미저장분을 반드시 내보낸다.
      onLeave(ctx, function () {
        var st = store();
        if (st && typeof st.flushAnswers === 'function') st.flushAnswers();
      });
      wrap.appendChild(transferActions(screen, ctx));
      return wrap;
    }

    var actions = el('div', 'instr-actions');
    actions.appendChild(ctaNode(screen, ctx));
    wrap.appendChild(actions);
    return wrap;
  }

  /* ── hardwareCheck ──────────────────────────────────────── */

  /* 상단바 Continue 를 잠근다(AC4: 권한 확보 전 Begin 비활성).
   * 화면을 떠날 때 반드시 복구한다 — onLeave 훅에서 되돌린다. */
  function lockAdvance(lock) {
    if (!doc) return;
    var b = doc.getElementById('btn-advance');
    if (b) b.disabled = !!lock;
  }

  function renderHardwareCheck(screen, ctx) {
    var wrap = card();
    wrap.className = 'instr-card instr-hardware';
    wrap.appendChild(titleNode(screen, copyOf(screen).titleEn || 'Hardware Check', copyOf(screen).titleKo || '장치 점검'));
    var body = bodyNode(screen);
    if (body) wrap.appendChild(body);

    var state = { stream: null, ctxAudio: null, raf: null, granted: false, alive: true };

    /* 1) 스피커 테스트 — 볼륨 화면과 동일한 합성음. */
    var speakerRow = el('div', 'instr-hw-row');
    var spkLabel = bi('h2', '1 · Speakers', '1 · 스피커');
    spkLabel.className = 'instr-hw-title';
    speakerRow.appendChild(spkLabel);
    var spkBtn = button('exam-btn', 'Play Test Sound', '테스트 음향 재생');
    var spkNote = el('p', 'muted');
    biInto(spkNote, 'You should hear a short tone. Adjust the volume with the toolbar control if needed.',
      '짧은 음이 들려야 합니다. 필요하면 상단 Volume 버튼으로 음량을 조절하세요.');
    spkBtn.onclick = function () {
      spkBtn.disabled = true;
      playTestTone(readVolume(), function () { spkBtn.disabled = false; });
    };
    speakerRow.appendChild(spkBtn);
    speakerRow.appendChild(spkNote);
    wrap.appendChild(speakerRow);

    /* 2) 마이크 — 실제 권한 요청 + AnalyserNode 레벨 미터. */
    var micRow = el('div', 'instr-hw-row');
    var micLabel = bi('h2', '2 · Microphone', '2 · 마이크');
    micLabel.className = 'instr-hw-title';
    micRow.appendChild(micLabel);

    var meter = el('div', 'instr-meter');
    var bar = el('div', 'instr-meter-bar');
    meter.appendChild(bar);
    micRow.appendChild(meter);

    var micStatus = el('p', 'instr-hw-status');
    biInto(micStatus, 'Requesting microphone access…', '마이크 권한을 요청하는 중…');
    micRow.appendChild(micStatus);

    var retry = button('exam-btn', 'Retry microphone', '마이크 다시 시도');
    retry.style.display = 'none';
    micRow.appendChild(retry);
    wrap.appendChild(micRow);

    /* 3) 진행 — 권한을 받으면 Begin 활성, 거부해도 명시적 폴백으로 계속(FR14). */
    var actions = el('div', 'instr-actions');
    var begin = ctaNode(screen, ctx);
    begin.disabled = true;
    actions.appendChild(begin);
    var skip = button('exam-btn', 'Continue without microphone', '마이크 없이 계속');
    skip.style.display = 'none';
    skip.onclick = function () {
      var st = store();
      if (st && typeof st.pushEvent === 'function') st.pushEvent('mic_skipped', screen.id, {});
      if (ctx && ctx.engine && typeof ctx.engine.next === 'function') ctx.engine.next('manual');
    };
    actions.appendChild(skip);
    wrap.appendChild(actions);

    lockAdvance(true);

    function setStatus(en, ko, cls) {
      while (micStatus.firstChild) micStatus.removeChild(micStatus.firstChild);
      micStatus.className = 'instr-hw-status' + (cls ? ' ' + cls : '');
      biInto(micStatus, en, ko);
    }

    function cleanup() {
      state.alive = false;
      if (state.raf !== null && root.cancelAnimationFrame) {
        try { root.cancelAnimationFrame(state.raf); } catch (e) {}
      }
      state.raf = null;
      if (state.stream) {
        var tracks = state.stream.getTracks ? state.stream.getTracks() : [];
        for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e2) {} }
        state.stream = null;
      }
      if (state.ctxAudio) { try { state.ctxAudio.close(); } catch (e3) {} state.ctxAudio = null; }
      lockAdvance(false);
    }
    onLeave(ctx, cleanup);

    function startMeter(stream) {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) { bar.style.width = '0%'; return; }
      try {
        var ac = new Ctx();
        state.ctxAudio = ac;
        var source = ac.createMediaStreamSource(stream);
        var analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        var buf = new Uint8Array(analyser.fftSize);
        // rAF 루프 — 카운트다운이 아니라 레벨 표시라 SG_CLOCK 대상이 아니다.
        var loop = function () {
          if (!state.alive) return;
          analyser.getByteTimeDomainData(buf);
          var sum = 0, i, v;
          for (i = 0; i < buf.length; i++) { v = (buf[i] - 128) / 128; sum += v * v; }
          var rms = Math.sqrt(sum / buf.length);
          var pct = Math.min(100, Math.round(rms * 320));
          bar.style.width = pct + '%';
          bar.className = 'instr-meter-bar' + (pct > 4 ? ' is-live' : '');
          if (root.requestAnimationFrame) state.raf = root.requestAnimationFrame(loop);
        };
        loop();
      } catch (e) { warn('level meter unavailable', e); }
    }

    function request() {
      var nav = root.navigator;
      if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
        setStatus('This browser cannot access a microphone. You can continue, but Speaking answers will not be recorded.',
          '이 브라우저는 마이크에 접근할 수 없습니다. 계속 진행할 수 있으나 스피킹 답변은 녹음되지 않습니다.', 'is-error');
        retry.style.display = 'none';
        skip.style.display = '';
        lockAdvance(false);
        return;
      }
      setStatus('Requesting microphone access…', '마이크 권한을 요청하는 중…', '');
      retry.style.display = 'none';
      skip.style.display = 'none';
      var p;
      try { p = nav.mediaDevices.getUserMedia({ audio: true }); } catch (e) { p = null; }
      if (!p || !p.then) {
        setStatus('Microphone request failed.', '마이크 요청에 실패했습니다.', 'is-error');
        retry.style.display = '';
        skip.style.display = '';
        return;
      }
      p.then(function (stream) {
        if (!state.alive) {
          var tr = stream.getTracks ? stream.getTracks() : [];
          for (var i = 0; i < tr.length; i++) { try { tr[i].stop(); } catch (e) {} }
          return;
        }
        state.stream = stream;
        state.granted = true;
        setStatus('Microphone is working. Speak at your normal volume and watch the meter move.',
          '마이크가 동작합니다. 평소 목소리로 말하면 레벨 미터가 움직입니다.', 'is-ok');
        begin.disabled = false;
        lockAdvance(false);
        var st = store();
        if (st && typeof st.pushEvent === 'function') st.pushEvent('mic_granted', screen.id, {});
        startMeter(stream);
      })['catch'](function (err) {
        var name = err && err.name ? err.name : 'Error';
        var denied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
        if (denied) {
          setStatus('Microphone access was blocked. Allow the microphone in your browser settings, then press Retry.',
            '마이크 접근이 차단되었습니다. 브라우저 설정에서 마이크를 허용한 뒤 다시 시도를 누르세요.', 'is-error');
        } else {
          setStatus('No microphone was found. Connect one and press Retry, or continue without recording.',
            '마이크를 찾지 못했습니다. 마이크를 연결한 뒤 다시 시도하거나 녹음 없이 계속하세요.', 'is-error');
        }
        retry.style.display = '';
        skip.style.display = '';
        begin.disabled = true;
        // 시험을 멈추지 않는다(FR14) — 상단바는 풀되 화면 안 Begin 은 잠근 채로 둔다.
        lockAdvance(false);
        var st2 = store();
        if (st2 && typeof st2.pushEvent === 'function') st2.pushEvent('mic_denied', screen.id, { name: name });
      });
    }

    retry.onclick = request;
    request();
    return wrap;
  }

  /* ── review ─────────────────────────────────────────────── */

  /* 섹션별 응답/미응답 집계. 화면열의 questionIds 와 저장된 답안만 본다(순수). */
  function reviewSummary(screens, answersMap) {
    var order = [], bySec = {}, i, j;
    var list = screens || [];
    var ans = answersMap || {};
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !s.questionIds || !s.questionIds.length) continue;
      if (!bySec[s.section]) { bySec[s.section] = { section: s.section, total: 0, answered: 0, unanswered: 0 }; order.push(s.section); }
      for (j = 0; j < s.questionIds.length; j++) {
        var qid = s.questionIds[j];
        var row = bySec[s.section];
        row.total += 1;
        var rec = ans[qid];
        var has = rec && rec.v !== null && rec.v !== undefined && rec.v !== '';
        if (has) row.answered += 1; else row.unanswered += 1;
      }
    }
    var rows = [], t = { section: 'total', total: 0, answered: 0, unanswered: 0 };
    for (i = 0; i < order.length; i++) {
      rows.push(bySec[order[i]]);
      t.total += bySec[order[i]].total;
      t.answered += bySec[order[i]].answered;
      t.unanswered += bySec[order[i]].unanswered;
    }
    return { rows: rows, total: t };
  }

  var SECTION_KO = { listening: '리스닝', speaking: '스피킹', reading: '리딩', writing: '라이팅' };

  function sectionLabel(id) {
    return { en: id.charAt(0).toUpperCase() + id.slice(1), ko: SECTION_KO[id] || id };
  }

  function renderReview(screen, ctx) {
    var wrap = card();
    wrap.className = 'instr-card instr-review';
    wrap.appendChild(titleNode(screen, copyOf(screen).titleEn || 'Submit Test', copyOf(screen).titleKo || '시험 제출'));
    var body = bodyNode(screen);
    if (body) wrap.appendChild(body);

    var st = store();
    var screens = (ctx && ctx.engine && typeof ctx.engine.screens === 'function') ? ctx.engine.screens() : [];
    var answersMap = st && typeof st.answers === 'function' ? st.answers() : {};
    var sum = reviewSummary(screens, answersMap);

    var tw = el('div', 'instr-table-wrap');
    var t = el('table', 'instr-table');
    var thead = el('thead');
    var htr = el('tr');
    var heads = [['Section', '섹션'], ['Questions', '문항'], ['Answered', '응답'], ['Unanswered', '미응답']];
    for (var h = 0; h < heads.length; h++) {
      var th = el('th'); biInto(th, heads[h][0], heads[h][1]); htr.appendChild(th);
    }
    thead.appendChild(htr);
    t.appendChild(thead);

    var tbody = el('tbody');
    for (var i = 0; i < sum.rows.length; i++) {
      var r = sum.rows[i];
      var tr = el('tr');
      var lab = sectionLabel(r.section);
      var c1 = el('td'); biInto(c1, lab.en, lab.ko); tr.appendChild(c1);
      var c2 = el('td'); c2.textContent = String(r.total); tr.appendChild(c2);
      var c3 = el('td'); c3.textContent = String(r.answered); tr.appendChild(c3);
      var c4 = el('td', r.unanswered ? 'is-unanswered' : ''); c4.textContent = String(r.unanswered); tr.appendChild(c4);
      tbody.appendChild(tr);
    }
    var totalRow = el('tr', 'instr-table-total');
    var d1 = el('td'); biInto(d1, 'Total', '합계'); totalRow.appendChild(d1);
    var d2 = el('td'); d2.textContent = String(sum.total.total); totalRow.appendChild(d2);
    var d3 = el('td'); d3.textContent = String(sum.total.answered); totalRow.appendChild(d3);
    var d4 = el('td', sum.total.unanswered ? 'is-unanswered' : ''); d4.textContent = String(sum.total.unanswered); totalRow.appendChild(d4);
    tbody.appendChild(totalRow);
    t.appendChild(tbody);
    tw.appendChild(t);
    wrap.appendChild(tw);

    if (sum.total.unanswered) {
      var warnP = bi('p',
        'Some questions are unanswered. You cannot return to them after submitting.',
        '응답하지 않은 문항이 있습니다. 제출 후에는 되돌아갈 수 없습니다.');
      warnP.className = 'instr-review-warn';
      wrap.appendChild(warnP);
    }

    var actions = el('div', 'instr-actions');
    var submit = button('exam-btn primary', copyOf(screen).ctaEn || 'Submit Test', copyOf(screen).ctaKo || '제출');
    submit.onclick = function () {
      submit.disabled = true;
      var s2 = store();
      if (s2 && typeof s2.flushAnswers === 'function') s2.flushAnswers();
      if (ctx && ctx.engine && typeof ctx.engine.next === 'function') ctx.engine.next('manual');
    };
    actions.appendChild(submit);
    wrap.appendChild(actions);
    return wrap;
  }

  /* ── 등록 ───────────────────────────────────────────────── */

  var R = root.SG_RENDER;
  if (R && typeof R.register === 'function' && doc) {
    R.register('instruction', renderInstruction);
    R.register('moduleEnd', renderModuleEnd);
    R.register('hardwareCheck', renderHardwareCheck);
    R.register('review', renderReview);
  } else {
    warn('SG_RENDER unavailable; instruction renderers not registered');
  }

  root.SG_INSTRUCTION = {
    VOLUME_KEY: VOLUME_KEY,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    readVolume: readVolume,
    applyVolume: applyVolume,
    playTestTone: playTestTone,
    // 순수/준순수 — node 및 셀프테스트에서 직접 검증한다
    reviewSummary: reviewSummary,
    moduleEndCopy: moduleEndCopy,
    speakingRows: speakingRows,
    questionCountsByModule: questionCountsByModule,
    unitWords: unitWords,
    // 렌더 함수(셀프테스트에서 직접 호출)
    renderInstruction: renderInstruction,
    renderModuleEnd: renderModuleEnd,
    renderHardwareCheck: renderHardwareCheck,
    renderReview: renderReview
  };
})(typeof window !== 'undefined' ? window : this);
