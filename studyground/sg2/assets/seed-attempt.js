/* SMEAG · StudyGround — seed-attempt.js  (개발 도구)
 * 목적: "거의 다 푼 응시" 한 벌을 계산한다. 모듈마다 마지막 문항 하나씩만 비우고
 *       나머지는 정해진 정답률로 채운다 — 채점·AI 리뷰를 처음부터 응시하지 않고 보기 위한 것.
 * 의존 전역: 없음 (콘텐츠 팩과 컴파일된 화면열을 인자로 받는다)
 * 노출 전역: window.SG_SEED
 *
 * 순수 함수만 둔다. localStorage·IndexedDB·네트워크·Date.now() 접근이 없어
 * node 에서 그대로 검산된다(tests/test_seed_attempt.js). 심는 일은 _seed.html 이 한다.
 *
 * 시험 셸이 이 세션을 이어받을 수 있어야 하므로, 심는 쪽이 지킬 계약을 여기 적어 둔다.
 *   · meta 에 contentHash·timingHash 를 적지 않는다. canResume() 은 저장된 해시가 있을
 *     때만 대조하므로 비워 두면 셸이 그때 계산한 값과 다툴 일이 없다. 셸의 해시 계산을
 *     베껴 쓰면 셸이 바뀔 때마다 조용히 어긋난다 — 베끼지 않는다.
 *   · clocks 를 심지 않는다. 시계는 화면에 들어갈 때 armClock() 이 처음 한 번 만든다.
 */
