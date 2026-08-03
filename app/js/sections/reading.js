/* =============================================================
 * SMEAG TOEFL — 리딩 섹션 렌더러
 * window.SMEAG_SECTIONS.reading = { renderBlock(ctx) -> {destroy()} }
 *
 * 처리하는 block.kind : 'cloze' | 'passage' | 'chat'
 * 블록 하나 = 한 페이지. 렌더가 끝나면 즉시 ctx.onReady() 를 호출한다.
 *
 * ES module 아님 — <script src> 로 로드되는 클래식 스크립트.
 * ============================================================= */
(function () {
  'use strict';

  window.SMEAG_SECTIONS = window.SMEAG_SECTIONS || {};

  /* ---------------------------------------------------------------
   * 공용 미니 헬퍼 (util.js 가 있으면 그쪽을 우선 사용)
   * --------------------------------------------------------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* 알파벳 라벨 (선택지 A/B/C/D) */
  function letter(i) {
    return String.fromCharCode(65 + i);
  }

  /* ---------------------------------------------------------------
   * 스타일 주입
   * app.css(담당 A) 가 항상 이기도록 <head> 의 맨 앞에 끼워 넣는다.
   * (동일 명세라면 나중에 선언된 app.css 가 우선한다)
   * --------------------------------------------------------------- */
  var STYLE_ID = 'smeag-reading-style';
  var CSS = [
    '.rd-wrap{max-width:1100px;margin:0 auto;padding:4px 2px 24px}',
    '.rd-head{margin-bottom:14px}',
    '.rd-heading{font-size:20px;font-weight:800;color:var(--brand,#5b5ef4)}',
    '.rd-instruction{font-size:14px;color:var(--muted,#8a8aa0);margin-top:4px}',
    '.rd-card{background:var(--card,#fff);border:1px solid var(--line,#ececf4);',
    '  border-radius:var(--radius,16px);padding:18px 20px;margin-bottom:14px}',
    '.rd-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}',
    '.rd-col-sticky{position:sticky;top:8px}',
    '@media (max-width:900px){.rd-split{grid-template-columns:1fr}.rd-col-sticky{position:static}}',
    /* --- 지문 --- */
    '.rd-title{font-size:17px;font-weight:800;margin-bottom:10px}',
    '.rd-para{font-size:15.5px;line-height:1.85;margin-bottom:12px;white-space:pre-wrap}',
    '.rd-para:last-child{margin-bottom:0}',
    /* --- 삽입점 마커 --- */
    '.rd-marker{display:inline-block;cursor:pointer;user-select:none;font-weight:700;',
    '  font-size:13px;line-height:1;padding:4px 7px;margin:0 3px;border-radius:8px;',
    '  border:1px dashed var(--brand,#5b5ef4);color:var(--brand,#5b5ef4);',
    '  background:var(--brand-soft,#eef0ff);vertical-align:middle}',
    '.rd-marker:hover{filter:brightness(.96)}',
    '.rd-marker.on{background:var(--brand,#5b5ef4);color:#fff;border-style:solid;',
    '  box-shadow:0 0 0 3px rgba(91,94,244,.18)}',
    /* --- Cloze --- */
    '.rd-cloze-body{font-size:16px;line-height:2.9}',
    '.rd-blank{position:relative;display:inline-flex;align-items:center;margin:0 3px;',
    '  border:1px solid var(--line,#ececf4);border-radius:10px;background:#fff;',
    '  padding:2px 6px;vertical-align:middle}',
    '.rd-blank.filled{border-color:var(--brand,#5b5ef4);background:var(--brand-soft,#eef0ff)}',
    '.rd-blank-no{position:absolute;top:-11px;left:-7px;font-size:10px;font-weight:800;',
    '  line-height:1;color:#fff;background:var(--brand,#5b5ef4);border-radius:999px;padding:3px 6px}',
    '.rd-hint{color:var(--muted,#8a8aa0);font-weight:700;letter-spacing:.5px}',
    '.rd-blank input.cloze-input{border:0;outline:none;background:transparent;font:inherit;',
    '  color:var(--text,#1c1c28);font-weight:700;letter-spacing:.5px;min-width:44px;padding:2px 0}',
    '.rd-blank input.cloze-input::placeholder{color:#c3c3d4;font-weight:400;letter-spacing:2px}',
    /* --- 채팅 --- */
    '.rd-chat{display:flex;flex-direction:column;gap:12px}',
    '.rd-msg{display:flex;flex-direction:column;max-width:78%}',
    '.rd-msg.left{align-self:flex-start;align-items:flex-start}',
    '.rd-msg.right{align-self:flex-end;align-items:flex-end}',
    '.rd-msg-meta{font-size:11.5px;color:var(--muted,#8a8aa0);margin-bottom:4px}',
    '.rd-bubble{padding:10px 14px;border-radius:14px;font-size:15px;line-height:1.7;',
    '  border:1px solid var(--line,#ececf4);background:#f7f7fc}',
    '.rd-msg.right .rd-bubble{background:var(--brand-soft,#eef0ff);border-color:#dcdefc}',
    /* --- 문항 --- */
    '.rd-q{border-bottom:1px solid var(--line,#ececf4);padding:14px 0}',
    '.rd-q:first-child{padding-top:0}',
    '.rd-q:last-child{border-bottom:0;padding-bottom:0}',
    '.rd-q-head{display:flex;gap:9px;align-items:flex-start;margin-bottom:10px}',
    '.rd-q-no{flex:0 0 auto;min-width:24px;height:24px;border-radius:8px;font-size:12px;',
    '  font-weight:800;display:inline-flex;align-items:center;justify-content:center;',
    '  color:#fff;background:var(--brand,#5b5ef4);padding:0 6px}',
    '.rd-q-prompt{font-size:15px;font-weight:600;line-height:1.6}',
    '.rd-q-sentence{margin:0 0 10px 33px;padding:10px 12px;border-left:3px solid var(--accent,#ff5a36);',
    '  background:#fff6f3;border-radius:0 10px 10px 0;font-size:15px;line-height:1.7}',
    '.rd-choices{display:flex;flex-direction:column;gap:8px;margin-left:33px}',
    '@media (max-width:680px){.rd-choices{margin-left:0}.rd-q-sentence{margin-left:0}}',
    '.rd-choices .choice{display:flex;gap:10px;align-items:flex-start;cursor:pointer;',
    '  border:1px solid var(--line,#ececf4);border-radius:12px;padding:10px 12px;background:#fff}',
    '.rd-choices .choice:hover{border-color:#c9caf8}',
    '.rd-choices .choice.sel{border-color:var(--brand,#5b5ef4);background:var(--brand-soft,#eef0ff)}',
    '.rd-choices .choice input{margin-top:3px;accent-color:var(--brand,#5b5ef4)}',
    '.rd-choice-letter{font-weight:800;color:var(--muted,#8a8aa0);flex:0 0 auto}',
    '.rd-choices .choice.sel .rd-choice-letter{color:var(--brand,#5b5ef4)}',
    '.rd-choice-text{font-size:14.5px;line-height:1.6}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    var head = document.head || document.getElementsByTagName('head')[0];
    if (head.firstChild) head.insertBefore(s, head.firstChild);
    else head.appendChild(s);
  }

  /* ---------------------------------------------------------------
   * 블록 머리말 (heading + instruction)
   * --------------------------------------------------------------- */
  function headerOf(block) {
    var box = el('div', 'rd-head');
    if (block.heading) box.appendChild(el('div', 'rd-heading', block.heading));
    if (block.instruction) box.appendChild(el('div', 'rd-instruction', block.instruction));
    return box;
  }

  /* ---------------------------------------------------------------
   * 객관식(mcq / insert) 문항 카드
   * onPick(index) 는 렌더러가 추가로 반응해야 할 때 쓴다(삽입점 연동).
   * 반환값: { node, select(index) }  ← 외부에서 선택을 밀어 넣을 수 있다
   * --------------------------------------------------------------- */
  function choiceCard(ctx, q, onPick) {
    var wrap = el('div', 'rd-q');
    wrap.setAttribute('data-qid', q.id);

    var head = el('div', 'rd-q-head');
    head.appendChild(el('span', 'rd-q-no', q.no));
    head.appendChild(el('div', 'rd-q-prompt', q.prompt || ''));
    wrap.appendChild(head);

    if (q.sentence) wrap.appendChild(el('div', 'rd-q-sentence', q.sentence));

    var list = el('div', 'rd-choices');
    var labels = [];
    var name = 'q_' + q.id;
    var saved = ctx.getAnswer(q.id);

    (q.choices || []).forEach(function (text, i) {
      var lab = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = String(i);
      if (saved === i) {
        radio.checked = true;
        lab.className = 'choice sel';
      }
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        apply(i, true);
      });
      lab.appendChild(radio);
      lab.appendChild(el('span', 'rd-choice-letter', letter(i) + '.'));
      lab.appendChild(el('span', 'rd-choice-text', text));
      list.appendChild(lab);
      labels.push({ lab: lab, radio: radio });
    });
    wrap.appendChild(list);

    /* fromUser=true 일 때만 onPick 을 통해 바깥(삽입점 마커)에 알린다 */
    function apply(index, fromUser) {
      labels.forEach(function (o, i) {
        o.lab.className = (i === index) ? 'choice sel' : 'choice';
        o.radio.checked = (i === index);
      });
      ctx.setAnswer(q.id, index);
      if (onPick) onPick(index, fromUser);
    }

    return { node: wrap, select: function (i) { apply(i, false); } };
  }

  /* 문항 여러 개를 담는 컨테이너. insert 문항은 handle 을 콜백으로 넘긴다 */
  function questionList(ctx, questions, onInsertReady) {
    var box = el('div', 'rd-card');
    questions.forEach(function (q) {
      if (q.kind === 'insert' && onInsertReady) {
        var handle = choiceCard(ctx, q, function (index, fromUser) {
          onInsertReady.pick(index, fromUser);
        });
        box.appendChild(handle.node);
        onInsertReady.register(q, handle);
      } else {
        box.appendChild(choiceCard(ctx, q, null).node);
      }
    });
    return box;
  }

  /* ===============================================================
   * kind: 'cloze'
   * template 의 {{n}} 을 인라인 입력칸으로 치환한다.
   * 힌트 철자는 회색 고정 접두어. 저장되는 값은 '힌트 + 입력' 완성 단어.
   * =============================================================== */
  function renderCloze(ctx) {
    var block = ctx.block;
    var byNo = {};
    (block.questions || []).forEach(function (q) { byNo[String(q.no)] = q; });

    var card = el('div', 'rd-card');
    var body = el('div', 'rd-cloze-body');
    var tpl = String(block.template || '');
    var re = /\{\{(\d+)\}\}/g;
    var last = 0;
    var m;

    while ((m = re.exec(tpl)) !== null) {
      if (m.index > last) body.appendChild(document.createTextNode(tpl.slice(last, m.index)));
      var q = byNo[m[1]];
      body.appendChild(q ? blankField(ctx, q) : document.createTextNode(m[0]));
      last = m.index + m[0].length;
    }
    if (last < tpl.length) body.appendChild(document.createTextNode(tpl.slice(last)));

    card.appendChild(body);
    return card;
  }

  function blankField(ctx, q) {
    var hint = String(q.hint || '');
    /* 남은 글자 수만 노출한다 — 정답 단어 자체는 절대 표시하지 않는다 */
    var remain = Math.max(1, String(q.answer || '').length - hint.length);
    var ph = new Array(remain + 1).join('_ ').trim();

    var wrap = el('span', 'rd-blank');
    wrap.appendChild(el('span', 'rd-blank-no', q.no));
    if (hint) wrap.appendChild(el('span', 'rd-hint', hint));

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cloze-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', q.no + '번 빈칸');
    input.placeholder = ph;
    input.style.width = (Math.max(remain, 3) * 11 + 16) + 'px';

    /* 저장값은 완성 단어이므로, 화면에는 힌트를 뺀 나머지만 넣는다 */
    var saved = ctx.getAnswer(q.id);
    if (typeof saved === 'string' && saved) {
      if (hint && saved.toLowerCase().indexOf(hint.toLowerCase()) === 0) {
        input.value = saved.slice(hint.length);
      } else {
        input.value = saved;
      }
    }
    paint();

    function paint() {
      wrap.className = input.value.trim() ? 'rd-blank filled' : 'rd-blank';
    }
    function commit() {
      var typed = input.value.replace(/\s+/g, '');
      if (typed !== input.value) input.value = typed;
      /* 힌트를 포함한 완성 단어 전체를 저장 */
      ctx.setAnswer(q.id, typed ? (hint + typed) : '');
      paint();
    }
    input.addEventListener('input', commit);
    input.addEventListener('change', commit);
    /* 엔터로 다음 빈칸 이동 */
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var all = Array.prototype.slice.call(document.querySelectorAll('.rd-blank input.cloze-input'));
      var i = all.indexOf(input);
      if (i > -1 && all[i + 1]) all[i + 1].focus();
    });

    wrap.appendChild(input);
    return wrap;
  }

  /* ===============================================================
   * kind: 'passage'
   * 왼쪽 지문 / 오른쪽 문항 2단 (900px 이하 1단).
   * 문단 안의 {{A}}~{{D}} 는 클릭 가능한 삽입점 마커로, insert 문항과 양방향 연동.
   * =============================================================== */
  function renderPassage(ctx) {
    var block = ctx.block;
    var split = el('div', 'rd-split');

    var left = el('div', 'rd-card');
    if (block.title) left.appendChild(el('div', 'rd-title', block.title));

    var markers = {};   // 'A' -> span
    var order = [];     // ['A','B','C','D'] 등장 순서

    (block.paragraphs || []).forEach(function (text) {
      var p = el('p', 'rd-para');
      var re = /\{\{([A-Z])\}\}/g;
      var last = 0;
      var m;
      var s = String(text);
      while ((m = re.exec(s)) !== null) {
        if (m.index > last) p.appendChild(document.createTextNode(s.slice(last, m.index)));
        var span = el('span', 'rd-marker', '◆ ' + m[1]);
        span.setAttribute('role', 'button');
        span.setAttribute('tabindex', '0');
        span.setAttribute('data-mark', m[1]);
        span.title = m[1] + ' 위치에 문장 삽입';
        markers[m[1]] = span;
        order.push(m[1]);
        p.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < s.length) p.appendChild(document.createTextNode(s.slice(last)));
      left.appendChild(p);
    });

    /* insert 문항과의 연결 고리 */
    var insertHandle = null;
    var link = {
      register: function (q, handle) {
        insertHandle = handle;
        var saved = ctx.getAnswer(q.id);
        if (typeof saved === 'number') highlight(saved);
      },
      pick: function (index) { highlight(index); }
    };

    function highlight(index) {
      order.forEach(function (k, i) {
        markers[k].className = (i === index) ? 'rd-marker on' : 'rd-marker';
      });
    }

    order.forEach(function (k, i) {
      function choose() {
        if (insertHandle) insertHandle.select(i);   // 선택지 라디오도 함께 갱신
        highlight(i);
      }
      markers[k].addEventListener('click', choose);
      markers[k].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
    });

    var right = el('div', 'rd-col-sticky');
    right.appendChild(questionList(ctx, block.questions || [], order.length ? link : null));

    split.appendChild(left);
    split.appendChild(right);
    return split;
  }

  /* ===============================================================
   * kind: 'chat'  — 말풍선 + 문항
   * =============================================================== */
  function renderChat(ctx) {
    var block = ctx.block;
    var split = el('div', 'rd-split');

    var left = el('div', 'rd-card');
    var chat = el('div', 'rd-chat');
    (block.messages || []).forEach(function (msg) {
      var side = (msg.side === 'right') ? 'right' : 'left';
      var row = el('div', 'rd-msg ' + side);
      var meta = [msg.name, msg.time].filter(Boolean).join(' · ');
      row.appendChild(el('div', 'rd-msg-meta', meta));
      row.appendChild(el('div', 'rd-bubble', msg.text || ''));
      chat.appendChild(row);
    });
    left.appendChild(chat);

    var right = el('div', 'rd-col-sticky');
    right.appendChild(questionList(ctx, block.questions || [], null));

    split.appendChild(left);
    split.appendChild(right);
    return split;
  }

  /* ===============================================================
   * 렌더러 진입점
   * =============================================================== */
  window.SMEAG_SECTIONS.reading = {
    renderBlock: function (ctx) {
      injectStyle();

      var wrap = el('div', 'rd-wrap');
      wrap.appendChild(headerOf(ctx.block));

      var kind = ctx.block && ctx.block.kind;
      if (kind === 'cloze') {
        wrap.appendChild(renderCloze(ctx));
      } else if (kind === 'passage') {
        wrap.appendChild(renderPassage(ctx));
      } else if (kind === 'chat') {
        wrap.appendChild(renderChat(ctx));
      } else {
        /* 계약에 없는 kind — 문항만이라도 보여준다 */
        wrap.appendChild(questionList(ctx, (ctx.block && ctx.block.questions) || [], null));
      }

      ctx.root.appendChild(wrap);

      /* 리딩은 렌더 직후 '다음' 을 열어 준다 */
      if (typeof ctx.onReady === 'function') ctx.onReady();

      return {
        destroy: function () {
          /* 타이머/오디오 없음. root 는 exam.js 가 비운다 */
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        }
      };
    }
  };
})();
