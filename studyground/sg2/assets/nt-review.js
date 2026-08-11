/* SMEAG · StudyGround — 문항별 채점 리뷰 (nt-review.html).
 *
 * review.html 이 "한 눈에 훑는 표" 라면 여기는 "한 문항씩 다시 푸는 화면" 이다.
 * 표는 무엇이 틀렸는지 알려 주지만 왜 틀렸는지는 알려 주지 못한다 — 문제문도,
 * 지문도, 단어 은행도 표 칸에는 들어가지 않기 때문이다. 그래서 이 화면은 응시
 * 화면과 같은 자료를 그대로 다시 펴 놓고, 그 옆에 내 답과 정답을 나란히 세운다.
 *
 *   nt-review.html?session=<세션 id>              내 응시
 *   nt-review.html?session=<세션 id>&owner=<uuid> 남의 응시 — 선생님·관리자
 *
 * 채점의 정본은 이 파일이 아니다.
 *   · 객관식(R·L)  — 콘텐츠 팩의 answerKey. sg-results.js 와 같은 비교 규칙을 쓴다.
 *   · Build a Sentence — 팩의 slots[].a. 정답표가 아니라 문항 자체가 정답을 들고 있다.
 *   · 산출형(W2·W3·S) — 서버가 매긴 sg_task_scores(0~5). 여기서는 보여 주기만 한다.
 * 세 벌을 한 화면에 놓되 눈금이 다르다는 사실은 숨기지 않는다 — 0~5 는 0~5 로 쓴다.
 */
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var SESSION = qs.get('session') || '';
  var OWNER = qs.get('owner') || '';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  /* 비교 규칙은 sg-results.js 와 같아야 한다 — 두 화면이 같은 답을 다르게 채점하면
     학생은 어느 쪽을 믿어야 할지 알 수 없다. 끝의 구두점만 더 너그럽게 본다. */
  function norm(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
      .replace(/\s+/g, ' ').replace(/[.,?!;:]+$/, '');
  }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    return M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
           ', ' + p(((h + 11) % 12) + 1) + ':' + p(d.getMinutes()) + ' ' + ap;
  }

  /* ── 상태 ─────────────────────────────────────────────── */

  var RES = null;        // sg_results 행
  var PACK = null;       // 콘텐츠 팩
  var ANS = {};          // 저장된 답안
  var TASKS = [];        // sg_task_scores 행
  var TASK_BY = {};      // question_id → 행
  var VIEW = null;       // SG_BAND.of()
  var CMT = [];          // 코멘트
  var TREE = [];         // [{id,label,mods:[{id,label,items:[]}]}]
  var WHO = null;        // 남의 응시를 볼 때의 학생 프로필
  var at = { sec: 'summary', mod: '', i: 0 };

  var SECLABEL = { reading: 'Reading', listening: 'Listening',
                   writing: 'Writing', speaking: 'Speaking' };
  var SECICON = { summary: '📄', reading: '📖', listening: '🎧',
                  writing: '✍️', speaking: '🎙️' };

  /* 산출형 과제 — 정답표가 없고 0~5 루브릭으로만 매겨지는 문항. */
  var RATED = { email: 1, discussion: 1, repeat: 1, interview: 1 };

  /* ── 팩 펼치기 ─────────────────────────────────────────── */

  function buildTree(pack) {
    var out = [];
    (pack && pack.sections || []).forEach(function (sec) {
      var mods = [];
      (sec.modules || []).forEach(function (mod) {
        var items = [];
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            items.push({ q: q, blk: blk, mod: mod, sec: sec });
          });
        });
        if (items.length) mods.push({ id: mod.id || '', label: mod.label || mod.id || '', items: items });
      });
      if (mods.length) out.push({ id: String(sec.id || '').toLowerCase(), label: sec.label || sec.id, mods: mods });
    });
    return out;
  }

  function sectionOf(id) {
    for (var i = 0; i < TREE.length; i++) if (TREE[i].id === id) return TREE[i];
    return null;
  }
  function moduleOf(sec, id) {
    if (!sec) return null;
    for (var i = 0; i < sec.mods.length; i++) if (sec.mods[i].id === id) return sec.mods[i];
    return sec.mods[0] || null;
  }

  /* ── 답안 · 채점 ───────────────────────────────────────── */

  function givenOf(qid) {
    var rec = ANS[qid];
    if (rec == null) return null;
    return (typeof rec === 'object' && rec !== null && 'v' in rec) ? rec.v : rec;
  }
  function keyOf(q) {
    var keys = (PACK && PACK.answerKey) || {};
    return keys.hasOwnProperty(q.id) ? keys[q.id] : q.answer;
  }

  /* Build a Sentence — 빈칸마다 정답이 문항 안에 있다(slots[].a). */
  function blanksOf(q) {
    return ((q.slots) || []).filter(function (s) { return s && s.t === 'b'; });
  }
  function buildCheck(q, val) {
    var blanks = blanksOf(q);
    var toks = isArr(val) ? val : [];
    var per = blanks.map(function (s, i) {
      return norm(toks[i]) !== '' && norm(toks[i]) === norm(s.a);
    });
    var answered = false;
    for (var i = 0; i < toks.length; i++) if (norm(toks[i]) !== '') answered = true;
    var ok = blanks.length > 0;
    for (var j = 0; j < per.length; j++) if (!per[j]) ok = false;
    return { blanks: blanks, tokens: toks, per: per, ok: ok, answered: answered };
  }

  function taskOf(qid) { return TASK_BY[qid] || null; }
  function taskScore(row) {
    if (!row) return null;
    var v = (row.teacher_score === null || row.teacher_score === undefined)
      ? row.ai_score : row.teacher_score;
    return (v === null || v === undefined || v === '') ? null : Number(v);
  }

  /**
   * 문항 하나의 판정.
   * @returns { state: 'ok'|'no'|'rated'|'wait', score?, max? }
   *   ok    자동채점 정답        no    자동채점 오답(무응답 포함)
   *   rated 0~5 루브릭 점수 있음  wait  아직 채점 전
   */
  function verdict(item) {
    var q = item.q, val = givenOf(q.id);

    if (RATED[q.kind]) {
      var row = taskOf(q.id), sc = taskScore(row);
      if (sc === null) return { state: 'wait', row: row };
      return { state: 'rated', score: sc, max: 5, row: row };
    }
    if (q.kind === 'build') {
      var b = buildCheck(q, val);
      if (!b.answered) return { state: 'no', blank: true, build: b };
      return { state: b.ok ? 'ok' : 'no', build: b };
    }
    var key = keyOf(q);
    if (key === null || key === undefined) return { state: 'wait' };
    if (val === null || val === '' || val === undefined) return { state: 'no', blank: true };

    var list = isArr(key) ? key : [key];
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === 'number') { if (Number(val) === list[i]) return { state: 'ok' }; }
      else if (norm(val) === norm(list[i])) return { state: 'ok' };
    }
    return { state: 'no' };
  }

  /** 과제(모듈) 하나의 점수. 자동채점이면 '맞은 수/전체', 루브릭이면 '평균/5.00'. */
  function moduleScore(mod) {
    var rated = 0, ratedSum = 0, auto = 0, autoOk = 0, waiting = 0;
    mod.items.forEach(function (it) {
      var v = verdict(it);
      if (v.state === 'rated') { rated += 1; ratedSum += v.score; }
      else if (v.state === 'wait') waiting += 1;
      else { auto += 1; if (v.state === 'ok') autoOk += 1; }
    });
    if (auto) return { text: autoOk + '/' + auto, kind: 'auto' };
    if (rated) return { text: (ratedSum / rated).toFixed(2) + '/5.00', kind: 'rated' };
    return { text: waiting ? '—' : '—', kind: 'wait' };
  }

  /* ── 조각 그리기 ───────────────────────────────────────── */

  function box(title, inner, cls) {
    return '<div class="nt-box ' + (cls || '') + '">' +
      (title ? '<h3>' + esc(title) + '</h3>' : '') + inner + '</div>';
  }

  /** slots[] 를 그대로 편다. fill(i) 가 빈칸 i 에 넣을 HTML 을 돌려준다. */
  function slotLine(q, fill) {
    var out = '', b = 0;
    (q.slots || []).forEach(function (s) {
      if (!s) return;
      if (s.t === 'b') { out += fill(b); b += 1; }
      else out += '<span class="nt-plain">' + esc(s.text || '') + '</span>';
    });
    return '<div class="nt-answer">' + out + '</div>';
  }

  function piece(text, cls) {
    return '<span class="nt-piece ' + cls + '">' + esc(text) + '</span>';
  }

  /* 왼쪽 — 문제. 응시 때 보던 것을 그대로 다시 놓는다. */
  function paintAsk(item) {
    var q = item.q, blk = item.blk, out = '';
    var inst = blk.instruction || '';

    if (q.kind === 'build') {
      out += '<div class="nt-ask"><span class="nt-face">👤</span>' +
             '<p>' + esc(q.context || q.prompt || '') + '</p></div>';
      if (inst) out += '<p class="nt-inst" style="margin-bottom:12px">' + esc(inst) + '</p>';
      out += box('Sentence Structure',
        '<div class="nt-slots">' + (q.slots || []).map(function (s) {
          return s && s.t === 'b'
            ? '<span class="nt-slot-blank"></span>'
            : '<span class="nt-slot-fixed">' + esc(s && s.text || '') + '</span>';
        }).join('') + '</div>');
      var tiles = (q.tiles || []).map(function (t) {
        var trap = (q.trapTiles || []).indexOf(t) >= 0;
        return '<span class="nt-tile' + (trap ? ' trap' : '') + '">' + esc(t) + '</span>';
      }).join('');
      out += box('Word Bank', '<div class="nt-tiles">' + tiles + '</div>');
      return out;
    }

    if (q.kind === 'email') {
      out += box('Task · Write an Email',
        (q.to ? '<p class="nt-plain"><b>To</b> ' + esc(q.to) + '</p>' : '') +
        (q.subject ? '<p class="nt-plain"><b>Subject</b> ' + esc(q.subject) + '</p>' : '') +
        '<p class="nt-essay" style="margin-top:8px">' + esc(q.situation || q.prompt || '') + '</p>' +
        ((q.bullets || []).length
          ? '<h3 style="margin-top:12px">' + esc(q.bulletsLabel || 'YOUR EMAIL SHOULD') + '</h3>' +
            '<ul class="nt-bullets">' + q.bullets.map(function (b) {
              return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>'
          : ''));
      return out;
    }

    if (q.kind === 'discussion') {
      out += box('Task · Write for an Academic Discussion',
        (q.professor ? '<p class="nt-plain"><b>' + esc(q.professor) + '</b></p>' : '') +
        '<p class="nt-essay" style="margin-top:8px">' + esc(q.prompt || '') + '</p>' +
        (q.posts || []).map(function (p) {
          return '<div class="nt-post"><b>' + esc(p.name || '') + '</b>' +
                 '<p>' + esc(p.text || '') + '</p></div>';
        }).join(''));
      return out;
    }

    if (q.kind === 'repeat' || q.kind === 'interview') {
      out += box('Task', (inst ? '<p class="nt-inst">' + esc(inst) + '</p>' : '') +
        (q.image ? '<img src="' + esc(q.image) + '" alt="" style="border-radius:12px;margin-top:10px">' : '') +
        (q.audio ? '<audio controls preload="none" src="' + esc(q.audio) + '"></audio>' : '') +
        (q.prompt ? '<p class="nt-prompt" style="margin-top:10px">' + esc(q.prompt) + '</p>' : ''));
      return out;
    }

    /* 리딩·리스닝. 문제문은 오른쪽에 있고, 여기에는 그 문제가 딛고 선 자료를 놓는다. */
    if (inst) out += '<p class="nt-inst" style="margin-bottom:12px">' + esc(inst) + '</p>';

    if (blk.kind === 'cloze' && blk.template) {
      out += box(blk.heading || 'Passage', '<div class="nt-passage">' +
        clozeHTML(blk, q.id) + '</div>');
    }
    if (blk.kind === 'passage') {
      out += box(blk.title || blk.heading || 'Passage',
        '<div class="nt-passage">' + (blk.paragraphs || []).map(function (p) {
          return '<p>' + esc(p) + '</p>';
        }).join('') + '</div>');
    }
    if (blk.kind === 'audio-set') {
      out += box(blk.heading || 'Audio',
        (blk.image ? '<img src="' + esc(blk.image) + '" alt="" style="border-radius:12px">' : '') +
        (blk.audio ? '<audio controls preload="none" src="' + esc(blk.audio) + '"></audio>' : '') +
        (q.audio ? '<audio controls preload="none" src="' + esc(q.audio) + '"></audio>' : '') +
        (blk.script
          ? '<details class="nt-fold" style="margin-top:12px"><summary>Show the transcript</summary>' +
            '<pre>' + esc(blk.script) + '</pre></details>'
          : ''));
    }
    if (q.kind === 'insert' && q.sentence) {
      out += box('Sentence to insert', '<p class="nt-essay">' + esc(q.sentence) + '</p>');
    }
    return out;
  }

  /* cloze 템플릿의 {{n}} 을 빈칸으로 바꾼다. 지금 보고 있는 문항만 노랗게 남긴다 —
     열 개의 빈칸이 똑같이 생기면 어느 자리를 묻는지 알 수 없다. */
  function clozeHTML(blk, qid) {
    var qs = blk.questions || [];
    var idx = {};
    qs.forEach(function (q, i) { idx[String(i + 1)] = q; });
    return '<p>' + esc(blk.template).replace(/\{\{(\d+)\}\}/g, function (_, n) {
      var q = idx[n];
      if (!q) return '____';
      var mine = q.id === qid;
      var label = q.hint ? q.hint + '____' : '____';
      return mine ? '<b class="nt-hl">' + esc(label) + '</b>' : esc(label);
    }) + '</p>';
  }

  /* 오른쪽 — 내 답 · 정답 · 판정. */
  function paintAnswer(item) {
    var q = item.q, val = givenOf(q.id), v = verdict(item), out = '';

    if (q.kind === 'build') {
      var b = v.build;
      out += box('Your Answer', slotLine(q, function (i) {
        var t = b.tokens[i];
        if (norm(t) === '') return piece('—', 'void');
        return piece(t, b.per[i] ? 'ok' : 'no');
      }));
      out += box('Correct Answer', slotLine(q, function (i) {
        return piece(b.blanks[i] ? b.blanks[i].a : '', 'key');
      }), 'nt-card-key');
      out += verdictBox(v);
      return out;
    }

    if (RATED[q.kind]) {
      var row = v.row;
      var text = (q.kind === 'repeat' || q.kind === 'interview')
        ? (row && row.transcript ? row.transcript : '')
        : String(val == null ? '' : val);

      var mine = '';
      if (q.kind === 'repeat' || q.kind === 'interview') {
        mine += (typeof val === 'string' && val.indexOf('idb:') === 0)
          ? '<div data-play="' + esc(val.slice(4)) + '"></div>' : '';
        if (row && row.media_path) mine += '<div data-cloudplay="' + esc(row.media_path) + '"></div>';
        mine += text
          ? '<p class="nt-essay" style="margin-top:10px">' + esc(text) + '</p>' +
            '<p class="nt-inst" style="margin-top:6px">Transcribed' +
              (row.transcript_model ? ' by ' + esc(row.transcript_model) : '') + '.</p>'
          : '<p class="nt-inst" style="margin-top:10px">No transcript yet.</p>';
      } else {
        mine += text
          ? '<p class="nt-essay">' + esc(text) + '</p>' +
            '<p class="nt-inst" style="margin-top:8px">' +
              text.trim().split(/\s+/).length + ' words</p>'
          : '<p class="nt-inst">No answer was submitted.</p>';
      }
      out += box(q.kind === 'repeat' || q.kind === 'interview' ? 'Your Recording' : 'Your Answer', mine);
      out += verdictBox(v);
      out += rubricBox(row);
      return out;
    }

    var key = keyOf(q);

    if (q.choices && q.choices.length) {
      var picked = (val === '' || val == null) ? -1 : Number(val);
      var right = typeof key === 'number' ? key : -1;
      out += box(q.prompt ? '' : 'Choices',
        (q.prompt ? '<p class="nt-prompt" style="margin-bottom:12px">' + esc(q.prompt) + '</p>' : '') +
        '<div class="nt-choices">' + q.choices.map(function (c, i) {
          var cls = (i === picked ? ' picked' : '') + (i === right ? ' correct' : '');
          var tag = i === picked && i === right ? 'your answer · correct'
                  : i === picked ? 'your answer'
                  : i === right ? 'correct answer' : '';
          return '<div class="nt-choice' + cls + '">' +
            '<span class="nt-letter">' + String.fromCharCode(65 + i) + '</span>' +
            '<span>' + esc(c) + '</span>' +
            (tag ? '<span class="nt-tag">' + tag + '</span>' : '') + '</div>';
        }).join('') + '</div>');
      out += verdictBox(v);
      return out;
    }

    /* 빈칸 채우기 — 한 낱말이 전부다. 힌트도 함께 보여야 무엇을 물었는지 남는다. */
    out += box('Your Answer',
      (q.hint ? '<p class="nt-inst" style="margin-bottom:8px">Hint · ' + esc(q.hint) + '…</p>' : '') +
      '<div class="nt-answer">' +
        (val === '' || val == null ? piece('(no answer)', 'void')
                                   : piece(isArr(val) ? val.join(' ') : val, v.state === 'ok' ? 'ok' : 'no')) +
      '</div>');
    if (key !== null && key !== undefined) {
      out += box('Correct Answer', '<div class="nt-answer">' +
        (isArr(key) ? key : [key]).map(function (k) { return piece(k, 'key'); }).join('') +
        '</div>', 'nt-card-key');
    }
    out += verdictBox(v);
    return out;
  }

  function verdictBox(v) {
    if (v.state === 'ok') return '<div class="nt-verdict ok">✅ Correct!</div>';
    if (v.state === 'no') {
      return '<div class="nt-verdict no">❌ ' +
        (v.blank ? 'Not answered' : 'Incorrect') + '</div>';
    }
    if (v.state === 'rated') {
      var row = v.row || {};
      return '<div class="nt-verdict rated"><span class="nt-mark">' +
        v.score.toFixed(2) + '<span>/ 5.00</span></span>' +
        '<span>' + (row.confirmed_at ? 'Confirmed by a teacher'
                                     : 'AI draft — a teacher has not confirmed it yet') + '</span></div>';
    }
    return '<div class="nt-verdict wait">⏳ Not scored yet.<small>' +
      'Writing and Speaking are scored against the official ETS scoring guide a minute or so after you submit.' +
      '</small></div>';
  }

  /** 왜 그 점수인가 — 루브릭 근거. 점수만 있고 근거가 없으면 다툴 수도 배울 수도 없다. */
  function rubricBox(row) {
    if (!row) return '';
    var rub = row.ai_rubric || {}, crit = rub.criteria || [], out = '';
    if (row.ai_error) out += '<p class="nt-inst">AI scoring failed: ' + esc(row.ai_error) + '</p>';
    if (rub.summary) out += '<p class="nt-essay">' + esc(rub.summary) + '</p>';
    if (crit.length) {
      out += '<ul class="nt-rubric">' + crit.map(function (c) {
        return '<li><b>' + esc(c.criterion) + '</b> — ' + esc(c.comment || '') + '</li>';
      }).join('') + '</ul>';
    }
    if (row.teacher_note) {
      out += '<p class="nt-essay" style="margin-top:10px"><b>Teacher</b> — ' + esc(row.teacher_note) + '</p>';
    }
    if (row.ai_score !== null && row.ai_score !== undefined &&
        row.teacher_score !== null && row.teacher_score !== undefined &&
        Number(row.ai_score) !== Number(row.teacher_score)) {
      out += '<p class="nt-inst" style="margin-top:8px">AI said ' + Number(row.ai_score) +
             ' / 5; the teacher changed it to ' + Number(row.teacher_score) + ' / 5.</p>';
    }
    if (row.ai_model) out += '<p class="nt-inst" style="margin-top:6px">' + esc(row.ai_model) + '</p>';
    if (!out) return '';
    return box('Why this score', out);
  }

  /** 문항에 달린 코멘트(선생님 · AI). 없으면 아무것도 그리지 않는다. */
  function commentBox(qid) {
    var notes = CMT.filter(function (c) {
      return c.scope === 'question' && (c.question_id || '') === qid;
    });
    if (!notes.length) return '';
    return box('Comments', notes.map(function (c) {
      var who = c.source === 'teacher'
        ? 'Teacher' + (c.author_name ? ' · ' + esc(c.author_name) : '')
        : 'AI' + (c.model ? ' · ' + esc(c.model) : '');
      return '<p class="nt-inst">' + who + '</p>' +
             (c.body ? '<p class="nt-essay" style="margin-bottom:8px">' + esc(c.body) + '</p>' : '');
    }).join(''));
  }

  /* ── 화면 ─────────────────────────────────────────────── */

  function paintBar() {
    var tabs = ['summary', 'reading', 'listening', 'writing', 'speaking'].map(function (id) {
      var has = id === 'summary' || !!sectionOf(id);
      return '<button data-sec="' + id + '"' + (has ? '' : ' disabled') +
        (at.sec === id ? ' class="on"' : '') + '>' + SECICON[id] + ' ' +
        (id === 'summary' ? 'Summary' : SECLABEL[id]) + '</button>';
    }).join('');

    $('bar').innerHTML =
      '<a class="nt-back" href="' + (OWNER ? 'admin-results.html' : 'dashboard.html') + '">← ' +
        (OWNER ? 'All results' : 'Dashboard') + '</a>' +
      '<span class="nt-setcode">' + esc(RES.set_code || '') + '</span>' +
      '<span class="nt-title">Review</span>' +
      '<span class="nt-meta">' + esc(RES.mode === 'full' || !RES.mode ? 'Full Test' : RES.mode) +
        ' · ' + esc(when(RES.submitted_at)) + '</span>' +
      '<span class="nt-secs" style="margin-left:18px">' + tabs + '</span>' +
      '<span class="nt-who">' + esc((WHO && (WHO.name || WHO.email)) ||
        (window.SG_AUTH && SG_AUTH.user() && SG_AUTH.user().email) || '') + '</span>';

    $('bar').onclick = function (e) {
      var b = e.target.closest('button[data-sec]');
      if (!b || b.disabled) return;
      go(b.getAttribute('data-sec'), '', 0);
    };
  }

  function paintSub() {
    var sec = sectionOf(at.sec);
    if (!sec) { $('sub').style.display = 'none'; return; }
    $('sub').style.display = '';
    var mod = moduleOf(sec, at.mod);

    var mods = sec.mods.map(function (m) {
      return '<button data-mod="' + esc(m.id) + '"' + (m === mod ? ' class="on"' : '') + '>' +
        esc(m.label) + '<span class="nt-count">' + m.items.length + '</span></button>';
    }).join('');

    var scores = sec.mods.map(function (m) {
      var s = moduleScore(m);
      return '<div class="nt-score' + (m === mod ? ' on' : '') + '">' +
        '<b>' + esc(shortLabel(m.label)) + '</b><i>' + esc(s.text) + '</i></div>';
    }).join('');

    var nav = mod.items.map(function (it, i) {
      var v = verdict(it);
      var cls = v.state === 'ok' ? 'ok' : v.state === 'no' ? 'no'
              : v.state === 'rated' ? 'rated' : 'wait';
      return '<button data-i="' + i + '" class="' + cls + (i === at.i ? ' on' : '') + '">' +
        (it.q.no != null ? it.q.no : i + 1) + '</button>';
    }).join('');

    $('sub').innerHTML =
      '<div class="nt-sub-in">' +
        '<span class="nt-mods">' + mods + '</span>' +
        '<span class="nt-pos">Question ' + (at.i + 1) + ' of ' + mod.items.length + '</span>' +
        '<button class="nt-step" data-step="-1"' + (at.i === 0 ? ' disabled' : '') + '>‹ Prev</button>' +
        '<button class="nt-step" data-step="1"' +
          (at.i >= mod.items.length - 1 ? ' disabled' : '') + '>Next ›</button>' +
        '<span class="nt-scores">' + scores + '</span>' +
        '<span class="nt-nav">' + nav + '</span>' +
      '</div>';

    $('sub').onclick = function (e) {
      var m = e.target.closest('button[data-mod]');
      if (m) { go(at.sec, m.getAttribute('data-mod'), 0); return; }
      var n = e.target.closest('button[data-i]');
      if (n) { go(at.sec, at.mod, Number(n.getAttribute('data-i'))); return; }
      var s = e.target.closest('button[data-step]');
      if (s && !s.disabled) go(at.sec, at.mod, at.i + Number(s.getAttribute('data-step')));
    };
  }

  /* 점수 칩은 좁다. 'Build a Sentence' 를 다 적으면 칩 넷이 한 줄을 다 먹는다. */
  function shortLabel(label) {
    var s = String(label || '');
    if (/build a sentence/i.test(s)) return 'BAS';
    if (/email/i.test(s)) return 'Email';
    if (/discussion/i.test(s)) return 'Discussion';
    return s.replace(/^(Reading|Listening|Speaking)\s*/i, '').replace(/·.*$/, '').trim() || s;
  }

  function paintBody() {
    var body = $('body');
    if (at.sec === 'summary') { body.className = 'nt-body one'; body.innerHTML = summaryHTML(); return; }

    var sec = sectionOf(at.sec), mod = moduleOf(sec, at.mod);
    var item = mod.items[at.i];
    if (!item) { body.innerHTML = ''; return; }

    body.className = 'nt-body';
    body.innerHTML = '<div>' + paintAsk(item) + '</div>' +
                     '<div>' + paintAnswer(item) + commentBox(item.q.id) + '</div>';
    wirePlayback();
    wireCloudPlayback();
  }

  function summaryHTML() {
    var v = VIEW, band = v && v.overall !== null ? SG_BAND.fmt(v.overall) : null;
    var cards = ['reading', 'listening', 'writing', 'speaking'].map(function (id) {
      var s = v && v.sections[id], b = s && s.band !== null ? s.band : null;
      var d = (s && s.detail) || null;
      var foot = b === null ? 'not scored yet'
        : s.status === 'draft' ? 'AI draft · awaiting teacher'
        : s.status === 'final' ? 'teacher-confirmed'
        : d ? d.correct + '/' + d.total + ' → ' + d.scaled + '/30' : '';
      return '<div class="nt-box"><h3>' + SECLABEL[id] + '</h3>' +
        '<div class="nt-band-big" style="font-size:30px;color:' +
          (b === null ? 'var(--muted)' : '#1d4ed8') + '">' +
          (b === null ? '—' : SG_BAND.fmt(b) + '<span> / 6.0</span>') + '</div>' +
        '<p class="nt-inst" style="margin-top:6px">' + esc(foot) + '</p></div>';
    }).join('');

    var overall = '<div class="nt-box">' +
      '<h3>Overall band</h3>' +
      '<div class="nt-band-big">' +
        (band ? esc(band) + '<span> / 6.0</span>'
              : '<span style="font-size:22px">Not scored yet</span>') + '</div>' +
      '<p class="nt-inst" style="margin-top:8px">' +
        (v && v.cefr ? 'CEFR ' + esc(v.cefr) + ' · ' : '') +
        esc(RES.set_code || '') + ' · ' + esc(when(RES.submitted_at)) + '</p>' +
      (v && v.draft ? '<p class="nt-inst">✎ Includes an AI draft a teacher has not confirmed yet.</p>' : '') +
      '</div>';

    var notes = ['overall', 'reading', 'listening', 'writing', 'speaking'].map(function (scope) {
      var list = CMT.filter(function (c) { return c.scope === scope; });
      if (!list.length) return '';
      return '<div class="nt-box"><h3>' +
        (scope === 'overall' ? 'Overall comment' : SECLABEL[scope] + ' comment') + '</h3>' +
        list.map(function (c) {
          return '<p class="nt-inst">' + (c.source === 'teacher' ? 'Teacher' : 'AI') +
                 (c.model ? ' · ' + esc(c.model) : '') + '</p>' +
                 (c.body ? '<p class="nt-essay" style="margin-bottom:8px">' + esc(c.body) + '</p>' : '') +
                 listOf('What went well', c.strengths) + listOf('What to work on', c.improvements);
        }).join('') + '</div>';
    }).join('');

    return overall + '<div class="nt-bands" style="margin-top:14px">' + cards + '</div>' + notes +
      '<div class="nt-box" style="margin-top:14px">' +
        '<p class="nt-inst">Reading and Listening are scored on this device from the answer key. ' +
        'Writing and Speaking are scored 0–5 against the official ETS scoring guide, ' +
        'then confirmed by a teacher. Pick a section above to go through the questions one by one.</p>' +
        '<p style="margin-top:10px"><a class="btn ghost sm" href="review.html?session=' +
          encodeURIComponent(SESSION) + (OWNER ? '&owner=' + encodeURIComponent(OWNER) : '') +
          '">See every question in one table</a></p>' +
      '</div>';
  }

  function listOf(label, arr) {
    if (!arr || !arr.length) return '';
    return '<p class="nt-inst">' + esc(label) + '</p><ul class="nt-rubric">' +
      arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }

  function go(sec, mod, i) {
    at.sec = sec;
    var s = sectionOf(sec);
    if (s) {
      var m = moduleOf(s, mod || at.mod);
      at.mod = m ? m.id : '';
      at.i = Math.max(0, Math.min(i || 0, (m ? m.items.length : 1) - 1));
    } else { at.mod = ''; at.i = 0; }
    location.hash = '#' + at.sec + (at.mod ? '/' + at.mod + '/' + at.i : '');
    paint();
  }

  function fromHash() {
    var p = String(location.hash || '').replace(/^#/, '').split('/');
    if (!p[0]) return;
    at.sec = p[0];
    at.mod = p[1] || '';
    at.i = Number(p[2] || 0) || 0;
  }

  function paint() { paintBar(); paintSub(); paintBody(); }

  /* ── 녹음 재생 ─────────────────────────────────────────────
   * 녹음은 두 군데에 있다. 응시한 기기의 IndexedDB 와, 제출 뒤 올라간 비공개 버킷.
   * 앞의 것은 그 기기에서만 열리고, 뒤의 것은 서명 URL 로 어느 기기에서나 열린다. */
  function playerInto(slot, src) {
    if (!slot || slot.querySelector('audio')) return;
    var a = document.createElement('audio');
    a.controls = true; a.preload = 'none'; a.src = src;
    slot.appendChild(a);
  }

  function wirePlayback() {
    var S = window.SG_STORE;
    var slots = document.querySelectorAll('[data-play]');
    if (!slots.length || !S || typeof S.getMedia !== 'function' || !SESSION) return;
    try { S.open(SESSION, false); } catch (e) { return; }   // 진행 중인 시험을 건드리지 않는다
    Array.prototype.forEach.call(slots, function (slot) {
      S.getMedia(slot.getAttribute('data-play'), function (err, rec) {
        var blob = rec && rec.blob ? rec.blob : rec;
        if (err || !blob || !blob.size) return;
        playerInto(slot, URL.createObjectURL(blob));
      });
    });
  }

  function wireCloudPlayback() {
    var slots = document.querySelectorAll('[data-cloudplay]');
    if (!slots.length || !window.SG_AUTH) return;
    SG_AUTH.token().then(function (tok) {
      if (!tok) return;
      Array.prototype.forEach.call(slots, function (slot) {
        if (slot.dataset.wired) return;
        slot.dataset.wired = '1';
        var path = slot.getAttribute('data-cloudplay');
        fetch(SG_AUTH.url + '/storage/v1/object/sign/toefl-recordings/' +
              path.split('/').map(encodeURIComponent).join('/'), {
          method: 'POST',
          headers: { apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok,
                     'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && j.signedURL) playerInto(slot, SG_AUTH.url + '/storage/v1' + j.signedURL);
          })['catch'](function () {});
      });
    })['catch'](function () {});
  }

  /* ── 부팅 ─────────────────────────────────────────────── */

  function notice(msg) {
    $('body').className = 'nt-body one';
    $('body').innerHTML = '<div class="nt-box"><p>' + esc(msg) + '</p></div>';
  }

  function render(res, who) {
    RES = res; WHO = who;
    PACK = SG_RESULTS.pack(res.set_code);
    if (!PACK) {
      notice('This test set is not loaded on this device, so the questions cannot be shown.');
      return;
    }
    ANS = res.answers || {};
    TREE = buildTree(PACK);
    VIEW = window.SG_BAND ? SG_BAND.of(res, []) : null;

    fromHash();
    paint();

    var ownerId = OWNER || res.owner || (window.SG_AUTH && SG_AUTH.user() && SG_AUTH.user().id) || '';
    if (!ownerId) return;

    SG_RESULTS.tasks(SESSION, ownerId).then(function (rows) {
      TASKS = rows || [];
      TASK_BY = {};
      TASKS.forEach(function (r) { if (r && r.question_id) TASK_BY[r.question_id] = r; });
      VIEW = SG_BAND.of(res, TASKS);
      paint();
    })['catch'](function () {});

    if (window.SG_COMMENTS) {
      SG_COMMENTS.list(ownerId, SESSION).then(function (rows) {
        CMT = rows || [];
        paint();
      })['catch'](function () {});
    }
  }

  function boot() {
    if (!SESSION) { notice('No test was specified.'); return; }
    window.addEventListener('hashchange', function () { fromHash(); paint(); });

    SG_RESULTS.get(SESSION, OWNER).then(function (res) {
      if (!res) {
        notice('That test result was not found, or you are not allowed to see it.');
        return;
      }
      if (!OWNER || !window.SG_AUTH) { render(res, null); return; }
      SG_AUTH.token().then(function (tok) {
        if (!tok) { render(res, null); return; }
        fetch(SG_AUTH.url + '/rest/v1/sg_profiles?select=name,student_id,email&id=eq.' +
              encodeURIComponent(OWNER), {
          headers: { apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok }
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (rows) { render(res, rows && rows[0]); })
          ['catch'](function () { render(res, null); });
      });
    })['catch'](function () { notice('Could not load the result.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
