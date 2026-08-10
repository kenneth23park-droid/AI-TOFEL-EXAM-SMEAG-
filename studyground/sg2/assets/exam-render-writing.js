/* SMEAG · StudyGround — exam-render-writing.js  (Story 2.4)
 * 목적: writing 섹션 화면 렌더러. architecture.md §4.2 의 block.kind 2종을 담당한다.
 *         build-set  → "Make an appropriate sentence" 드래그/클릭 배열 (문항 1개 = 화면 1개, W1 10화면)
 *         free-write → W2 Write an Email / W3 Write for an Academic Discussion (textarea + 단어수)
 * 의존 전역: window.SG_RENDER (필수), window.SG_STORE, window.SG_CLOCK, window.SG_EXAM,
 *            window.SG_TTS (선택 — 없으면 Read-aloud 버튼 미표시), window.SMEAG_SET1 (문항 원본)
 * 노출 전역: window.SG_WRITING  (테스트/셀프테스트용 순수 헬퍼 + 렌더 진입점)
 *
 * 규약 준수
 *  - ES5 문법만. var + function + 문자열 연결. (P1)
 *  - 답안 기록은 engine.answer() → SG_STORE.upsertAnswer() 만 사용. localStorage 직접 접근 없음.
 *  - 타이머는 SG_CLOCK 만 구독한다. setInterval 카운트다운을 직접 만들지 않는다.
 *  - 미디어 경로는 SG_MEDIA.resolveMedia() 를 통과시킨다(이 렌더러는 미디어를 쓰지 않아 호출부 없음 —
 *    TTS 는 SG_TTS 가 media/tts/index.json 을 통해 자체 해석한다).
 *  - 예외는 삼킨다. 렌더 실패로 시험이 멈추면 안 된다(F12).
 *
 * exam-render.js 와의 공존 (중요)
 *  SG_RENDER.register() 는 screenType 하나당 하나의 렌더러만 담는다. 그런데 writing/reading/listening
 *  화면은 전부 screenType === 'question' 이다. 뒤에 로드되는 파일이 앞의 등록을 덮어써 버리므로,
 *  이 파일은 register() 를 덮어쓰지 않고 SG_RENDER.render() 를 감싸 "내 화면(section==='writing' 이고
 *  blockKind 가 build-set/free-write)"만 가로챈 뒤 나머지는 원래 dispatcher 로 그대로 넘긴다.
 *  exam-render.js 파일 자체는 수정하지 않는다(소유자 Story 2.7).
 */