(function (root) {
  'use strict';

  /* 문항 → 그 문항이 실린 화면. 컴파일 결과가 정본이다. */
  function questionIndex(screens) {
    var map = {}, i, j;
    for (i = 0; i < (screens || []).length; i++) {
      var sc = screens[i], ids = (sc && sc.questionIds) || [];
      for (j = 0; j < ids.length; j++) {
        map[ids[j]] = {
          screenIndex: i, screenId: sc.id,
          moduleId: sc.moduleId || '', section: sc.section || ''
        };
      }
    }
    return map;
  }

  /* 모듈마다 마지막 문항 하나. 화면 순서가 곧 응시 순서라 그 순서로 훑는다 —
     팩의 배열 순서로 훑으면 timing.sectionOrder 로 바뀐 실제 순서와 어긋난다. */
  function lastOfEachModule(screens) {
    var last = {}, order = [], i, j;
    for (i = 0; i < (screens || []).length; i++) {
      var sc = screens[i], ids = (sc && sc.questionIds) || [];
      for (j = 0; j < ids.length; j++) {
        var m = sc.moduleId || sc.section || '?';
        if (!last.hasOwnProperty(m)) order.push(m);
        last[m] = ids[j];
      }
    }
    var out = [];
    for (i = 0; i < order.length; i++) out.push({ module: order[i], qid: last[order[i]] });
    return out;
  }

  /* ── 답 만들기 ───────────────────────────────────────────── */

  function keyOf(pack, q) {
    var K = (pack && pack.answerKey) || {};
    var k = K.hasOwnProperty(q.id) ? K[q.id] : q.answer;
    return Object.prototype.toString.call(k) === '[object Array]' ? k[0] : k;
  }

  function buildTokens(q) {
    var out = [], s = (q && q.slots) || [], i;
    for (i = 0; i < s.length; i++) if (s[i] && s[i].t === 'b') out.push(s[i].a);
    return out;
  }

  /* wrong=true 면 일부러 틀린다. "무응답" 이 아니라 "틀린 답" 이어야 리뷰의 정오 표시와
     밴드 계산이 실제 응시와 같은 모양으로 나온다. 답이 없는 종류는 null 을 돌려준다
     (email·discussion 은 사람이 써야 하고, repeat·interview 는 녹음이라야 한다). */
  function answerFor(pack, q, wrong) {
    var key = keyOf(pack, q);
    switch (q && q.kind) {
      case 'mcq':
      case 'insert': {
        var n = (q.choices && q.choices.length) || 4;
        var c = Number(key);
        if (isNaN(c)) return wrong ? 0 : key;
        return wrong ? ((c + 1) % n) : c;
      }
      case 'blank': {
        if (!wrong) return String(key == null ? '' : key);
        // 오답도 낱말이어야 한다 — 빈 문자열은 채점에서 무응답과 구분되지 않는다.
        return 'the';
      }
      case 'build': {
        var t = buildTokens(q);
        if (!wrong || t.length < 2) return t;
        var s = t.slice(), x = s[0]; s[0] = s[1]; s[1] = x;
        return s;
      }
      default:
        return null;
    }
  }

  var SPOKEN = { repeat: 1, interview: 1 };
  var WRITTEN = { email: 1, discussion: 1 };

  /**
   * plan(pack, screens, opts) → 심을 것 전부.
   *   opts.accuracy  0~1. 객관 채점 문항의 목표 정답률(기본 0.8).
   *   opts.cursorAt  'first' | 'reading' | 'listening' | 'speaking' | 'writing'
   *
   * 반환 { skip, answers, wrong, spoken, written, cursor, counts }
   *   answers  { qid: value }  — 심는 쪽이 upsertAnswer 로 하나씩 넣는다
   *   spoken   [{qid, kind, script, respondSec}]  — 녹음을 만들어 넣어야 하는 문항
   *   cursor   { screenId, screenIndex }          — 이어받을 화면
   */
  function plan(pack, screens, opts) {
    var o = opts || {};
    var acc = typeof o.accuracy === 'number' ? o.accuracy : 0.8;
    var want = o.cursorAt || 'first';

    var map = questionIndex(screens);
    var lasts = lastOfEachModule(screens);
    var skip = {}, i;
    for (i = 0; i < lasts.length; i++) skip[lasts[i].qid] = true;

    /* 오답은 정해진 간격으로 뿌린다 — 돌릴 때마다 정답률이 흔들리면 "고쳤더니 점수가
       달라졌다" 를 시드 탓인지 코드 탓인지 가릴 수 없다. */
    var every = acc >= 1 ? 0 : Math.max(2, Math.round(1 / (1 - acc)));

    var all = (pack && typeof pack.allQuestions === 'function') ? pack.allQuestions() : [];
    var answers = {}, wrong = [], spoken = [], written = [], graded = 0;

    for (i = 0; i < all.length; i++) {
      var q = all[i].q || all[i];
      if (skip[q.id]) continue;
      if (SPOKEN[q.kind]) {
        spoken.push({ qid: q.id, kind: q.kind, script: q.script || '', respondSec: q.respondSec || 20, audio: q.audio || '' });
        continue;
      }
      if (WRITTEN[q.kind]) { written.push(q.id); continue; }
      var v = answerFor(pack, q, false);
      if (v === null) continue;
      graded += 1;
      var isWrong = every > 0 && (graded % every === 0);
      answers[q.id] = answerFor(pack, q, isWrong);
      if (isWrong) wrong.push(q.id);
    }

    /* 커서는 하나뿐이라 이어받는 자리도 하나다. 섹션을 고르면 그 섹션에서 처음 비워 둔
       문항으로 건너뛰고, 앞 구간에 비워 둔 문항은 무응답으로 남는다. */
    var target = null;
    for (i = 0; i < lasts.length; i++) {
      var info = map[lasts[i].qid];
      if (!info) continue;
      if (want === 'first' || info.section === want) { target = info; break; }
    }
    if (!target && lasts.length) target = map[lasts[0].qid];

    return {
      skip: lasts,
      answers: answers,
      wrong: wrong,
      spoken: spoken,
      written: written,
      cursor: target ? { screenId: target.screenId, screenIndex: target.screenIndex } : null,
      counts: {
        answered: (function () { var n = 0, k; for (k in answers) if (answers.hasOwnProperty(k)) n++; return n; })(),
        wrong: wrong.length,
        blank: lasts.length,
        spoken: spoken.length,
        written: written.length
      }
    };
  }

  root.SG_SEED = {
    questionIndex: questionIndex,
    lastOfEachModule: lastOfEachModule,
    answerFor: answerFor,
    plan: plan
  };
})(typeof window !== 'undefined' ? window : this);
