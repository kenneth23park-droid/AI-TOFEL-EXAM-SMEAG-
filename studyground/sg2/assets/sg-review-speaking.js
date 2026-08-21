/* SMEAG · StudyGround 2.0 — 스피킹 채점 리뷰(문항 하나씩 펼쳐 보기).
 *
 * 왜 표가 아니라 이 화면인가.
 *   스피킹의 답은 글이 아니라 소리다. 표 한 칸에 넣을 수 있는 것은 "녹음 제출됨" 뿐이고,
 *   그것으로는 아무도 점수를 이해할 수 없다. 학생이 다시 만나야 하는 것은 넷이다 —
 *   무엇을 들려줬나(그림·원문·오디오), 내가 뭐라고 말했나(녹음), 그 말이 어떻게 옮겨
 *   적혔나(전사), 그래서 몇 점인가(루브릭). 넷이 한 화면에 있어야 "왜 이 점수인가"에
 *   답이 된다. 잘못 들린 낱말 하나 때문에 깎였는지도 여기서만 보인다.
 *
 * 두 과제는 재는 것이 다르다. 그 사실을 화면에서 감추지 않는다.
 *   S1 Listen and Repeat — 들려준 문장을 그대로 따라 말한다. 원문이 있으므로 낱말
 *                          단위로 대조해 무엇을 빠뜨리고 무엇을 덧붙였는지까지 보여 준다.
 *   S2 Interview        — 정답 문장이라는 것이 없다. 루브릭 축과 총평만 보여 준다.
 *   둘 다 점수는 서버가 ETS 루브릭으로 매긴 0~5(sg_task_scores)이고, 선생님이 확정하면
 *   그 점수가 이긴다.
 *
 * 의존 전역(없으면 각각 degrade):
 *   SG_MEDIA   원본 경로 → 배포 경로 리맵
 *   SG_AUDIO   관리자 오디오 교체·배속
 *   SG_STORE   응시 기기의 녹음(IndexedDB)
 *   SG_AUTH    비공개 버킷의 녹음(서명 URL) — 다른 기기·선생님 화면
 *
 * 노출 전역: window.SG_REVIEW_SPEAKING
 *   .compare(reference, said)   → 낱말 대조 {ops,total,matched,missing,added,substituted,accuracy}
 *   .model(pack, rows, tasks)   → [{id,label,items,score}]  과제 → 문항
 *   .html(model, state, opts)   → 화면 전체 HTML (순수 함수 — 테스트가 이걸 본다)
 *   .mount(el, opts)            → 그리고 클릭·이동·녹음 재생까지 묶는다
 *
 * ES5 — 빌드 없이 <script src> 로 읽힌다.
 */
