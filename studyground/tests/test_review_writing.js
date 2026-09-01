/* 라이팅 채점 리뷰(assets/sg-review-writing.js) — node 전용.
 * 실행: node "studyground/tests/test_review_writing.js"
 *
 * 지키는 것 다섯.
 *  [A] SET 9 라이팅이 과제 셋으로 펴진다 — Build a Sentence 10문항 · Email 1 · Discussion 1.
 *  [B] Build a Sentence 는 정답표가 아니라 문항 자체(slots[].a)로 채점되고,
 *      어느 빈칸이 틀렸는지까지 남는다.
 *  [C] 과제 점수 칩은 눈금이 갈린다 — 자동채점은 'n/10', 루브릭은 'x.xx/5.00'.
 *  [D] 화면에 과제문이 함께 실린다 — 상대의 말 · 문장 틀 · 단어 은행 · 상황문 · 요구사항.
 *  [E] 채점 전 산출형 과제는 0점이 아니라 '아직 채점 전'으로 남는다.
 */
var fs = require('fs');
var path = require('path');

var SG2 = path.join(__dirname, '..', 'sg2');
global.window = global;

function load(rel) {
  var code = fs.readFileSync(path.join(SG2, rel), 'utf8');
  (0, eval)(code);
}

load('assets/set9.js');
load('assets/sg-review-writing.js');

var RW = window.SG_REVIEW_WRITING;
var PACK = window.SMEAG_SET9;
var fails = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }

/* 채점 행을 흉내낸다. Build a Sentence 는 홀수 문항만 정답을 그대로 채우고,
   짝수 문항은 첫 빈칸에 엉뚱한 말을 넣는다. 4번만 통째로 비워 무응답도 본다. */
function blanksOf(q) {
  return (q.slots || []).filter(function (s) { return s && s.t === 'b'; });
}

var rows = [];
PACK.sections.forEach(function (sec) {
  if (sec.id !== 'writing') return;
  sec.modules.forEach(function (mod) {
    mod.blocks.forEach(function (blk) {
      (blk.questions || []).forEach(function (q) {
        var given;
        if (q.kind === 'build') {
          var want = blanksOf(q).map(function (s) { return s.a; });
          if (q.no === 4) given = [];
          else if (q.no % 2 === 0) { given = want.slice(); given[0] = 'zzz'; }
          else given = want.slice();
        } else {
          given = 'This is what the student wrote for ' + q.id + '.';
        }
        rows.push({ qid: q.id, no: q.no, section: 'writing', given: given, key: null, ok: null });
      });
    });
  });
});

/* 이메일만 채점이 끝났고, 토론은 아직 채점 전이라고 둔다. */
var tasks = [{
  question_id: 'set9-W2-email', skill: 'writing', task_kind: 'email',
  ai_score: 4, teacher_score: null, confirmed_at: null, ai_model: 'gpt-4o',
  ai_rubric: { summary: 'Clear and on task.',
               score_basis: {
                 selected: 'A generally successful response.',
                 next: 'A fully successful response.',
                 lower: 'A partially successful response.'
               },
               criteria: [{ criterion: 'Task fulfilment', comment: 'All three points covered.' }] }
}];

var M = RW.model(PACK, rows, tasks);

/* [A] 구조 */
ok(M.length === 3, 'A: 라이팅 과제가 셋이어야 한다 — 실제 ' + M.length);
ok(M[0].items.length === 10, 'A: Build a Sentence 10문항 — 실제 ' + M[0].items.length);
ok(M[1].items.length === 1, 'A: Email 1과제 — 실제 ' + M[1].items.length);
ok(M[2].items.length === 1, 'A: Discussion 1과제 — 실제 ' + M[2].items.length);
ok(/build a sentence/i.test(M[0].label), 'A: 첫 과제 이름은 Build a Sentence — 실제 ' + M[0].label);

/* [B] Build a Sentence 채점 — 정답표에는 없는 문항이다 */
ok(PACK.answerKey['set9-W1-q01'] === undefined,
   'B: 전제 확인 — Build a Sentence 는 answerKey 에 없어야 한다');
var bas = M[0].items;
var odd = bas.filter(function (it) { return it.no % 2 === 1 && it.no !== 4; });
ok(odd.every(function (it) { return it.ok === true; }),
   'B: 정답 그대로 채운 홀수 문항은 전부 정답이어야 한다');
var even = bas.filter(function (it) { return it.no % 2 === 0 && it.no !== 4; });
ok(even.every(function (it) { return it.ok === false; }),
   'B: 첫 빈칸을 틀린 짝수 문항은 전부 오답이어야 한다');
ok(even.every(function (it) { return it.build.per[0] === false; }),
   'B: 틀린 자리가 첫 빈칸으로 남아야 한다');
ok(even.every(function (it) {
  return it.build.per.slice(1).every(function (x) { return x === true; });
}), 'B: 나머지 빈칸은 맞은 것으로 남아야 한다');
var q4 = bas.filter(function (it) { return it.no === 4; })[0];
ok(q4 && q4.build.answered === false && q4.ok === false,
   'B: 무응답 문항은 answered=false · ok=false 여야 한다');

