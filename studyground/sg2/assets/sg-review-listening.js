/* SMEAG · StudyGround 2.0 — 리스닝 채점 리뷰(문항 하나씩 펼쳐 보기).
 *
 * 왜 표가 아니라 이 화면인가.
 *   리딩은 지문이 화면에 남아 있어 표 한 줄("내 답 C / 정답 A")만으로도 복기가 된다.
 *   리스닝은 다르다. 학생이 다시 봐야 하는 것은 고른 보기가 아니라 **들었던 소리**다.
 *   무엇을 잘못 들었는지는 그 클립을 다시 듣고, 네 보기를 나란히 놓고, 대본을 펴 봐야
 *   알 수 있다. 그래서 리스닝만 문항 카드로 편다 — 왼쪽에 오디오·삽화·대본, 오른쪽에
 *   보기와 정오.
 *
 * 의존 전역(없으면 각각 degrade):
 *   SG_MEDIA        원본 경로 → 배포 경로 리맵
 *   SG_AUDIO        관리자 오디오 교체·배속 (스크립트만 얹으면 자동으로 걸린다)
 *   SG_SCRIPT_CHECK config/audio-check.<set>.json 의 대본
 *
 * 노출 전역: window.SG_REVIEW_LISTENING
 *   .model(pack, rows)          → [{id,label,groups,items}]  모듈 → 블록 → 문항
 *   .groupLabel(block)          → 'Best Response' | 'Conversation' | …
 *   .html(model, state)         → 화면 전체 HTML (순수 함수 — 테스트가 이걸 본다)
 *   .mount(el, opts)            → 그리고 클릭·이동까지 묶는다
 *
 * ES5 — 빌드 없이 <script src> 로 읽힌다.
 */
