/* =============================================================
 * app/js/sections/writing.js
 * window.SMEAG_SECTIONS.writing — 라이팅 섹션 렌더러
 *
 * 담당 블록 kind:
 *   - 'build-set'  : Build a Sentence 10문항 (한 화면에 전부)
 *   - 'free-write' : email / discussion 작성형
 *
 * 계약: renderBlock(ctx) -> { destroy() }
 * 클래식 스크립트. import/export 없음.
 * ============================================================= */
(function () {
  'use strict';

  window.SMEAG_SECTIONS = window.SMEAG_SECTIONS || {};

  /* ---------- 작은 DOM 헬퍼 (외부 의존 최소화) ---------- */
  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }
  function on(node, type, fn) { node.addEventListener(type, fn); return node; }

  /* ---------- 이 파일 전용 스타일 (A 담당 app.css 와 충돌 방지용 접두사) ---------- */
  var STYLE_ID = 'smeag-writing-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) { return; }
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.wr-instruction{color:#8a8aa0;font-size:14px;margin:0 0 14px}',
      '.wr-q{background:#fff;border:1px solid #ececf4;border-radius:16px;padding:16px 18px;margin:0 0 14px}',
      '.wr-q-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}',
      '.wr-no{flex:0 0 auto;min-width:28px;height:28px;padding:0 8px;border-radius:14px;background:#eef0ff;color:#5b5ef4;font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center}',
      '.wr-context{color:#1c1c28;font-size:15px;font-weight:600}',
      '.wr-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:12px;background:#f5f5fb;border-radius:12px;min-height:56px}',
      '.wr-fixed{font-size:15px;color:#1c1c28;padding:4px 2px}',
      '.wr-tiles{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
      '.wr-hint{font-size:12px;color:#8a8aa0;margin-top:8px}',
      '.wr-mailbox{background:#fff;border:1px solid #ececf4;border-radius:16px;overflow:hidden;margin-bottom:14px}',
      '.wr-mailrow{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid #ececf4;font-size:14px}',
      '.wr-mailrow:last-child{border-bottom:0}',
      '.wr-maillabel{flex:0 0 68px;color:#8a8aa0;font-weight:700}',
      '.wr-mailval{color:#1c1c28;word-break:break-all}',
      '.wr-panel{background:#fff;border:1px solid #ececf4;border-radius:16px;padding:16px 18px;margin-bottom:14px}',
      '.wr-label{font-size:12px;font-weight:800;letter-spacing:.06em;color:#5b5ef4;margin-bottom:8px}',
      '.wr-body{font-size:15px;line-height:1.7;color:#1c1c28}',
      '.wr-bullets{margin:8px 0 0;padding-left:20px}',
      '.wr-bullets li{font-size:15px;line-height:1.7;margin-bottom:4px}',
      '.wr-post{background:#fff;border:1px solid #ececf4;border-left:4px solid #5b5ef4;border-radius:12px;padding:14px 16px;margin-bottom:10px}',
      '.wr-post.wr-prof{border-left-color:#ff5a36;background:#fffaf8}',
      '.wr-post-name{font-weight:800;font-size:14px;color:#1c1c28;margin-bottom:6px}',
      '.wr-ta{width:100%;box-sizing:border-box;min-height:280px;resize:vertical;padding:14px;font-family:inherit;font-size:15px;line-height:1.7;color:#1c1c28;background:#fff;border:1px solid #ececf4;border-radius:16px;outline:none}',
      '.wr-ta:focus{border-color:#5b5ef4;box-shadow:0 0 0 3px rgba(91,94,244,.15)}',
      '.wr-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}',
      '.wr-count{font-size:13px;font-weight:700;color:#8a8aa0}',
      '.wr-count.ok{color:#12a150}',
      '.wr-note{font-size:12px;color:#8a8aa0}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- 문항 id 기반 결정적 셔플 (렌더마다 순서 동일) ---------- */
  function seedOf(str) {
    var h = 2166136261, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function rngFrom(seed) {
    var s = seed || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function shuffleDet(arr, seedStr) {
    var out = arr.slice(), rnd = rngFrom(seedOf(seedStr)), i, j, t;
    for (i = out.length - 1; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* ---------- 단어 수 ---------- */
  function wordCount(s) {
    if (!s) { return 0; }
    var t = String(s).trim();
    if (!t) { return 0; }
    return t.split(/\s+/).length;
  }

  /* =============================================================
   * build-set — Build a Sentence
   * ============================================================= */
  function renderBuildSet(ctx) {
    var root = ctx.root, block = ctx.block;

    if (block.heading) { root.appendChild(E('h2', 'wr-heading', block.heading)); }
    if (block.instruction) { root.appendChild(E('p', 'wr-instruction', block.instruction)); }

    block.questions.forEach(function (q) { buildOne(ctx, q); });

    // 리딩/라이팅은 렌더 직후 준비 완료
    if (typeof ctx.onReady === 'function') { ctx.onReady(); }

    return { destroy: function () { /* 정리할 타이머/오디오 없음 */ } };
  }

  function buildOne(ctx, q) {
    var card = E('div', 'wr-q');
    var head = E('div', 'wr-q-head');
    head.appendChild(E('span', 'wr-no', String(q.no)));
    head.appendChild(E('div', 'wr-context', q.context || ''));
    card.appendChild(head);

    var line = E('div', 'wr-line');
    var tileWrap = E('div', 'wr-tiles');
    card.appendChild(line);
    card.appendChild(tileWrap);
    card.appendChild(E('div', 'wr-hint', '타일을 눌러 빈칸을 채우고, 채워진 칸을 다시 누르면 되돌립니다.'));
    ctx.root.appendChild(card);

    // --- 상태 ---
    var slots = q.slots || [];
    var blankIdxOfSlot = [];        // slots 인덱스 -> blank 인덱스(-1 이면 고정)
    var nBlank = 0;
    slots.forEach(function (s, i) {
      if (s.t === 'b') { blankIdxOfSlot[i] = nBlank++; } else { blankIdxOfSlot[i] = -1; }
    });

    var tiles = shuffleDet(q.tiles || [], q.id);      // 표시용(결정적)
    var owner = [];                                   // blank 인덱스 -> tile 인덱스 (없으면 -1)
    var usedBy = [];                                  // tile 인덱스 -> blank 인덱스 (없으면 -1)
    var b, t;
    for (b = 0; b < nBlank; b++) { owner[b] = -1; }
    for (t = 0; t < tiles.length; t++) { usedBy[t] = -1; }

    // --- 저장된 답 복원 ---
    var saved = ctx.getAnswer(q.id);
    if (Object.prototype.toString.call(saved) === '[object Array]') {
      saved.forEach(function (tok, bi) {
        if (bi >= nBlank || !tok) { return; }
        var ti;
        for (ti = 0; ti < tiles.length; ti++) {
          if (usedBy[ti] === -1 && tiles[ti] === tok) {
            usedBy[ti] = bi; owner[bi] = ti; return;
          }
        }
      });
    }

    // --- DOM 캐시 ---
    var slotNodes = [];   // blank 인덱스 -> button
    var tileNodes = [];   // tile 인덱스 -> button

    slots.forEach(function (s, i) {
      if (s.t === 'f') {
        line.appendChild(E('span', 'wr-fixed', s.text || ''));
        return;
      }
      var bi = blankIdxOfSlot[i];
      var btn = E('button', 'slot');
      btn.type = 'button';
      on(btn, 'click', function () { takeBack(bi); });
      slotNodes[bi] = btn;
      line.appendChild(btn);
    });

    tiles.forEach(function (text, ti) {
      var btn = E('button', 'tile', text);
      btn.type = 'button';
      on(btn, 'click', function () { placeTile(ti); });
      tileNodes[ti] = btn;
      tileWrap.appendChild(btn);
    });

    function placeTile(ti) {
      if (usedBy[ti] !== -1) { return; }
      var bi = -1, k;
      for (k = 0; k < nBlank; k++) { if (owner[k] === -1) { bi = k; break; } }
      if (bi === -1) { return; }        // 빈 슬롯 없음
      owner[bi] = ti; usedBy[ti] = bi;
      paint(); commit();
    }

    function takeBack(bi) {
      var ti = owner[bi];
      if (ti === -1) { return; }
      owner[bi] = -1; usedBy[ti] = -1;
      paint(); commit();
    }

    function paint() {
      var k;
      for (k = 0; k < nBlank; k++) {
        var node = slotNodes[k];
        if (owner[k] === -1) {
          node.textContent = '';
          node.className = 'slot';
        } else {
          node.textContent = tiles[owner[k]];
          node.className = 'slot filled';
        }
      }
      for (k = 0; k < tiles.length; k++) {
        tileNodes[k].className = usedBy[k] === -1 ? 'tile' : 'tile used';
        tileNodes[k].disabled = usedBy[k] !== -1;
      }
    }

    function commit() {
      // response: blank 슬롯 순서의 토큰 배열. 빈 자리는 null 이 아니라 ''.
      var res = [], k;
      for (k = 0; k < nBlank; k++) { res.push(owner[k] === -1 ? '' : tiles[owner[k]]); }
      ctx.setAnswer(q.id, res);
    }

    paint();
    // 복원된 값이 있을 때만 저장(빈 상태를 굳이 덮어쓰지 않음)
    if (Object.prototype.toString.call(saved) === '[object Array]') { commit(); }
  }

  /* =============================================================
   * free-write — email / discussion
   * ============================================================= */
  function renderFreeWrite(ctx) {
    var root = ctx.root, block = ctx.block;

    if (block.heading) { root.appendChild(E('h2', 'wr-heading', block.heading)); }
    if (block.instruction) { root.appendChild(E('p', 'wr-instruction', block.instruction)); }

    block.questions.forEach(function (q) {
      if (q.kind === 'discussion') { renderDiscussion(ctx, q); } else { renderEmail(ctx, q); }
    });

    if (typeof ctx.onReady === 'function') { ctx.onReady(); }
    return { destroy: function () { } };
  }

  function renderEmail(ctx, q) {
    var box = E('div', 'wr-mailbox');
    box.appendChild(mailRow('To', q.to || ''));
    box.appendChild(mailRow('Subject', q.subject || ''));
    ctx.root.appendChild(box);

    if (q.situation) {
      var sp = E('div', 'wr-panel');
      sp.appendChild(E('div', 'wr-label', q.situationLabel || 'SITUATION'));
      sp.appendChild(E('div', 'wr-body', q.situation));
      ctx.root.appendChild(sp);
    }

    if (q.bullets && q.bullets.length) {
      var bp = E('div', 'wr-panel');
      bp.appendChild(E('div', 'wr-label', q.bulletsLabel || 'YOUR EMAIL SHOULD'));
      var ul = E('ul', 'wr-bullets');
      q.bullets.forEach(function (b) { ul.appendChild(E('li', null, b)); });
      bp.appendChild(ul);
      ctx.root.appendChild(bp);
    }

    attachEditor(ctx, q, 'Write your email here.');
  }

  function mailRow(label, value) {
    var r = E('div', 'wr-mailrow');
    r.appendChild(E('div', 'wr-maillabel', label));
    r.appendChild(E('div', 'wr-mailval', value));
    return r;
  }

  function renderDiscussion(ctx, q) {
    var prof = E('div', 'wr-post wr-prof');
    prof.appendChild(E('div', 'wr-post-name', q.professor || 'Professor'));
    prof.appendChild(E('div', 'wr-body', q.prompt || ''));
    ctx.root.appendChild(prof);

    (q.posts || []).forEach(function (p) {
      var d = E('div', 'wr-post');
      d.appendChild(E('div', 'wr-post-name', p.name || 'Student'));
      d.appendChild(E('div', 'wr-body', p.text || ''));
      ctx.root.appendChild(d);
    });

    attachEditor(ctx, q, 'Write your response here.');
  }

  function attachEditor(ctx, q, placeholder) {
    var ta = E('textarea', 'wr-ta');
    ta.placeholder = placeholder;
    ta.spellcheck = false;

    var saved = ctx.getAnswer(q.id);
    ta.value = typeof saved === 'string' ? saved : '';

    var foot = E('div', 'wr-foot');
    var counter = E('div', 'wr-count');
    var min = q.minWords || 0;
    foot.appendChild(counter);
    foot.appendChild(E('div', 'wr-note', '이 문항은 자동 채점 대상이 아닙니다 — 제출 후 채점 대기 상태로 표시됩니다.'));

    function refresh() {
      var n = wordCount(ta.value);
      counter.textContent = '단어 수 ' + n + ' / 최소 ' + min;
      counter.className = n >= min && min > 0 ? 'wr-count ok' : 'wr-count';
    }

    on(ta, 'input', function () {
      refresh();
      ctx.setAnswer(q.id, ta.value);
    });

    ctx.root.appendChild(ta);
    ctx.root.appendChild(foot);
    refresh();
  }

  /* =============================================================
   * 공개 렌더러
   * ============================================================= */
  window.SMEAG_SECTIONS.writing = {
    renderBlock: function (ctx) {
      ensureStyle();
      var kind = ctx.block && ctx.block.kind;
      if (kind === 'build-set') { return renderBuildSet(ctx); }
      if (kind === 'free-write') { return renderFreeWrite(ctx); }

      // 알 수 없는 kind — 시험을 멈추지 않는다.
      ctx.root.appendChild(E('p', 'wr-instruction', '표시할 수 없는 블록입니다. (' + String(kind) + ')'));
      if (typeof ctx.onReady === 'function') { ctx.onReady(); }
      return { destroy: function () { } };
    }
  };
})();