window.SG_REVIEW_SPEAKING = (function () {
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

  /** sg_task_scores 한 행의 최종 점수. 선생님이 손댔으면 선생님이 이긴다. */
  function scoreOf(task) {
    if (!task) return null;
    var v = (task.teacher_score === null || task.teacher_score === undefined)
      ? task.ai_score : task.teacher_score;
    return (v === null || v === undefined || v === '') ? null : Number(v);
  }

  /* ── 원문 대조 ────────────────────────────────────────────
   *
   * 낱말을 고르고 세는 규칙은 서버 채점기(app/scoring/rubric.py 의 _repeat_tokens ·
   * compare_repeat)와 같아야 한다. 화면이 "7개 중 6개 맞음" 이라 하는데 점수는 다른
   * 셈법에서 나왔다면, 학생이 보는 근거가 근거가 아니게 된다. 그래서 여기서도 소문자로
   * 낮추고, 굽은 따옴표를 곧게 펴고, 아포스트로피만 낱말의 일부로 남긴 채 구두점에서
   * 자른다(today's 는 한 낱말, first-time 은 두 낱말).
   */
  function tokens(text) {
    var body = String(text == null ? '' : text).toLowerCase().replace(/[‘’ʼ]/g, "'");
    return body.replace(/[^a-z0-9']+/g, ' ').split(' ').filter(function (t) { return t; });
  }

  /* 최장 공통 부분수열. 복창은 한 문장(길어야 스무 낱말)이라 표를 통째로 채워도 싸다. */
  function diff(ref, hyp) {
    var n = ref.length, m = hyp.length, i, j;
    var L = [];
    for (i = 0; i <= n; i++) { L.push([]); for (j = 0; j <= m; j++) L[i].push(0); }
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        L[i][j] = ref[i] === hyp[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (ref[i] === hyp[j]) { ops.push({ t: 'eq', w: ref[i] }); i += 1; j += 1; }
      else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ t: 'del', w: ref[i] }); i += 1; }
      else { ops.push({ t: 'ins', w: hyp[j] }); j += 1; }
    }
    while (i < n) { ops.push({ t: 'del', w: ref[i] }); i += 1; }
    while (j < m) { ops.push({ t: 'ins', w: hyp[j] }); j += 1; }
    return ops;
  }

  /**
   * 낱말 대조. 원문이 없으면 null — 없는 근거를 지어내지 않는다.
   *
   * 바뀐 낱말(substituted)은 빠뜨림(missing)이자 덧붙임(added)이기도 하다. 셋을 더해서
   * 총계를 맞추려 들면 안 된다 — 겹쳐서 세는 서로 다른 관점이다:
   *   missing     원문에 있는데 말하지 않은 낱말
   *   added       원문에 없는데 말한 낱말
   *   substituted 그중 자리를 맞바꾼 쌍의 수 (missing·added 양쪽에 이미 들어 있다)
   */
  function compare(reference, said) {
    var ref = tokens(reference), hyp = tokens(said);
    if (!ref.length) return null;
    var ops = diff(ref, hyp);
    var matched = 0, missing = 0, added = 0, substituted = 0, k = 0;
    while (k < ops.length) {
      if (ops[k].t === 'eq') { matched += 1; k += 1; continue; }
      var d = 0, a = 0;
      while (k < ops.length && ops[k].t === 'del') { d += 1; k += 1; }
      while (k < ops.length && ops[k].t === 'ins') { a += 1; k += 1; }
      missing += d; added += a; substituted += Math.min(d, a);
    }
    return {
      ops: ops, total: ref.length, said: hyp.length, matched: matched,
      missing: missing, added: added, substituted: substituted,
      accuracy: Math.round(matched / ref.length * 100)
    };
  }

  /* ── 모델 ─────────────────────────────────────────────── */

  /**
   * 팩의 스피킹 구조에 채점 행과 과제 점수를 얹는다.
   * @param pack   콘텐츠 팩(window.SMEAG_SET9 등)
   * @param rows   SG_RESULTS.detail(res).rows — 녹음을 냈는지 여기서 안다
   * @param tasks  sg_task_scores 행[] — 0~5 점수·전사문·루브릭
   */
  function model(pack, rows, tasks) {
    var byQid = {}, byTask = {};
    (rows || []).forEach(function (r) { if (r && r.qid) byQid[r.qid] = r; });
    (tasks || []).forEach(function (t) { if (t && t.question_id) byTask[t.question_id] = t; });

    var out = [];
    ((pack && pack.sections) || []).forEach(function (sec) {
      if (String((sec && sec.id) || '').toLowerCase() !== 'speaking') return;
      (sec.modules || []).forEach(function (mod) {
        var items = [];
        (mod.blocks || []).forEach(function (blk) {
          (blk.questions || []).forEach(function (q) {
            var row = byQid[q.id] || null;
            var task = byTask[q.id] || null;
            var it = {
              qid: q.id, no: q.no, q: q, block: blk, kind: q.kind,
              index: items.length,
              /* 답 자리에 'idb:…' 가 있으면 이 기기에 녹음이 남아 있다는 뜻이다. */
              recorded: !!(row && typeof row.given === 'string' && row.given.indexOf('idb:') === 0),
              task: task,
              score: scoreOf(task),
              transcript: (task && task.transcript) || '',
              /* 복창만 대조가 성립한다. 원문이 없는 옛 세트(SET 1)는 null 로 남는다. */
              compare: q.kind === 'repeat' && task && task.transcript
                ? compare(q.script, task.transcript) : null
            };
            items.push(it);
          });
        });
        if (!items.length) return;
        out.push({
          id: mod.id || '', label: mod.label || mod.id || 'Speaking',
          kind: items[0].kind, items: items, score: summarize(items)
        });
      });
    });
    return out;
  }

  /** 과제 하나의 점수 칩 — 채점된 문항의 평균. 하나도 없으면 '—'. */
  function summarize(items) {
    var n = 0, sum = 0;
    items.forEach(function (it) { if (it.score !== null) { n += 1; sum += it.score; } });
    if (!n) return { kind: 'wait', got: null, max: null, text: '—' };
    return { kind: 'rated', got: sum / n, max: 5, text: (sum / n).toFixed(2) + '/5.00' };
  }

  /* 'Task 1 · Listen and Repeat' 는 점수 칩에 다 들어가지 않는다. */
  function shortLabel(label) {
    var s = String(label || '');
    if (/repeat/i.test(s)) return 'Listen & Repeat';
    if (/interview/i.test(s)) return 'Interview';
    return s;
  }

  /* 문항 번호(no)는 시험 전체 통번호(8~11)라 과제 안에서 몇 번째인지 말해 주지 않는다.
     이동 줄에서는 과제 안 순번으로 부른다 — 학생이 "3번 문제"라고 할 때의 그 번호다. */
  function markOf(it) {
    return it.score !== null ? 'rated' : (it.recorded ? 'na' : 'no');
  }

  /* ── 왼쪽: 무엇이 나왔나 ──────────────────────────────── */

  /* S1 의 지시문은 과제 이름을 그대로 되뇐다('Listen and Repeat'). 칩 바로 밑에 같은
     말을 한 번 더 쓰면 두 줄이 서로를 설명하는 것처럼 읽힌다 — 같으면 지운다. */
  function sameAsKind(instruction, kind) {
    function n(s) { return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); }
    var a = n(instruction), b = kind === 'repeat' ? 'listen and repeat' : 'interview';
    return !a || a === b;
  }

  function taskHtml(it) {
    var q = it.q, blk = it.block || {};
    var src = media(q.audio || '');
    var repeat = it.kind === 'repeat';
    return '' +
      '<div class="lr-kind">' + (repeat
        ? bi('Listen and Repeat', '듣고 따라 말하기')
        : bi('Interview', '인터뷰')) + '</div>' +
      (sameAsKind(blk.instruction, it.kind) ? '' : '<p class="lr-ins">' + esc(blk.instruction) + '</p>') +
      (q.image ? '<img class="lr-img" src="' + esc(media(q.image)) + '" alt="">' : '') +
      /* 원문은 들려준 소리를 글로 옮긴 것이다. 복창은 이 문장이 곧 채점의 잣대이고,
         인터뷰는 이 문장이 곧 문제다 — 그래서 이름만 갈라 붙이고 자리는 같다. */
      (q.script
        ? '<div class="rs-said ' + (repeat ? 'ref' : 'ask') + '">' +
            '<div class="lr-lab">' + (repeat
              ? bi('Reference text', '들려준 문장')
              : bi('What the interviewer asked', '면접관의 질문')) + '</div>' +
            '<p>' + esc(q.script) + '</p>' +
          '</div>'
        : '') +
      (src
        ? '<audio class="lr-audio" controls preload="none" src="' + esc(src) + '"></audio>'
        : '<div class="muted" style="font-size:12.5px;margin-top:10px">' +
            bi('No audio for this question.', '이 문항에는 오디오가 없습니다.') + '</div>') +
      '<p class="rs-meta">' + esc(blk.heading || '') +
        (q.respondSec ? ' · ' + bi(q.respondSec + 's to answer', '답할 시간 ' + q.respondSec + '초') : '') +
      '</p>';
  }

  /* ── 오른쪽: 무엇을 말했나 · 몇 점인가 ────────────────── */

  /* 녹음 자리는 비워 두고 mount() 가 채운다 — 기기의 IndexedDB 든 버킷의 서명 URL 이든
     비동기라서 html() 이 만들 수 없다. html() 은 순수 함수로 남겨 둔다(테스트가 본다). */
  function recordingHtml(it) {
    return '<div class="rs-panel rs-step rs-step-recording">' +
      '<div class="lr-lab">' + bi('Your recording', '내 녹음') + '</div>' +
      '<div class="rs-play" data-play="' + esc(it.qid) + '">' +
        '<span class="muted">' + (it.recorded || (it.task && it.task.media_path)
          ? bi('Looking for the recording…', '녹음을 찾는 중…')
          : bi('No recording was submitted for this question.', '이 문항은 녹음이 제출되지 않았습니다.')) +
        '</span>' +
      '</div>' +
      '<div class="lr-lab">' + bi('Transcription', '전사문') +
        (it.task && it.task.transcript_model ? ' · ' + esc(it.task.transcript_model) : '') + '</div>' +
      (it.transcript
        ? '<p class="rs-body">' + esc(it.transcript) + '</p>'
        : '<p class="muted">' + bi('Not transcribed yet.', '아직 전사되지 않았습니다.') + '</p>') +
    '</div>';
  }

  function verdictHtml(it) {
    if (it.score === null) {
      return '<div class="rw-verdict wait">' +
        bi('Not scored yet.', '아직 채점 전입니다.') +
        '<small>' + bi('Speaking is transcribed from your recording and scored against the official ' +
                       'ETS scoring guide about a minute after you submit.',
                       '스피킹은 제출 뒤 1분쯤 지나 녹음을 글로 옮긴 다음 ETS 공식 채점 가이드로 채점됩니다.') +
        '</small></div>';
    }
    var t = it.task || {};
    return '<div class="rw-verdict rated">' +
      '<span class="rw-score">' + it.score.toFixed(2) + '<span> / 5.00</span></span>' +
      '<small>' + (t.confirmed_at
        ? bi('Confirmed by a teacher.', '선생님이 확정한 점수입니다.')
        : bi('Scored by AI on the official ETS scoring guide.', 'ETS 공식 채점 가이드로 AI 가 채점했습니다.')) +
      '</small></div>';
  }

  /** 복창의 낱말 대조. 점수 밑에 깔리는 산수를 그대로 펴 보인다. */
  function accuracyHtml(it) {
    var c = it.compare;
    if (!c) return '';
    return '<div class="rs-panel rs-step rs-step-accuracy">' +
      '<div class="lr-lab">' + bi('Word by word', '낱말 대조') + '</div>' +
      '<div class="rs-stats">' +
        '<div class="rs-stat"><b>' + c.accuracy + '%</b><span>' + bi('Accuracy', '정확도') + '</span></div>' +
        '<div class="rs-stat ok"><b>' + c.matched + '</b><span>' + bi('Correct', '맞은 낱말') + '</span></div>' +
        '<div class="rs-stat"><b>' + c.total + '</b><span>' + bi('In the sentence', '원문 낱말') + '</span></div>' +
      '</div>' +
      '<div class="rs-tags">' +
        '<span class="rs-tag miss">' + bi('Missing', '빠뜨림') + ' ' + c.missing + '</span>' +
        '<span class="rs-tag add">' + bi('Added', '덧붙임') + ' ' + c.added + '</span>' +
        '<span class="rs-tag sub">' + bi('Substituted', '바꿔 말함') + ' ' + c.substituted + '</span>' +
      '</div>' +
      '<div class="rs-diff">' + c.ops.map(function (o) {
        return o.t === 'eq' ? esc(o.w) : '<i class="' + o.t + '">' + esc(o.w) + '</i>';
      }).join(' ') + '</div>' +
      '<p class="rs-note muted">' +
        bi('Struck-through words are in the sentence but were not said; the others were said but ' +
           'are not in the sentence. Words are compared in lower case without punctuation — the ' +
           'same way the score is worked out.',
           '취소선은 원문에 있는데 말하지 않은 낱말, 나머지는 원문에 없는데 말한 낱말입니다. ' +
           '낱말은 소문자·구두점 없이 비교합니다 — 점수를 내는 방식과 같습니다.') +
      '</p>' +
    '</div>';
  }

  /** 왜 그 점수인가. 점수만 있고 근거가 없으면 학생은 배울 수도 다툴 수도 없다. */
  function rubricHtml(it) {
    var t = it.task;
    if (!t) return '';
    var rub = t.ai_rubric || {}, crit = rub.criteria || [], out = '';
    if (t.ai_error) out += '<p class="muted">' + bi('AI scoring failed: ', 'AI 채점 실패: ') + esc(t.ai_error) + '</p>';
    if (rub.summary) out += '<p class="rs-body">' + esc(rub.summary) + '</p>';
    if (crit.length) {
      /* 인용은 전사문에서 글자 그대로 찾은 것만 남는다(api/score.js) — 학생이 "내가
         그렇게 말했나" 를 전사문에서 바로 확인할 수 있어야 한다. */
      out += '<ul class="rw-crit">' + crit.map(function (c) {
        return '<li><b>' + esc(c.criterion) + '</b> — ' + esc(c.comment || '') +
          (c.quote ? ' <q class="rw-quote">' + esc(c.quote) + '</q>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    /* Listen and Repeat 는 세어서 아는 과제다. 센 것을 그대로 보여 준다 — "몇 개 중
       몇 개를 옮겼고 무엇이 빠졌는가" 는 어떤 총평보다 학생이 바로 쓸 수 있는 말이다. */
    if (rub.guard && rub.guard.content_total) {
      var g = rub.guard;
      out += '<p class="rs-body">' +
        (g.exact
          ? bi('Repeated exactly, word for word.', '한 단어도 빠짐없이 그대로 따라 했습니다.')
          : bi('Kept ' + g.content_kept + ' of ' + g.content_total + ' key words.',
               '핵심 단어 ' + g.content_total + '개 중 ' + g.content_kept + '개를 옮겼습니다.') +
            ((g.missing_content && g.missing_content.length)
              ? ' ' + bi('Missing: ', '빠진 말: ') + esc(g.missing_content.join(', '))
              : '')) +
        '</p>';
    }
    if (rub.why_not_higher) {
      out += '<p class="rs-body"><b>' + bi('To score higher', '한 점 더 받으려면') + '</b> — ' +
        esc(rub.why_not_higher) + '</p>';
    }
    if (t.teacher_note) {
      out += '<p class="rs-body"><b>' + bi('Teacher', '선생님') + '</b> — ' + esc(t.teacher_note) + '</p>';
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
    return '<div class="rs-panel rs-step rs-step-rubric"><div class="lr-lab">' +
      bi('Why this score', '채점 근거') + '</div>' + out + '</div>';
  }

  /* ── 화면 ─────────────────────────────────────────────── */

  function tabsHtml(m, state) {
    return '<div class="lr-mods">' + m.map(function (mod, i) {
      return '<button type="button" data-mod="' + i + '"' + (i === state.m ? ' class="on"' : '') + '>' +
        esc(shortLabel(mod.label)) +
        '<span class="lr-count">' + mod.items.length + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  /* 과제별 점수는 늘 둘 다 보인다 — 지금 보는 과제만 보여 주면 스피킹 점수가
     어디서 왔는지 알 수 없다. 보고 있는 과제만 진하게 선다. */
  function scoresHtml(m, state) {
    return '<div class="rw-scores">' + m.map(function (mod, i) {
      return '<div class="rw-chip' + (i === state.m ? ' on' : '') + '">' +
        '<b>' + esc(shortLabel(mod.label)) + '</b>' +
        '<i>' + esc(mod.score.text) + '</i>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* 이동 줄은 번호 위·점수 아래다. 어느 문항이 무너졌는지 한 줄로 보여야 한다. */
  function stripHtml(mod, state) {
    return '<div class="lr-strip"><div class="lr-grp">' +
      '<div class="lr-grp-lab">' + esc(shortLabel(mod.label)) + '</div>' +
      '<div class="rs-dots">' + mod.items.map(function (it, i) {
        return '<button type="button" class="rs-dot ' + markOf(it) +
          (it.index === state.q ? ' now' : '') + '" data-q="' + it.index + '" ' +
          'title="' + esc(it.qid) + '">' +
          '<span>' + (i + 1) + '</span>' +
          '<b>' + (it.score === null ? '—' : it.score.toFixed(2)) + '</b>' +
        '</button>';
      }).join('') + '</div>' +
    '</div></div>';
  }

  /**
   * 화면 전체 HTML.
   * @param {Array}  m      model()
   * @param {Object} state  { m: 과제 index, q: 그 과제 안 문항 index }
   * @param {Object} opts   { extraFor: fn(qid) → HTML }
   */
  function html(m, state, opts) {
    opts = opts || {};
    if (!m || !m.length) {
      return '<div class="lr-empty muted">' +
        bi('This test set has no speaking tasks on this device.',
           '이 기기의 세트에 스피킹 과제가 없습니다.') + '</div>';
    }
    var mod = m[Math.min(state.m || 0, m.length - 1)];
    var qi = Math.min(Math.max(state.q || 0, 0), mod.items.length - 1);
    var it = mod.items[qi];
    var st = { m: m.indexOf(mod), q: qi };

    return '<div class="lr rs">' +
      '<div class="lr-bar">' +
        tabsHtml(m, st) +
        '<div class="lr-nav">' +
          '<span class="lr-pos">' + bi('Question', '문항') + ' ' + (qi + 1) + ' / ' + mod.items.length + '</span>' +
          '<button class="btn ghost sm" type="button" data-go="prev"' + (qi === 0 ? ' disabled' : '') + '>‹ ' +
            bi('Prev', '이전') + '</button>' +
          '<button class="btn ghost sm" type="button" data-go="next"' +
            (qi === mod.items.length - 1 ? ' disabled' : '') + '>' + bi('Next', '다음') + ' ›</button>' +
        '</div>' +
      '</div>' +
      scoresHtml(m, st) +
      stripHtml(mod, st) +
      '<div class="lr-pane">' +
        '<div class="lr-left">' + taskHtml(it) + '</div>' +
        /* 점수가 먼저다 — 학생이 이 화면을 여는 이유가 그것이고, 그 밑의 녹음·전사·대조는
           전부 "왜 그 점수인가" 에 대한 답이라 점수 뒤에 와야 순서가 맞는다. */
        '<div class="lr-right rs-flow">' +
          verdictHtml(it) + recordingHtml(it) + accuracyHtml(it) + rubricHtml(it) +
          (opts.extraFor ? opts.extraFor(it.qid) : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ── 녹음 ─────────────────────────────────────────────────
   *
   * 녹음은 두 군데에 있다. 응시한 기기의 IndexedDB 와, 제출 뒤 올라간 비공개 버킷.
   * 앞의 것은 그 기기에서만 열리지만 네트워크 없이 열리고, 뒤의 것은 서명 URL 이라
   * 어느 기기에서나 열린다(정책상 자기 폴더만 서명할 수 있어, 남의 응시를 보는
   * 선생님에게는 조용히 재생기가 붙지 않는다 — 전사문은 그대로 보인다).
   * 기기 사본을 먼저 찾고, 없을 때만 버킷을 부른다.
   */
  function playerInto(slot, src, meta) {
    var a = document.createElement('audio');
    a.controls = true;
    a.preload = 'none';
    a.className = 'lr-audio';
    a.src = src;
    slot.innerHTML = '';
    slot.appendChild(a);
    if (meta) {
      var c = document.createElement('div');
      c.className = 'rs-recmeta muted';
      c.textContent = meta;
      slot.appendChild(c);
    }
    if (window.SG_AUDIO && typeof window.SG_AUDIO.apply === 'function') {
      try { window.SG_AUDIO.apply(slot); } catch (e) {}
    }
  }

  /* 재생기만 놓여 있으면 "안 들린다" 가 무음인지 재생 문제인지 가려지지 않는다.
   * 길이·용량과, 녹음 당시 관측한 입력 최대치를 한 줄로 적어 둔다. */
  function recMeta(rec, blob) {
    var bits = [];
    if (rec && rec.durationMs > 0) bits.push(Math.round(rec.durationMs / 100) / 10 + 's');
    if (blob && blob.size) bits.push(Math.round(blob.size / 1024) + ' KB');
    if (rec && rec.silent === true) bits.push('no sound was detected while recording');
    else if (rec && typeof rec.peak === 'number') bits.push('input peak ' + Math.round(rec.peak * 100) + '%');
    return bits.join(' · ');
  }
  function say(slot, en, ko) {
    slot.innerHTML = '<span class="muted">' + bi(en, ko) + '</span>';
  }

  /* 녹음이 없다고 말하는 자리마다 회수 도구로 가는 문을 세운다(선생님·관리자에게만).
   *
   * 이 문구가 뜨는 자리는 둘 중 하나다 — 업로드가 실패했거나, 애초에 올라간 적이
   * 없거나. 어느 쪽이든 다음 할 일은 같다: 시험을 친 그 컴퓨터에서 원본을 꺼내는 것.
   * 그 사실을 아는 사람만 admin 허브를 뒤져 도구를 찾을 수 있었고, 그동안 스피킹은
   * 영영 no_transcript 였다. 세션을 달아 보내면 그 응시의 녹음만 추려 스스로 스캔한다. */
  function recoverInto(slot, session, staff) {
    if (!staff || !session || !slot) return;
    var a = document.createElement('a');
    a.href = 'recover-recordings.html?session=' + encodeURIComponent(session);
    a.className = 'btn ghost sm';
    a.style.marginLeft = '8px';
    a.textContent = bi('Recover from this PC', '이 PC 에서 회수');
    slot.appendChild(a);
  }

  /* 녹음이 놓일 수 있는 자리들. 앞에서부터 하나씩 서명을 시도한다.
   *
   * media_path 는 채점이 돌 때 api/score.js 가 채운다. 그래서 채점 전에는 비어 있고,
   * 그 상태에서는 파일이 버킷에 멀쩡히 있어도 재생기가 붙지 않았다. 업로더가 쓰는
   * 규칙({owner}/{session}/{qid}.{ext})은 알고 있으니, 경로가 비면 그 규칙으로
   * 직접 찾아본다. 확장자는 기기마다 다르므로(MediaRecorder 가 고르는 대로) 후보를 돈다. */
  var MEDIA_EXTS = ['webm', 'm4a', 'ogg', 'mp3', 'wav'];

  function mediaPaths(task, owner, session, qid) {
    var out = [];
    var known = task && task.media_path;
    if (known) out.push(known);
    if (owner && session && qid) {
      for (var i = 0; i < MEDIA_EXTS.length; i++) {
        var guess = owner + '/' + session + '/' + qid + '.' + MEDIA_EXTS[i];
        if (guess !== known) out.push(guess);
      }
    }
    return out;
  }

  function wirePlayback(el, it, session, staff, owner) {
    var slot = el.querySelector('[data-play]');
    if (!slot) return;
    var paths = mediaPaths(it.task, owner, session, it.qid);
    if (!it.recorded && !paths.length) {               // 녹음 자체가 없다 — html() 이 이미 말했다
      recoverInto(slot, session, staff);
      return;
    }

    function cloud() {
      if (!paths.length || !window.SG_AUTH) {
        say(slot, 'The recording is not on this device.', '이 기기에는 녹음이 없습니다.');
        recoverInto(slot, session, staff);
        return;
      }
      SG_AUTH.token().then(function (tok) {
        if (!tok) { say(slot, 'Sign in to play the recording.', '녹음을 들으려면 로그인하세요.'); return; }

        var i = 0;
        function tryNext() {
          if (i >= paths.length) {
            /* 어느 자리에서도 열리지 않는다 — 파일이 버킷에 없다는 뜻이다
               (업로드가 400 으로 거절당한 자리가 그랬다). 회수가 답이다. */
            say(slot, 'The recording could not be opened from this device.',
                '이 기기에서는 녹음을 열 수 없습니다.');
            recoverInto(slot, session, staff);
            return null;
          }
          var p = paths[i++];
          return fetch(SG_AUTH.url + '/storage/v1/object/sign/toefl-recordings/' +
                       p.split('/').map(encodeURIComponent).join('/'), {
            method: 'POST',
            headers: { apikey: SG_AUTH.anonKey, Authorization: 'Bearer ' + tok,
                       'Content-Type': 'application/json' },
            body: JSON.stringify({ expiresIn: 3600 })
          }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && j.signedURL) { playerInto(slot, SG_AUTH.url + '/storage/v1' + j.signedURL); return null; }
              return tryNext();
            });
        }
        return tryNext();
      })['catch'](function () {
        say(slot, 'The recording could not be opened from this device.',
            '이 기기에서는 녹음을 열 수 없습니다.');
        recoverInto(slot, session, staff);
      });
    }

    var S = window.SG_STORE;
    if (!it.recorded || !S || typeof S.getMedia !== 'function' || !session) { cloud(); return; }
    /* 진행 중인 다른 시험의 '활성 세션' 표시를 건드리지 않는다. */
    try { S.open(session, false); } catch (e) { cloud(); return; }
    S.getMedia(it.qid, function (err, rec) {
      // 저장 형식은 {questionKey, blob, mime, …} 다. 아주 옛 기록은 Blob 자체였다.
      var blob = rec && rec.blob ? rec.blob : rec;
      if (err || !blob || !blob.size) { cloud(); return; }
      playerInto(slot, URL.createObjectURL(blob), recMeta(rec && rec.blob ? rec : null, blob));
    });
  }

  /* ── 묶기 ─────────────────────────────────────────────── */

  /**
   * mount(el, opts)
   *   opts.pack      콘텐츠 팩
   *   opts.rows      SG_RESULTS.detail(res).rows
   *   opts.tasks     sg_task_scores 행[] (늦게 와도 된다 — setTasks 로 갈아 끼운다)
   *   opts.session   녹음을 찾을 응시 세션 id
   *   opts.owner     응시한 학생의 계정 id — media_path 가 아직 없을 때 버킷에서 직접 찾는다
   *   opts.staff     선생님·관리자면 true — 녹음이 없는 자리에 회수 도구 문을 세운다
   *   opts.extraFor  fn(qid) → 문항 아래 붙일 HTML(코멘트 등)
   *   opts.onPaint   fn(el) 다시 그린 뒤 부를 것(코멘트 편집기 배선 등)
   * @returns {{repaint, setTasks, state, model}}
   */
  function mount(el, opts) {
    opts = opts || {};
    var m = model(opts.pack, opts.rows, opts.tasks);
    var state = { m: 0, q: 0 };

    function current() {
      var mod = m[state.m];
      return mod ? mod.items[state.q] : null;
    }

    function paint() {
      el.innerHTML = html(m, state, { extraFor: opts.extraFor });
      /* 관리자 교체본·배속은 이 순간 새로 생긴 <audio> 에도 걸려야 한다. */
      if (window.SG_AUDIO && typeof window.SG_AUDIO.apply === 'function') {
        try { window.SG_AUDIO.apply(el); } catch (e) {}
      }
      var it = current();
      if (it) wirePlayback(el, it, opts.session, opts.staff, opts.owner);
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
    });

    paint();

    /* 채점은 서버에서 늦게 온다. 오면 모델만 새로 짜고 보던 자리는 지킨다 —
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
    compare: compare, tokens: tokens, summarize: summarize,
    shortLabel: shortLabel, esc: esc
  };
})();