window.SG_REVIEW_LISTENING = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function bi(en, ko) { return '<span data-en>' + esc(en) + '</span><span data-ko>' + esc(ko) + '</span>'; }

  function media(raw) {
    if (!raw) return '';
    if (window.SG_MEDIA && typeof window.SG_MEDIA.resolveMedia === 'function') {
      return window.SG_MEDIA.resolveMedia(raw);
    }
    return encodeURI(String(raw));
  }

  /* 블록의 종류를 학생이 아는 말로 바꾼다. 정본은 지시문이다 — 문항 데이터에
   * 종류 필드가 따로 없고, heading('Questions 13-14')은 무엇을 들었는지 말해 주지 않는다. */
  function groupLabel(block) {
    var ins = String((block && (block.instruction || block.heading)) || '');
    if (/best response/i.test(ins)) return ['Best Response', '베스트 리스폰스'];
    if (/conversation/i.test(ins)) return ['Conversation', '대화'];
    if (/announcement/i.test(ins)) return ['Announcement', '안내 방송'];
    if (/lecture|talk/i.test(ins)) return ['Academic Talk', '강의'];
    return [String((block && block.heading) || 'Listening'), String((block && block.heading) || '리스닝')];
  }

  /** 팩의 리스닝 구조에 채점 행(rows)을 얹어 모듈 → 블록 → 문항으로 편다. */
  function model(pack, rows) {
    var byQid = {};
    (rows || []).forEach(function (r) { if (r && r.qid) byQid[r.qid] = r; });

    var out = [];
    ((pack && pack.sections) || []).forEach(function (sec) {
      if (String((sec && sec.id) || '').toLowerCase() !== 'listening') return;
      (sec.modules || []).forEach(function (mod) {
        var groups = [], items = [];
        (mod.blocks || []).forEach(function (blk) {
          var lab = groupLabel(blk);
          var g = {
            label: lab[0], labelKo: lab[1],
            heading: blk.heading || '', instruction: blk.instruction || '',
            audio: blk.audio || '', image: blk.image || '', items: []
          };
          (blk.questions || []).forEach(function (q) {
            var row = byQid[q.id] || null;
            var key = row && row.key != null ? row.key : q.answer;
            var it = {
              qid: q.id, no: q.no, q: q, group: g, row: row,
              given: row ? row.given : '',
              key: key,
              ok: row ? row.ok : null,
              /* 오디오는 문항이 들고 있으면 문항 것, 아니면 블록 것이다 —
                 단답 응답형은 문항마다 클립이 있고, 대화·강의는 블록 하나에 클립 하나다. */
              audio: q.audio || blk.audio || '',
              image: q.image || blk.image || '',
              index: items.length
            };
            g.items.push(it);
            items.push(it);
          });
          if (g.items.length) groups.push(g);
        });
        if (items.length) {
          out.push({
            id: mod.id || '', label: mod.label || mod.id || 'Listening',
            groups: groups, items: items
          });
        }
      });
    });
    return out;
  }

  /* 'Listening Module 1' → 'Module 1'. 탭 줄에서 'Listening' 은 이미 앞 탭이 말했다. */
  function shortLabel(label) {
    return String(label || '').replace(/^listening\s+/i, '');
  }

  function markOf(it) {
    return it.ok === true ? 'ok' : it.ok === false ? 'no' : 'na';
  }

  /* 저장값을 보기 번호로. 무응답이면 -1. */
  function pickOf(v) {
    if (v === '' || v == null) return -1;
    var n = Number(v);
    return isFinite(n) && String(v).match(/^\s*[0-9]+\s*$/) ? n : -1;
  }
  function letter(i) { return String.fromCharCode(65 + i); }

  /* ── 화면 ──────────────────────────────────────────────── */

  function tabsHtml(model, state) {
    if (model.length < 2) return '';
    return '<div class="lr-mods">' + model.map(function (m, i) {
      var wrong = m.items.filter(function (x) { return x.ok === false; }).length;
      return '<button type="button" data-mod="' + i + '"' + (i === state.m ? ' class="on"' : '') + '>' +
        esc(shortLabel(m.label)) +
        '<span class="lr-count">' + m.items.length + '</span>' +
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

  function choicesHtml(it) {
    var ch = (it.q && it.q.choices) || [];
    var pick = pickOf(it.given);
    var key = pickOf(it.key);
    if (!ch.length) {
      /* 객관식이 아닌 리스닝 문항(있다면) — 값을 글로 보여 준다. */
      return '<div class="lr-open">' +
        '<div class="lr-lab">' + bi('Your answer', '내 답') + '</div>' +
        '<div>' + (it.given === '' || it.given == null
          ? '<span class="muted">' + bi('(no answer)', '(무응답)') + '</span>' : esc(it.given)) + '</div>' +
        '<div class="lr-lab">' + bi('Correct', '정답') + '</div>' +
        '<div>' + (it.key == null ? '—' : esc(it.key)) + '</div>' +
      '</div>';
    }
    return '<div class="lr-choices">' + ch.map(function (text, i) {
      var isKey = i === key, isPick = i === pick;
      var cls = isKey ? 'key' : (isPick ? 'pick' : '');
      var tag = isKey ? '<span class="lr-tag ok">' + bi('Correct', '정답') + '</span>'
              : isPick ? '<span class="lr-tag no">' + bi('Selected', '내가 고른 답') + '</span>' : '';
      return '<div class="lr-ch ' + cls + (isPick ? ' mine' : '') + '">' +
        '<span class="lr-ltr">' + letter(i) + '</span>' +
        '<span class="lr-ch-t">' + esc(text) + '</span>' + tag +
      '</div>';
    }).join('') + '</div>';
  }

  function verdictHtml(it) {
    var pick = pickOf(it.given), key = pickOf(it.key);
    var mine = pick < 0 ? '<span class="muted">' + bi('(no answer)', '(무응답)') + '</span>'
                        : '<b class="' + (it.ok === true ? 'is-ok' : 'is-no') + '">' + letter(pick) + '</b>';
    var right = key < 0 ? '—' : '<b class="is-ok">' + letter(key) + '</b>';
    var line = it.ok === true ? '<span class="is-ok">✓ ' + bi('Correct', '정답') + '</span>'
             : it.ok === false ? '<span class="is-no">✗ ' + bi('Incorrect', '오답') + '</span>'
             : '<span class="muted">' + bi('Not auto-scored', '자동채점 대상 아님') + '</span>';
    return '<div class="lr-verdict ' + markOf(it) + '">' +
      '<div class="lr-vr"><span>' + bi('Your answer', '내 답') + '</span>' + mine + '</div>' +
      '<div class="lr-vr"><span>' + bi('Correct', '정답') + '</span>' + right + '</div>' +
      '<div class="lr-vl">' + line + '</div>' +
    '</div>';
  }

  /* 대본은 접어 둔다. 펴 놓고 시작하면 눈이 먼저 글을 읽어, 다시 듣기가 듣기가 아니게 된다. */
  function scriptHtml(it, scripts) {
    var rec = scripts && it.audio ? scripts[String(it.audio)] : null;
    if (!rec || !rec.text) return '';
    return '<details class="lr-script"><summary>' + bi('Show transcript', '대본 보기') + '</summary>' +
      '<div>' + esc(rec.text) + '</div></details>';
  }

  /* 단답 응답형의 prompt 는 지시문을 거의 그대로 되뇐다("Listen to the question and
   * select the best response."). 두 줄로 겹쳐 놓으면 학생은 어느 쪽이 문제인지 헷갈린다. */
  function sameAsInstruction(it) {
    var p = String((it.q && it.q.prompt) || '');
    if (!p) return true;
    var ins = String(it.group.instruction || '');
    function n(s) { return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }
    var a = n(p), b = n(ins);
    return !!a && !!b && (a === b || b.indexOf(a) === 0 || a.indexOf(b) === 0);
  }

  function paneHtml(it, scripts, extra) {
    var src = media(it.audio);
    var left =
      '<div class="lr-left">' +
        (it.image ? '<img class="lr-img" src="' + esc(media(it.image)) + '" alt="">' : '') +
        (src
          ? '<audio class="lr-audio" controls preload="none" src="' + esc(src) + '"></audio>'
          : '<div class="muted" style="font-size:12.5px">' +
              bi('No audio for this question.', '이 문항에는 오디오가 없습니다.') + '</div>') +
        scriptHtml(it, scripts) +
      '</div>';
    var right =
      '<div class="lr-right">' +
        '<div class="lr-kind">' + bi(it.group.label, it.group.labelKo) +
          (it.group.heading ? ' · ' + esc(it.group.heading) : '') + '</div>' +
        (it.group.instruction ? '<p class="lr-ins">' + esc(it.group.instruction) + '</p>' : '') +
        (sameAsInstruction(it) ? '' : '<p class="lr-q">' + esc(it.q.prompt) + '</p>') +
        choicesHtml(it) +
        verdictHtml(it) +
        (extra || '') +
      '</div>';
    return '<div class="lr-pane">' + left + right + '</div>';
  }

  /**
   * 화면 전체 HTML.
   * @param {Array}  m      model()
   * @param {Object} state  { m: 모듈 index, q: 그 모듈 안 문항 index }
   * @param {Object} opts   { scripts: {경로:{text}}, extraFor: fn(qid) → HTML }
   */
  function html(m, state, opts) {
    opts = opts || {};
    if (!m || !m.length) {
      return '<div class="lr-empty muted">' +
        bi('This test set has no listening questions on this device.',
           '이 기기의 세트에 리스닝 문항이 없습니다.') + '</div>';
    }
    var mod = m[Math.min(state.m || 0, m.length - 1)];
    var qi = Math.min(Math.max(state.q || 0, 0), mod.items.length - 1);
    var it = mod.items[qi];
    var st = { m: m.indexOf(mod), q: qi };

    return '<div class="lr">' +
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
      paneHtml(it, opts.scripts, opts.extraFor ? opts.extraFor(it.qid) : '') +
    '</div>';
  }

  /* ── 묶기 ──────────────────────────────────────────────── */

  /**
   * mount(el, opts)
   *   opts.pack      콘텐츠 팩(window.SMEAG_SET9 등)
   *   opts.rows      SG_RESULTS.detail(res).rows
   *   opts.setCode   대본을 찾을 SET 코드('SET9')
   *   opts.extraFor  fn(qid) → 문항 아래 붙일 HTML(코멘트 등)
   *   opts.onPaint   fn(el) 다시 그린 뒤 부를 것(코멘트 편집기 배선 등)
   * @returns {{repaint: function, state: object}}
   */
  function mount(el, opts) {
    opts = opts || {};
    var m = model(opts.pack, opts.rows);
    var state = { m: 0, q: 0 };
    var scripts = null;

    /* 처음 열 때는 첫 오답으로 데려간다 — 리뷰에서 먼저 보고 싶은 건 틀린 문항이다. */
    (function () {
      for (var i = 0; i < m.length; i++) {
        for (var j = 0; j < m[i].items.length; j++) {
          if (m[i].items[j].ok === false) { state.m = i; state.q = j; return; }
        }
      }
    })();

    function paint() {
      el.innerHTML = html(m, state, { scripts: scripts, extraFor: opts.extraFor });
      /* 관리자 교체본·배속은 이 순간 새로 생긴 <audio> 에도 걸려야 한다. */
      if (window.SG_AUDIO && typeof window.SG_AUDIO.apply === 'function') {
        try { window.SG_AUDIO.apply(el); } catch (e) {}
      }
      if (typeof opts.onPaint === 'function') opts.onPaint(el);
    }

    function stop() {
      var list = el.querySelectorAll ? el.querySelectorAll('audio') : [];
      for (var i = 0; i < list.length; i++) { try { list[i].pause(); } catch (e) {} }
    }

    function go(qi) {
      var mod = m[state.m];
      if (!mod) return;
      state.q = Math.min(Math.max(qi, 0), mod.items.length - 1);
      stop();                              // 화면을 떠나면 소리도 끊는다(시험 화면과 같은 규칙)
      paint();
    }

    el.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-q],[data-mod],[data-go]') : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-mod')) {
        state.m = Number(t.getAttribute('data-mod')) || 0;
        state.q = 0; stop(); paint(); return;
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

    /* 대본은 늦게 와도 된다 — 오면 그 자리에서 다시 그린다. */
    var set = String(opts.setCode || '').toLowerCase().replace(/\s+/g, '');
    if (set && window.SG_SCRIPT_CHECK && typeof window.SG_SCRIPT_CHECK.load === 'function') {
      window.SG_SCRIPT_CHECK.load(set).then(function () {
        var found = {}, any = false;
        m.forEach(function (mod) {
          mod.items.forEach(function (it) {
            if (!it.audio || found[it.audio]) return;
            var rec = window.SG_SCRIPT_CHECK.forPath(it.audio);
            if (rec && rec.text) { found[it.audio] = rec; any = true; }
          });
        });
        if (!any) return;
        scripts = found;
        paint();
      })['catch'](function () {});
    }

    return { repaint: paint, state: state, model: m };
  }

  return {
    model: model, groupLabel: groupLabel, html: html, mount: mount,
    shortLabel: shortLabel, esc: esc
  };
})();
