/* SMEAG · StudyGround 2.0 — 라이팅 채점 리뷰(과제 하나씩 펼쳐 보기).
 *
 * 왜 표가 아니라 이 화면인가.
 *   라이팅에서 학생이 다시 봐야 하는 것은 자기가 쓴 글이 아니라 **무엇을 쓰라고 했는가**
 *   와 그 글을 나란히 놓은 모습이다. 표 한 칸에는 과제문이 들어가지 않는다 — Build a
 *   Sentence 는 상대의 말·문장 틀·단어 은행이 있어야 문제가 되고, 이메일과 토론은
 *   상황문과 요구사항 세 줄이 곧 채점 기준이다. 그래서 왼쪽에 과제를 통째로 다시 펴고
 *   오른쪽에 내 답과 정답(또는 0~5 루브릭)을 세운다.
 *
 * 세 과제는 눈금이 다르다. 그 사실을 화면에서 감추지 않는다.
 *   W1 Build a Sentence — 자동채점. 정답은 문항 안에 있다(slots[].a). 'n/10'.
 *   W2 Write an Email       ┐ 서버가 ETS 루브릭으로 매긴 0~5(sg_task_scores).
 *   W3 Academic Discussion  ┘ 선생님이 확정하면 그 점수가 이긴다. 'x.xx/5.00'.
 *
 * 노출 전역: window.SG_REVIEW_WRITING
 *   .model(pack, rows, tasks)   → [{id,label,kind,items,score}]  과제 → 문항
 *   .html(model, state, opts)   → 화면 전체 HTML (순수 함수 — 테스트가 이걸 본다)
 *   .mount(el, opts)            → 그리고 클릭·이동까지 묶는다
 *
 * ES5 — 빌드 없이 <script src> 로 읽힌다.
 */
