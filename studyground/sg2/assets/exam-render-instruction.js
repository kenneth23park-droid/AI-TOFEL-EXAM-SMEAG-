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

  /* Adjusting the Volume (녹화 02:30 확정).
   * 관찰값: 화면 안에 슬라이더가 없다 — 음량은 상단바 Volume 팝오버에서만 조절한다.
   * 화면은 안내문 3단락 + 스피커 아이콘 행 + 가운데 Play Test Audio 버튼으로 구성된다. */

  // 문장 중간의 "Volume" 만 굵게. bi() 는 통문장만 다루므로 여기서 조립한다.
  function volumeCopy() {
    var lines = [
      { en: ['To adjust the volume, select the ', 'Volume', ' icon at the top of the screen. The volume control will appear. Move the volume indicator to the left or the right to change the volume.'],
        ko: ['음량을 조절하려면 화면 상단의 ', 'Volume', ' 아이콘을 선택하세요. 음량 조절 막대가 나타납니다. 표시를 좌우로 움직여 음량을 바꿉니다.'] },
      { en: ['To close the volume control, select the ', 'Volume', ' icon again.'],
        ko: ['음량 조절을 닫으려면 ', 'Volume', ' 아이콘을 다시 선택하세요.'] },
      { en: ['You will be able to change the volume during the test if you need to.'],
        ko: ['시험 중에도 필요하면 언제든지 음량을 바꿀 수 있습니다.'] }
    ];
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      var p = el('p', 'instr-body instr-vol-para');
      p.appendChild(langSpan('en', lines[i].en));
      p.appendChild(langSpan('ko', lines[i].ko));
      frag.appendChild(p);
    }
    return frag;
  }

  // parts 가 [평문, 강조, 평문, …] 순서로 번갈아 오는 한 언어분(分) 스팬.
  function langSpan(lang, parts) {
    var s = el('span');
    s.setAttribute(lang === 'ko' ? 'data-ko' : 'data-en', '');
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var b = el('b');
        b.textContent = parts[i];
        s.appendChild(b);
      } else {
        s.appendChild(doc.createTextNode(parts[i]));
      }
    }
    return s;
  }

  function speakerIcon(cls) {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    var d = ['M4 9v6h4l5 4V5L8 9H4z', 'M17 9a4 4 0 0 1 0 6', 'M19.5 6.5a8 8 0 0 1 0 11'];
    for (var i = 0; i < d.length; i++) {
      var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d[i]);
      svg.appendChild(p);
    }
    return svg;
  }

  function playIcon() {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M8 5.5v13l11-6.5-11-6.5z');
    svg.appendChild(p);
    return svg;
  }

  function volumePanel() {
    var box = el('div', 'instr-volume');
    var vol = readVolume();

    /* 아이콘 행 — 아이콘 자체가 상단바 Volume 팝오버를 여는 버튼이다
     * (안내문의 "select the Volume icon" 을 화면 안에서도 그대로 실행할 수 있게). */
    var row = el('div', 'instr-vol-note');
    var iconBtn = el('button', 'instr-vol-icon');
    iconBtn.type = 'button';
    iconBtn.setAttribute('aria-label', 'Volume');
    iconBtn.appendChild(speakerIcon());
    iconBtn.onclick = function () {
      var tb = doc.getElementById('btn-volume');
      if (tb && !tb.hidden) tb.click();
    };
    row.appendChild(iconBtn);

    var note = bi('p', 'You now have the option to adjust the volume.', '이제 음량을 조절할 수 있습니다.');
    note.className = 'instr-vol-note-text';
    row.appendChild(note);
    box.appendChild(row);

    var actions = el('div', 'instr-vol-play-row');
    var play = button('exam-btn primary instr-testaudio', 'Play Test Audio', '테스트 음향 재생');
    play.insertBefore(playIcon(), play.firstChild);
    var status = el('p', 'instr-vol-status muted');
    play.onclick = function () {
      var v = readVolume();
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
    actions.appendChild(play);
    box.appendChild(actions);
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
    var set = root.SG_CONTENT_PACK || root.SMEAG_SET1;
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

  /* ── Reading Section Directions ─────────────────────────
   * 레퍼런스 화면 구성: 제목 "Reading Section" · 안내 문단 · 2열 표(유형/설명) ·
   * 모듈별 제한 시간 문단. 표의 유형과 문항 수는 콘텐츠 팩에서, 시간은 timing config
   * 에서 유도한다 — 상수로 박지 않는다(F11: 세트가 바뀌면 화면도 따라 바뀐다).
   */
  var READING_TASKS = [
    { key: 'cloze', en: 'Complete the Words', ko: '단어 완성',
      descEn: 'Fill in the missing letters in a paragraph.',
      descKo: '지문에서 빠진 철자를 채웁니다.' },
    { key: 'daily', en: 'Read in Daily Life', ko: '실생활 읽기',
      descEn: 'Answer questions about everyday reading material.',
      descKo: '일상에서 접하는 글에 대한 문항에 답합니다.' },
    { key: 'academic', en: 'Read an Academic Passage', ko: '학술 지문 읽기',
      descEn: 'Answer questions about academic passages.',
      descKo: '학술 지문에 대한 문항에 답합니다.' }
  ];

  /* 블록 하나가 어느 유형에 속하는지. passage 는 지시문("Read a passage." vs
   * "Read an email." 등)이 학술/실생활을 가른다 — 콘텐츠 팩에 유형 필드가 없다. */
  function readingTaskKey(block) {
    if (!block) return null;
    var kind = String(block.kind || '');
    if (kind === 'cloze') return 'cloze';
    if (kind === 'chat') return 'daily';
    if (kind !== 'passage') return null;
    return /\bpassage\b/i.test(String(block.instruction || '')) ? 'academic' : 'daily';
  }

  /* 표에 넣을 유형 목록. 콘텐츠를 못 읽으면 3종 전부를 보여준다(레퍼런스 기본형). */
  function readingRows() {
    var set = root.SG_CONTENT_PACK || root.SMEAG_SET1;
    var seen = {}, any = false, i, j, k;
    if (set && set.sections) {
      for (i = 0; i < set.sections.length; i++) {
        if (set.sections[i].id !== 'reading') continue;
        var mods = set.sections[i].modules || [];
        for (j = 0; j < mods.length; j++) {
          var blocks = mods[j].blocks || [];
          for (k = 0; k < blocks.length; k++) {
            var key = readingTaskKey(blocks[k]);
            if (key) { seen[key] = true; any = true; }
          }
        }
      }
    }
    var out = [];
    for (i = 0; i < READING_TASKS.length; i++) {
      if (!any || seen[READING_TASKS[i].key]) out.push(READING_TASKS[i]);
    }
    return out;
  }

  function readingQuestionCount() {
    var counts = questionCountsByModule('reading'), total = 0;
    for (var id in counts) { if (counts.hasOwnProperty(id)) total += counts[id]; }
    return total;
  }

  function readingTimingConfig() {
    var t = null;
    if (root.SG_RUNTIME && typeof root.SG_RUNTIME.timing === 'function') t = root.SG_RUNTIME.timing();
    if (!t && root.SG_TIMING && typeof root.SG_TIMING.config === 'function') t = root.SG_TIMING.config();
    if (!t && root.SG_TIMING && root.SG_TIMING.FALLBACK) t = root.SG_TIMING.FALLBACK;
    return (t && t.sections && t.sections.reading) || null;
  }

  var NUM_WORD_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  var NUM_WORD_KO = ['0', '한', '두', '세', '네', '다섯', '여섯'];

  /* 초 → "20 minutes and 30 seconds" / "9 minutes" / "45 seconds". */
  function durationWords(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(s / 60), r = s % 60;
    var en = [], ko = [];
    if (m) { en.push(m + (m === 1 ? ' minute' : ' minutes')); ko.push(m + '분'); }
    if (r || !m) { en.push(r + (r === 1 ? ' second' : ' seconds')); ko.push(r + '초'); }
    return { en: en.join(' and '), ko: ko.join(' ') };
  }

  /* 숫자를 한국어로 읽었을 때의 받침에 맞는 주제격 조사. 1(일)·3(삼)·6(육)·7(칠)·8(팔) → 은. */
  function koTopicParticle(n) {
    return ({ 1: '은', 3: '은', 6: '은', 7: '은', 8: '은' })[n] || '는';
  }

  /* 모듈별 제한 시간 문단. 모듈 수에 관계없이 문장을 조립한다. */
  function readingTimeParagraph() {
    var sec = readingTimingConfig();
    var mods = (sec && sec.modules) || [];
    var parts = [], i;
    for (i = 0; i < mods.length; i++) {
      var alloc = mods[i].allocatedSec;
      if (typeof alloc !== 'number' || !(alloc > 0)) continue;
      var d = durationWords(alloc);
      parts.push({ en: d.en, ko: d.ko, no: parts.length + 1 });
    }
    if (!parts.length) return null;

    /* [평문, 강조, 평문, …] 교대 배열 — langSpan 의 입력 형식이다.
       EN: "You will have 20 minutes to complete Module 1 and 9 minutes to complete Module 2."
       KO: "모듈 1은 20분, 모듈 2는 9분 동안 풉니다." (한국어는 어순이 달라 문형을 따로 짠다) */
    var en = ['You will have '], ko = [];
    for (i = 0; i < parts.length; i++) {
      var last = (i === parts.length - 1);
      var tail = last ? '. ' : (i === parts.length - 2 ? ' and ' : ', ');
      en.push(parts[i].en);
      en.push(' to complete Module ' + parts[i].no + tail);
      ko.push((i ? ', ' : '') + '모듈 ' + parts[i].no + koTopicParticle(parts[i].no) + ' ');
      ko.push(parts[i].ko);
    }
    ko.push(' 동안 풉니다. ');
    /* 마지막 원소는 평문 자리다 — 'Select ' 를 새로 push 하면 강조 자리로 밀려
       Begin 과 함께 굵어진다. 이어 붙여서 교대 순서를 지킨다. */
    en[en.length - 1] += 'Select ';
    en.push('Begin');
    en.push(' when you are ready to start.');
    ko[ko.length - 1] += '준비되면 ';
    ko.push('Begin');
    ko.push(' 을 선택하세요.');

    var p = el('p', 'instr-body instr-dir-time');
    p.appendChild(langSpan('en', en));
    p.appendChild(langSpan('ko', ko));
    return p;
  }

  /* 안내 문단 — 문항 수와 유형 수를 실제 콘텐츠에서 읽어 넣는다. */
  function readingIntroParagraph(rows) {
    var n = readingQuestionCount();
    var kinds = rows.length;
    var enCount = n > 0 ? ('answer ' + n + ' questions to demonstrate') : 'answer questions that show';
    var koCount = n > 0 ? (n + '문항을 풀며') : '문항을 풀며';
    var enKinds = NUM_WORD_EN[kinds] || String(kinds);
    var koKinds = NUM_WORD_KO[kinds] || String(kinds);
    var p = bi('p',
      'In the reading section, you will ' + enCount +
        ' how well you understand academic and non-academic texts in English. There are ' +
        enKinds + ' types of tasks.',
      '리딩 섹션에서는 ' + koCount +
        ' 영어로 된 학술·비학술 지문을 얼마나 잘 이해하는지 보여 줍니다. 과제 유형은 ' +
        koKinds + ' 가지입니다.');
    p.className = 'instr-body';
    return p;
  }

  function readingTable(rows) {
    if (!rows || !rows.length) return null;
    var wrap = el('div', 'instr-table-wrap');
    var t = el('table', 'instr-table');
    var thead = el('thead');
    var tr = el('tr');
    var heads = [['Type of Task', '과제 유형'], ['Description', '설명']];
    for (var h = 0; h < heads.length; h++) {
      var th = el('th');
      biInto(th, heads[h][0], heads[h][1]);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = el('tbody');
    for (var i = 0; i < rows.length; i++) {
      var row = el('tr');
      var c1 = el('td'); biInto(c1, rows[i].en, rows[i].ko); row.appendChild(c1);
      var c2 = el('td'); biInto(c2, rows[i].descEn, rows[i].descKo); row.appendChild(c2);
      tbody.appendChild(row);
    }
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

  function isDirections(screen) {
    return String(screen && screen.id).indexOf('.directions') >= 0;
  }

  function renderInstruction(screen, ctx) {
    var isVolume = screen.id === fixedId('adjustVolume', 'intro.volume');
    var isReadingDir = screen.section === 'reading' && isDirections(screen);
    var wrap = card();
    if (isVolume) wrap.className += ' instr-volume-screen';
    if (isReadingDir) wrap.className += ' instr-directions';
    /* 레퍼런스 리딩 안내 화면의 제목은 "Reading Section Directions" 가 아니라
       "Reading Section" 이다. config 의 label 을 화면에서만 줄여 쓴다. */
    if (isReadingDir) wrap.appendChild(titleNode(screen, 'Reading Section', '리딩 섹션'));
    else wrap.appendChild(titleNode(screen));

    // 볼륨 화면은 제목 아래 구분선 + 전용 3단락 안내문을 쓴다(녹화 02:30).
    if (isVolume) {
      wrap.appendChild(el('div', 'instr-rule'));
      wrap.appendChild(volumeCopy());
    } else if (isReadingDir) {
      var readingRowList = readingRows();
      wrap.appendChild(readingIntroParagraph(readingRowList));
      var readingTbl = readingTable(readingRowList);
      if (readingTbl) wrap.appendChild(readingTbl);
      var timePara = readingTimeParagraph();
      if (timePara) wrap.appendChild(timePara);
    } else {
      var body = bodyNode(screen);
      if (body) wrap.appendChild(body);
    }

    var audioNode = introAudioNode(screen, ctx);
    if (audioNode) wrap.appendChild(audioNode);

    if (isVolume) {
      wrap.appendChild(volumePanel());
      // 진행은 상단바 Continue 로만 한다(관찰값 — 화면 안에 버튼이 없다).
      if (screen.timer) warn('instruction screen "' + screen.id + '" unexpectedly carries a timer');
      return wrap;
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

  /* 관찰(docs/reference/screens/reading-module-end-2910s.png) — 문구가 두 줄이다:
   *   제목  "End of Module 1"
   *   1행   "Your time for Module 1 of the reading section has ended."
   *   2행   "Select Continue to go to Module 2."
   * 이전 구현은 두 문장을 한 줄에 이어 붙였고 섹션명이 빠져 있었다. 두 줄로 분리하고
   * 섹션명을 넣는다. body2En/body2Ko 가 둘째 줄이며, 없으면 null 이다. */
  function sectionWord(screen) {
    var id = (screen && screen.section) || '';
    return { en: String(id).toLowerCase(), ko: SECTION_KO[id] || id };
  }

  function moduleEndCopy(screen, ctx) {
    var u = unitWords(screen);
    var s = sectionWord(screen);
    var n = typeof screen.module === 'number' ? screen.module : null;
    var isTransfer = !!(screen.transfer && screen.transfer.enabled);

    if (isTransfer) {
      var c = copyOf(screen);
      return {
        titleEn: c.titleEn || 'Transfer your answers',
        titleKo: c.titleKo || '답안 옮겨 적기',
        bodyEn: c.bodyEn || 'You now have time to transfer your answers.',
        bodyKo: c.bodyKo || '이제 답안을 옮겨 적을 시간입니다.',
        body2En: null, body2Ko: null
      };
    }

    var titleEn = n === null ? (copyOf(screen).titleEn || 'End of ' + u.en) : 'End of ' + u.en + ' ' + n;
    var titleKo = n === null ? (copyOf(screen).titleKo || u.ko + ' 종료') : u.ko + ' ' + n + ' 종료';
    var bodyEn, bodyKo, body2En = null, body2Ko = null;
    var ofSectionEn = s.en ? ' of the ' + s.en + ' section' : '';
    var ofSectionKo = s.ko ? s.ko + ' 섹션의 ' : '';
    if (n === null) {
      bodyEn = copyOf(screen).bodyEn || 'Your time for this section has ended.';
      bodyKo = copyOf(screen).bodyKo || bodyEn;
      body2En = 'Select Continue to go on.';
      body2Ko = '계속하려면 Continue 를 선택하세요.';
    } else {
      bodyEn = 'Your time for ' + u.en + ' ' + n + ofSectionEn + ' has ended.';
      bodyKo = ofSectionKo + u.ko + ' ' + n + ' 시간이 종료되었습니다.';
      if (hasFollowingUnit(ctx, screen)) {
        body2En = 'Select Continue to go to ' + u.en + ' ' + (n + 1) + '.';
        body2Ko = u.ko + ' ' + (n + 1) + '(으)로 이동하려면 Continue 를 선택하세요.';
      } else {
        body2En = 'Select Continue to go to the next section.';
        body2Ko = '다음 섹션으로 이동하려면 Continue 를 선택하세요.';
      }
    }
    return { titleEn: titleEn, titleKo: titleKo, bodyEn: bodyEn, bodyKo: bodyKo,
             body2En: body2En, body2Ko: body2Ko };
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
    var set = root.SG_CONTENT_PACK || root.SMEAG_SET1;
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
    // 관찰: 제목 바로 아래 얇은 가로 구분선이 카드 폭 전체를 가로지른다.
    wrap.appendChild(el('div', 'instr-rule'));
    var p = bi('p', c.bodyEn, c.bodyKo);
    p.className = 'instr-body';
    wrap.appendChild(p);
    if (c.body2En) {
      var p2 = bi('p', c.body2En, c.body2Ko || c.body2En);
      p2.className = 'instr-body';
      wrap.appendChild(p2);
    }

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

  /* ── Adjusting the Microphone (레퍼런스 test-nt 화면) ───── */

  /* 레퍼런스 화면(en_test-nt) 관찰:
   *   가운데 정렬 굵은 제목 → 가로 구분선 → 흰 카드.
   *   카드는 2열이다. 좌측에 원형 RECORD 버튼, 우측에 안내 2문단 + 낭독 지문(회색 박스).
   *   그 아래 칸이 나뉜 입력 레벨 미터와 Too Quiet / Good / Too Loud 라벨.
   *   우하단에 "Skip microphone check".
   * ETS 원본과 동일하게 Record 를 누르면 카운트다운 후 정해진 시간 동안 녹음하고,
   * 끝나면 피크 레벨로 판정한다. 판정 전에는 상단바 Continue 를 잠근다(AC4 와 동일 규칙).
   */
  var MIC_READY_SEC = 3;      // "A timer will count down until the system is ready to record."
  var MIC_RECORD_SEC = 10;    // 낭독 지문 1회 분량
  var MIC_SEGMENTS = 24;
  var MIC_QUIET_PEAK = 0.10;  // 이하면 Too Quiet
  var MIC_LOUD_PEAK = 0.80;   // 이상이면 Too Loud

  var MIC_SAMPLE_EN = 'There are several reasons why I would prefer to live in a large city. ' +
    'Some of the greatest advantages would include the number of job opportunities and career options, ' +
    'public transportation, greater diversity, and a wealth of entertainment. Also, large cities typically ' +
    'have a great deal to offer in terms of history, art and culture.';
  var MIC_SAMPLE_KO = '제가 대도시에 살고 싶은 이유는 여러 가지입니다. 가장 큰 장점으로는 많은 일자리와 다양한 진로, ' +
    '편리한 대중교통, 높은 다양성, 그리고 풍부한 볼거리를 들 수 있습니다. 또한 대도시는 역사와 예술, 문화 면에서도 ' +
    '누릴 것이 아주 많습니다.';

  /* 피크 레벨 → 판정. 순수 함수라 셀프테스트에서 직접 검증한다. */
  function micVerdict(peak) {
    if (!(peak > 0)) return 'silent';
    if (peak < MIC_QUIET_PEAK) return 'quiet';
    if (peak > MIC_LOUD_PEAK) return 'loud';
    return 'good';
  }

  function micIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    // 스텁 DOM(노드 테스트)에는 createElementNS 가 없다 — 아이콘은 장식이므로 조용히 뺀다.
    if (!doc || typeof doc.createElementNS !== 'function') return el('span', 'instr-mic-icon');
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'instr-mic-icon');
    svg.setAttribute('aria-hidden', 'true');
    var body = doc.createElementNS(NS, 'path');
    body.setAttribute('d', 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z');
    var arc = doc.createElementNS(NS, 'path');
    arc.setAttribute('d', 'M5 11a7 7 0 0 0 14 0M12 18v3');
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', 'currentColor');
    arc.setAttribute('stroke-width', '2');
    arc.setAttribute('stroke-linecap', 'round');
    svg.appendChild(body);
    svg.appendChild(arc);
    return svg;
  }

  /* 칸이 나뉜 레벨 미터. setLevel(0..1) 로 채운 칸 수를 바꾼다. */
  function segmentMeter() {
    var box = el('div', 'instr-seg-wrap');
    var strip = el('div', 'instr-seg');
    var cells = [];
    for (var i = 0; i < MIC_SEGMENTS; i++) {
      var c = el('span', 'instr-seg-cell');
      strip.appendChild(c);
      cells.push(c);
    }
    box.appendChild(strip);

    var labels = el('div', 'instr-seg-labels');
    var l1 = bi('span', 'Too Quiet', '너무 작음');
    var l2 = bi('span', 'Good', '적절함');
    var l3 = bi('span', 'Too Loud', '너무 큼');
    labels.appendChild(l1); labels.appendChild(l2); labels.appendChild(l3);
    box.appendChild(labels);

    box.setLevel = function (v) {
      var lvl = typeof v === 'number' && v > 0 ? v : 0;
      var on = Math.min(MIC_SEGMENTS, Math.round(lvl * MIC_SEGMENTS));
      for (var k = 0; k < MIC_SEGMENTS; k++) {
        var zone = k < MIC_SEGMENTS * MIC_QUIET_PEAK ? 'is-quiet'
          : (k >= MIC_SEGMENTS * MIC_LOUD_PEAK ? 'is-loud' : 'is-good');
        cells[k].className = 'instr-seg-cell' + (k < on ? ' is-on ' + zone : '');
      }
    };
    box.setLevel(0);
    return box;
  }

  function renderMicAdjust(screen, ctx) {
    var c = copyOf(screen);
    var wrap = card();
    wrap.className = 'instr-card instr-micscreen';

    var h1 = bi('h1', c.titleEn || 'Adjusting the Microphone', c.titleKo || '마이크 조절');
    h1.className = 'instr-mic-h1';
    wrap.appendChild(h1);
    wrap.appendChild(el('div', 'instr-rule'));

    var panel = el('div', 'instr-mic');

    /* 좌측 — 원형 RECORD 버튼 */
    var left = el('div', 'instr-mic-left');
    var rec = el('button', 'instr-mic-record');
    rec.type = 'button';
    rec.appendChild(micIcon());
    var recLabel = el('span', 'instr-mic-record-label');
    biInto(recLabel, 'RECORD', '녹음');
    rec.appendChild(recLabel);
    left.appendChild(rec);
    panel.appendChild(left);

    /* 우측 — 안내 2문단 + 낭독 지문 */
    var right = el('div', 'instr-mic-copy');
    var p1 = bi('p', "Select the 'Record' button. A timer will count down until the system is ready to record.",
      "'Record' 버튼을 선택하세요. 녹음이 준비될 때까지 타이머가 카운트다운됩니다.");
    var p2 = bi('p', 'To check your microphone level, you will record the following paragraph using your normal tone and volume.',
      '마이크 입력 수준을 확인하기 위해 아래 지문을 평소 말투와 목소리 크기로 읽어 녹음합니다.');
    right.appendChild(p1);
    right.appendChild(p2);
    var sample = bi('p', MIC_SAMPLE_EN, MIC_SAMPLE_KO);
    sample.className = 'instr-mic-sample';
    right.appendChild(sample);
    panel.appendChild(right);
    wrap.appendChild(panel);

    /* 레벨 미터 */
    var meter = segmentMeter();
    wrap.appendChild(meter);

    var status = el('p', 'instr-hw-status instr-mic-status');
    biInto(status, 'Select Record when you are ready.', '준비되면 Record 를 선택하세요.');
    wrap.appendChild(status);

    /* 액션 — 판정 전에는 Skip 만, 통과하면 Continue 가 붙는다 */
    var actions = el('div', 'instr-actions instr-mic-actions');
    var cont = ctaNode(screen, ctx);
    cont.style.display = 'none';
    var skip = button('exam-btn instr-mic-skip', 'Skip microphone check', '마이크 점검 건너뛰기');
    skip.onclick = function () {
      var st = store();
      if (st && typeof st.pushEvent === 'function') st.pushEvent('mic_skipped', screen.id, {});
      if (ctx && ctx.engine && typeof ctx.engine.next === 'function') ctx.engine.next('manual');
    };
    actions.appendChild(cont);
    actions.appendChild(skip);
    wrap.appendChild(actions);

    lockAdvance(true);

    var state = {
      alive: true, stream: null, audioCtx: null, raf: null,
      tick: null, phase: 'idle', peak: 0, adopted: false
    };

    function setStatus(en, ko, cls) {
      while (status.firstChild) status.removeChild(status.firstChild);
      status.className = 'instr-hw-status instr-mic-status' + (cls ? ' ' + cls : '');
      biInto(status, en, ko);
    }

    function setRecLabel(en, ko) {
      while (recLabel.firstChild) recLabel.removeChild(recLabel.firstChild);
      biInto(recLabel, en, ko);
    }

    function clearTick() {
      if (state.tick !== null) { try { root.clearInterval(state.tick); } catch (e) {} }
      state.tick = null;
    }

    function cleanup() {
      state.alive = false;
      clearTick();
      if (state.raf !== null && root.cancelAnimationFrame) {
        try { root.cancelAnimationFrame(state.raf); } catch (e) {}
      }
      state.raf = null;
      if (state.audioCtx) { try { state.audioCtx.close(); } catch (e2) {} state.audioCtx = null; }
      // 스트림은 SG_RECORDER 가 물려받았으면 살려 둔다 — 스피킹에서 권한을 다시 묻지 않기 위해서다.
      if (state.stream && !state.adopted) {
        var tr = state.stream.getTracks ? state.stream.getTracks() : [];
        for (var i = 0; i < tr.length; i++) { try { tr[i].stop(); } catch (e3) {} }
      }
      state.stream = null;
      lockAdvance(false);
    }
    onLeave(ctx, cleanup);

    function startMeter(stream) {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      try {
        var ac = new Ctx();
        state.audioCtx = ac;
        var analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        ac.createMediaStreamSource(stream).connect(analyser);
        var buf = new Uint8Array(analyser.fftSize);
        var loop = function () {
          if (!state.alive) return;
          analyser.getByteTimeDomainData(buf);
          var sum = 0, v;
          for (var i = 0; i < buf.length; i++) { v = (buf[i] - 128) / 128; sum += v * v; }
          var rms = Math.sqrt(sum / buf.length);
          var lvl = Math.min(1, rms * 3.2);
          if (state.phase === 'recording') {
            if (lvl > state.peak) state.peak = lvl;
            meter.setLevel(lvl);
          } else {
            meter.setLevel(0);
          }
          if (root.requestAnimationFrame) state.raf = root.requestAnimationFrame(loop);
        };
        loop();
      } catch (e) { warn('level meter unavailable', e); }
    }

    function finish() {
      state.phase = 'done';
      clearTick();
      meter.setLevel(state.peak);
      rec.className = 'instr-mic-record';
      setRecLabel('RE-RECORD', '다시 녹음');
      rec.disabled = false;
      var verdict = micVerdict(state.peak);
      var st = store();
      if (st && typeof st.pushEvent === 'function') {
        st.pushEvent('mic_check_done', screen.id, { peak: Math.round(state.peak * 100) / 100, verdict: verdict });
      }
      if (verdict === 'good') {
        setStatus('Your microphone level is good. Select Continue to go on.',
          '마이크 입력 수준이 적절합니다. 계속하려면 Continue 를 선택하세요.', 'is-ok');
      } else if (verdict === 'quiet') {
        setStatus('Your voice was too quiet. Move closer to the microphone or raise your input level, then record again.',
          '목소리가 너무 작습니다. 마이크에 더 가까이 가거나 입력 감도를 올린 뒤 다시 녹음하세요.', 'is-error');
      } else if (verdict === 'loud') {
        setStatus('Your voice was too loud. Move away from the microphone or lower your input level, then record again.',
          '목소리가 너무 큽니다. 마이크에서 조금 떨어지거나 입력 감도를 낮춘 뒤 다시 녹음하세요.', 'is-error');
      } else {
        setStatus('No sound was detected. Check that the right microphone is selected, then record again.',
          '소리가 감지되지 않았습니다. 올바른 마이크가 선택되어 있는지 확인한 뒤 다시 녹음하세요.', 'is-error');
      }
      // 판정과 무관하게 한 번 녹음했으면 진행은 열어 준다(FR14 — 시험을 멈추지 않는다).
      cont.style.display = '';
      cont.disabled = false;
      lockAdvance(false);
    }

    function runRecording() {
      state.phase = 'recording';
      state.peak = 0;
      rec.className = 'instr-mic-record is-recording';
      rec.disabled = true;
      var left2 = MIC_RECORD_SEC;
      setRecLabel('RECORDING', '녹음 중');
      setStatus('Read the paragraph aloud. ' + left2 + ' seconds remaining.',
        '지문을 소리 내어 읽으세요. ' + left2 + '초 남았습니다.');
      state.tick = root.setInterval(function () {
        if (!state.alive) { clearTick(); return; }
        left2 -= 1;
        if (left2 <= 0) { finish(); return; }
        setStatus('Read the paragraph aloud. ' + left2 + ' seconds remaining.',
          '지문을 소리 내어 읽으세요. ' + left2 + '초 남았습니다.');
      }, 1000);
    }

    function runCountdown() {
      state.phase = 'countdown';
      rec.disabled = true;
      rec.className = 'instr-mic-record is-arming';
      var n = MIC_READY_SEC;
      setRecLabel(String(n), String(n));
      setStatus('Get ready — recording starts in ' + n + '…', '준비하세요 — ' + n + '초 후 녹음이 시작됩니다…');
      state.tick = root.setInterval(function () {
        if (!state.alive) { clearTick(); return; }
        n -= 1;
        if (n <= 0) { clearTick(); runRecording(); return; }
        setRecLabel(String(n), String(n));
        setStatus('Get ready — recording starts in ' + n + '…', '준비하세요 — ' + n + '초 후 녹음이 시작됩니다…');
      }, 1000);
    }

    function unavailable(en, ko) {
      setStatus(en, ko, 'is-error');
      rec.disabled = true;
      setRecLabel('RECORD', '녹음');
      rec.className = 'instr-mic-record is-disabled';
      // 마이크가 없어도 시험은 계속된다 — Skip 만 남기고 상단바를 푼다.
      lockAdvance(false);
    }

    function ensureStream(then) {
      if (state.stream) { then(state.stream); return; }
      // 이미 SG_RECORDER 가 스트림을 쥐고 있으면 권한을 두 번 묻지 않는다.
      var R2 = root.SG_RECORDER;
      var live = R2 && typeof R2.getStream === 'function' ? R2.getStream() : null;
      if (live) {
        state.stream = live;
        state.adopted = true;
        startMeter(live);
        then(live);
        return;
      }
      var nav = root.navigator;
      if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') {
        unavailable('This browser cannot access a microphone. You can continue, but Speaking answers will not be recorded.',
          '이 브라우저는 마이크에 접근할 수 없습니다. 계속 진행할 수 있으나 스피킹 답변은 녹음되지 않습니다.');
        return;
      }
      setStatus('Requesting microphone access…', '마이크 권한을 요청하는 중…');
      rec.disabled = true;
      var p;
      try { p = nav.mediaDevices.getUserMedia({ audio: true }); } catch (e) { p = null; }
      if (!p || !p.then) {
        unavailable('Microphone request failed.', '마이크 요청에 실패했습니다.');
        return;
      }
      p.then(function (stream) {
        if (!state.alive) {
          var tr = stream.getTracks ? stream.getTracks() : [];
          for (var i = 0; i < tr.length; i++) { try { tr[i].stop(); } catch (e) {} }
          return;
        }
        state.stream = stream;
        if (R2 && typeof R2.adoptStream === 'function') { state.adopted = !!R2.adoptStream(stream); }
        var st = store();
        if (st && typeof st.pushEvent === 'function') st.pushEvent('mic_granted', screen.id, {});
        startMeter(stream);
        rec.disabled = false;
        then(stream);
      })['catch'](function (err) {
        var name = err && err.name ? err.name : 'Error';
        var denied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
        rec.disabled = false;
        rec.className = 'instr-mic-record';
        setRecLabel('RECORD', '녹음');
        if (denied) {
          setStatus('Microphone access was blocked. Allow the microphone in your browser settings, then select Record again.',
            '마이크 접근이 차단되었습니다. 브라우저 설정에서 마이크를 허용한 뒤 Record 를 다시 선택하세요.', 'is-error');
        } else {
          setStatus('No microphone was found. Connect one and select Record again, or skip the check.',
            '마이크를 찾지 못했습니다. 마이크를 연결한 뒤 Record 를 다시 선택하거나 점검을 건너뛰세요.', 'is-error');
        }
        lockAdvance(false);
        var st2 = store();
        if (st2 && typeof st2.pushEvent === 'function') st2.pushEvent('mic_denied', screen.id, { name: name });
      });
    }

    rec.onclick = function () {
      if (rec.disabled) return;
      if (state.phase === 'countdown' || state.phase === 'recording') return;
      ensureStream(function () { runCountdown(); });
    };

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
    // Adjusting the Microphone 은 같은 screenType 을 쓰지만 레퍼런스 레이아웃이 따로 있다.
    if (screen && screen.id === fixedId('adjustMic', 'intro.microphone')) return renderMicAdjust(screen, ctx);

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
    readingTaskKey: readingTaskKey,
    readingRows: readingRows,
    readingQuestionCount: readingQuestionCount,
    durationWords: durationWords,
    questionCountsByModule: questionCountsByModule,
    unitWords: unitWords,
    micVerdict: micVerdict,
    MIC_SAMPLE_EN: MIC_SAMPLE_EN,
    // 렌더 함수(셀프테스트에서 직접 호출)
    renderInstruction: renderInstruction,
    renderModuleEnd: renderModuleEnd,
    renderHardwareCheck: renderHardwareCheck,
    renderMicAdjust: renderMicAdjust,
    renderReview: renderReview
  };
})(typeof window !== 'undefined' ? window : this);
