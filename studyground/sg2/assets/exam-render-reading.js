/* SMEAG · StudyGround — exam-render-reading.js
 * 목적: Reading 화면(screenType 'question' · section 'reading') 렌더러.
 *       block.kind 4종을 그린다 — cloze / passage / chat, 그리고 passage 안의 insert 문항.
 * 의존 전역: window.SG_RENDER (필수), window.SMEAG_SET1(콘텐츠 원본),
 *            window.SG_STORE(답안 복원), window.SG_EXAM 머신은 ctx.engine 으로 받는다,
 *            window.SG_TTS(선택 — Read aloud), window.SG_CLOCK(읽기 전용, 타이머는 엔진이 arm 한다)
 * 노출 전역: window.SG_RENDER_READING (테스트/셀프테스트용 순수 헬퍼 + render)
 *
 * 왜 이렇게 붙이는가 (렌더 디스패처 우회 없이 공존하기):
 *   SG_RENDER 의 registry 는 screenType 하나당 함수 하나다. 그런데 listening/reading/writing
 *   화면은 모두 screenType==='question' 이라 각 섹션 렌더러가 register('question', ...) 를
 *   그대로 부르면 나중에 로드된 파일이 앞선 파일을 덮어쓴다(exam-runtime.html 의 로드 순서상
 *   reading 은 listening 뒤, writing 앞이다). registry 에서 기존 함수를 되읽는 API 가 없으므로
 *   덮어쓰기는 복구 불가능하다.
 *   그래서 이 파일은
 *     1) 자기 렌더러를 전용 별칭 screenType('reading-question')으로만 register 하고,
 *     2) SG_RENDER.render 를 한 겹 감싸서 reading 화면일 때만 별칭으로 위임한다.
 *   마운트/clear/폴백 로직은 감싼 원본 render 가 그대로 수행하므로 exam-render.js 는 손대지 않고,
 *   다른 섹션의 register('question') 도 아무 영향을 받지 않는다.
 *   (Story 2.7 이 exam-render.js 에 정식 섹션 디스패처를 넣으면 이 래퍼는 제거해도 된다.)
 *
 * 타이머: Reading 은 module 단위 sharedDeadline 이다. clock key 는 exam-engine.js 의
 *   clockKeyFor() 가 'module:{moduleId}'(예 module:R1)로 만들고, releaseScreenClocks() 는
 *   question/screen scope 만 지우므로 같은 모듈 화면을 오가도 deadline 이 유지된다.
 *   따라서 이 렌더러는 시계를 만들지도 arm 하지도 않는다(직접 setInterval 금지).
 */
