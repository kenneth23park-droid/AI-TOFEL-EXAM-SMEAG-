/* 성적 세트 — 여러 회차에서 영역별로 하나씩 골라 한 벌로 합치는 계산.
 *
 * 이 계산이 틀리면 학생의 성적표가 틀린다. 지켜야 할 것은 넷이다.
 *   1) 고른 회차의 그 영역만 온다 — 다른 회차의 같은 영역이 섞이면 안 된다.
 *   2) 종합은 합쳐진 네 밴드의 평균이다(어느 한 응시의 종합이 아니다).
 *   3) 점수가 없는 영역은 고를 수 없다(supplies 가 null 로 말한다).
 *   4) 라이팅·스피킹은 과제 행에서 오므로, 회차를 바꾸면 과제도 통째로 바뀐다.
 *
 * 실행: node studyground/tests/test_score_set.js
 */
'use strict';

var path = require('path');
var ROOT = path.join(__dirname, '..');
var BAND = require(path.join(ROOT, 'sg2', 'assets', 'sg-band.js'));
var SS = require(path.join(ROOT, 'sg2', 'assets', 'sg-score-set.js'));

var fails = 0;
function ok(cond, label) {
  if (cond) { console.log('PASS ' + label); return; }
  fails += 1;
  console.error('FAIL ' + label);
}
function eq(got, want, label) { ok(got === want, label + ' (got ' + got + ', want ' + want + ')'); }

/* ── 재료 ────────────────────────────────────────────────────────────────
   1회차: 리딩·리스닝만 좋고 라이팅은 낮다. 스피킹은 아예 채점이 없다(녹음 실패).
   2회차: 라이팅·스피킹만 다시 쳤다 — 리딩·리스닝은 손대지 않아 by_section 이 없다. */
function tasks(session, skill, kind, scores) {
  return scores.map(function (s, i) {
    return { session: session, question_id: kind + (i + 1), skill: skill, task_kind: kind,
             ai_score: s, teacher_score: null, confirmed_at: null };
  });
}

var A = {
  session: 'a', set_code: 'SET 9', attempt_no: 1, submitted_at: '2026-08-03T01:00:00Z',
  by_section: { reading: { score: 45, total: 50 }, listening: { score: 40, total: 47 } }
};
var B = {
  session: 'b', set_code: 'SET 9', attempt_no: 2, submitted_at: '2026-08-09T01:00:00Z',
  by_section: {}
};

var TASKS = {
  a: tasks('a', 'writing', 'email', [2, 2]),                    // 낮은 라이팅
  b: tasks('b', 'writing', 'email', [5, 5]).concat(            // 다시 친 라이팅
       tasks('b', 'speaking', 'repeat', [4, 4, 4]))            // 그리고 스피킹
};
var SRC = { a: { row: A, tasks: TASKS.a }, b: { row: B, tasks: TASKS.b } };

/* ── 1. supplies — 어느 응시가 어느 영역을 채울 수 있는가 ── */
var supA = SS.supplies(A, TASKS.a);
var supB = SS.supplies(B, TASKS.b);
ok(supA.reading !== null && supA.listening !== null, '1회차는 R·L 을 채운다');
ok(supA.speaking === null, '1회차 스피킹은 채점이 없어 고를 수 없다');
ok(supB.reading === null && supB.listening === null, '2회차는 R·L 을 채우지 못한다(영역별 재응시)');
ok(supB.writing !== null && supB.speaking !== null, '2회차는 W·S 를 채운다');

/* ── 2. 고른 회차의 그 영역만 온다 ── */
var c = SS.compose(
  { reading: 'a', listening: 'a', writing: 'b', speaking: 'b' }, SRC);

eq(c.missing.length, 0, '네 영역이 다 찼다');
eq(c.view.sections.reading.band, BAND.sectionBand(45, 50, 'reading'), '리딩은 1회차 그대로');
eq(c.view.sections.writing.band, BAND.taskBand([{ score: 5 }, { score: 5 }], 'writing'),
   '라이팅은 2회차만 — 1회차의 낮은 과제가 섞이지 않는다');
eq(c.view.sections.speaking.band, BAND.taskBand([{ score: 4 }, { score: 4 }, { score: 4 }], 'speaking'),
   '스피킹은 2회차에서 온다');

/* 섞이지 않는다는 것을 다른 쪽에서도 확인한다 — 라이팅을 1회차로 바꾸면 값이 달라져야 한다. */
var c1 = SS.compose({ reading: 'a', listening: 'a', writing: 'a', speaking: 'b' }, SRC);
ok(c1.view.sections.writing.band < c.view.sections.writing.band,
   '라이팅을 1회차로 바꾸면 밴드가 내려간다');

/* ── 3. 종합은 합쳐진 네 밴드의 평균 ── */
var want = BAND.overall({
  reading: c.view.sections.reading.band,
  listening: c.view.sections.listening.band,
  writing: c.view.sections.writing.band,
  speaking: c.view.sections.speaking.band
});
eq(c.view.overall, want, '종합 = 고른 네 영역의 평균');
ok(c.view.overall !== BAND.of(A, TASKS.a).overall, '어느 한 응시의 종합과 같지 않다');

/* ── 4. 출처가 함께 남는다 ── */
eq(c.sections.reading.session, 'a', '리딩의 출처는 1회차');
eq(c.sections.speaking.attempt_no, 2, '스피킹의 출처는 2회차');
eq(c.setCode, 'SET 9', '한 세트 안에서 골랐으면 세트 코드는 하나');

/* 세트를 넘나들면 둘 다 적힌다 — 성적표에 어느 시험이었는지 남아야 한다. */
var B8 = { session: 'c', set_code: 'SET 8', attempt_no: 1, submitted_at: '2026-08-10T01:00:00Z', by_section: {} };
var c2 = SS.compose({ reading: 'a', listening: 'a', writing: 'c', speaking: 'c' },
  { a: SRC.a, c: { row: B8, tasks: tasks('c', 'writing', 'email', [3, 3]).concat(tasks('c', 'speaking', 'repeat', [3])) } });
eq(c2.setCode, 'SET 9 + SET 8', '세트를 넘나든 성적 세트는 둘 다 적는다');

/* ── 5. 빈 영역은 missing 으로 나온다(화면이 확정 버튼을 잠그는 근거) ── */
var c3 = SS.compose({ reading: 'a', listening: 'a' }, SRC);
eq(c3.missing.join(','), 'writing,speaking', '고르지 않은 영역은 missing');
eq(c3.view.sections.writing.band, null, '고르지 않은 영역은 밴드가 없다');

/* 없는 session 을 가리켜도 터지지 않는다 — 응시가 지워졌거나 못 읽는 자리. */
var c4 = SS.compose({ reading: 'zzz', listening: 'a', writing: 'b', speaking: 'b' }, SRC);
eq(c4.missing.join(','), 'reading', '모르는 session 은 빈 영역으로 남는다');

/* ── 6. snapshot — 확정 순간의 값이 그대로 굳는다 ── */
var snap = SS.snapshotOf(c.view);
eq(snap.overall, c.view.overall, 'snapshot 의 종합');
eq(snap.sections.speaking, c.view.sections.speaking.band, 'snapshot 의 영역 밴드');
eq(snap.cefr, c.view.cefr, 'snapshot 의 CEFR');

console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exit(fails ? 1 : 0);
