/* Build a Sentence 는 AI 리뷰에 실어 보내지 않는다.
 *
 * 왜
 *   BAS 는 정답표가 있는 자동채점 문항이다. 리뷰 화면이 빈칸마다 내 답과 정답을
 *   나란히 펴 놓기 때문에, AI 가 여기에 쓸 말은 정답을 다시 읽어 주는 것뿐이다.
 *   채점(sg_task_scores)에서도 이미 빠져 있으니 코멘트만 혼자 남으면 안 된다.
 *
 * 두 자리를 함께 지킨다
 *   1. 보내지 않는다 — questionsFor 가 서버에 넘기는 목록에 build 가 없어야 한다.
 *      /api/feedback 은 "받은 문항 목록에 있는 것만" 코멘트한다.
 *   2. 그리지 않는다 — 예전에 저장된 AI 초안이 남아 있어도 BAS 칸에는 접는다.
 *      선생님이 직접 쓴 코멘트는 그대로 남는다.
 *
 * 겸사겸사 하나 더: 이 목록에는 **내 답이 실리지 않는다**. 채점 근거가 되는 글은
 * 언제나 서버가 sg_results.answers 에서 직접 읽는다(/api/score 와 같은 규칙).
 *
 * 실행: node studyground/tests/test_ai_review_skips_build.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var fails = 0;
function ok(cond, what) {
  if (cond) return;
  fails++;
  console.error('FAIL — ' + what);
}

/* ── 1. 보내지 않는다 ─────────────────────────────────────────────────── */

var SRC = path.join(__dirname, '..', 'sg2', 'assets', 'sg-comments.js');
global.window = {};
require(SRC);
var SG_COMMENTS = global.window.SG_COMMENTS;
ok(SG_COMMENTS && typeof SG_COMMENTS.questionsFor === 'function',
   'A: SG_COMMENTS.questionsFor 가 있어야 한다');

var DET = {
  score: 2, total: 4,
  bySection: {},
  rows: [
    { qid: 'R1-3', no: 3, section: 'reading', kind: 'blank',
      prompt: 'The lecture ____', given: 'begin', key: 'began', ok: false },
    { qid: 'W1-3', no: 3, section: 'writing', kind: 'build',
      prompt: 'Have you decided on you class schedule yet?',
      given: 'to the morning section I still if can switch',
      key: 'if I can still switch to the morning section', ok: false },
    { qid: 'W2-1', section: 'writing', kind: 'email',
      prompt: 'Write an email', given: 'Dear professor, '.repeat(10), ok: null }
  ]
};
var sent = SG_COMMENTS.questionsFor(DET);
var ids = sent.map(function (q) { return q.question_id; });

ok(ids.indexOf('W1-3') < 0, 'B: Build a Sentence 오답은 AI 에 보내지 않는다');
ok(ids.indexOf('R1-3') >= 0, 'C: 다른 오답은 그대로 보낸다');
ok(ids.indexOf('W2-1') >= 0, 'D: 서술형 문항도 그대로 보낸다(코멘트 대상이다)');
ok(sent.every(function (q) { return !('given' in q) && !('answer' in q); }),
   'D2: 학생의 답은 보내지 않는다 — 서버가 DB 에서 직접 읽는다');

/* ── 2. 그리지 않는다 ─────────────────────────────────────────────────── */

var HTML = fs.readFileSync(path.join(__dirname, '..', 'sg2', 'review.html'), 'utf8');
var WRITE_JS = fs.readFileSync(
  path.join(__dirname, '..', 'sg2', 'assets', 'sg-review-writing.js'), 'utf8');

ok(/opts\.extraFor\(it\.qid, it\)/.test(WRITE_JS),
   'E: 라이팅 리뷰는 extraFor 에 문항을 함께 넘겨야 한다(종류를 알아야 접는다)');

var a = HTML.indexOf('    WRITE = SG_REVIEW_WRITING.mount(el, {');
var b = HTML.indexOf('onPaint', a);
var block = a >= 0 && b > a ? HTML.slice(a, b) : '';
ok(/it\.kind === 'build'/.test(block) && /c\.source === 'teacher'/.test(block),
   'F: BAS 칸에서는 AI 코멘트를 걸러 내고 선생님 코멘트만 남긴다');

if (fails) process.exit(1);
console.log('OK — AI 리뷰는 Build a Sentence 를 건드리지 않는다: 전송 제외 · 표시 제외');