/* [C] 점수 칩 — 눈금이 갈린다 */
ok(M[0].score.text === '5/10', 'C: BAS 는 10문항 중 5개 정답이어야 한다 — 실제 ' + M[0].score.text);
ok(M[1].score.text === '4.00/5.00', 'C: Email 은 루브릭 눈금이어야 한다 — 실제 ' + M[1].score.text);
ok(M[2].score.text === '—', 'C: 채점 전 토론은 점수가 없어야 한다 — 실제 ' + M[2].score.text);
ok(RW.shortLabel(M[2].label) === 'Discussion',
   'C: 긴 과제 이름은 칩에서 줄어야 한다 — 실제 ' + RW.shortLabel(M[2].label));

/* 선생님이 고치면 선생님이 이긴다 */
var M2 = RW.model(PACK, rows, [{ question_id: 'set9-W2-email', skill: 'writing',
  task_kind: 'email', ai_score: 4, teacher_score: 2, confirmed_at: '2026-08-11T00:00:00Z' }]);
ok(M2[1].score.text === '2.00/5.00',
   'C: 교사 점수가 AI 초안을 이겨야 한다 — 실제 ' + M2[1].score.text);

/* [D] 과제문이 화면에 실린다 */
var basHtml = RW.html(M, { m: 0, q: 0 });
var q1 = PACK.sections.filter(function (s) { return s.id === 'writing'; })[0]
  .modules[0].blocks[0].questions[0];
ok(basHtml.indexOf(RW.esc(q1.context)) >= 0, 'D: 상대가 던진 말(context)이 화면에 있어야 한다');
ok(basHtml.indexOf('Sentence Structure') >= 0, 'D: 문장 틀 이름이 있어야 한다');
ok(basHtml.indexOf('Word Bank') >= 0, 'D: 단어 은행 이름이 있어야 한다');
ok(q1.tiles.every(function (t) { return basHtml.indexOf(RW.esc(t)) >= 0; }),
   'D: 단어 은행의 타일이 전부 실려야 한다');
ok(basHtml.indexOf('rw-blank') >= 0, 'D: 빈칸이 빈칸으로 그려져야 한다');
ok(basHtml.indexOf('Correct Answer') >= 0, 'D: 정답 칸이 있어야 한다');

var mailHtml = RW.html(M, { m: 1, q: 0 });
var email = PACK.sections.filter(function (s) { return s.id === 'writing'; })[0]
  .modules[1].blocks[0].questions[0];
ok(mailHtml.indexOf(RW.esc(email.situation)) >= 0, 'D: 이메일 상황문이 실려야 한다');
ok(email.bullets.every(function (b) { return mailHtml.indexOf(RW.esc(b)) >= 0; }),
   'D: 이메일 요구사항 세 줄이 전부 실려야 한다');
ok(mailHtml.indexOf('4.00') >= 0, 'D: 이메일 점수가 실려야 한다');
ok(mailHtml.indexOf('All three points covered.') >= 0, 'D: 채점 근거(루브릭)가 실려야 한다');
ok(mailHtml.indexOf('Selected band') >= 0 &&
   mailHtml.indexOf('A generally successful response.') >= 0 &&
   mailHtml.indexOf('Next band up') >= 0 &&
   mailHtml.indexOf('A fully successful response.') >= 0,
   'D: 왜 이 점수인지 공식 점수 구간과 바로 위 구간이 보여야 한다');

var discHtml = RW.html(M, { m: 2, q: 0 });
var disc = PACK.sections.filter(function (s) { return s.id === 'writing'; })[0]
  .modules[2].blocks[0].questions[0];
ok(discHtml.indexOf(RW.esc(disc.prompt)) >= 0, 'D: 토론 문제문이 실려야 한다');
ok(disc.posts.every(function (p) { return discHtml.indexOf(RW.esc(p.text)) >= 0; }),
   'D: 토론 게시글이 전부 실려야 한다');

/* [E] 채점 전은 0점이 아니다 */
ok(discHtml.indexOf('Not scored yet.') >= 0, 'E: 채점 전이라고 말해야 한다');
ok(discHtml.indexOf('0.00') < 0, 'E: 채점 전을 0.00 으로 보여 주면 안 된다');

/* 문항 이동 줄 — 색이 곧 채점 결과다 */
ok(/lr-dot ok/.test(basHtml) && /lr-dot no/.test(basHtml),
   'E: 이동 줄에 맞음·틀림이 색으로 갈려야 한다');
ok(basHtml.indexOf('data-go="wrong"') >= 0, 'E: 다음 오답으로 건너뛰는 단추가 있어야 한다');
ok(mailHtml.indexOf('data-go="next"') < 0,
   'E: 문항이 하나뿐인 과제에는 이전/다음이 없어야 한다');

if (fails.length) {
  console.error('FAIL (' + fails.length + ')');
  fails.forEach(function (m) { console.error('  · ' + m); });
  process.exit(1);
}
console.log('OK — 라이팅 리뷰: 구조 · Build a Sentence 채점 · 점수 눈금 · 과제문 · 채점 전 표시');
