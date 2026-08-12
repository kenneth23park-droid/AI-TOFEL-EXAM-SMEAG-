/* 제출하고 인터넷이 있으면 리뷰와 학습 계획이 따라 나온다.
 *
 * 이 기능이 조용히 반쯤 죽는 자리가 셋 있어서, 셋을 다 못 박는다.
 *
 *   1. 저장이 서버로 옮겨졌다. 학생은 sg_comments 에 쓸 수 없다(RLS). 브라우저가
 *      저장을 맡고 있으면 학생 화면에서는 리뷰가 만들어지고도 사라진다.
 *   2. 계획 행은 따로 쓴다. scope='plan' 과 data 칸은 새로 낸 것이라, 아직
 *      supabase/ai_review_plan.sql 을 돌리지 않은 DB 에서는 그 한 행 때문에
 *      배열 전체가 400 으로 되돌아온다 — 총평·문항별 해설까지 함께 죽는다.
 *   3. 제출 화면이 리뷰를 부른다. 여기서 안 부르면 학생이 리뷰 화면을 연 뒤에야
 *      시작되고, 그 화면은 빈 카드로 몇십 초를 서 있는다.
 *
 * 실행: node studyground/tests/test_review_plan.js
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

var SG2 = path.join(__dirname, '..', 'sg2');
var API = require(path.join(SG2, 'api', 'feedback.js'));
var SRC_EARLY = fs.readFileSync(path.join(SG2, 'api', 'feedback.js'), 'utf8');

/* ── 1. 서버가 만드는 행 ─────────────────────────────────────────────── */

var parsed = {
  sections: [
    { scope: 'reading', summary: 'R', strengths: ['a'], improvements: ['b'] },
    { scope: 'overall', summary: 'O' },
    { scope: 'nonsense', summary: 'X' }            // 스키마 밖의 scope 는 버린다
  ],
  questions: [{ question_id: 'R1-3', body: 'why' }, { question_id: '', body: 'no id' }],
  plan: {
    summary: 'p',
    focus: [{ skill: 'listening', why: 'w', target: 'Band 4.5' }],
    study: [{ title: 'Dictation', detail: 'd', minutes: 20, how_often: 'daily' }],
    weeks: [{ week: 1, goal: 'g', tasks: ['t'] }],
    next_test: 'n'
  }
};
var out = API.rowsFor('owner-1', 'sess-1', 'model-x', 'en', parsed);

ok(out.rows.map(function (r) { return r.scope; }).join(',') === 'reading,overall,question',
   'A: 스키마에 있는 scope 와 id 있는 문항만 남는다 (지금 ' +
   out.rows.map(function (r) { return r.scope; }).join(',') + ')');
ok(out.rows.every(function (r) { return r.source === 'ai'; }), 'A: 전부 AI 출처다');

ok(out.plan && out.plan.scope === 'plan' && out.plan.question_id === '',
   'B: 학습 계획은 scope=plan 한 행이다');
ok(out.plan && out.plan.data && out.plan.data.weeks && out.plan.data.weeks.length === 1,
   'B: 계획 전문은 data 칸에 통째로 들어간다');
/* 총평·문항별 행도 구조를 들고 간다(영역별 문제점·근거·해결, 문항의 문제점·원인·해결).
   예전에는 이 행에 data 를 못 붙였다 — 칸이 없는 DB 에서 배열 전체가 400 으로 죽었기
   때문이다. 지금은 putComments 가 그 400 을 잡아 data 를 떼고 한 번 더 넣으므로,
   구조를 붙이되 없는 DB 에서도 글은 남는다. 그 재시도가 이 규칙의 전제다. */
ok(out.rows.every(function (r) { return !('data' in r) || r.data && typeof r.data === 'object'; }),
   'C: 총평·문항별 행의 data 는 있으면 객체다');
ok(/PGRST204/.test(SRC_EARLY) && /delete copy\.data/.test(SRC_EARLY),
   'C: data 칸이 없는 DB 는 400 을 잡아 data 를 떼고 다시 넣는다');