window.SG_REVIEW_WRITING = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function bi(en, ko) { return '<span data-en>' + esc(en) + '</span><span data-ko>' + esc(ko) + '</span>'; }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  /* 비교 규칙은 sg-results.js 와 같다 — 두 화면이 같은 답을 다르게 채점하면
     학생은 어느 쪽을 믿어야 할지 알 수 없다. 끝의 구두점만 조금 더 너그럽게 본다. */
  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .replace(/\s+/g, ' ').replace(/[.,?!;:]+$/, '');
  }

  /* 산출형 과제 — 정답표가 없고 0~5 루브릭으로만 매겨진다. */
  var RATED = { email: 1, discussion: 1 };

  /** sg_task_scores 한 행의 최종 점수. 선생님이 손댔으면 선생님이 이긴다. */
  function scoreOf(task) {
    if (!task) return null;
    var v = (task.teacher_score === null || task.teacher_score === undefined)
      ? task.ai_score : task.teacher_score;
    return (v === null || v === undefined || v === '') ? null : Number(v);
  }

  /* ── Build a Sentence 채점 ────────────────────────────────
   * 정답표(answerKey)에 이 문항은 없다. 정답은 문항이 들고 있다 — slots 의 빈칸마다
   * 들어갈 말이 .a 로 적혀 있고, 그 순서가 곧 학생이 채운 토큰 배열의 순서다.
   * 그래서 빈칸 단위로 맞춰 본다: 어느 칸에서 틀렸는지까지 보여야 복기가 된다. */
  function blanksOf(q) {
    var out = [], slots = (q && q.slots) || [], i;
    for (i = 0; i < slots.length; i++) if (slots[i] && slots[i].t === 'b') out.push(slots[i]);
    return out;
  }

  function checkBuild(q, given) {
    var blanks = blanksOf(q);
    var toks = isArr(given) ? given : [];
    var per = [], answered = false, all = blanks.length > 0, i;
    for (i = 0; i < blanks.length; i++) {
      var mine = norm(toks[i]);
      var hit = mine !== '' && mine === norm(blanks[i].a);
      per.push(hit);
      if (mine !== '') answered = true;
      if (!hit) all = false;
    }
    return { blanks: blanks, tokens: toks, per: per, ok: all, answered: answered };
  }

  /* ── 모델 ─────────────────────────────────────────────── */

  /**
   * 팩의 라이팅 구조에 채점 행과 과제 점수를 얹는다.
   * @param pack   콘텐츠 팩(window.SMEAG_SET9 등)
   * @param rows   SG_RESULTS.detail(res).rows — given 을 여기서 얻는다
   * @param tasks  sg_task_scores 행[] — W2·W3 의 0~5 점수와 루브릭
   */
  function model(pack, rows, tasks) {
    var byQid = {}, byTask = {};
    (rows || []).forEach(function (r) { if (r && r.qid) byQid[r.qid] = r; });
    (tasks || []).forEach(function (t) { if (t && t.question_id) byTask[t.question_id] = t; });

    var out = [];
    ((pack && pack.sections) || []).forEach(function (sec) {
      if (String((sec && sec.id) || '').toLowerCase() !== 'writing') return;
      (sec.modules || []).forEach(function (mod) {
        var items = [];
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            var row = byQid[q.id] || null;
            var given = row ? row.given : '';
            var it = {
              qid: q.id, no: q.no, q: q, block: blk, kind: q.kind,
              given: given, index: items.length,
              build: null, task: null, score: null, ok: null
            };
            if (q.kind === 'build') {
              it.build = checkBuild(q, given);
              it.ok = it.build.answered ? it.build.ok : false;
            } else if (RATED[q.kind]) {
              it.task = byTask[q.id] || null;
              it.score = scoreOf(it.task);
            }
            items.push(it);
          });
        });
        if (!items.length) return;
        out.push({
          id: mod.id || '', label: mod.label || mod.id || 'Writing',
          kind: items[0].kind, items: items, score: summarize(items)
        });
      });
    });
    return out;
  }

  /** 과제 하나의 점수 칩. 자동채점이면 '맞은 수/전체', 루브릭이면 '평균/5.00'. */
  function summarize(items) {
    var auto = 0, autoOk = 0, rated = 0, sum = 0;
    items.forEach(function (it) {
      if (it.kind === 'build') { auto += 1; if (it.ok) autoOk += 1; }
      else if (RATED[it.kind] && it.score !== null) { rated += 1; sum += it.score; }
    });
    if (auto) return { kind: 'auto', got: autoOk, max: auto, text: autoOk + '/' + auto };
    if (rated) return { kind: 'rated', got: sum / rated, max: 5,
                        text: (sum / rated).toFixed(2) + '/5.00' };
    return { kind: 'wait', got: null, max: null, text: '—' };
  }

  /* 'Write for an Academic Discussion' 은 점수 칩에 다 들어가지 않는다. */
  function shortLabel(label) {
    var s = String(label || '');
    if (/build a sentence/i.test(s)) return 'BAS';
    if (/email/i.test(s)) return 'Email';
    if (/discussion/i.test(s)) return 'Discussion';
    return s;
  }

  function markOf(it) {
    if (it.kind === 'build') return it.ok === true ? 'ok' : 'no';
    if (it.score !== null && it.score !== undefined) return 'rated';
    return 'na';
  }

  /* ── 왼쪽: 과제 ───────────────────────────────────────── */

  /** slots[] 를 그대로 편다. fill(i) 가 i 번째 빈칸에 넣을 HTML 을 돌려준다. */
  function slotLine(q, fill) {
    var out = '', b = 0;
    ((q && q.slots) || []).forEach(function (s) {
      if (!s) return;
      if (s.t === 'b') { out += fill(b); b += 1; }
      else out += '<span class="rw-fixed">' + esc(s.text || '') + '</span>';
    });
    return '<div class="rw-line">' + out + '</div>';
  }

  function taskHtml(it) {
    var q = it.q, blk = it.block || {};

    if (it.kind === 'build') {
      return '' +
        '<div class="rw-ask"><span class="rw-face">👤</span>' +
          '<p>' + esc(q.context || q.prompt || '') + '</p></div>' +
        (blk.instruction ? '<p class="rw-ins">' + esc(blk.instruction) + '</p>' : '') +
        '<div class="rw-panel">' +
          '<div class="rw-lab">' + bi('Sentence Structure', '문장 구조') + '</div>' +
          slotLine(q, function () { return '<span class="rw-blank"></span>'; }) +
        '</div>' +
        '<div class="rw-panel">' +
          '<div class="rw-lab">' + bi('Word Bank', '단어 은행') + '</div>' +
          '<div class="rw-tiles">' + ((q.tiles) || []).map(function (t) {
            var trap = ((q.trapTiles) || []).indexOf(t) >= 0;
            return '<span class="rw-tile' + (trap ? ' trap' : '') + '">' + esc(t) + '</span>';
          }).join('') + '</div>' +
        '</div>';
    }

    if (it.kind === 'email') {
      return '' +
        '<div class="rw-kind">' + bi('Write an Email', '이메일 쓰기') + '</div>' +
        '<div class="rw-panel">' +
          (q.to ? '<p class="rw-meta"><b>To</b> ' + esc(q.to) + '</p>' : '') +
          (q.subject ? '<p class="rw-meta"><b>Subject</b> ' + esc(q.subject) + '</p>' : '') +
          '<div class="rw-lab">' + esc(q.situationLabel || 'SITUATION') + '</div>' +
          '<p class="rw-body">' + esc(q.situation || q.prompt || '') + '</p>' +
          (((q.bullets) || []).length
            ? '<div class="rw-lab">' + esc(q.bulletsLabel || 'YOUR EMAIL SHOULD') + '</div>' +
              '<ul class="rw-bullets">' + q.bullets.map(function (b) {
                return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>'
            : '') +
        '</div>';
    }

    if (it.kind === 'discussion') {
      return '' +
        '<div class="rw-kind">' + bi('Academic Discussion', '학술 토론') + '</div>' +
        '<div class="rw-panel">' +
          (q.professor ? '<p class="rw-meta"><b>' + esc(q.professor) + '</b></p>' : '') +
          '<p class="rw-body">' + esc(q.prompt || '') + '</p>' +
          ((q.posts) || []).map(function (p) {
            return '<div class="rw-post"><b>' + esc(p.name || '') + '</b>' +
                   '<p>' + esc(p.text || '') + '</p></div>';
          }).join('') +
        '</div>';
    }

    return '<p class="rw-body">' + esc(q.prompt || '') + '</p>';
  }

  /* ── 오른쪽: 내 답 · 정답 · 점수 ──────────────────────── */

  function answerHtml(it) {
    if (it.kind === 'build') {
      var b = it.build;
      return '' +
        '<div class="rw-panel">' +
          '<div class="rw-lab">' + bi('Your Answer', '내 답') + '</div>' +
          slotLine(it.q, function (i) {
            var t = b.tokens[i];
            if (norm(t) === '') return '<span class="rw-tok void">—</span>';
            return '<span class="rw-tok ' + (b.per[i] ? 'ok' : 'no') + '">' + esc(t) + '</span>';
          }) +
        '</div>' +
        '<div class="rw-panel key">' +
          '<div class="rw-lab">' + bi('Correct Answer', '정답') + '</div>' +
          slotLine(it.q, function (i) {
            return '<span class="rw-tok key">' + esc(b.blanks[i] ? b.blanks[i].a : '') + '</span>';
          }) +
        '</div>';
    }

    var text = String(it.given == null ? '' : it.given);
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return '<div class="rw-panel">' +
      '<div class="rw-lab">' + bi('Your Answer', '내 답') + '</div>' +
      (text
        ? '<p class="rw-essay">' + esc(text) + '</p>' +
          '<p class="rw-count">' + words + ' ' + bi('words', '단어') + '</p>'
        : '<p class="muted">' + bi('(no answer)', '(무응답)') + '</p>') +
    '</div>';
  }

  function verdictHtml(it) {
    if (it.kind === 'build') {
      if (!it.build.answered) {
        return '<div class="rw-verdict no">✗ ' + bi('Not answered', '무응답') + '</div>';
      }
      var wrong = it.build.per.filter(function (x) { return !x; }).length;
      return it.ok
        ? '<div class="rw-verdict ok">✓ ' + bi('Correct!', '정답입니다') + '</div>'
        : '<div class="rw-verdict no">✗ ' + bi('Incorrect', '오답') +
            '<small>' + bi(wrong + ' of ' + it.build.per.length + ' blanks are wrong.',
                           '빈칸 ' + it.build.per.length + '개 중 ' + wrong + '개가 틀렸습니다.') +
            '</small></div>';
    }

    if (it.score === null || it.score === undefined) {
      return '<div class="rw-verdict wait">' +
        bi('Not scored yet.', '아직 채점 전입니다.') +
        '<small>' + bi('Writing is scored against the official ETS scoring guide about a minute after you submit.',
                       '라이팅은 제출 뒤 1분쯤 지나 ETS 공식 채점 가이드로 채점됩니다.') + '</small></div>';
    }
    var t = it.task || {};
    return '<div class="rw-verdict rated">' +
      '<span class="rw-score">' + it.score.toFixed(2) + '<span> / 5.00</span></span>' +
      '<small>' + (t.confirmed_at
        ? bi('Confirmed by a teacher.', '선생님이 확정한 점수입니다.')
        : bi('Scored by AI on the official ETS scoring guide.', 'ETS 공식 채점 가이드로 AI 가 채점했습니다.')) +
      '</small></div>';
  }

  /** 왜 그 점수인가. 점수만 있고 근거가 없으면 학생은 배울 수도 다툴 수도 없다. */
  function rubricHtml(it) {
    var t = it.task;
    if (!t) return '';
    var rub = t.ai_rubric || {}, crit = rub.criteria || [], out = '';
    if (t.ai_error) out += '<p class="muted">' + bi('AI scoring failed: ', 'AI 채점 실패: ') + esc(t.ai_error) + '</p>';
    if (rub.score_basis && rub.score_basis.selected) {
      out += '<div class="rw-basis">' +
        '<p><b>' + bi('Selected band', '선택된 점수 구간') + '</b> — ' +
          esc(rub.score_basis.selected) + '</p>' +
        (rub.score_basis.next
          ? '<p><b>' + bi('Next band up', '바로 위 점수 구간') + '</b> — ' +
              esc(rub.score_basis.next) + '</p>' : '') +
        (rub.score_basis.lower
          ? '<p><b>' + bi('One band lower', '바로 아래 점수 구간') + '</b> — ' +
              esc(rub.score_basis.lower) + '</p>' : '') +
      '</div>';
    } else if (rub.descriptor) {
      out += '<p class="rw-body"><b>' + bi('Selected descriptor', '선택된 기준 문구') + '</b> — ' +
        esc(rub.descriptor) + '</p>';
    }
    if (rub.summary) out += '<p class="rw-body">' + esc(rub.summary) + '</p>';
    if (crit.length) {
      /* 인용은 서버가 답안에서 글자 그대로 찾은 것만 남는다(api/score.js). 그래서 여기
         보이는 말은 학생이 자기 글에서 반드시 찾을 수 있다 — 못 찾는 지적은 안 나온다. */
      out += '<ul class="rw-crit">' + crit.map(function (c) {
        return '<li><b>' + esc(c.criterion) + '</b> — ' + esc(c.comment || '') +
          (c.quote ? ' <q class="rw-quote">' + esc(c.quote) + '</q>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    /* 한 칸 위·아래 점수와의 경계. "왜 4가 아니라 3인가" 가 다음에 무엇을 고쳐야
       하는지를 가장 정확히 말해 준다 — 총평보다 이 한 줄이 실전에 가깝다. */
    if (rub.why_not_higher) {
      out += '<p class="rw-body"><b>' + bi('To score higher', '한 점 더 받으려면') + '</b> — ' +
        esc(rub.why_not_higher) + '</p>';
    }
    if (t.teacher_note) {
      out += '<p class="rw-body"><b>' + bi('Teacher', '선생님') + '</b> — ' + esc(t.teacher_note) + '</p>';
    }
    if (t.ai_score !== null && t.ai_score !== undefined &&
        t.teacher_score !== null && t.teacher_score !== undefined &&
        Number(t.ai_score) !== Number(t.teacher_score)) {
      out += '<p class="muted">' +
        bi('AI said ' + Number(t.ai_score) + ' / 5; the teacher changed it to ' + Number(t.teacher_score) + ' / 5.',
           'AI 는 ' + Number(t.ai_score) + ' / 5 로 봤고, 선생님이 ' + Number(t.teacher_score) + ' / 5 로 고쳤습니다.') +
        '</p>';
    }
    if (t.ai_model) out += '<p class="rw-model">' + esc(t.ai_model) + '</p>';
    if (!out) return '';
    return '<div class="rw-panel"><div class="rw-lab">' +
      bi('Why this score', '채점 근거') + '</div>' + out + '</div>';
  }

  /* ── 화면 ─────────────────────────────────────────────── */

  function tabsHtml(m, state) {
    return '<div class="lr-mods">' + m.map(function (mod, i) {
      var wrong = mod.items.filter(function (x) { return x.kind === 'build' && x.ok === false; }).length;
      return '<button type="button" data-mod="' + i + '"' + (i === state.m ? ' class="on"' : '') + '>' +
        esc(mod.label) +
        '<span class="lr-count">' + mod.items.length + '</span>' +
        (wrong ? '<span class="lr-count bad">' + wrong + ' ✗</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }

  /* 과제별 점수는 늘 셋 다 보인다 — 지금 보는 과제만 보여 주면 라이팅 점수가
     어디서 왔는지 알 수 없다. 보고 있는 과제만 진하게 선다. */
  function scoresHtml(m, state) {
    return '<div class="rw-scores">' + m.map(function (mod, i) {
      return '<div class="rw-chip' + (i === state.m ? ' on' : '') + '">' +
        '<b>' + esc(shortLabel(mod.label)) + '</b>' +
        '<i>' + esc(mod.score.text) + '</i>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* 문항이 하나뿐인 과제(이메일·토론)에는 이동 줄을 그리지 않는다. */
  function stripHtml(mod, state) {
    if (mod.items.length < 2) return '';
    return '<div class="lr-strip"><div class="lr-grp">' +
      '<div class="lr-grp-lab">' + esc(mod.label) + '</div>' +
      '<div class="lr-dots">' + mod.items.map(function (it) {
        return '<button type="button" class="lr-dot ' + markOf(it) +
          (it.index === state.q ? ' now' : '') + '" data-q="' + it.index + '" ' +
          'title="' + esc(it.qid) + '">' + esc(it.no != null ? it.no : '·') + '</button>';
      }).join('') + '</div>' +
    '</div></div>';
  }

  /**
   * 화면 전체 HTML.
   * @param {Array}  m      model()
   * @param {Object} state  { m: 과제 index, q: 그 과제 안 문항 index }
   * @param {Object} opts   { extraFor: fn(qid, item) → HTML }
   */
  function html(m, state, opts) {
    opts = opts || {};
    if (!m || !m.length) {
      return '<div class="lr-empty muted">' +
        bi('This test set has no writing tasks on this device.',
           '이 기기의 세트에 라이팅 과제가 없습니다.') + '</div>';
    }
    var mod = m[Math.min(state.m || 0, m.length - 1)];
    var qi = Math.min(Math.max(state.q || 0, 0), mod.items.length - 1);
    var it = mod.items[qi];
    var st = { m: m.indexOf(mod), q: qi };

    return '<div class="lr rw">' +
      '<div class="lr-bar">' +
        tabsHtml(m, st) +
        '<div class="lr-nav">' +
          (mod.items.length > 1
            ? '<span class="lr-pos">' + bi('Question', '문항') + ' ' + (qi + 1) + ' / ' + mod.items.length + '</span>' +
              '<button class="btn ghost sm" type="button" data-go="prev"' + (qi === 0 ? ' disabled' : '') + '>‹ ' +
                bi('Prev', '이전') + '</button>' +
              '<button class="btn ghost sm" type="button" data-go="next"' +
                (qi === mod.items.length - 1 ? ' disabled' : '') + '>' + bi('Next', '다음') + ' ›</button>' +
              '<button class="btn ghost sm" type="button" data-go="wrong">' +
                bi('Next wrong', '다음 오답') + '</button>'
            : '') +
        '</div>' +
      '</div>' +
      scoresHtml(m, st) +
      stripHtml(mod, st) +
      '<div class="lr-pane">' +
        '<div class="lr-left">' + taskHtml(it) + '</div>' +
        '<div class="lr-right">' +
          answerHtml(it) + verdictHtml(it) + rubricHtml(it) +
          (opts.extraFor ? opts.extraFor(it.qid, it) : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ── 묶기 ─────────────────────────────────────────────── */

  /**
   * mount(el, opts)
   *   opts.pack      콘텐츠 팩
   *   opts.rows      SG_RESULTS.detail(res).rows
   *   opts.tasks     sg_task_scores 행[] (늦게 와도 된다 — setTasks 로 갈아 끼운다)
   *   opts.extraFor  fn(qid, item) → 문항 아래 붙일 HTML(코멘트 등)
   *   opts.onPaint   fn(el) 다시 그린 뒤 부를 것(코멘트 편집기 배선 등)
   * @returns {{repaint, setTasks, state, model}}
   */
  function mount(el, opts) {
    opts = opts || {};
    var m = model(opts.pack, opts.rows, opts.tasks);
    var state = { m: 0, q: 0 };

    /* 처음 열 때는 첫 오답으로 데려간다 — 리뷰에서 먼저 보고 싶은 건 틀린 문항이다.
       오답이 없으면 첫 과제 첫 문항 그대로 둔다. */
    (function () {
      for (var i = 0; i < m.length; i++) {
        for (var j = 0; j < m[i].items.length; j++) {
          if (m[i].items[j].kind === 'build' && m[i].items[j].ok === false) {
            state.m = i; state.q = j; return;
          }
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
          if (items[n].kind === 'build' && items[n].ok === false) return go(n);
        }
      }
    });

    paint();

    /* 과제 점수는 서버에서 늦게 온다. 오면 모델만 새로 짜고 보던 자리는 지킨다 —
       읽던 문항이 점수 도착 때문에 첫 문항으로 튕기면 그게 더 성가시다. */
    function setTasks(tasks) {
      m = model(opts.pack, opts.rows, tasks);
      state.m = Math.min(state.m, Math.max(0, m.length - 1));
      var mod = m[state.m];
      state.q = mod ? Math.min(state.q, mod.items.length - 1) : 0;
      paint();
    }

    return { repaint: paint, setTasks: setTasks, state: state,
             model: function () { return m; } };
  }

  return {
    model: model, html: html, mount: mount,
    shortLabel: shortLabel, summarize: summarize, checkBuild: checkBuild, esc: esc
  };
})();
