/* SMEAG · StudyGround 2.0 — 리딩 채점 리뷰(문항 하나씩 펼쳐 보기).
 *
 * 왜 표가 아니라 이 화면인가.
 *   리딩의 표는 "내 답 C / 정답 A" 까지만 말한다. 그런데 리딩에서 틀린 이유는 거의 늘
 *   지문 안에 있다 — 어느 문단을 잘못 읽었는지, C-Test 의 어떤 어간을 무슨 글자로
 *   메웠는지. 지문을 떼어 놓고 보기 네 줄만 보여 주면 학생은 자기 오답을 설명하지
 *   못한다. 그래서 리스닝·라이팅·스피킹과 같은 뼈대로 편다 — 왼쪽에 읽은 것(지문 ·
 *   C-Test 문단 · 메신저 대화), 오른쪽에 고른 것과 정오.
 *
 * 노출 전역: window.SG_REVIEW_READING
 *   .model(pack, rows)   → [{id,label,groups,items}]  모듈 → 블록 → 문항
 *   .groupLabel(block)   → ['C-Test', 'C-Test'] | ['Read in Daily Life (Short)', …] | …
 *   .html(model, state)  → 화면 전체 HTML (순수 함수 — 테스트가 이걸 본다)
 *   .mount(el, opts)     → 그리고 클릭·이동까지 묶는다
 *
 * ES5 — 빌드 없이 <script src> 로 읽힌다.
 */