ok(out.plan && out.plan.improvements.indexOf('Dictation') >= 0,
   'C: data 칸이 없는 DB 를 대비해 할 일 제목은 improvements 에도 겹쳐 둔다');

/* 계획이 없는 응답에도 총평은 저장돼야 한다. */
var noPlan = API.rowsFor('o', 's', 'm', 'en', { sections: [{ scope: 'overall', summary: 'x' }] });
ok(noPlan.plan === null && noPlan.rows.length === 1, 'D: 계획이 없어도 총평은 남는다');

/* ── 2. 서버에 보내는 것 · 서버가 읽는 것 ────────────────────────────── */

var SRC = fs.readFileSync(path.join(SG2, 'api', 'feedback.js'), 'utf8');
ok(/sg_results\?select=/.test(SRC) && /sg_task_scores\?select=/.test(SRC),
   'E: 채점 결과는 서버가 DB 에서 직접 읽는다');
ok(/SUPABASE_SERVICE_ROLE_KEY/.test(SRC),
   'F: 저장은 service_role 로 한다 — 학생 토큰으로는 sg_comments 에 못 쓴다');
ok(!/staffOf\(/.test(SRC), 'G: 더 이상 선생님 전용이 아니다 (학생이 자기 리뷰를 부른다)');
ok(/const owner = \(me\.staff && body\.owner\)/.test(SRC),
   'G: 남의 응시를 지정하는 것은 여전히 선생님만이다');
ok(/const force = !!body\.force && me\.staff/.test(SRC),
   'H: 다시 사는 것(force)은 선생님만 — 학생 새로고침이 결제 버튼이 되면 안 된다');

/* 여러 채점 결과를 한 프롬프트에 담는데, 응답이 오래 걸린다. 기본 10초로는 못 끝낸다. */
ok(API.config && API.config.maxDuration >= 60, 'I: 실행 시간 상한을 늘려 둔다');

/* ── 3. 부르는 자리 ──────────────────────────────────────────────────── */

var SHELL = fs.readFileSync(path.join(SG2, 'assets', 'exam-shell.js'), 'utf8');
ok(/assets\/sg-comments\.js/.test(SHELL), 'J: 시험 셸이 sg-comments.js 를 싣는다');
ok(/askReview\(session\)/.test(SHELL) && /SG_COMMENTS\.generate\(/.test(SHELL),
   'J: 제출 화면이 채점 뒤 리뷰를 부른다');
ok(SHELL.indexOf('showBands(session).then(function (b) {\n        if (b) return askReview(session);') >= 0,
   'K: 밴드가 나온 뒤에 부른다 — 채점 전에 부르면 W·S 없는 리뷰가 최종본이 된다');

var HTML = fs.readFileSync(path.join(SG2, 'review.html'), 'utf8');
ok(/id="plan"/.test(HTML) && /function paintPlan\(\)/.test(HTML),
   'L: 리뷰 화면에 학습 계획 카드가 있다');
ok(/function autoReview\(\)/.test(HTML),
   'M: 리뷰가 없으면 리뷰 화면에서도 한 번 부른다 (오프라인으로 치른 응시)');
ok(/if \(ASKED \|\| STAFF/.test(HTML),
   'M: 한 번만 부르고, 선생님 화면에서는 자동으로 부르지 않는다');
ok(/if \(!TASKS_READY \|\| !VIEW \|\| VIEW\.overall === null\) return;/.test(HTML),
   'N: 채점 전에는 부르지 않는다 — 쓸 말이 없다');
ok((HTML.split('SG_COMMENTS.generate(').length - 1) === 1,
   'O: 생성 경로는 한 군데뿐이다 (선생님 버튼 · 연필 · 자동 요청이 같은 함수를 지난다)');
ok(!/SG_COMMENTS\.save\(\{[\s\S]{0,200}source: 'ai'/.test(HTML),
   'P: 브라우저는 AI 코멘트를 저장하지 않는다 — 서버가 쓴다');

if (fails) { console.error('\n' + fails + '개 실패'); process.exit(1); }
console.log('OK — 제출 → AI 채점 → 리뷰·학습 계획: 서버 저장 · 분리 저장 · 두 입구');