(function (root) {
  'use strict';

  var doc = root.document || null;
  var ALIAS = 'reading-question';   // 별칭 screenType — 위 주석의 공존 전략
  var MARKERS = ['A', 'B', 'C', 'D'];

  /* 한 화면에 실린 문항을 한 개씩만 보여 준다(passage/chat).
     화면열은 그대로다 — 지문 한 편이 화면 하나라는 컴파일 결과를 바꾸지 않고,
     그 안에서 문항 카드를 하나만 펴고 나머지는 감춘다. 마지막 문항에서 Next 를
     누르면 그때 화면이 넘어가므로 "한 지문이 끝나면 다음 지문" 이 된다.
     셸(exam-shell.js)의 Next/Back 은 아래 SG_SCREEN_NAV 를 먼저 물어본다.
     화면 id 를 함께 실어 두는 이유: 다른 섹션 렌더러는 이 전역을 지우지 않으므로
     셸이 "지금 화면의 것인가"를 스스로 확인할 수 있어야 한다. */
  function setNav(nav) { root.SG_SCREEN_NAV = nav || null; }

  function syncShellNav() {
    var R = root.SG_RUNTIME;
    if (R && typeof R.syncNav === 'function') { try { R.syncNav(); } catch (e) {} }
  }

  /* ── 순수 헬퍼 (node 에서 그대로 검증 가능 — F9) ─────────── */

  // 지문 텍스트는 블록마다 필드가 다르다(passage / paragraphs / messages). exam.html 의
  // passageText() 를 그대로 계승한다 — TTS 에 넘길 평문을 만드는 유일한 경로.
  function passageText(blk) {
    if (!blk) return '';
    if (blk.passage) return blk.passage;
    if (blk.paragraphs) return blk.paragraphs.join('\n\n');
    if (blk.messages) {
      return blk.messages.map(function (m) {
        return (m.from || m.sender || m.name || '') + ': ' + (m.text || m);
      }).join('\n');
    }
    return '';
  }

  // exam.html 과 같은 slug 규칙 — media/tts/index.json 의 기존 id('read-R1-roman-roads')를 그대로 맞춘다.
  function slug(s) { return String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }

  function ttsIdOf(moduleId, blk) { return 'read-' + moduleId + '-' + slug(blk && (blk.title || blk.heading)); }

  // '{{1}}' / '{{A}}' 를 토큰으로 끊는다. 반환: [{text:'..'} | {token:'1'}]
  function splitTokens(text, re) {
    var out = [], parts = String(text || '').split(re), i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === undefined || parts[i] === '') continue;
      // split 은 캡처그룹을 홀수 인덱스로 돌려준다.
      if (i % 2 === 1) out.push({ token: parts[i] });
      else out.push({ text: parts[i] });
    }
    return out;
  }

  function clozeTokens(template) { return splitTokens(template, /\{\{(\d+)\}\}/); }
  function markerTokens(paragraph) { return splitTokens(paragraph, /\{\{([A-D])\}\}/); }

  /* ── cloze 어간/밑줄 계산 ─────────────────────────────────
     관찰(docs/reference/screens/reading-cloze-2760s.png): 빈칸은 빈 입력상자가 아니라
     '어간 + 빠진 글자 수만큼의 밑줄' 이다 — fo__ a__ she____ con____ sunl____ prov_____.
     콘텐츠 팩은 이미 필요한 정보를 다 갖고 있다: question.hint 가 어간, question.answer 가 정답.
     따라서 별도 파싱 없이 need = answer.length - hint.length 로 밑줄 개수가 나온다.
     hint 가 answer 의 접두사가 아니거나 answer 가 없으면 글자 수를 알 수 없으므로
     자유 입력(FREE_WIDTH)으로 떨어진다 — 콘텐츠가 어긋나도 시험은 멈추지 않는다(F12). */

  var FREE_WIDTH = 10;

  /* 빈칸은 영어 단어만 받는다. 그런데 한글을 그냥 버리면 자판이 한글인 학생에게는
     "아무것도 안 써지는 칸" 이 된다 — 친 대로 지워지니 고장으로 보인다.
     그래서 버리는 대신 두벌식 자판을 되돌린다: 'ㅁㅏ'(마)는 a·k 를 누른 결과이므로 'ak' 로 편다.
     학생이 친 자판 그대로 영문이 들어가므로, 한글 상태인 줄 모르고 쳐도 시험은 이어진다.
     (IME 조합 중에는 손대지 않고 compositionend 에서 한 번에 편다 — 조합이 깨지지 않게.) */
  var HG_CHO = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
  var HG_JUNG = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
  var HG_JONG = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
  // 낱자만 남은 조합(ㅡㅁ 처럼 초성이 없는 경우) — 호환 자모 U+3131~U+3163.
  var HG_JAMO = ['r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g',
                'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
  var NON_ASCII = /[^\x20-\x7E]/g;

  function hangulKeys(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) {           // 완성형 한 글자 → 초성·중성·종성 순서로 편다
      var i = c - 0xAC00;
      return HG_CHO[Math.floor(i / 588)] + HG_JUNG[Math.floor((i % 588) / 28)] + HG_JONG[i % 28];
    }
    if (c >= 0x3131 && c <= 0x3163) return HG_JAMO[c - 0x3131] || '';
    return '';
  }

  function asciiOnly(s) {
    if (s === null || s === undefined) return '';
    var src = String(s), out = '', i, ch;
    for (i = 0; i < src.length; i++) {
      ch = src.charAt(i);
      out += (ch >= ' ' && ch <= '~') ? ch : hangulKeys(ch);
    }
    return out.replace(NON_ASCII, '');
  }

  function stemOf(q) { return (q && q.hint) ? String(q.hint) : ''; }

  // 빠진 글자 수. 0 = 알 수 없음(자유 입력).
  function missingCount(q) {
    var ans = (q && q.answer) ? String(q.answer) : '';
    var hint = stemOf(q);
    if (!ans) return 0;
    if (ans.toLowerCase().indexOf(hint.toLowerCase()) !== 0) return 0;
    var n = ans.length - hint.length;
    return n > 0 ? n : 0;
  }

  // 밑줄 레일 — 이미 친 글자는 공백으로 자리만 비워 두고 남은 칸만 '_' 로 그린다.
  // 입력칸과 같은 등폭 글꼴에 white-space:pre 라 오프셋 계산 없이 정렬된다.
  function railText(width, typedLen) {
    var s = '', i;
    var n = width > 0 ? width : 0;
    var t = typedLen > 0 ? (typedLen > n ? n : typedLen) : 0;
    for (i = 0; i < t; i++) s += ' ';
    for (i = t; i < n; i++) s += '_';
    return s;
  }

  // 저장 정본은 '어간 + 입력' 인 완성 단어다(autoscore 의 CLOZE/WORD_FILLING 는 정답 텍스트 비교).
  // 아무것도 안 쳤으면 어간만 남기지 않고 빈 문자열로 둔다 — 미응답이 응답으로 둔갑하면 안 된다.
  function composeAnswer(q, typed) {
    var t = typed === undefined || typed === null ? '' : String(typed);
    if (!t) return '';
    return stemOf(q) + t;
  }

  // 저장된 완성 단어 → 입력칸에 되돌릴 '빠진 글자' 부분.
  function typedFrom(q, saved) {
    var v = (saved === null || saved === undefined) ? '' : String(saved);
    if (!v) return '';
    var hint = stemOf(q);
    if (hint && v.toLowerCase().indexOf(hint.toLowerCase()) === 0) return v.slice(hint.length);
    return v;
  }

  function hasMarkers(blk) {
    var ps = (blk && blk.paragraphs) || [], i;
    for (i = 0; i < ps.length; i++) { if (/\{\{[A-D]\}\}/.test(ps[i])) return true; }
    return false;
  }

  // 화면이 담은 문항 id 만 골라낸다(컴파일러는 블록 1개=화면 1개지만 계약상 부분집합도 허용).
  function questionsOf(blk, ids) {
    var qs = (blk && blk.questions) || [], out = [], i, j;
    if (!ids || !ids.length) return qs.slice(0);
    for (i = 0; i < qs.length; i++) {
      for (j = 0; j < ids.length; j++) { if (qs[i].id === ids[j]) { out.push(qs[i]); break; } }
    }
    return out;
  }

  // 컴파일된 화면에는 문항 id 만 있다. 원본 블록은 콘텐츠 팩에서 되찾는다.
  function blockOf(screen, set) {
    var pack = set || root.SG_CONTENT_PACK || root.SMEAG_SET1;
    var ids = (screen && screen.questionIds) || [];
    if (!pack || !ids.length || typeof pack.findQuestion !== 'function') return null;
    var hit = pack.findQuestion(ids[0]);
    return hit ? hit.block : null;
  }

  function insertQuestionOf(blk, qs) {
    var list = qs || (blk && blk.questions) || [], i;
    for (i = 0; i < list.length; i++) { if (list[i].kind === 'insert') return list[i]; }
    return null;
  }

  /* ── 답안 I/O — localStorage 직접 접근 금지 ──────────────── */

  // 정본은 엔진(ctx.engine.answer) 이다. 엔진 없이 렌더만 하는 셀프테스트에서는 store 로 떨어진다.
  function saveAnswer(ctx, qid, value) {
    var eng = ctx && ctx.engine;
    if (eng && typeof eng.answer === 'function') {
      try { eng.answer(qid, value); return true; } catch (e) { warn('answer rejected for ' + qid, e); }
    }
    var S = root.SG_STORE;
    if (S && typeof S.upsertAnswer === 'function') { S.upsertAnswer(qid, value); return true; }
    return false;
  }

  function savedAnswer(qid) {
    var S = root.SG_STORE;
    if (!S || typeof S.getAnswer !== 'function') return null;
    var rec = null;
    try { rec = S.getAnswer(qid); } catch (e) { rec = null; }
    return rec && rec.v !== undefined ? rec.v : null;
  }

  function warn(msg, e) { if (root.console && root.console.warn) root.console.warn('[SG_READING] ' + msg, e || ''); }

  /* ── DOM 유틸 ────────────────────────────────────────────── */

  function el(tag, cls) { var e = doc.createElement(tag); if (cls) e.className = cls; return e; }

  function textEl(tag, cls, txt) { var e = el(tag, cls); e.textContent = txt === undefined ? '' : txt; return e; }

  function bi(tag, en, ko) {
    if (root.SG_RENDER && typeof root.SG_RENDER.bilingual === 'function') return root.SG_RENDER.bilingual(tag, en, ko);
    return textEl(tag || 'p', null, en);
  }

  /* Read aloud — 번들 mp3(media/tts/*.mp3) 우선, 없으면 브라우저 음성. SG_TTS 미로드면 버튼 자체를 만들지 않는다. */
  function readAloudBtn(ttsId, text) {
    if (!root.SG_TTS || !text) return null;
    var b = el('button', 'btn ghost sm');
    b.type = 'button';
    b.appendChild(doc.createTextNode('🔊 '));
    b.appendChild(bi('span', 'Read aloud', '읽어주기'));
    b.onclick = function () {
      try {
        if (b.getAttribute('data-state') === 'playing') { root.SG_TTS.stop(); b.setAttribute('data-state', ''); return; }
        root.SG_TTS.speak(ttsId, text, b);
      } catch (e) { warn('tts failed', e); }
    };
    return b;
  }

  /* ── 블록별 렌더 ─────────────────────────────────────────── */

  /* cloze — 관찰 화면(reading-cloze-2760s.png)의 "Fill in the missing letters in the paragraph."
     template 의 {{n}} 자리에 [어간][밑줄] 을 인라인으로 그린다. 어간은 본문 글꼴로 그대로 보이고,
     빠진 글자 수만큼의 밑줄 위에 등폭 입력칸이 겹쳐 있다. 한 칸을 다 채우면 다음 칸으로 자동 이동,
     화살표/Backspace 로도 칸 사이를 오간다. 시계는 만들지 않는다(모듈 sharedDeadline — 파일 상단 주석). */
  function focusBlank(api, i, toEnd) {
    var b = api.blanks[i];
    if (!b || !b.input) return false;
    if (typeof b.input.focus === 'function') { try { b.input.focus(); } catch (e) {} }
    var n = (b.input.value || '').length;
    var at = toEnd ? n : 0;
    if (typeof b.input.setSelectionRange === 'function') {
      try { b.input.setSelectionRange(at, at); } catch (e2) {}
    }
    return true;
  }

  function syncBlank(b) {
    var typed = b.input.value || '';
    if (!b.composing) {
      var only = asciiOnly(typed);
      if (only !== typed) { typed = only; b.input.value = typed; }
    }
    if (b.need && typed.length > b.need) { typed = typed.slice(0, b.need); b.input.value = typed; }
    b.rail.textContent = railText(b.width, typed.length);
    var cls = 'rd-blank';
    if (typed.length) cls += ' is-filled';
    if (b.need && typed.length >= b.need) cls += ' is-done';
    if (b.focused) cls += ' is-focus';
    b.wrap.className = cls;
    return typed;
  }

  function blankNode(ctx, api, no, q) {
    var wrap = el('span', 'rd-blank');
    wrap.setAttribute('data-blank', String(no));

    var need = missingCount(q);            // 0 = 글자 수 미상 → 자유 입력
    var width = need || FREE_WIDTH;
    var stem = stemOf(q);
    if (stem) wrap.appendChild(textEl('span', 'rd-blank-stem', stem));

    var slot = el('span', 'rd-blank-slot');
    // 자간(--rd-blank-gap)만큼 칸마다 벌어지므로 너비도 글자수 × (1ch + 자간) 이다.
    if (slot.style) slot.style.width = 'calc(' + width + 'ch + ' + width + ' * var(--rd-blank-gap, 0px))';

    var rail = el('span', 'rd-blank-rail');
    rail.setAttribute('aria-hidden', 'true');

    var inp = el('input', 'blank-in rd-blank-in');
    inp.type = 'text';
    inp.value = '';
    inp.setAttribute('data-blank', String(no));
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('spellcheck', 'false');
    inp.setAttribute('lang', 'en');                 // 모바일 자판에 영문을 먼저 권한다
    inp.setAttribute('inputmode', 'text');
    if (inp.style) inp.style.imeMode = 'disabled';  // 구형 파이어폭스/IE 만 알아듣는다
    if (need) inp.maxLength = need;

    slot.appendChild(rail);
    slot.appendChild(inp);
    wrap.appendChild(slot);

    var b = { wrap: wrap, input: inp, rail: rail, need: need, width: width, q: q, focused: false, composing: false, index: api.blanks.length };
    api.blanks.push(b);

    if (!q) {                              // template 과 questions 가 어긋난 경우(F12)
      inp.disabled = true;
      syncBlank(b);
      return wrap;
    }

    inp.id = 'rd-q-' + q.id;
    inp.setAttribute('aria-label', 'Blank ' + no + (need ? (', ' + need + ' letters') : ''));
    inp.value = asciiOnly(typedFrom(q, savedAnswer(q.id)));

    inp.oncompositionstart = function () { b.composing = true; };
    inp.oncompositionend = function () { b.composing = false; if (inp.oninput) inp.oninput(); };
    inp.oninput = function () {
      if (b.composing) return;                      // 조합이 끝나면 compositionend 가 다시 부른다
      var typed = syncBlank(b);
      saveAnswer(ctx, q.id, composeAnswer(q, typed));
      api.refreshGrid();
      // AC: 다 채우면 다음 칸으로 자동 이동
      if (b.need && typed.length >= b.need) focusBlank(api, b.index + 1, false);
    };
    inp.onfocus = function () { b.focused = true; syncBlank(b); };
    inp.onblur = function () { b.focused = false; syncBlank(b); };
    inp.onkeydown = function (ev) {
      var e = ev || root.event;
      if (!e) return;
      var k = e.key || '';
      var code = e.keyCode || 0;
      var val = inp.value || '';
      var caret = (typeof inp.selectionStart === 'number') ? inp.selectionStart : val.length;
      var move = 0, toEnd = false;
      if (k === 'ArrowLeft' || code === 37) { if (caret <= 0) { move = -1; toEnd = true; } }
      else if (k === 'ArrowRight' || code === 39) { if (caret >= val.length) { move = 1; } }
      else if (k === 'ArrowUp' || code === 38) { move = -1; toEnd = true; }
      else if (k === 'ArrowDown' || code === 40 || k === 'Enter' || code === 13) { move = 1; }
      else if (k === 'Backspace' || code === 8) { if (!val.length) { move = -1; toEnd = true; } }
      if (!move) return;
      if (focusBlank(api, b.index + move, toEnd) && e.preventDefault) e.preventDefault();
    };
    syncBlank(b);
    return wrap;
  }

  function renderCloze(screen, ctx, blk, qs, api) {
    var box = el('div', 'rd-cloze');
    var card = el('div', 'rd-card rd-cloze-card');

    var byNo = {}, i;
    for (i = 0; i < qs.length; i++) byNo[String(qs[i].no)] = qs[i];

    var p = el('div', 'rd-cloze-text');
    var toks = clozeTokens(blk.template || '');
    for (i = 0; i < toks.length; i++) {
      if (toks[i].text !== undefined) { p.appendChild(doc.createTextNode(toks[i].text)); continue; }
      p.appendChild(blankNode(ctx, api, toks[i].token, byNo[toks[i].token]));
    }
    card.appendChild(p);
    card.appendChild(el('div', 'rd-cloze-sep'));
    var note = bi('p',
      'Click on a blank to start typing. Focus automatically moves to the next blank when filled. Use arrow keys to navigate.',
      '빈칸을 클릭해 입력하세요. 한 칸이 채워지면 다음 칸으로 자동 이동하며, 화살표 키로도 이동할 수 있습니다.');
    note.className = 'rd-cloze-note';
    card.appendChild(note);

    box.appendChild(card);
    return box;
  }

  /* chat — messages[] 를 말풍선으로. side 는 'left'|'right', 이름/시각을 함께 보여준다. */
  function renderChat(blk) {
    var box = el('div', 'rd-chat');
    var ms = blk.messages || [], i;
    for (i = 0; i < ms.length; i++) {
      var m = ms[i];
      var side = (m.side === 'right') ? 'right' : 'left';
      var row = el('div', 'rd-chat-row ' + side);
      var bub = el('div', 'rd-chat-bubble');
      var who = (m.name || m.from || m.sender || '');
      if (who || m.time) {
        var head = el('div', 'rd-chat-meta');
        if (who) head.appendChild(textEl('b', null, who));
        if (m.time) head.appendChild(textEl('span', 'muted', ' ' + m.time));
        bub.appendChild(head);
      }
      bub.appendChild(textEl('div', 'rd-chat-text', m.text || (typeof m === 'string' ? m : '')));
      row.appendChild(bub);
      box.appendChild(row);
    }
    return box;
  }

  /* passage 본문 — {{A}}~{{D}} 마커는 클릭 가능한 삽입 지점 버튼이 된다(insert 문항 있을 때만).
     선택 시 sentence 를 그 자리에 미리보기로 넣는다. 라디오와의 동기화는 api.setInsert 가 맡는다. */
  function renderPassageBody(blk, insertQ, api) {
    var box = el('div', 'rd-passage-body');
    if (blk.title) box.appendChild(textEl('h3', 'rd-passage-title', blk.title));
    var ps = blk.paragraphs || (blk.passage ? [blk.passage] : []), i, j;
    for (i = 0; i < ps.length; i++) {
      var para = el('p', 'rd-para');
      var toks = insertQ ? markerTokens(ps[i]) : [{ text: ps[i] }];
      for (j = 0; j < toks.length; j++) {
        if (toks[j].text !== undefined) { para.appendChild(doc.createTextNode(toks[j].text)); continue; }
        var letter = toks[j].token;
        var idx = -1, k;
        for (k = 0; k < MARKERS.length; k++) { if (MARKERS[k] === letter) idx = k; }
        var mk = el('button', 'rd-marker');
        mk.type = 'button';
        mk.setAttribute('data-marker', letter);
        mk.title = 'Insert the sentence here';
        mk.appendChild(textEl('span', 'rd-marker-dot', '■'));
        var prev = el('span', 'rd-marker-preview');
        prev.textContent = '';
        mk.appendChild(prev);
        (function (position) {
          mk.onclick = function () { api.setInsert(position, true); };
        })(idx);
        api.markers[letter] = mk;
        para.appendChild(mk);
      }
      box.appendChild(para);
    }
    return box;
  }

  /* 문항 카드 1개. mcq/insert 모두 라디오 4지선다이며 값은 선택지 index(숫자)로 저장한다. */
  function questionCard(screen, ctx, q, api) {
    var card = el('div', 'qcard rd-q');
    card.id = 'rd-card-' + q.id;
    card.setAttribute('data-qid', q.id);
    card.appendChild(textEl('div', 'qh', 'Question ' + (q.no === undefined ? '' : q.no)));
    if (q.prompt) card.appendChild(textEl('div', 'prompt', q.prompt));
    if (q.sentence) card.appendChild(textEl('div', 'passage rd-insert-sentence', q.sentence));

    var choices = q.choices || [], i;
    var saved = savedAnswer(q.id);
    for (i = 0; i < choices.length; i++) {
      var lab = el('label', 'opt');
      lab.setAttribute('data-q', q.id);
      lab.setAttribute('data-idx', String(i));
      var radio = el('input');
      radio.type = 'radio';
      radio.name = q.id;
      radio.value = String(i);
      if (saved !== null && String(saved) === String(i)) { radio.checked = true; lab.className = 'opt is-chosen'; }
      (function (index, input) {
        input.onchange = function () {
          if (!input.checked) return;
          if (q.kind === 'insert') { api.setInsert(index, false); return; }
          saveAnswer(ctx, q.id, index);
          api.paintChoice(q.id, index);
          api.refreshGrid();
        };
      })(i, radio);
      lab.appendChild(radio);
      lab.appendChild(textEl('span', null, choices[i]));
      card.appendChild(lab);
      if (!api.radios[q.id]) api.radios[q.id] = [];
      api.radios[q.id].push(radio);
    }
    if (!choices.length) card.appendChild(bi('p', 'This question has no choices in the content pack.', '콘텐츠에 선택지가 없습니다.'));
    return card;
  }

  /* ── 화면 조립 ───────────────────────────────────────────── */

  function render(screen, ctx) {
    if (!doc) return null;
    ctx = ctx || {};
    setNav(null);                      // 이 화면에서 다시 채운다(passage/chat 만)
    var wrap = el('div', 'rd-screen');
    var blk = blockOf(screen);
    var kind0 = (screen && screen.blockKind) || (blk && blk.kind) || '';

    /* 화면 제목 — 관찰 화면은 중앙 상단에 큰 한 줄뿐이다. 진행 표시("Questions 1-10 of 35")와
       타이머는 셸의 서브바가 그리므로 여기서 되풀이하지 않는다(중복 표기 제거). */
    var titleEn = kind0 === 'cloze'
      ? 'Fill in the missing letters in the paragraph.'
      : ((blk && blk.instruction) || (blk && blk.heading) || '');
    var titleKo = kind0 === 'cloze' ? '문단에서 빠진 글자를 채우세요.' : titleEn;
    if (titleEn) {
      var h = bi('h1', titleEn, titleKo);
      h.className = 'rd-title';
      wrap.appendChild(h);
    }

    if (!blk) {
      wrap.appendChild(bi('p', 'Reading content is unavailable offline for this screen.',
        '이 화면의 리딩 콘텐츠를 불러오지 못했습니다.'));
      return wrap;
    }

    var qs = questionsOf(blk, screen && screen.questionIds);
    var insertQ = insertQuestionOf(blk, qs);

    // 렌더 지역 상태 — 마커/라디오/그리드가 서로를 갱신한다.
    var cards = {};                    // qid → 문항 카드(한 개만 펴 둔다)
    var cur = 0;                       // 지금 보이는 문항의 인덱스
    var api = {
      markers: {}, radios: {}, gridBtns: {}, blanks: [], qs: qs,
      // 문항 하나만 펴고 나머지는 감춘다. 그리드의 현재 표시와 셸 버튼도 함께 맞춘다.
      showQuestion: function (i) {
        if (i < 0 || i >= qs.length) return false;
        cur = i;
        var j, card;
        for (j = 0; j < qs.length; j++) {
          card = cards[qs[j].id];
          if (card) card.hidden = (j !== i);
        }
        api.refreshGrid();
        syncShellNav();
        return true;
      },
      indexOfQuestion: function (qid) {
        for (var j = 0; j < qs.length; j++) { if (qs[j].id === qid) return j; }
        return -1;
      },
      paintChoice: function (qid, index) {
        var labs = wrap.querySelectorAll('label[data-q="' + qid + '"]'), i;
        for (i = 0; i < labs.length; i++) {
          labs[i].className = (String(i) === String(index)) ? 'opt is-chosen' : 'opt';
        }
      },
      refreshGrid: function () {
        var i, q, btn;
        for (i = 0; i < qs.length; i++) {
          q = qs[i]; btn = api.gridBtns[q.id];
          if (!btn) continue;
          var v = savedAnswer(q.id);
          var done = v !== null && v !== undefined && String(v) !== '';
          var cls = done ? 'answered' : '';
          if (i === cur) cls = cls ? cls + ' current' : 'current';
          btn.className = cls;
        }
      },
      // insert 답안 단일 진입점 — 마커 클릭과 라디오가 양방향으로 같은 상태를 쓴다(AC4).
      setInsert: function (position, fromMarker) {
        if (!insertQ) return;
        saveAnswer(ctx, insertQ.id, position);
        var rs = api.radios[insertQ.id] || [], i;
        for (i = 0; i < rs.length; i++) rs[i].checked = (i === position);
        api.paintChoice(insertQ.id, position);
        for (i = 0; i < MARKERS.length; i++) {
          var mk = api.markers[MARKERS[i]];
          if (!mk) continue;
          var on = (i === position);
          mk.className = on ? 'rd-marker is-chosen' : 'rd-marker';
          var pv = mk.querySelector('.rd-marker-preview');
          if (pv) pv.textContent = on ? (' ' + (insertQ.sentence || '')) : '';
        }
        api.refreshGrid();
        if (fromMarker) {
          // 지문의 마커를 눌렀는데 다른 문항이 펴져 있을 수 있다 — 그 문항으로 옮겨 준다.
          var at = api.indexOfQuestion(insertQ.id);
          if (at >= 0 && at !== cur) api.showQuestion(at);
          var card = doc.getElementById('rd-card-' + insertQ.id);
          if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'nearest' }); } catch (e) { card.scrollIntoView(); } }
        }
      }
    };

    var kind = kind0 || blk.kind;

    /* cloze 는 그리드 내비게이션을 두지 않는다 — 관찰 화면에는 카드 아래에 아무것도 없고,
       빈칸이 지문 안에 인라인으로 있으므로 자동 이동·화살표 이동이 그 역할을 대신한다. */
    if (kind === 'cloze') {
      wrap.appendChild(renderCloze(screen, ctx, blk, qs, api));
      api.refreshGrid();
      return wrap;
    }

    // passage / chat 공통 2단 레이아웃. 좌: 지문(자체 스크롤), 우: 문항 목록.
    var cols = el('div', 'rd-cols');
    var left = el('div', 'rd-left');
    var bar = el('div', 'rd-toolbar');
    var text = passageText(blk);
    var btn = readAloudBtn(ttsIdOf(screen && screen.moduleId ? screen.moduleId : 'R', blk), text);
    if (btn) bar.appendChild(btn);
    if (bar.firstChild) left.appendChild(bar);

    var scroller = el('div', 'rd-scroll');
    scroller.appendChild(kind === 'chat' ? renderChat(blk) : renderPassageBody(blk, insertQ, api));
    left.appendChild(scroller);

    var right = el('div', 'rd-right');
    right.appendChild(gridNav(qs, api));
    var i, card;
    for (i = 0; i < qs.length; i++) {
      card = questionCard(screen, ctx, qs[i], api);
      cards[qs[i].id] = card;
      card.hidden = (i !== 0);         // 첫 문항만 펴 둔다
      right.appendChild(card);
    }

    cols.appendChild(left);
    cols.appendChild(right);
    wrap.appendChild(cols);

    // 저장된 insert 답안 복원(마커 하이라이트 + 미리보기까지 되살린다).
    if (insertQ) {
      var prev = savedAnswer(insertQ.id);
      if (prev !== null && prev !== undefined && prev !== '') api.setInsert(parseInt(prev, 10), false);
    }
    api.refreshGrid();

    /* 셸의 Next/Back 이 화면을 넘기기 전에 이 화면 안의 문항을 먼저 넘긴다.
       마지막 문항에서 next() 가 false 를 돌려주면 셸이 다음 화면(=다음 지문)으로 간다. */
    setNav({
      screenId: screen && screen.id,
      count: qs.length,
      index: function () { return cur; },
      canPrev: function () { return cur > 0; },
      next: function () { return cur + 1 < qs.length ? api.showQuestion(cur + 1) : false; },
      prev: function () { return cur > 0 ? api.showQuestion(cur - 1) : false; },
      /* 서브바 표시 — 화면이 "31-35 of 50" 이어도 지금 보이는 건 한 문항이다. */
      progress: function () {
        var q = qs[cur], total = screen && screen.progress ? screen.progress.total : 0;
        if (!q || q.no === undefined || !total) return null;
        return { first: q.no, last: q.no, total: total, style: 'single' };
      }
    });
    return wrap;
  }

  /* 문항 그리드 — allowBack 화면에서 화면 안의 문항으로 점프한다.
     엔진은 역방향 화면 이동을 제공하지 않으므로(Story 1.4 AC3) 범위는 '현재 화면의 문항'이다. */
  function gridNav(qs, api) {
    var nav = el('div', 'grid-nav rd-grid');
    var i;
    for (i = 0; i < qs.length; i++) {
      var q = qs[i];
      var b = el('button');
      b.type = 'button';
      b.textContent = String(q.no === undefined ? i + 1 : q.no);
      b.setAttribute('data-qid', q.id);
      (function (qq, at) {
        b.onclick = function () {
          // 한 번에 한 문항만 보이므로, 스크롤이 아니라 그 문항으로 갈아 끼운다.
          if (typeof api.showQuestion === 'function' && api.showQuestion(at)) {
            var shown = doc.getElementById('rd-card-' + qq.id);
            if (shown && shown.scrollIntoView) { try { shown.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
            return;
          }
          var target = doc.getElementById('rd-card-' + qq.id) || doc.getElementById('rd-q-' + qq.id);
          if (!target) return;
          if (target.scrollIntoView) { try { target.scrollIntoView({ block: 'center' }); } catch (e) { target.scrollIntoView(); } }
          if (target.focus) { try { target.focus(); } catch (e) {} }
        };
      })(q, i);
      api.gridBtns[q.id] = b;
      nav.appendChild(b);
    }
    return nav;
  }

  /* ── 등록 (파일 상단 주석의 공존 전략) ───────────────────── */

  function isReadingScreen(s) {
    return !!s && s.screenType === 'question' && s.section === 'reading';
  }

  function install(R) {
    if (!R || typeof R.register !== 'function') return false;
    R.register(ALIAS, render);
    if (R.__sgReadingWrapped) return true;
    var origRender = R.render;
    R.render = function (screen, ctx) {
      if (!isReadingScreen(screen)) return origRender.call(R, screen, ctx);
      var alias = {}, k;
      for (k in screen) { if (screen.hasOwnProperty(k)) alias[k] = screen[k]; }
      alias.screenType = ALIAS;
      var node = origRender.call(R, alias, ctx);
      // 마운트 속성은 원래 screenType 을 유지한다(셸/CSS 가 'question' 을 본다).
      var m = typeof R.mount === 'function' ? R.mount() : null;
      if (m && m.setAttribute) {
        m.setAttribute('data-screen-type', 'question');
        m.setAttribute('data-screen-id', screen.id || '');
      }
      return node;
    };
    R.__sgReadingWrapped = true;
    return true;
  }

  root.SG_RENDER_READING = {
    ALIAS: ALIAS,
    render: render,
    install: install,
    isReadingScreen: isReadingScreen,
    // 순수 헬퍼(테스트용)
    passageText: passageText, slug: slug, ttsIdOf: ttsIdOf,
    clozeTokens: clozeTokens, markerTokens: markerTokens, hasMarkers: hasMarkers,
    stemOf: stemOf, missingCount: missingCount, railText: railText,
    composeAnswer: composeAnswer, typedFrom: typedFrom, FREE_WIDTH: FREE_WIDTH,
    questionsOf: questionsOf, blockOf: blockOf, insertQuestionOf: insertQuestionOf
  };

  install(root.SG_RENDER);
})(typeof window !== 'undefined' ? window : this);