window.SG_REVIEW_READING = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function bi(en, ko) { return '<span data-en>' + esc(en) + '</span><span data-ko>' + esc(ko) + '</span>'; }

  /* ── 블록의 종류 ──────────────────────────────────────────
   * 정본은 지시문이다. heading('Questions 21-22')은 무엇을 읽었는지 말해 주지 않고,
   * kind('passage')는 웹페이지와 학술 지문을 같은 말로 부른다. 학생이 성적표에서
   * 찾는 이름("일상 지문은 다 맞았는데 학술 지문에서 무너졌다")으로 붙인다.
   * 짧은 글·긴 글의 경계는 문항 수다 — 2문항짜리는 공지·이메일처럼 한눈에 읽는 글이고,
   * 3문항 이상은 표·조건을 오가며 읽는 글이라 복기의 성격이 다르다. */
  function groupLabel(block) {
    var b = block || {};
    var ins = String(b.instruction || b.heading || '');
    if (b.kind === 'cloze' || /fill in the blank/i.test(ins)) return ['C-Test', 'C-Test'];
    if (b.kind === 'chat' || /message|chat|text conversation/i.test(ins)) {
      return ['Read a Conversation', '메시지 대화'];
    }
    if (/passage|article/i.test(ins)) return ['Academic Passage', '학술 지문'];
    var many = ((b.questions || []).length > 2);
    return many ? ['Read in Daily Life (Long)', '생활문 (긴 글)']
                : ['Read in Daily Life (Short)', '생활문 (짧은 글)'];
  }

  /** 팩의 리딩 구조에 채점 행(rows)을 얹어 모듈 → 블록 → 문항으로 편다. */
  function model(pack, rows) {
    var byQid = {};
    (rows || []).forEach(function (r) { if (r && r.qid) byQid[r.qid] = r; });

    var out = [];
    ((pack && pack.sections) || []).forEach(function (sec) {
      if (String((sec && sec.id) || '').toLowerCase() !== 'reading') return;
      (sec.modules || []).forEach(function (mod) {
        var groups = [], items = [];
        (mod.blocks || []).forEach(function (blk) {
          var lab = groupLabel(blk);
          var g = {
            label: lab[0], labelKo: lab[1], kind: blk.kind || '',
            heading: blk.heading || '', instruction: blk.instruction || '',
            title: blk.title || '', block: blk, items: []
          };
          (blk.questions || []).forEach(function (q) {
            var row = byQid[q.id] || null;
            var it = {
              qid: q.id, no: q.no, q: q, group: g, block: blk, row: row,
              given: row ? row.given : '',
              key: row && row.key != null ? row.key : q.answer,
              ok: row ? row.ok : null,
              index: items.length
            };
            g.items.push(it);
            items.push(it);
          });
          if (g.items.length) groups.push(g);
        });
        if (items.length) {
          out.push({
            id: mod.id || '', label: mod.label || mod.id || 'Reading',
            groups: groups, items: items
          });
        }
      });
    });
    return out;
  }

  /* 'Reading Module 1' → 'Module 1'. 탭 줄에서 'Reading' 은 이미 앞 탭이 말했다. */
  function shortLabel(label) {
    return String(label || '').replace(/^reading\s+/i, '');
  }

  function markOf(it) {
    return it.ok === true ? 'ok' : it.ok === false ? 'no' : 'na';
  }

  function pickOf(v) {
    if (v === '' || v == null) return -1;
    var n = Number(v);
    return isFinite(n) && String(v).match(/^\s*[0-9]+\s*$/) ? n : -1;
  }
  function letter(i) { return String.fromCharCode(65 + i); }

  /* ── C-Test 어간·빈칸 ─────────────────────────────────────
   * 시험 화면(exam-render-reading.js)과 같은 규칙이다: 어간은 hint, 빠진 글자 수는
   * answer.length - hint.length. 리뷰에서는 입력칸 대신 네모(□)로 그 자릿수를 남긴다 —
   * "몇 글자를 채워야 했는지" 가 보이지 않으면 오답의 이유가 반이 지워진다. */
  function stemOf(q) { return (q && q.hint) ? String(q.hint) : ''; }

  function missingCount(q) {
    var ans = (q && q.answer) ? String(q.answer) : '';
    var hint = stemOf(q);
    if (!ans) return 0;
    if (ans.toLowerCase().indexOf(hint.toLowerCase()) !== 0) return 0;
    var n = ans.length - hint.length;
    return n > 0 ? n : 0;
  }

  function boxes(n) {
    var s = '', i;
    for (i = 0; i < (n > 0 ? n : 4); i++) s += '□';
    return s;
  }

  function splitTokens(text, re) {
    var out = [], parts = String(text || '').split(re), i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === undefined || parts[i] === '') continue;
      if (i % 2 === 1) out.push({ token: parts[i] });
      else out.push({ text: parts[i] });
    }
    return out;
  }
  function clozeTokens(template) { return splitTokens(template, /\{\{(\d+)\}\}/); }
  function markerTokens(paragraph) { return splitTokens(paragraph, /\{\{([A-D])\}\}/); }

  /* ── 왼쪽: 읽은 것 ────────────────────────────────────────── */

  /* 채워진 빈칸 하나. 리뷰의 문단은 시험지의 복사본이 아니다 — 열 칸이 전부 □ 로
     남아 있으면 학생은 자기가 채운 글자로 이 문단이 어떻게 읽혔는지 다시 볼 수 없고,
     복기는 오른쪽 판정 상자 한 칸에 갇힌다. 채운 것을 제자리에 되돌려 놓는다.
       맞은 칸  — 채운 낱말 (어간 뒤 내가 쓴 글자에 밑줄)
       틀린 칸  — 채운 낱말에 줄을 긋고 정답을 옆에 세운다
       빈 칸    — □ 를 남긴다. 몇 글자였는지가 지워지면 오답의 이유가 반이 지워진다.
     지금 보고 있는 칸만 따로 짚어 준다(now). */
  function fillHtml(it, on) {
    var q = it.q || {};
    var stem = stemOf(q);
    var given = (it.given === '' || it.given == null) ? '' : String(it.given);
    var key = (it.key === '' || it.key == null) ? '' : String(it.key);
    var right = key ? '<i class="rr-key">' + esc(key) + '</i>' : '';
    var body;

    if (!given) {
      body = esc(stem) + esc(boxes(missingCount(q))) + right;
    } else {
      /* 어간은 시험지가 준 것이고 그 뒤가 학생이 채운 글자다. 밑줄로 갈라 두면
         "무엇을 내가 썼는가" 가 문단 안에서도 보인다. 어간으로 시작하지 않는 답
         (자유 입력 · 어간을 지우고 쓴 답)은 통째로 내가 쓴 것으로 본다.
         틀린 낱말에는 밑줄을 긋지 않는다 — 취소선과 겹치면 둘 다 안 읽힌다. */
      var head = given.toLowerCase().indexOf(stem.toLowerCase()) === 0 ? stem.length : 0;
      body = it.ok === false
        ? '<s>' + esc(given) + '</s>' + right
        : esc(given.slice(0, head)) + '<u>' + esc(given.slice(head)) + '</u>';
    }

    return '<span class="rr-blank' + (on ? ' now' : '') + ' ' + markOf(it) + '">' +
      body + '</span>';
  }

  /* C-Test 문단 — 블록의 빈칸 전부를 채점 결과로 채운다. 그래서 문항 목록은
     팩의 questions 가 아니라 채점 행이 얹힌 group.items 를 본다. */
  function clozeHtml(it) {
    var blk = it.block || {};
    var byNo = {};
    (((it.group && it.group.items) || [])).forEach(function (x) {
      if (x && x.q && x.q.no != null) byNo[String(x.q.no)] = x;
    });

    var body = clozeTokens(blk.template || '').map(function (t) {
      if (t.text !== undefined) return esc(t.text);
      var x = byNo[t.token];
      if (!x) return '<span class="rr-blank na">' + esc(boxes(0)) + '</span>';
      return '<sup class="rr-bno">' + esc(t.token) + '</sup>' +
        fillHtml(x, x.qid === it.qid);
    }).join('');

    return '<div class="rr-passage rr-cloze">' + body + '</div>';
  }

  /* 메신저 대화. 시험 화면과 같은 말풍선이라야 "그때 본 것"으로 읽힌다. */
  function chatHtml(blk) {
    return '<div class="rr-chat">' + ((blk.messages || []).map(function (m) {
      var side = (m.side === 'right') ? 'right' : 'left';
      var who = m.name || m.from || m.sender || '';
      return '<div class="rr-msg ' + side + '"><div class="rr-bub">' +
        (who || m.time
          ? '<div class="rr-msg-meta">' + (who ? '<b>' + esc(who) + '</b>' : '') +
            (m.time ? ' <span class="muted">' + esc(m.time) + '</span>' : '') + '</div>'
          : '') +
        '<div>' + esc(m.text || (typeof m === 'string' ? m : '')) + '</div>' +
      '</div></div>';
    }).join('')) + '</div>';
  }

  /* 지문. 삽입 문항을 보고 있을 때만 A~D 표식을 살린다 — 다른 문항에서는 표식이
     본문을 끊어 놓기만 한다. 표식에는 내가 고른 자리와 정답 자리를 함께 세운다.  */
  function passageHtml(it) {
    var blk = it.block || {};
    var insert = (it.q && it.q.kind === 'insert') ? it.q : null;
    var pick = insert ? pickOf(it.given) : -1;
    var key = insert ? pickOf(it.key) : -1;

    var body = (blk.paragraphs || (blk.passage ? [blk.passage] : [])).map(function (p) {
      var toks = insert ? markerTokens(p) : [{ text: String(p).replace(/\{\{[A-D]\}\}/g, '') }];
      return '<p>' + toks.map(function (t) {
        if (t.text !== undefined) return esc(t.text);
        var at = t.token.charCodeAt(0) - 65;
        var cls = at === key ? 'key' : (at === pick ? 'pick' : '');
        return '<span class="rr-mark ' + cls + '">' + esc(t.token) +
          (at === key ? ' <i>' + esc(insert.sentence || '') + '</i>' : '') + '</span>';
      }).join('') + '</p>';
    }).join('');

    return '<div class="rr-passage">' +
      (blk.title ? '<h3 class="rr-title">' + esc(blk.title) + '</h3>' : '') + body + '</div>';
  }

  function leftHtml(it) {
    var kind = (it.block && it.block.kind) || '';
    if (kind === 'cloze') return '<div class="lr-left">' + clozeHtml(it) + '</div>';
    if (kind === 'chat') return '<div class="lr-left">' + chatHtml(it.block) + '</div>';
    return '<div class="lr-left">' + passageHtml(it) + '</div>';
  }

  /* ── 오른쪽: 고른 것 ──────────────────────────────────────── */

  function choicesHtml(it) {
    var ch = (it.q && it.q.choices) || [];
    var pick = pickOf(it.given), key = pickOf(it.key);
    return '<div class="lr-choices">' + ch.map(function (text, i) {
      var isKey = i === key, isPick = i === pick;
      var tag = isKey ? '<span class="lr-tag ok">' + bi('Correct', '정답') + '</span>'
              : isPick ? '<span class="lr-tag no">' + bi('Selected', '내가 고른 답') + '</span>' : '';
      return '<div class="lr-ch ' + (isKey ? 'key' : (isPick ? 'pick' : '')) + '">' +
        '<span class="lr-ltr">' + letter(i) + '</span>' +
        '<span class="lr-ch-t">' + esc(text) + '</span>' + tag +
      '</div>';
    }).join('') + '</div>';
  }

  /* C-Test 는 보기가 없다. 물어본 것은 "이 어간 뒤에 무슨 글자가 오는가" 하나뿐이라
     빈칸 모양을 그대로 한 번 더 크게 세우고, 답 두 줄을 아래에 붙인다. */
  function blankHtml(it) {
    return '<p class="lr-q">' + bi('Fill in the blank:', '빈칸을 채우세요:') + '</p>' +
      '<div class="rr-cue">' + esc(stemOf(it.q)) + esc(boxes(missingCount(it.q))) + '</div>';
  }

  function answerText(v) {
    return (v === '' || v == null)
      ? '<span class="muted">' + bi('(no answer)', '(무응답)') + '</span>'
      : esc(String(v));
  }

  function verdictHtml(it) {
    var isChoice = !!((it.q && it.q.choices) || []).length;
    var pick = pickOf(it.given), key = pickOf(it.key);
    var mine, right;
    if (isChoice) {
      mine = pick < 0 ? '<span class="muted">' + bi('(no answer)', '(무응답)') + '</span>'
                      : '<b class="' + (it.ok === true ? 'is-ok' : 'is-no') + '">' + letter(pick) + '</b>';
      right = key < 0 ? '—' : '<b class="is-ok">' + letter(key) + '</b>';
    } else {
      mine = '<b class="' + (it.ok === true ? 'is-ok' : it.ok === false ? 'is-no' : '') + '">' +
        answerText(it.given) + '</b>';
      right = '<b class="is-ok">' + (it.key == null ? '—' : esc(String(it.key))) + '</b>';
    }
    var line = it.ok === true ? '<span class="is-ok">✓ ' + bi('Correct', '정답') + '</span>'
             : it.ok === false ? '<span class="is-no">✗ ' + bi('Incorrect', '오답') + '</span>'
             : '<span class="muted">' + bi('Not auto-scored', '자동채점 대상 아님') + '</span>';
    return '<div class="lr-verdict ' + markOf(it) + '">' +
      '<div class="lr-vr"><span>' + bi('Your answer', '내 답') + '</span>' + mine + '</div>' +
      '<div class="lr-vr"><span>' + bi('Correct', '정답') + '</span>' + right + '</div>' +
      '<div class="lr-vl">' + line + '</div>' +
    '</div>';
  }

  function rightHtml(it, extra) {
    var q = it.q || {};
    var isBlank = !((q.choices || []).length);
    return '<div class="lr-right">' +
      '<div class="lr-kind">' + bi(it.group.label, it.group.labelKo) + '</div>' +
      (isBlank
        ? blankHtml(it)
        : (q.prompt ? '<p class="lr-q">' + esc(q.prompt) + '</p>' : '') +
          (q.sentence ? '<div class="rr-insert">' + esc(q.sentence) + '</div>' : '') +
          choicesHtml(it)) +
      verdictHtml(it) +
      (extra || '') +
    '</div>';
  }

  /* ── 화면 ─────────────────────────────────────────────────── */

  function tabsHtml(m, state) {
    if (m.length < 2) return '';
    return '<div class="lr-mods">' + m.map(function (mod, i) {
      var wrong = mod.items.filter(function (x) { return x.ok === false; }).length;
      return '<button type="button" data-mod="' + i + '"' + (i === state.m ? ' class="on"' : '') + '>' +
        esc(shortLabel(mod.label)) +
        '<span class="lr-count">' + mod.items.length + '</span>' +
        (wrong ? '<span class="lr-count bad">' + wrong + ' ✗</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }

  function stripHtml(mod, state) {
    return '<div class="lr-strip">' + mod.groups.map(function (g) {
      return '<div class="lr-grp">' +
        '<div class="lr-grp-lab">' + bi(g.label, g.labelKo) + '</div>' +
        '<div class="lr-dots">' + g.items.map(function (it) {
          return '<button type="button" class="lr-dot ' + markOf(it) +
            (it.index === state.q ? ' now' : '') + '" data-q="' + it.index + '" ' +
            'title="' + esc(it.qid) + '">' + esc(it.no != null ? it.no : '·') + '</button>';
        }).join('') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /**
   * 화면 전체 HTML.
   * @param {Array}  m      model()
   * @param {Object} state  { m: 모듈 index, q: 그 모듈 안 문항 index }
   * @param {Object} opts   { extraFor: fn(qid) → HTML }
   */
  function html(m, state, opts) {
    opts = opts || {};
    if (!m || !m.length) {
      return '<div class="lr-empty muted">' +
        bi('This test set has no reading questions on this device.',
           '이 기기의 세트에 리딩 문항이 없습니다.') + '</div>';
    }
    var mod = m[Math.min(state.m || 0, m.length - 1)];
    var qi = Math.min(Math.max(state.q || 0, 0), mod.items.length - 1);
    var it = mod.items[qi];
    var st = { m: m.indexOf(mod), q: qi };

    return '<div class="lr rr">' +
      '<div class="lr-bar">' +
        tabsHtml(m, st) +
        '<div class="lr-nav">' +
          '<span class="lr-pos">' + bi('Question', '문항') + ' ' + (qi + 1) + ' / ' + mod.items.length + '</span>' +
          '<button class="btn ghost sm" type="button" data-go="prev"' + (qi === 0 ? ' disabled' : '') + '>‹ ' +
            bi('Prev', '이전') + '</button>' +
          '<button class="btn ghost sm" type="button" data-go="next"' +
            (qi === mod.items.length - 1 ? ' disabled' : '') + '>' + bi('Next', '다음') + ' ›</button>' +
          '<button class="btn ghost sm" type="button" data-go="wrong">' +
            bi('Next wrong', '다음 오답') + '</button>' +
        '</div>' +
      '</div>' +
      stripHtml(mod, st) +
      '<div class="lr-pane">' +
        leftHtml(it) +
        rightHtml(it, opts.extraFor ? opts.extraFor(it.qid) : '') +
      '</div>' +
    '</div>';
  }

  /* ── 묶기 ─────────────────────────────────────────────────── */

  /**
   * mount(el, opts)
   *   opts.pack      콘텐츠 팩(window.SMEAG_SET9 등)
   *   opts.rows      SG_RESULTS.detail(res).rows
   *   opts.extraFor  fn(qid) → 문항 아래 붙일 HTML(코멘트 등)
   *   opts.onPaint   fn(el) 다시 그린 뒤 부를 것(코멘트 편집기 배선 등)
   * @returns {{repaint: function, state: object, model: Array}}
   */
  function mount(el, opts) {
    opts = opts || {};
    var m = model(opts.pack, opts.rows);
    var state = { m: 0, q: 0 };

    /* 처음 열 때는 첫 오답으로 데려간다 — 리뷰에서 먼저 보고 싶은 건 틀린 문항이다. */
    (function () {
      for (var i = 0; i < m.length; i++) {
        for (var j = 0; j < m[i].items.length; j++) {
          if (m[i].items[j].ok === false) { state.m = i; state.q = j; return; }
        }
      }
    })();

    function paint() {
      el.innerHTML = html(m, state, { extraFor: opts.extraFor });
      if (typeof opts.onPaint === 'function') opts.onPaint(el);
    }

    function go(qi) {
      var mod = m[state.m];
      if (!mod) return;
      state.q = Math.min(Math.max(qi, 0), mod.items.length - 1);
      paint();
    }

    el.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-q],[data-mod],[data-go]') : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-mod')) {
        state.m = Number(t.getAttribute('data-mod')) || 0;
        state.q = 0; paint(); return;
      }
      if (t.hasAttribute('data-q')) { go(Number(t.getAttribute('data-q')) || 0); return; }
      var dir = t.getAttribute('data-go');
      if (dir === 'prev') return go(state.q - 1);
      if (dir === 'next') return go(state.q + 1);
      if (dir === 'wrong') {
        var items = m[state.m].items;
        for (var k = 1; k <= items.length; k++) {
          var n = (state.q + k) % items.length;
          if (items[n].ok === false) return go(n);
        }
      }
    });

    paint();
    return { repaint: paint, state: state, model: m };
  }

  return {
    model: model, groupLabel: groupLabel, html: html, mount: mount,
    shortLabel: shortLabel, stemOf: stemOf, missingCount: missingCount,
    clozeTokens: clozeTokens, markerTokens: markerTokens, esc: esc
  };
})();
