/* =============================================================
 * SMEAG TOEFL — 자동 채점 엔진
 * 담당 C · window.SMEAG_GRADE 하나만 정의한다.
 *
 * ES module 아님 — <script src> 로 로드된다.
 * 의존: window.SMEAG_SET1 (문제 데이터), window.SMEAG (util)
 *
 * 채점 규칙 (INTERFACES.md)
 *   blank          : SMEAG.normWord(내 답) === SMEAG.normWord(q.answer)
 *   mcq / insert   : 숫자 인덱스 일치 (null/미응답은 오답)
 *   build          : SMEAG.tokenize(내 답.join(' ')) 와
 *                    SMEAG.tokenize(q.answerTokens.join(' ')) 배열이 완전 동일
 *   email/discussion/repeat/interview : correct = null → pending 에 id 추가
 * ============================================================= */
(function () {
  'use strict';

  /* ---------- util 안전 접근 --------------------------------------
   * util.js 가 먼저 로드되는 것이 정상이지만, 만에 하나 없더라도
   * 채점이 예외로 죽지 않도록 동일 동작의 최소 대체 구현을 둔다. */
  function U() { return window.SMEAG || null; }

  function normWord(s) {
    var u = U();
    if (u && typeof u.normWord === 'function') return u.normWord(s);
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
  }

  function tokenize(s) {
    var u = U();
    if (u && typeof u.tokenize === 'function') return u.tokenize(s);
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t.length > 0; });
  }

  function sameTokens(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  /* ---------- 문항 종류 분류 ---------------------------------------- */
  var AUTO_KINDS = { blank: true, mcq: true, insert: true, build: true };
  var PENDING_KINDS = { email: true, discussion: true, repeat: true, interview: true };
  var SPEAKING_KINDS = { repeat: true, interview: true };

  /* 한 문항 채점 → {correct, expected} */
  function gradeOne(q, response) {
    var kind = q.kind;

    if (kind === 'blank') {
      return {
        correct: response != null && normWord(response) === normWord(q.answer),
        expected: q.answer
      };
    }

    if (kind === 'mcq' || kind === 'insert') {
      // 미응답(null/undefined)은 오답 처리. 숫자 인덱스 비교.
      return {
        correct: typeof response === 'number' && response === q.answer,
        expected: q.answer
      };
    }

    if (kind === 'build') {
      var mine = Array.isArray(response) ? response : [];
      var want = Array.isArray(q.answerTokens) ? q.answerTokens : [];
      return {
        correct: mine.length > 0 && sameTokens(tokenize(mine.join(' ')), tokenize(want.join(' '))),
        expected: want
      };
    }

    // email / discussion → 사람이 채점, speaking → 녹음 제출만 확인
    if (PENDING_KINDS[kind]) {
      return { correct: null, expected: null };
    }

    // 알 수 없는 kind 는 자동채점 대상에서 제외한다.
    return { correct: null, expected: null };
  }

  /* ---------- 메인 -------------------------------------------------- */
  function run(attempt) {
    var answers = (attempt && attempt.answers) || {};
    var set = window.SMEAG_SET1;

    var perQuestion = {};
    var pending = [];
    var sections = {
      reading: { correct: 0, total: 0, pct: 0 },
      listening: { correct: 0, total: 0, pct: 0 },
      writing: { correct: 0, total: 0, pct: 0 },   // Build a Sentence 만 집계
      speaking: { submitted: 0, total: 0 }
    };

    var entries = (set && typeof set.allQuestions === 'function') ? set.allQuestions() : [];

    entries.forEach(function (e) {
      var q = e.q;
      var sid = e.section && e.section.id;
      var response = answers[q.id];
      var res = gradeOne(q, response);

      perQuestion[q.id] = {
        correct: res.correct,
        response: response === undefined ? null : response,
        expected: res.expected,
        kind: q.kind
      };

      if (PENDING_KINDS[q.kind]) pending.push(q.id);

      if (SPEAKING_KINDS[q.kind]) {
        // 스피킹: 정오가 아니라 '제출 여부' 로 집계한다.
        sections.speaking.total += 1;
        if (response && response.recorded === true) sections.speaking.submitted += 1;
        return;
      }

      if (!AUTO_KINDS[q.kind]) return;   // email / discussion 은 점수 총계에서 제외

      var bucket = sections[sid];
      if (!bucket) return;
      bucket.total += 1;
      if (res.correct === true) bucket.correct += 1;
    });

    function pct(c, t) { return t > 0 ? Math.round((c / t) * 1000) / 10 : 0; }

    sections.reading.pct = pct(sections.reading.correct, sections.reading.total);
    sections.listening.pct = pct(sections.listening.correct, sections.listening.total);
    sections.writing.pct = pct(sections.writing.correct, sections.writing.total);

    var autoCorrect = sections.reading.correct + sections.listening.correct + sections.writing.correct;
    var autoTotal = sections.reading.total + sections.listening.total + sections.writing.total;

    return {
      perQuestion: perQuestion,
      sections: sections,
      autoScore: { correct: autoCorrect, total: autoTotal, pct: pct(autoCorrect, autoTotal) },
      pending: pending,
      gradedAt: new Date().toISOString()
    };
  }

  window.SMEAG_GRADE = { run: run };
})();
