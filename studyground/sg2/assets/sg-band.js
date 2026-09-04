/* SMEAG · StudyGround — TOEFL 1~6 밴드 환산. 의존성 없음.
 *
 * ETS 는 2026-01 부터 네 영역과 종합을 1.0~6.0(0.5 단위)로 보고한다. 종합은 옛
 * 스케일처럼 영역의 **합**이 아니라 **평균**이다 — 이 차이를 놓치면 종합이 4배로
 * 부풀거나(합) 학생이 자기 점수를 못 알아본다.
 *
 * 두 단계를 지나며, 근거의 등급이 서로 다르다. 코드에서도 갈라 둔다.
 *   1) 원점수 → 0~30 환산   ⚠️가설(검증필요). 정답률 비례.
 *   2) 0~30 → 1~6 밴드      ✅ETS 공식 표.
 *
 * 1단계가 가설인 이유: ETS 표는 "0~30 환산점수"에서 출발하는데 SMEAG 모의고사는
 * 문항 수가 실제 시험과 다르다(SET 9 는 R 50 · L 47 문항). 실측 환산표가 생기면
 * scaledFromRaw() 하나만 갈아 끼우면 되고 밴드 경계는 건드릴 필요가 없다.
 *
 * ⚠️ 이 표는 app/scoring/toefl6_band_table.json 의 **사본**이다. 세 곳(여기 ·
 * 그 JSON · smeag-com/scores.html)이 같은 숫자를 들고 있으니 함께 고칠 것.
 * studyground/tests/test_band_table.js 가 세 벌이 어긋나면 실패한다.
 *
 * 노출 전역: window.SG_BAND
 *   SG_BAND.sectionBand(correct, total, skill)  객관식 영역(R·L) → 밴드
 *   SG_BAND.taskBand(tasks, skill)              산출형(W·S) 과제 점수(0~5) → 밴드
 *   SG_BAND.speakingBand(ratio)                 스피킹 전용 — 과제 평균을 0.5 로 올린다
 *   SG_BAND.overall(bandsBySkill)               종합 = 평균(빈 영역은 빠진다)
 *   SG_BAND.of(row, taskRows)                   응시 한 건 → 화면이 그릴 전부
 *   SG_BAND.fmt(band) / SG_BAND.cefr(band)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // node 테스트
  if (root) root.SG_BAND = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var SKILLS = ['reading', 'listening', 'writing', 'speaking'];

  /* ── ETS 공식 대응표 (0~30 환산점수 → 밴드) ────────────────────────────────
     출처: ETS, TOEFL iBT Score Scale Update (2026-08-11 확인)
     https://www.ets.org/toefl/institutions/ibt/score-scale-update.html
     각 행은 [해당 밴드의 하한, 밴드]. 높은 구간부터 훑는다. */
  var TABLE = {
    reading:   [[29,6],[27,5.5],[24,5],[22,4.5],[18,4],[12,3.5],[6,3],[4,2.5],[3,2],[2,1.5],[0,1]],
    listening: [[28,6],[26,5.5],[22,5],[20,4.5],[17,4],[13,3.5],[9,3],[6,2.5],[4,2],[2,1.5],[0,1]],
    writing:   [[29,6],[27,5.5],[24,5],[21,4.5],[17,4],[15,3.5],[13,3],[11,2.5],[7,2],[3,1.5],[0,1]],
    speaking:  [[28,6],[27,5.5],[25,5],[23,4.5],[20,4],[18,3.5],[16,3],[13,2.5],[10,2],[5,1.5],[0,1]]
  };

  /* 밴드 → CEFR. ETS 가 같은 표에서 함께 발표한 대응이다. */
  var CEFR = {
    '6.0': 'C2', '5.5': 'C1', '5.0': 'C1', '4.5': 'B2', '4.0': 'B2', '3.5': 'B1',
    '3.0': 'B1', '2.5': 'A2', '2.0': 'A2', '1.5': 'A1', '1.0': 'A1'
  };

  var SCALED_MAX = 30;
  var BAND_MIN = 1;
  var BAND_MAX = 6;
  /* ETS 공식 산출형 루브릭은 네 과제 모두 0~5 다(Email · Discussion · Repeat · Interview).
     docs/reference/toefl-official-scoring-guides.md 참조. */
  var TASK_MAX = 5;

  /* .5 는 언제나 올린다. scores.html·scale.py 와 같은 규칙이라야 세 화면이 같은
     점수를 보여 준다(JS 의 Math.round 는 음수에서만 어긋나므로 floor 로 통일한다). */
  function halfUp(x) { return Math.floor(Number(x) + 0.5); }
  function toHalf(x) { return Math.floor(Number(x) * 2 + 0.5) / 2; }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** ⚠️가설(검증필요) — 정답률을 그대로 0~30 으로 편다. 실측 표가 생기면 여기만 바꾼다. */
  function scaledFromRaw(correct, total) {
    var t = Number(total) || 0;
    if (!t) return 0;
    var ratio = Number(correct) / t;
    if (!(ratio > 0)) ratio = 0;
    if (ratio > 1) ratio = 1;
    return halfUp(ratio * SCALED_MAX);
  }

  /** 0~30 환산점수 → 밴드. ETS 공식 표 그대로. 밴드 바닥은 1.0 이다(0.0 은 없다). */
  function bandForScaled(scaled, skill) {
    var rows = TABLE[String(skill || '').toLowerCase()];
    var n = Number(scaled);
    if (!isNum(n)) n = 0;
    if (!rows) {          // 모르는 영역: 비례 추정. 화면이 멈추는 것보다는 낫다.
      var r = Math.max(0, Math.min(1, n / SCALED_MAX));
      return toHalf(BAND_MIN + r * (BAND_MAX - BAND_MIN));
    }
    for (var i = 0; i < rows.length; i++) if (n >= rows[i][0]) return rows[i][1];
    return rows[rows.length - 1][1];
  }

  /**
   * 객관식 영역(Reading·Listening) → 밴드.
   * 문항이 0 개면 **밴드 1 이 아니라 null** 이다 — 채점할 게 없는 것과 다 틀린 것은
   * 다른 말이고, 그 둘을 섞으면 아직 안 낸 영역 때문에 종합이 바닥으로 굳는다.
   */
  function sectionBand(correct, total, skill) {
    if (!(Number(total) > 0)) return null;
    return bandForScaled(scaledFromRaw(correct, total), skill);
  }

  /**
   * 산출형 영역(Writing·Speaking) → 밴드.
   * tasks: [{ score: 0~5, max?: 5 }] — 과제(문항) 하나당 한 개. 채점된 과제가
   * 하나도 없으면 null(= 채점 대기)이다.
   *
   * 스피킹은 표를 타지 않는다 — `speakingBand()` 참조.
   */
  function taskBand(tasks, skill) {
    var got = 0, top = 0, n = 0;
    for (var i = 0; i < (tasks || []).length; i++) {
      var t = tasks[i];
      if (!t || !isNum(Number(t.score))) continue;
      var max = isNum(Number(t.max)) && Number(t.max) > 0 ? Number(t.max) : TASK_MAX;
      got += Number(t.score);
      top += max;
      n += 1;
    }
    if (!n || top <= 0) return null;
    var ratio = Math.max(0, Math.min(1, got / top));
    if (String(skill || '').toLowerCase() === 'speaking') return speakingBand(ratio);
    return bandForScaled(halfUp(ratio * SCALED_MAX), skill);
  }

  /**
   * 스피킹 영역 밴드 = **과제 평균(0~5)을 그대로 0.5 단위로 올린 값**.
   *
   * 리딩·리스닝·라이팅과 달리 0~30 환산표를 거치지 않는다. 스피킹은 과제가 넷이라
   * 평균이 늘 0.25 단위로 떨어지는데, 그 자리를 표로 옮기면 같은 0.25 차이가 어떤
   * 구간에서는 밴드를 바꾸고 어떤 구간에서는 안 바꾼다. 학생에게 설명되는 눈금이
   * 아니어서, 평균을 0.5 로 올리는 규칙 하나로 바꿨다(2026-09-04, 운영 결정).
   *
   *   3.00 → 3.0 · 3.25 → 3.5 · 3.50 → 3.5 · 3.75 → 4.0 · 4.75 → 5.0
   *
   * 바닥은 1.0 이다(0.0 이라는 밴드는 없다). 천장은 만점 평균 5.0 이라 6.0 은
   * 스피킹에서 나오지 않는다 — 표를 버린 대가이고, 의도한 것이다.
   */
  function speakingBand(ratio) {
    var mean = Math.max(0, Math.min(1, Number(ratio) || 0)) * TASK_MAX;
    return Math.max(BAND_MIN, Math.min(BAND_MAX, toHalf(mean)));
  }

  /**
   * 종합 = 네 영역 밴드의 **평균**을 0.5 단위로 반올림(ETS 규칙, .25 는 올림).
   * ETS 예시: 5.125 → 5.0, 5.25 → 5.5.
   * null(채점 대기) 영역은 평균에서 통째로 빠진다.
   */
  function overall(bands) {
    var sum = 0, n = 0;
    for (var k in (bands || {})) {
      if (!Object.prototype.hasOwnProperty.call(bands, k)) continue;
      var v = Number(bands[k]);
      if (bands[k] === null || bands[k] === undefined || !isNum(v)) continue;
      sum += v; n += 1;
    }
    return n ? toHalf(sum / n) : null;
  }

  function cefr(band) { return CEFR[fmt(band)] || ''; }

  /** 밴드는 늘 소수 한 자리로 쓴다 — '5' 와 '5.0' 이 섞이면 다른 점수처럼 보인다. */
  function fmt(band) {
    return (band === null || band === undefined || !isNum(Number(band)))
      ? '—' : Number(band).toFixed(1);
  }

  /**
   * 응시 한 건 → 화면이 그릴 전부.
   *
   * @param row       sg_results 행 ({ by_section, set_code, scale })
   * @param taskRows  sg_task_scores 행 [] (없으면 W·S 는 채점 대기)
   * @returns { scale, sections:{skill:{band,status,...}}, overall, cefr, pending:[] }
   *
   * status 는 셋 중 하나다. 화면은 이 값만 보고 문구를 고르면 된다.
   *   'scored'  채점 끝 — R·L 은 자동채점, W·S 는 AI 채점
   *   'final'   교사가 손대서 확정 (W·S)
   *   'pending' 아직 점수가 없다
   *
   * AI 채점은 그 자체로 성적이다. 예전에는 'draft' 라는 네 번째 상태가 있어서
   * 교사가 확정하기 전까지 화면마다 "초안 · 확정 대기" 라고 붙였는데, 확정을
   * 기다리는 동안 학생에게는 점수가 없는 것처럼 보였다. 이제 AI 점수는 나오는
   * 즉시 그 응시의 점수이고, 교사의 확정은 **덮어쓰기**일 뿐 관문이 아니다.
   */
  function of(row, taskRows) {
    row = row || {};
    var by = row.by_section || {};
    var byTask = { writing: [], speaking: [] };
    var picked = {};

    /* DB 중복 행이 남아 있어도 문항당 점수는 하나만 집계한다. */
    for (var p = 0; p < (taskRows || []).length; p++) {
      var candidate = taskRows[p] || {};
      var candidateSkill = String(candidate.skill || '').toLowerCase();
      var candidateKey = candidateSkill + '|' + String(candidate.question_id || '');
      var current = picked[candidateKey];
      var candidateRank = (candidate.confirmed_at ? 8 : 0) +
        (candidate.teacher_score !== null && candidate.teacher_score !== undefined ? 4 : 0) +
        (candidate.ai_score !== null && candidate.ai_score !== undefined ? 2 : 0);
      var currentRank = current ? ((current.confirmed_at ? 8 : 0) +
        (current.teacher_score !== null && current.teacher_score !== undefined ? 4 : 0) +
        (current.ai_score !== null && current.ai_score !== undefined ? 2 : 0)) : -1;
      if (!current || candidateRank >= currentRank) picked[candidateKey] = candidate;
    }

    var pickedKeys = Object.keys(picked);
    for (var i = 0; i < pickedKeys.length; i++) {
      var t = picked[pickedKeys[i]] || {};
      var skill = String(t.skill || '').toLowerCase();
      if (!byTask[skill]) continue;
      /* 최종 점수는 교사가 이긴다. 교사가 손대지 않았으면 AI 점수가 그대로 점수다. */
      var score = (t.teacher_score === null || t.teacher_score === undefined)
        ? t.ai_score : t.teacher_score;
      if (score === null || score === undefined || score === '') continue;
      byTask[skill].push({
        score: Number(score),
        max: TASK_MAX,
        confirmed: !!t.confirmed_at,
        question_id: t.question_id || ''
      });
    }

    var sections = {}, bands = {}, pending = [];
    for (var s = 0; s < SKILLS.length; s++) {
      var skill2 = SKILLS[s];
      var band = null, status = 'pending', detail = null;

      if (skill2 === 'writing' || skill2 === 'speaking') {
        var tasks = byTask[skill2];
        band = taskBand(tasks, skill2);
        if (band !== null) {
          var confirmed = 0;
          for (var j = 0; j < tasks.length; j++) if (tasks[j].confirmed) confirmed += 1;
          /* 점수는 이미 나와 있다. confirmed 는 "선생님이 들여다본 자리" 를 세는
             것일 뿐, 점수가 유효한지를 가르는 값이 아니다. */
          status = confirmed === tasks.length ? 'final' : 'scored';
          var got = 0;
          for (var k = 0; k < tasks.length; k++) got += Number(tasks[k].score) || 0;
          detail = { tasks: tasks.length, confirmed: confirmed, got: got,
                     top: tasks.length * TASK_MAX,
                     scaled: scaledFromRaw(got, tasks.length * TASK_MAX) };
        }
      } else {
        var v = by[skill2];
        if (v) {
          band = sectionBand(v.score, v.total, skill2);
          if (band !== null) {
            status = 'scored';
            detail = { correct: Number(v.score) || 0, total: Number(v.total) || 0,
                       scaled: scaledFromRaw(v.score, v.total) };
          }
        }
      }

      if (band === null) pending.push(skill2);
      else bands[skill2] = band;
      sections[skill2] = { band: band, status: status, detail: detail };
    }

    var total = overall(bands);
    return {
      scale: row.scale || 'toefl6',
      sections: sections,
      overall: total,
      cefr: total === null ? '' : cefr(total),
      pending: pending
    };
  }

  return {
    SKILLS: SKILLS, TABLE: TABLE, CEFR: CEFR,
    SCALED_MAX: SCALED_MAX, TASK_MAX: TASK_MAX,
    halfUp: halfUp, toHalf: toHalf,
    scaledFromRaw: scaledFromRaw, bandForScaled: bandForScaled,
    sectionBand: sectionBand, taskBand: taskBand, speakingBand: speakingBand, overall: overall,
    cefr: cefr, fmt: fmt, of: of
  };
});