(function (root) {
  'use strict';

  var doc = root.document || null;

  /* 이 렌더러가 책임지는 blockKind. 그 외에는 손대지 않는다. */
  var MINE = { 'build-set': 1, 'free-write': 1 };

  var TEXT_DEBOUNCE_MS = 500;   // AC7 — textarea 는 500ms 디바운스 후 저장
  var teardowns = [];           // 현재 화면이 잡고 있는 구독/타이머 해제자

  function warn(msg, e) { if (root.console && root.console.warn) root.console.warn('[SG_WRITING] ' + msg, e || ''); }

  /* ── 순수 헬퍼 (node 에서 그대로 검증 가능 — DOM/Date 접근 없음) ───────────── */

  /* exam.html 의 slug() 와 같은 규칙. media/tts/index.json 의 키가 이 규칙으로 만들어져 있다. */
  function slug(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  }

  /* 실시간 단어수. 공백류 하나 이상으로 끊고 빈 토큰은 버린다. */
  function wordCount(text) {
    var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ');
    s = s.replace(/^ +| +$/g, '');
    if (!s) return 0;
    return s.split(' ').length;
  }

  /* slots[] 중 t:'b'(빈칸) 의 인덱스 목록. 순서 = answerTokens 의 순서. */
  function blankIndexes(slots) {
    var out = [], i;
    if (!(slots instanceof Array)) return out;
    for (i = 0; i < slots.length; i++) { if (slots[i] && slots[i].t === 'b') out.push(i); }
    return out;
  }

  /* 빈칸별 배치 상태(placed[blank] = tileIndex|null) → answerTokens 와 같은 순서의 문자열 배열. */
  function tokensOf(tiles, placed) {
    var out = [], i, t;
    for (i = 0; i < placed.length; i++) {
      t = placed[i];
      out.push(t === null || t === undefined ? '' : String(tiles[t]));
    }
    return out;
  }

  /* 문장 미리보기. 고정 슬롯 텍스트와 배치된 토큰을 원래 순서로 이어붙인다.
     · 구두점(. , ? ! ; :) 앞의 공백은 제거한다.
     · 첫 글자는 대문자로 올린다 — set1.js 의 tiles[] 는 문장 첫 단어를 소문자로 담고
       있고(예: W-3 tiles 'why', slots 정답 'Why'), 완성 문장(question.sentence)은 대문자다. */
  function sentenceOf(slots, tiles, placed) {
    var parts = [], bIdx = 0, i, piece;
    for (i = 0; i < slots.length; i++) {
      if (!slots[i]) continue;
      if (slots[i].t === 'b') { piece = placed[bIdx] === null || placed[bIdx] === undefined ? '' : String(tiles[placed[bIdx]]); bIdx++; }
      else { piece = String(slots[i].text === undefined ? '' : slots[i].text); }
      if (piece !== '') parts.push(piece);
    }
    var s = parts.join(' ');
    s = s.replace(/ +([.,?!;:])/g, '$1');
    if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
    return s;
  }

  function isComplete(placed) {
    for (var i = 0; i < placed.length; i++) { if (placed[i] === null || placed[i] === undefined) return false; }
    return placed.length > 0;
  }

  /* 콘텐츠 팩에서 문항 원본을 찾는다. 화면(TestScreen)에는 questionIds 만 있고 본문이 없다. */
  function findQuestion(set, qid) {
    if (!set || !(set.sections instanceof Array) || !qid) return null;
    var si, mi, bi, qi, sec, mod, blk, qs;
    for (si = 0; si < set.sections.length; si++) {
      sec = set.sections[si];
      var mods = (sec && sec.modules instanceof Array) ? sec.modules : [];
      for (mi = 0; mi < mods.length; mi++) {
        mod = mods[mi];
        var blocks = (mod && mod.blocks instanceof Array) ? mod.blocks : [];
        for (bi = 0; bi < blocks.length; bi++) {
          blk = blocks[bi];
          qs = (blk && blk.questions instanceof Array) ? blk.questions : [];
          for (qi = 0; qi < qs.length; qi++) {
            if (qs[qi] && qs[qi].id === qid) {
              return { question: qs[qi], block: blk, module: mod, section: sec };
            }
          }
        }
      }
    }
    return null;
  }

  /* Read-aloud 로 읽어줄 지문. exam.html 의 free-write 규칙과 동일(prompt → situation). */
  function promptTextOf(q) {
    if (!q) return '';
    return String(q.prompt || q.situation || '');
  }

  /* media/tts/index.json 키. 기존 번들 키(write-w-email / write-w-disc)와 일치한다. */
  function ttsIdFor(q) { return 'write-' + slug(q && q.id ? q.id : (q && q.no)); }

  /* 저장된 답안 → placed 배열 복원. 토큰 문자열을 미사용 타일에 앞에서부터 매칭한다.
     1차는 완전일치, 남은 것만 2차로 대소문자 무시 매칭 — set1.js 의 tiles[] 는 문장
     첫 단어를 소문자로 담고 있어(예: 'why' vs slots 정답 'Why') 완전일치만으로는
     정답 토큰 배열을 되돌릴 수 없다. */
  function restorePlaced(tiles, blanks, saved) {
    var placed = [], used = {}, pass, i, j, tok;
    for (i = 0; i < blanks; i++) placed.push(null);
    var toks = null;
    if (saved) {
      if (saved.tokens instanceof Array) toks = saved.tokens;
      else if (saved.v instanceof Array) toks = saved.v;
    }
    if (!toks) return placed;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < placed.length && i < toks.length; i++) {
        if (placed[i] !== null) continue;
        tok = toks[i];
        if (tok === '' || tok === null || tok === undefined) continue;
        for (j = 0; j < tiles.length; j++) {
          if (used[j]) continue;
          var a = String(tiles[j]), b = String(tok);
          var hit = pass === 0 ? (a === b) : (a.toLowerCase() === b.toLowerCase());
          if (hit) { placed[i] = j; used[j] = 1; break; }
        }
      }
    }
    return placed;
  }

  /* ── 런타임 접근자 ─────────────────────────────────────────────────────── */

  function contentOf(ctx) {
    return (ctx && (ctx.content || ctx.set)) || root.SG_CONTENT_PACK || root.SMEAG_SET1 || null;
  }

  function storeApi() { return root.SG_STORE || null; }

  function savedAnswer(qid) {
    var s = storeApi();
    if (!s || typeof s.getAnswer !== 'function') return null;
    try { return s.getAnswer(qid); } catch (e) { return null; }
  }

  /* 답안 기록의 유일한 경로. engine 이 있으면 engine.answer(), 없으면(셀프테스트) store 직접. */
  function saveAnswer(ctx, qid, value, extra) {
    var eng = ctx && ctx.engine;
    var engErr = null;
    if (eng && typeof eng.answer === 'function') {
      try { return eng.answer(qid, value, extra); } catch (e) { engErr = e; }
    }
    var s = storeApi();
    if (s && typeof s.upsertAnswer === 'function') {
      /* engine 이 거절하는 **정상** 경로가 하나 있다: 화면을 떠날 때의 teardown commit.
         renderScreen() 이 disposeAll() 을 부르는 시점에 engine 은 이미 다음 화면에 있어
         이전 화면의 문항을 "does not belong to screen" 으로 거절한다. 여기서 store 에
         직접 쓰면 답안은 그대로 보존되므로 경고를 남기지 않는다(예전에는 writing 화면을
         떠날 때마다 콘솔에 가짜 경고가 찍혔다 — F2 렌더 스윕에서 발견). */
      try { return s.upsertAnswer(qid, value, extra); }
      catch (e2) { warn('save failed for ' + qid, engErr || e2); return false; }
    }
    if (engErr) warn('engine.answer failed for ' + qid, engErr);
    return false;
  }

  function flushAnswers() {
    var s = storeApi();
    if (s && typeof s.flushAnswers === 'function') { try { s.flushAnswers(); } catch (e) {} }
  }

  /* 화면에 걸린 clock key 들. 엔진의 clockKeyFor 계약을 그대로 쓴다(§3.5). */
  function clockKeysOf(screen, ctx) {
    var out = [], ts = [], i, kf, k;
    if (!screen) return out;
    if (screen.timer) ts.push(screen.timer);
    if (screen.timers instanceof Array) {
      for (i = 0; i < screen.timers.length; i++) { if (screen.timers[i]) ts.push(screen.timers[i]); }
    }
    kf = (ctx && ctx.engine && ctx.engine.clockKeyFor) || (root.SG_EXAM && root.SG_EXAM.clockKeyFor) || null;
    if (!kf) return out;
    for (i = 0; i < ts.length; i++) {
      k = kf(screen, ts[i]);
      if (k) out.push(k);
    }
    return out;
  }

  /* 만료 판정 — SG_CLOCK 이 정본. 렌더러가 남은 초를 따로 세지 않는다. */
  function isExpired(screen, ctx) {
    var C = root.SG_CLOCK;
    if (!C || typeof C.remainingSec !== 'function') return false;
    var keys = clockKeysOf(screen, ctx), i, r;
    for (i = 0; i < keys.length; i++) {
      r = C.remainingSec(keys[i]);
      if (r === 0) return true;
    }
    return false;
  }

  /* ── DOM 유틸 ──────────────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function bi(tag, en, ko, cls) {
    var R = root.SG_RENDER;
    var n = (R && typeof R.bilingual === 'function') ? R.bilingual(tag, en, ko) : el(tag || 'p', null, en);
    if (cls) n.className = cls;
    return n;
  }

  function on(node, type, fn) {
    if (node.addEventListener) node.addEventListener(type, fn, false);
    else if (node.attachEvent) node.attachEvent('on' + type, fn);
  }

  function disposeAll() {
    for (var i = 0; i < teardowns.length; i++) { try { teardowns[i](); } catch (e) {} }
    teardowns = [];
  }

  /* 화면이 DOM 에서 사라지면 스스로 구독을 끊는다 (SG_RENDER 에 teardown 훅이 없으므로). */
  function watchExpiry(rootEl, screen, ctx, apply) {
    var C = root.SG_CLOCK;
    apply(isExpired(screen, ctx));
    if (!C || typeof C.subscribe !== 'function') return;
    var off = C.subscribe(function () {
      if (doc && doc.body && !doc.body.contains(rootEl)) { off(); return; }
      apply(isExpired(screen, ctx));
    });
    teardowns.push(off);
  }

  /* ── build-set ─────────────────────────────────────────────────────────── */

  function renderBuildSet(screen, ctx, found) {
    var q = found.question;
    var slots = (q.slots instanceof Array) ? q.slots : [];
    var tiles = (q.tiles instanceof Array) ? q.tiles : [];
    var blanks = blankIndexes(slots);
    var placed = restorePlaced(tiles, blanks.length, savedAnswer(q.id));
    var selectedTile = -1;   // 클릭-투-플레이스: 선택된 팔레트 타일
    var selectedBlank = -1;  // 클릭-투-플레이스: 선택된 빈칸
    var locked = false;

    var wrap = el('div', 'wr-screen wr-build');

    wrap.appendChild(bi('h2', 'Make an appropriate sentence.', '알맞은 문장을 만드세요.', 'wr-heading'));
    wrap.appendChild(bi('p',
      'Drag each tile into a blank, or tap a tile and then tap a blank. Tap a placed tile to send it back.',
      '타일을 빈칸으로 끌어다 놓거나, 타일을 누른 뒤 빈칸을 누르세요. 배치된 타일을 누르면 팔레트로 돌아갑니다.',
      'wr-hint muted'));

    if (q.context) {
      var ctxBox = el('div', 'wr-context');
      ctxBox.appendChild(bi('span', 'Prompt', '문제', 'wr-context-label'));
      ctxBox.appendChild(el('p', 'wr-context-text', q.context));
      wrap.appendChild(ctxBox);
    }

    var sentence = el('div', 'wr-sentence');
    sentence.setAttribute('role', 'group');
    wrap.appendChild(sentence);

    var preview = el('div', 'wr-preview');
    wrap.appendChild(preview);

    var palette = el('div', 'wr-tiles');
    palette.setAttribute('role', 'list');
    wrap.appendChild(palette);

    var lockNote = bi('p', 'Time is up for this task. Your answer has been kept as it is.',
      '이 과제의 시간이 종료되었습니다. 현재 답안이 그대로 제출 대상으로 남습니다.', 'wr-locked-note');
    lockNote.style.display = 'none';
    wrap.appendChild(lockNote);

    var grid = buildGrid(screen, ctx);
    if (grid) wrap.appendChild(grid);

    function commit() {
      var toks = tokensOf(tiles, placed);
      saveAnswer(ctx, q.id, toks, {
        text: sentenceOf(slots, tiles, placed),
        complete: isComplete(placed),
        kind: 'build'
      });
      refreshGrid(grid, screen, ctx);
    }

    function place(blank, tile) {
      if (locked) return;
      var i;
      for (i = 0; i < placed.length; i++) { if (placed[i] === tile) placed[i] = null; }
      placed[blank] = tile;
      selectedTile = -1; selectedBlank = -1;
      paint(); commit();
    }

    function unplace(blank) {
      if (locked) return;
      placed[blank] = null;
      selectedTile = -1; selectedBlank = -1;
      paint(); commit();
    }

    function firstEmptyBlank() {
      for (var i = 0; i < placed.length; i++) { if (placed[i] === null) return i; }
      return -1;
    }

    function tileUsed(tile) {
      for (var i = 0; i < placed.length; i++) { if (placed[i] === tile) return true; }
      return false;
    }

    function onTileActivate(tile) {
      if (locked || tileUsed(tile)) return;
      if (selectedBlank >= 0) { place(selectedBlank, tile); return; }
      var b = firstEmptyBlank();
      if (b >= 0) { place(b, tile); return; }
      selectedTile = (selectedTile === tile) ? -1 : tile;
      paint();
    }

    function onBlankActivate(blank) {
      if (locked) return;
      if (placed[blank] !== null) { unplace(blank); return; }
      if (selectedTile >= 0) { place(blank, selectedTile); return; }
      selectedBlank = (selectedBlank === blank) ? -1 : blank;
      paint();
    }

    function makeBlank(blank) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'wr-slot' + (placed[blank] === null ? ' is-empty' : ' is-filled') +
        (selectedBlank === blank ? ' is-target' : '');
      b.setAttribute('data-blank', String(blank));
      b.disabled = !!locked;
      b.textContent = placed[blank] === null ? ' ' : String(tiles[placed[blank]]);
      b.setAttribute('aria-label', 'Blank ' + (blank + 1) + (placed[blank] === null ? ' (empty)' : ': ' + tiles[placed[blank]]));
      on(b, 'click', function () { onBlankActivate(blank); });
      on(b, 'dragover', function (e) {
        if (e.preventDefault) e.preventDefault();
        if (b.className.indexOf(' is-over') < 0) b.className += ' is-over';
      });
      on(b, 'dragleave', function () { b.className = b.className.replace(/ is-over/g, ''); });
      on(b, 'drop', function (e) {
        if (e.preventDefault) e.preventDefault();
        b.className = b.className.replace(/ is-over/g, '');
        var raw = '';
        try { raw = e.dataTransfer ? e.dataTransfer.getData('text/plain') : ''; } catch (err) { raw = ''; }
        var t = parseInt(raw, 10);
        if (isNaN(t) || !tiles[t]) return;
        place(blank, t);
      });
      return b;
    }

    function makeTile(i) {
      var t = doc.createElement('button');
      t.type = 'button';
      t.className = 'wr-tile' + (selectedTile === i ? ' is-selected' : '');
      t.setAttribute('data-tile', String(i));
      t.setAttribute('role', 'listitem');
      t.disabled = !!locked;
      t.textContent = String(tiles[i]);
      if (!locked) t.setAttribute('draggable', 'true');
      on(t, 'click', function () { onTileActivate(i); });
      on(t, 'dragstart', function (e) {
        if (locked) { if (e.preventDefault) e.preventDefault(); return; }
        try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      return t;
    }

    function paint() {
      var i;
      while (sentence.firstChild) sentence.removeChild(sentence.firstChild);
      var b = 0;
      for (i = 0; i < slots.length; i++) {
        if (!slots[i]) continue;
        if (slots[i].t === 'b') { sentence.appendChild(makeBlank(b)); b++; }
        else sentence.appendChild(el('span', 'wr-fixed', slots[i].text));
      }
      while (palette.firstChild) palette.removeChild(palette.firstChild);
      for (i = 0; i < tiles.length; i++) { if (!tileUsed(i)) palette.appendChild(makeTile(i)); }
      if (!palette.firstChild) {
        palette.appendChild(bi('span', 'All tiles placed.', '모든 타일을 배치했습니다.', 'wr-tiles-empty muted'));
      }
      // AC3 — 드롭존이 모두 채워지면 완성 문장을 한 줄로 표시한다.
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      if (isComplete(placed)) {
        preview.className = 'wr-preview is-complete';
        preview.appendChild(el('span', 'wr-preview-text', sentenceOf(slots, tiles, placed)));
      } else {
        preview.className = 'wr-preview';
      }
    }

    // 팔레트 자체도 드롭 타깃 — 배치된 타일을 되돌릴 수 있다.
    on(palette, 'dragover', function (e) { if (e.preventDefault) e.preventDefault(); });
    on(palette, 'drop', function (e) {
      if (e.preventDefault) e.preventDefault();
      var raw = '';
      try { raw = e.dataTransfer ? e.dataTransfer.getData('text/plain') : ''; } catch (err) { raw = ''; }
      var t = parseInt(raw, 10);
      if (isNaN(t)) return;
      for (var i = 0; i < placed.length; i++) { if (placed[i] === t) { unplace(i); return; } }
    });

    paint();

    watchExpiry(wrap, screen, ctx, function (expired) {
      if (expired === locked) return;
      locked = expired;
      lockNote.style.display = locked ? '' : 'none';
      wrap.className = 'wr-screen wr-build' + (locked ? ' is-locked' : '');
      paint();
      if (locked) flushAnswers();
    });

    teardowns.push(function () { flushAnswers(); });

    // 셀프테스트에서 클릭 없이 상태를 확인할 수 있도록 훅을 남긴다.
    wrap.__sg = {
      question: q, tiles: tiles, slots: slots,
      placed: function () { return placed.slice(0); },
      tapTile: onTileActivate, tapBlank: onBlankActivate,
      tokens: function () { return tokensOf(tiles, placed); },
      sentence: function () { return sentenceOf(slots, tiles, placed); },
      locked: function () { return locked; }
    };
    return wrap;
  }

  /* ── 문항 그리드 네비게이션 (build-set 전용) ──────────────────────────── */

  /* 같은 모듈(W1)의 build-set 화면들을 모아 1..N 그리드를 만든다.
     엔진에는 역방향 이동 API 가 없다(Story 1.4 AC3 — 의도적). 그래서 앞으로 가는 셀만
     활성화하고, 뒤 셀은 disabled 로 남긴다. 엔진이 훗날 goToScreen 을 노출하면 자동으로 쓴다. */
  function siblingScreens(screen, ctx) {
    var eng = ctx && ctx.engine;
    if (!eng || typeof eng.screens !== 'function') return null;
    var all = eng.screens() || [], out = [], i;
    for (i = 0; i < all.length; i++) {
      if (all[i] && all[i].section === screen.section && all[i].moduleId === screen.moduleId &&
          all[i].blockKind === 'build-set') {
        out.push({ index: i, screen: all[i] });
      }
    }
    return out.length > 1 ? out : null;
  }

  function buildGrid(screen, ctx) {
    var sibs = siblingScreens(screen, ctx);
    if (!sibs) return null;
    var eng = ctx.engine;
    var here = eng.currentIndex ? eng.currentIndex() : -1;
    var box = el('div', 'wr-grid');
    box.appendChild(bi('span', 'Questions', '문항', 'wr-grid-label'));
    var nav = el('div', 'grid-nav');
    box.appendChild(nav);
    box.__sibs = sibs;

    for (var i = 0; i < sibs.length; i++) {
      (function (n) {
        var s = sibs[n].screen;
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = String(n + 1);
        btn.setAttribute('data-screen-id', s.id);
        var isHere = s.id === screen.id;
        var forward = sibs[n].index > here;
        if (isHere) btn.className = 'current';
        var a = savedAnswer((s.questionIds || [])[0]);
        if (!isHere && a && a.complete) btn.className = 'answered';
        if (!isHere && !forward) {
          btn.disabled = true;
          btn.title = 'You cannot go back to a previous question.';
        }
        if (isHere) btn.disabled = true;
        on(btn, 'click', function () {
          if (isHere) return;
          if (typeof eng.goToScreen === 'function') { eng.goToScreen(s.id, 'manual'); return; }
          var steps = sibs[n].index - (eng.currentIndex ? eng.currentIndex() : 0);
          for (var k = 0; k < steps; k++) { if (!eng.next('manual')) break; }
        });
        nav.appendChild(btn);
      })(i);
    }
    return box;
  }

  function refreshGrid(grid, screen, ctx) {
    if (!grid || !grid.__sibs) return;
    var nav = grid.getElementsByTagName('div')[0];
    if (!nav) return;
    var kids = nav.childNodes, i;
    for (i = 0; i < kids.length; i++) {
      var id = kids[i].getAttribute ? kids[i].getAttribute('data-screen-id') : null;
      if (!id || id === screen.id) continue;
      var sc = null, j;
      for (j = 0; j < grid.__sibs.length; j++) { if (grid.__sibs[j].screen.id === id) { sc = grid.__sibs[j].screen; break; } }
      if (!sc) continue;
      var a = savedAnswer((sc.questionIds || [])[0]);
      kids[i].className = (a && a.complete) ? 'answered' : '';
    }
  }

  /* ── free-write ────────────────────────────────────────────────────────── */

  function readAloudButton(q) {
    var text = promptTextOf(q);
    if (!text || !root.SG_TTS) return null;
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost sm wr-tts';
    var icon = el('span', null, '🔊');
    var labEn = el('span', null, ' Read aloud'); labEn.setAttribute('data-en', '');
    var labKo = el('span', null, ' 읽어주기'); labKo.setAttribute('data-ko', '');
    btn.appendChild(icon); btn.appendChild(labEn); btn.appendChild(labKo);
    var ttsId = ttsIdFor(q);
    on(btn, 'click', function () {
      if (btn.getAttribute('data-state') === 'playing') {
        try { root.SG_TTS.stop(); } catch (e) {}
        btn.setAttribute('data-state', '');
        return;
      }
      try { root.SG_TTS.speak(ttsId, text, btn); } catch (e) { warn('tts failed', e); }
    });
    teardowns.push(function () { try { if (root.SG_TTS) root.SG_TTS.stop(); } catch (e) {} });
    return btn;
  }

  function emailHeader(q) {
    var box = el('div', 'wr-mail-head');
    var rowTo = el('div', 'wr-mail-row');
    rowTo.appendChild(bi('span', 'To', '받는 사람', 'wr-mail-key'));
    rowTo.appendChild(el('span', 'wr-mail-val', q.to || ''));
    var rowSub = el('div', 'wr-mail-row');
    rowSub.appendChild(bi('span', 'Subject', '제목', 'wr-mail-key'));
    rowSub.appendChild(el('span', 'wr-mail-val', q.subject || ''));
    box.appendChild(rowTo); box.appendChild(rowSub);
    return box;
  }

  function situationBox(q) {
    var box = el('div', 'wr-situation');
    box.appendChild(el('div', 'wr-situation-label', q.situationLabel || 'SITUATION'));
    box.appendChild(el('p', 'wr-situation-text', q.situation || ''));
    return box;
  }

  function bulletsBox(q) {
    var list = (q.bullets instanceof Array) ? q.bullets : [];
    if (!list.length) return null;
    var box = el('div', 'wr-bullets');
    box.appendChild(el('div', 'wr-bullets-label', q.bulletsLabel || 'YOUR EMAIL SHOULD'));
    var ul = el('ul', 'wr-bullets-list');
    for (var i = 0; i < list.length; i++) ul.appendChild(el('li', null, list[i]));
    box.appendChild(ul);
    return box;
  }

  /* 이름 → 아바타 이니셜. 사진이 없는 화자는 이니셜 원으로 대체한다. */
  function initialsOf(name) {
    var s = String(name || '').replace(/^professor\s+/i, '').replace(/[–—-].*$/, '');
    var parts = s.replace(/^\s+|\s+$/g, '').split(/\s+/), out = '', i;
    for (i = 0; i < parts.length && out.length < 2; i++) {
      if (parts[i]) out += parts[i].charAt(0).toUpperCase();
    }
    return out || '?';
  }

  function avatarOf(name, src) {
    var box = el('div', 'wr-avatar');
    var url = '';
    if (src) {
      url = src;
      if (root.SG_MEDIA && typeof root.SG_MEDIA.resolveMedia === 'function') {
        try { url = root.SG_MEDIA.resolveMedia(src) || src; } catch (e) { url = src; }
      }
    }
    if (url) {
      var img = doc.createElement('img');
      img.src = url; img.alt = '';
      box.appendChild(img);
    } else {
      box.appendChild(el('span', 'wr-avatar-ini', initialsOf(name)));
    }
    return box;
  }

  /* 화자 카드 — 아바타(좌) + 이름·본문(우). 교수 글도 같은 형식으로 낸다. */
  function postCard(name, text, src, textCls) {
    var card = el('div', 'wr-post');
    card.appendChild(avatarOf(name, src));
    var body = el('div', 'wr-post-body');
    body.appendChild(el('div', 'wr-post-name' + (textCls ? ' wr-disc-prof' : ''), name || ''));
    body.appendChild(el('p', 'wr-post-text' + (textCls ? ' ' + textCls : ''), text || ''));
    card.appendChild(body);
    return card;
  }

  /* 'Professor Gupta – Education' → 'education' (과목명). 지시문 첫 문장에 쓴다. */
  function topicOf(q) {
    if (q.topic) return String(q.topic);
    var m = String(q.professor || '').split(/[–—-]/);
    if (m.length > 1) return m[m.length - 1].replace(/^\s+|\s+$/g, '').toLowerCase();
    return '';
  }

  /* 화면 상단 지시문 — 최종수정사항.docx Writing Task 3 캡처와 같은 3단 구성:
     "Your professor is teaching a class on X…" / "In your response, you should do the following." +
     불릿 / "An effective response will contain at least N words." */
  function discussionIntro(q) {
    var box = el('div', 'wr-intro');
    var topic = topicOf(q);
    var lead = q.instruction || ('Your professor is teaching a class' + (topic ? ' on ' + topic : '') +
      '. Write a post responding to the professor\'s question.');
    box.appendChild(bi('p', lead,
      '교수님이' + (topic ? ' ' + topic + ' ' : ' ') + '수업을 진행합니다. 교수님의 질문에 답하는 글을 쓰세요.',
      'wr-intro-lead'));

    box.appendChild(bi('p', 'In your response, you should do the following.',
      '답안에는 다음 내용이 들어가야 합니다.', 'wr-intro-label'));

    var list = (q.bullets instanceof Array && q.bullets.length) ? q.bullets : [
      'Express and support your opinion.',
      'Make a contribution to the discussion in your own words.'
    ];
    var ul = el('ul', 'wr-bullets-list');
    for (var i = 0; i < list.length; i++) ul.appendChild(el('li', null, list[i]));
    box.appendChild(ul);

    var min = typeof q.minWords === 'number' ? q.minWords : 0;
    if (min) {
      box.appendChild(bi('p', 'An effective response will contain at least ' + min + ' words.',
        '좋은 답안은 최소 ' + min + '단어 이상입니다.', 'wr-intro-min'));
    }
    return box;
  }

  function discussionBox(q) {
    var box = el('div', 'wr-disc');
    if (q.professor || q.prompt) {
      box.appendChild(postCard(q.professor || 'Professor', q.prompt || '',
        q.professorImage || q.image, 'wr-disc-prompt'));
    }
    var posts = (q.posts instanceof Array) ? q.posts : [];
    for (var i = 0; i < posts.length; i++) {
      box.appendChild(postCard(posts[i].name || '', posts[i].text || '', posts[i].image));
    }
    return box;
  }

  /* ── 작성창 툴바 (Cut / Paste / Undo / Redo · 단어수 표시 토글) ─────────── */

  /* 브라우저 편집 명령. textarea 에 포커스를 준 뒤 실행해야 한다. */
  function execOn(ta, cmd) {
    try {
      ta.focus();
      if (doc.execCommand) return doc.execCommand(cmd, false, null);
    } catch (e) { warn(cmd + ' failed', e); }
    return false;
  }

  /* execCommand('paste') 는 대부분의 브라우저에서 막혀 있다. 비동기 클립보드로 폴백한다. */
  function pasteInto(ta, after) {
    if (execOn(ta, 'paste')) { after(); return; }
    var nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.readText === 'function') {
      try {
        nav.clipboard.readText().then(function (txt) {
          if (typeof txt !== 'string' || !txt) return;
          var s = ta.selectionStart, e = ta.selectionEnd;
          if (typeof s !== 'number') { ta.value += txt; }
          else {
            ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
            ta.selectionStart = ta.selectionEnd = s + txt.length;
          }
          ta.focus();
          after();
        })['catch'](function () {});
        return;
      } catch (e2) { warn('clipboard paste failed', e2); }
    }
  }

  function toolButton(label, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'wr-tool';
    b.textContent = label;
    on(b, 'click', function (e) { if (e && e.preventDefault) e.preventDefault(); onClick(); });
    /* mousedown 기본동작(포커스 이동)을 막아 textarea 선택이 풀리지 않게 한다 — Cut 이 대상 없이 도는 것 방지. */
    on(b, 'mousedown', function (e) { if (e && e.preventDefault) e.preventDefault(); });
    return b;
  }

  /* 반환: { node, count, setLocked } — count 는 단어수를 다시 칠하는 함수. */
  function editorToolbar(ta, minWords, onEdit) {
    var bar = el('div', 'wr-tools');
    var left = el('div', 'wr-tools-left');
    var right = el('div', 'wr-tools-right');
    bar.appendChild(left); bar.appendChild(right);

    var btns = [
      toolButton('Cut', function () { execOn(ta, 'cut'); onEdit(); }),
      toolButton('Paste', function () { pasteInto(ta, onEdit); }),
      toolButton('Undo', function () { execOn(ta, 'undo'); onEdit(); }),
      toolButton('Redo', function () { execOn(ta, 'redo'); onEdit(); })
    ];
    for (var i = 0; i < btns.length; i++) left.appendChild(btns[i]);

    var count = el('span', 'wr-count');
    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wr-count-toggle';
    var hidden = false;

    function paintToggle() {
      toggle.textContent = (hidden ? '⊘ Show Word Count' : '⊘ Hide Word Count');
      count.style.visibility = hidden ? 'hidden' : '';
      toggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    }
    on(toggle, 'click', function () { hidden = !hidden; paintToggle(); });
    paintToggle();

    right.appendChild(toggle);
    right.appendChild(count);

    function paintCount() {
      var w = wordCount(ta.value);
      count.textContent = w + (w === 1 ? ' word' : ' words');
      count.className = 'wr-count' + (minWords && w < minWords ? ' wr-count--warn' : '');
      return w;
    }

    function setLocked(locked) {
      for (var j = 0; j < btns.length; j++) btns[j].disabled = !!locked;
    }

    return { node: bar, count: paintCount, setLocked: setLocked, isHidden: function () { return hidden; } };
  }

  function renderFreeWrite(screen, ctx, foundList) {
    var wrap = el('div', 'wr-screen wr-free');
    var locked = false;
    var editors = [];

    for (var n = 0; n < foundList.length; n++) {
      (function (found) {
        var q = found.question;
        var isEmail = q.kind === 'email';
        var card = el('section', 'wr-task');

        card.appendChild(isEmail
          ? bi('h2', 'Write an Email', '이메일 작성하기', 'wr-heading')
          : bi('h2', 'Write for an Academic Discussion', '학술 토론 작성하기', 'wr-heading'));

        /* 2단 배치 — 과제는 왼쪽, 작성창은 오른쪽(최종수정사항.docx Writing Task 2·3:
         * "task should be on the left side and writing response should be on the right side").
         * 좁은 화면에서는 CSS 가 1단으로 접는다. */
        var cols = el('div', 'wr-cols');
        var pane = el('div', 'wr-pane wr-pane-task');
        var answer = el('div', 'wr-pane wr-pane-answer');
        cols.appendChild(pane);
        cols.appendChild(answer);
        card.appendChild(cols);

        var bar = el('div', 'wr-bar');
        var tts = readAloudButton(q);
        if (tts) bar.appendChild(tts);
        if (bar.firstChild) pane.appendChild(bar);

        if (isEmail) {
          pane.appendChild(situationBox(q));
          var bl = bulletsBox(q);
          if (bl) pane.appendChild(bl);
        } else {
          pane.appendChild(discussionIntro(q));
          pane.appendChild(discussionBox(q));
        }

        var minWords = typeof q.minWords === 'number' ? q.minWords : 0;
        var ta = doc.createElement('textarea');
        ta.className = 'wr-textarea';
        ta.setAttribute('rows', '12');
        ta.setAttribute('spellcheck', 'false');
        ta.placeholder = isEmail ? 'Type your email here…' : 'Type your response here…';

        /* 응답 패널 머리 — 스크린샷 규격: "Your Response:" 아래에 To/Subject 가 오고
           그 다음 줄이 편집 툴바다. 이메일 과제에서만 To/Subject 를 보여준다. */
        answer.appendChild(bi('h3', 'Your Response:', '작성란', 'wr-resp-head'));
        if (isEmail) answer.appendChild(emailHeader(q));

        /* 툴바(Cut/Paste/Undo/Redo · 단어수)는 작성창 위. 편집 버튼이 값을 바꾸면
           input 이벤트가 안 오는 브라우저가 있어 schedule() 을 직접 부른다. */
        var tools = editorToolbar(ta, minWords, function () { schedule(); });
        answer.appendChild(tools.node);

        var prev = savedAnswer(q.id);
        ta.value = (prev && typeof prev.v === 'string') ? prev.v : '';
        answer.appendChild(ta);

        var foot = el('div', 'wr-foot');
        var min = el('span', 'wr-min');
        min.appendChild(bi('span', 'minimum ' + minWords + ' words', '최소 ' + minWords + '단어', null));
        foot.appendChild(min);
        answer.appendChild(foot);

        var timer = null;

        function paintCount() { return tools.count(); }

        function commit() {
          var w = wordCount(ta.value);
          saveAnswer(ctx, q.id, ta.value, { words: w, minWords: minWords, kind: q.kind || 'free' });
        }

        // AC7 — 매 키스트로크가 아니라 500ms 디바운스로 저장한다(§5.3 텍스트 입력 폭주 방지).
        function schedule() {
          paintCount();
          if (timer !== null) root.clearTimeout(timer);
          timer = root.setTimeout(function () { timer = null; commit(); }, TEXT_DEBOUNCE_MS);
        }

        on(ta, 'input', schedule);
        on(ta, 'keyup', schedule);         // IE/구형 사파리 폴백
        on(ta, 'blur', function () {
          if (timer !== null) { root.clearTimeout(timer); timer = null; }
          commit(); flushAnswers();
        });

        paintCount();

        teardowns.push(function () {
          if (timer !== null) { root.clearTimeout(timer); timer = null; }
          commit(); flushAnswers();
        });

        editors.push({ textarea: ta, commit: commit, count: paintCount, tools: tools, question: q, minWords: minWords });
        wrap.appendChild(card);
      })(foundList[n]);
    }

    var lockNote = bi('p', 'Time is up for this task. Your response has been kept as it is.',
      '이 과제의 시간이 종료되었습니다. 작성한 내용이 그대로 제출 대상으로 남습니다.', 'wr-locked-note');
    lockNote.style.display = 'none';
    wrap.appendChild(lockNote);

    watchExpiry(wrap, screen, ctx, function (expired) {
      if (expired === locked) return;
      locked = expired;
      lockNote.style.display = locked ? '' : 'none';
      wrap.className = 'wr-screen wr-free' + (locked ? ' is-locked' : '');
      for (var i = 0; i < editors.length; i++) {
        // 만료 시 입력만 잠그고 내용은 남긴다 — 현재 값이 그대로 제출 대상이다.
        if (locked) { editors[i].commit(); }
        if (editors[i].tools) editors[i].tools.setLocked(locked);
        editors[i].textarea.readOnly = !!locked;
        editors[i].textarea.setAttribute('aria-readonly', locked ? 'true' : 'false');
      }
      if (locked) flushAnswers();
    });

    wrap.__sg = {
      editors: editors,
      words: function (i) { return wordCount(editors[i || 0].textarea.value); },
      locked: function () { return locked; }
    };
    return wrap;
  }

  /* ── 진입점 ────────────────────────────────────────────────────────────── */

  function handles(screen) {
    return !!(screen && screen.section === 'writing' && MINE[screen.blockKind]);
  }

  function renderScreen(screen, ctx) {
    if (!doc || !handles(screen)) return null;
    disposeAll();
    var set = contentOf(ctx);
    var ids = (screen.questionIds instanceof Array) ? screen.questionIds : [];
    var found = [], i, f;
    for (i = 0; i < ids.length; i++) {
      f = findQuestion(set, ids[i]);
      if (f) found.push(f);
    }
    if (!found.length) { warn('no content found for ' + screen.id); return null; }
    if (screen.blockKind === 'build-set') return renderBuildSet(screen, ctx || {}, found[0]);
    return renderFreeWrite(screen, ctx || {}, found);
  }

  /* SG_RENDER.render() 를 감싸 내 화면만 가로챈다. exam-render.js 는 수정하지 않는다.
     다른 screenType/blockKind 는 원래 dispatcher 로 그대로 흘려보낸다. */
  function install() {
    var R = root.SG_RENDER;
    if (!R || typeof R.render !== 'function') return false;
    if (!R.has('question')) R.register('question', renderScreen);
    if (R.__sgWritingHook) return true;
    var orig = R.render;
    R.render = function (screen, ctx) {
      if (handles(screen)) {
        var m = (typeof R.mount === 'function') ? R.mount() : null;
        if (m) {
          R.clear();
          var node = null;
          try { node = renderScreen(screen, ctx || {}); } catch (e) { warn('renderScreen failed', e); node = null; }
          if (!node) node = R.placeholder(screen);
          m.appendChild(node);
          m.setAttribute('data-screen-type', screen.screenType || '');
          m.setAttribute('data-screen-id', screen.id || '');
          return node;
        }
      }
      return orig.call(R, screen, ctx);
    };
    R.__sgWritingHook = true;
    return true;
  }

  root.SG_WRITING = {
    MINE: MINE,
    TEXT_DEBOUNCE_MS: TEXT_DEBOUNCE_MS,
    // 순수
    slug: slug, wordCount: wordCount, blankIndexes: blankIndexes, tokensOf: tokensOf,
    sentenceOf: sentenceOf, isComplete: isComplete, findQuestion: findQuestion,
    promptTextOf: promptTextOf, ttsIdFor: ttsIdFor, restorePlaced: restorePlaced,
    // 렌더
    handles: handles, renderScreen: renderScreen, install: install, dispose: disposeAll
  };

  install();
})(typeof window !== 'undefined' ? window : this);
