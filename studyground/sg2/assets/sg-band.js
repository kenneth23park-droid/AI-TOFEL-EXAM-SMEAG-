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
 *   SG_BAND.linearBand(ratio)                   W·S 전용 기관 선형 환산 (1 + 5×비율)
 *   SG_BAND.speakingBand(ratio)                 스피킹 — linearBand 의 다른 이름
 *   SG_BAND.writingRaw(auto, essays)            라이팅 원점수 {raw, max} (BAS + 가중 에세이)
 *   SG_BAND.writingBand(auto, essays)           라이팅 — BAS 를 포함한 밴드
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

  /* 라이팅 12문항의 ETS 배점 — Build a Sentence 는 문항당 1점, 에세이 둘은 각 5.14 점.
     그래서 라이팅 만점은 10 + 5.14 + 5.14 = 20.28 이다. 에세이는 0~5 루브릭으로
     채점하므로 원점수로 넣을 때 5.14/5 를 곱한다. */
  var ESSAY_WEIGHT = 5.14;

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
   * 기관용 선형 환산 — 비율(0~1)을 1.0~6.0 에 그대로 편다. Writing·Speaking 전용.
   *
   * Reading·Listening 과 달리 0~30 ETS 표를 거치지 않는다. 산출형은 과제 수가 적어
   * 원점수가 늘 0.25 단위로 떨어지는데, 그 자리를 표로 옮기면 같은 0.25 차이가 어떤
   * 구간에서는 밴드를 바꾸고 어떤 구간에서는 안 바꾼다. 학생에게 설명되는 눈금이
   * 아니어서 선형식 하나로 바꿨다.
   *
   *     밴드 = round½(1 + 원점수 ÷ 만점 × 5)
   *
   * 2026-09-04 에 스피킹만 "평균을 0.5 로 올린다"(= 5×비율)로 바꿨고, 2026-09-07 에
   * 여기 +1 을 더해 두 영역 모두 이 식으로 통일했다. 만점이 6.0 에 닿는다.
   * .25·.75 는 늘 올린다 — 집 전체의 반올림 규칙과 같다.
   */
  function linearBand(ratio) {
    var r = Math.max(0, Math.min(1, Number(ratio) || 0));
    return Math.max(BAND_MIN, Math.min(BAND_MAX, toHalf(BAND_MIN + r * (BAND_MAX - BAND_MIN))));
  }

  /** 스피킹 밴드 = 과제 평균(0~5, 11과제 만점 55)을 선형 환산한 값. linearBand 와 같다. */
  function speakingBand(ratio) { return linearBand(ratio); }

  /**
   * 라이팅 원점수 → { raw, max }.
   *
   *   raw = Build a Sentence 정답 수 + Σ(에세이 점수 ÷ 5 × 5.14)
   *   max = BAS 문항 수 + 에세이 수 × 5.14          (SET 9 기준 10 + 10.28 = 20.28)
   *
   * 채점되지 않은 부분은 raw 에도 max 에도 들어가지 않는다 — 넣으면 아직 안 낸 몫이
   * 오답으로 세어져 밴드가 실제보다 낮게 굳는다.
   *
   * @param auto    { score, total } Build a Sentence 자동채점분 (by_section.writing). 없으면 null
   * @param essays  [{ score: 0~5 }]  Email · Academic Discussion
   */
  function writingRaw(auto, essays) {
    var raw = 0, max = 0;
    if (auto && Number(auto.total) > 0) {
      raw += Math.max(0, Math.min(Number(auto.total), Number(auto.score) || 0));
      max += Number(auto.total);
    }
    for (var i = 0; i < (essays || []).length; i++) {
      var t = essays[i];
      if (!t || !isNum(Number(t.score))) continue;
      var top = isNum(Number(t.max)) && Number(t.max) > 0 ? Number(t.max) : TASK_MAX;
      raw += Math.max(0, Math.min(top, Number(t.score))) / top * ESSAY_WEIGHT;
      max += ESSAY_WEIGHT;
    }
    return { raw: raw, max: max };
  }

  /**
   * 라이팅 영역 밴드. 에세이가 한 편도 채점되지 않았으면 null(= 채점 대기)이다 —
   * BAS 만으로 밴드를 내면 10 점짜리 몫을 다 놓친 점수가 성적표에 실린다.
   */
  function writingBand(auto, essays) {
    var scored = 0;
    for (var i = 0; i < (essays || []).length; i++) {
      if (essays[i] && isNum(Number(essays[i].score))) scored += 1;
    }
    if (!scored) return null;
    var w = writingRaw(auto, essays);
    return w.max > 0 ? linearBand(w.raw / w.max) : null;
  }

  /**
   * 산출형 영역(Writing·Speaking) 과제 목록 → 밴드.
   * tasks: [{ score: 0~5, max?: 5 }] — 과제(문항) 하나당 한 개. 채점된 과제가
   * 하나도 없으면 null(= 채점 대기)이다.
   *
   * 라이팅을 이 함수로 부르면 **에세이만** 접은 값이다. BAS 를 포함한 영역 밴드는
   * writingBand() 이고, of() 가 그쪽을 쓴다. 여기는 성적표의 파트별 칸처럼 한 파트만
   * 따로 볼 때를 위해 남아 있다.
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
    var s = String(skill || '').toLowerCase();
    if (s === 'speaking' || s === 'writing') return linearBand(ratio);
    return bandForScaled(halfUp(ratio * SCALED_MAX), skill);
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
        /* 라이팅만 자동채점분(Build a Sentence)을 함께 접는다 — 12문항 중 10문항이
           거기 있어서, 에세이 둘만 보면 영역의 절반을 안 본 점수가 된다. */
        var auto = skill2 === 'writing' ? by.writing : null;
        band = skill2 === 'writing' ? writingBand(auto, tasks) : taskBand(tasks, skill2);
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
                     /* 옛 /30·/120 눈금은 전환기(2026~2028) 병기용으로 계속 낸다.
                        밴드가 표를 떠났어도 이 값은 같은 비율에서 나와야 한다. */
                     scaled: scaledFromRaw(got, tasks.length * TASK_MAX) };
          if (skill2 === 'writing') {
            var w = writingRaw(auto, tasks);
            detail.raw = Math.round(w.raw * 1000) / 1000;
            detail.rawMax = Math.round(w.max * 1000) / 1000;
            detail.scaled = scaledFromRaw(w.raw, w.max);
            if (auto && Number(auto.total) > 0) {
              detail.autoCorrect = Number(auto.score) || 0;
              detail.autoTotal = Number(auto.total);
            }
          }
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
    SCALED_MAX: SCALED_MAX, TASK_MAX: TASK_MAX, ESSAY_WEIGHT: ESSAY_WEIGHT,
    halfUp: halfUp, toHalf: toHalf,
    scaledFromRaw: scaledFromRaw, bandForScaled: bandForScaled,
    sectionBand: sectionBand, taskBand: taskBand,
    linearBand: linearBand, speakingBand: speakingBand,
    writingRaw: writingRaw, writingBand: writingBand, overall: overall,
    cefr: cefr, fmt: fmt, of: of
  };
});
