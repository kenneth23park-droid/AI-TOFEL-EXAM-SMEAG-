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
    var pack = set || root.SMEAG_SET1;
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

  /* cloze — 녹화 45:30 "Fill in the missing letters". template 의 {{n}} 을 입력칸으로 바꾸고
     hint(선행 글자)를 placeholder 로 쓴다. 한 화면에 blank 10개. 스타일은 exam.html 의 .blank-in 계승. */
  function renderCloze(screen, ctx, blk, qs, api) {
    var box = el('div', 'rd-cloze');
    box.appendChild(bi('h3', 'Fill in the missing letters.', '빠진 글자를 채우세요.'));

    var byNo = {}, i;
    for (i = 0; i < qs.length; i++) byNo[String(qs[i].no)] = qs[i];

    var p = el('div', 'passage rd-cloze-text');
    var toks = clozeTokens(blk.template || '');
    for (i = 0; i < toks.length; i++) {
      if (toks[i].text !== undefined) { p.appendChild(doc.createTextNode(toks[i].text)); continue; }
      var q = byNo[toks[i].token];
      var inp = el('input', 'blank-in');
      inp.type = 'text';
      inp.setAttribute('data-blank', toks[i].token);
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('spellcheck', 'false');
      inp.placeholder = (q && q.hint) ? q.hint : toks[i].token;
      if (q) {
        inp.id = 'rd-q-' + q.id;
        inp.setAttribute('aria-label', 'Blank ' + toks[i].token);
        var prev = savedAnswer(q.id);
        if (prev !== null && prev !== undefined) inp.value = String(prev);
        (function (qq, node) {
          node.oninput = function () { saveAnswer(ctx, qq.id, node.value); api.refreshGrid(); };
        })(q, inp);
      } else {
        inp.disabled = true;   // template 과 questions 가 어긋난 경우 — 시험은 멈추지 않는다(F12)
      }
      p.appendChild(inp);
    }
    box.appendChild(p);
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
    var wrap = el('div', 'rd-screen');
    var blk = blockOf(screen);
    var head = el('div', 'rd-head');

    if (screen && screen.progress) {
      head.appendChild(textEl('span', 'exam-badge',
        'Question ' + screen.progress.index + ' of ' + screen.progress.total));
    }
    if (blk && blk.heading) head.appendChild(textEl('b', 'rd-heading', blk.heading));
    if (blk && blk.instruction) head.appendChild(textEl('span', 'qinstr', blk.instruction));
    wrap.appendChild(head);

    if (!blk) {
      wrap.appendChild(bi('p', 'Reading content is unavailable offline for this screen.',
        '이 화면의 리딩 콘텐츠를 불러오지 못했습니다.'));
      return wrap;
    }

    var qs = questionsOf(blk, screen && screen.questionIds);
    var insertQ = insertQuestionOf(blk, qs);

    // 렌더 지역 상태 — 마커/라디오/그리드가 서로를 갱신한다.
    var api = {
      markers: {}, radios: {}, gridBtns: {}, qs: qs,
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
          btn.className = done ? 'answered' : '';
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
          var card = doc.getElementById('rd-card-' + insertQ.id);
          if (card && card.scrollIntoView) { try { card.scrollIntoView({ block: 'nearest' }); } catch (e) { card.scrollIntoView(); } }
        }
      }
    };

    var kind = (screen && screen.blockKind) || blk.kind;

    if (kind === 'cloze') {
      wrap.appendChild(renderCloze(screen, ctx, blk, qs, api));
      wrap.appendChild(gridNav(qs, api));
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
    var i;
    for (i = 0; i < qs.length; i++) right.appendChild(questionCard(screen, ctx, qs[i], api));

    cols.appendChild(left);
    cols.appendChild(right);
    wrap.appendChild(cols);

    // 저장된 insert 답안 복원(마커 하이라이트 + 미리보기까지 되살린다).
    if (insertQ) {
      var prev = savedAnswer(insertQ.id);
      if (prev !== null && prev !== undefined && prev !== '') api.setInsert(parseInt(prev, 10), false);
    }
    api.refreshGrid();
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
      (function (qq) {
        b.onclick = function () {
          var target = doc.getElementById('rd-card-' + qq.id) || doc.getElementById('rd-q-' + qq.id);
          if (!target) return;
          if (target.scrollIntoView) { try { target.scrollIntoView({ block: 'center' }); } catch (e) { target.scrollIntoView(); } }
          if (target.focus) { try { target.focus(); } catch (e) {} }
        };
      })(q);
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
    questionsOf: questionsOf, blockOf: blockOf, insertQuestionOf: insertQuestionOf
  };

  install(root.SG_RENDER);
})(typeof window !== 'undefined' ? window : this);
