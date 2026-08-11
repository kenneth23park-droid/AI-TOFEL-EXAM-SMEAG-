/* smeag000 계정에 Writing·Speaking 샘플 응시를 하나 만든다 (AI 채점·리뷰 시연용).
 *
 * 왜 스크립트인가
 *   답안은 팩(set9.js)의 실제 문항에 맞춰야 하고, score/total/percent/by_section 은
 *   화면과 **같은 코드**(sg-results.js 의 score())로 나와야 한다. 손으로 적은 SQL 은
 *   문항이 한 번 바뀌는 순간 조용히 어긋난다.
 *
 * 스피킹은 녹음이 없다
 *   그래서 sg_task_scores.transcript 를 먼저 심는다. /api/score 는 이미 옮겨 적어 둔
 *   글이 있으면 STT 를 건너뛰고 그 글을 그대로 채점한다(score.js speechOf 2단계).
 *   덕분에 음성 파일 없이도 AI 채점 → 교사 확정 → AI 리뷰의 전 과정을 볼 수 있다.
 *
 * 답안의 수준은 일부러 고르지 않다 — 그대로 따라 한 문장, 낱말이 빠진 문장, 크게
 * 무너진 문장이 섞여야 루브릭의 축이 실제로 갈리는지 확인할 수 있다.
 *
 * 쓰는 법
 *   node studyground/tools/seed_sample_ws.js > /tmp/seed.sql   # SQL 만 만든다
 *   (그 SQL 을 Supabase SQL Editor 에 붙여 넣는다 — RLS 밖에서 도는 자리다)
 *
 * 지우려면
 *   delete from sg_task_scores where session = 'sample-set9-ws-001';
 *   delete from sg_comments    where session = 'sample-set9-ws-001';
 *   delete from sg_results     where session = 'sample-set9-ws-001';
 */
'use strict';

var path = require('path');

var ROOT = path.join(__dirname, '..');      // studyground/

global.window = {};
global.localStorage = { length: 0, key: function () { return null; }, getItem: function () { return null; } };
require(ROOT + '/sg2/assets/set9.js');
require(ROOT + '/sg2/assets/sg-results.js');

var PACK = global.window.SMEAG_SET9;
var ALL = PACK.allQuestions().map(function (x) { return x.q || x; });

var OWNER = '956d6efb-db96-4404-aa51-96ddfa7f04d1';       // smeag000 (Sunny)
var SESSION = 'sample-set9-ws-001';
var STARTED = '2026-08-12T01:10:00.000Z';
var SUBMITTED = '2026-08-12T02:05:00.000Z';

/* ── Writing 1 · Build a Sentence (자동채점) ──────────────────────────────
   10문항 중 7개는 정답 순서 그대로, 3개는 흔한 오답(어순 뒤집기)으로 둔다. */
var WRONG = { 'set9-W1-q03': 1, 'set9-W1-q06': 1, 'set9-W1-q09': 1 };

function tokensOf(q) {
  return (q.slots || []).filter(function (s) { return s && s.t === 'b'; })
                        .map(function (s) { return s.a; });
}

var answers = {};
var t = Date.parse(STARTED);
function stamp() { t += 45000; return t; }

ALL.filter(function (q) { return q.kind === 'build'; }).forEach(function (q) {
  var toks = tokensOf(q).slice();
  if (WRONG[q.id] && toks.length > 2) {            // 마지막 두 토막의 자리를 바꾼다
    var a = toks[toks.length - 1];
    toks[toks.length - 1] = toks[toks.length - 2];
    toks[toks.length - 2] = a;
  }
  answers[q.id] = { t: stamp(), v: toks, kind: 'build' };
});

/* ── Writing 2 · Email ────────────────────────────────────────────────────
   중급(B1~B2) 답안. 과제 세 가지를 모두 건드리되 문법 실수가 남아 있다. */
var EMAIL =
  "Hi Christina,\n\n" +
  "I hope you are doing well. I was thinking about our fundraising event for the children's " +
  "hospital, and I have one idea I want to share with you. What if we invite local shops and " +
  "cafes to open small booths at the event? They can sell drinks and snacks, and give a part " +
  "of the money to the hospital. I think this is effective because people already know these " +
  "shops, so they will come more easily, and the shops also get advertising, so everybody wins.\n\n" +
  "For your part, maybe you can contact the shops near the school, because you know many owners " +
  "from your part-time job. You are also better than me at making the poster and the online post, " +
  "so we can share the work.\n\n" +
  "Can we meet next Tuesday at 4 p.m.? Our classes finish early on that day, so we have enough " +
  "time to talk without hurry, and it is still two weeks before the event.\n\n" +
  "Please tell me what you think.\n\nBest,\nSunny";

answers['set9-W2-email'] = {
  t: stamp(), v: EMAIL, kind: 'email',
  words: EMAIL.split(/\s+/).filter(Boolean).length, minWords: 80
};

/* ── Writing 3 · Academic discussion ──────────────────────────────────────
   두 학생의 글에 실제로 응답하고 자기 입장을 든다. 위 이메일보다 한 단계 낫다. */
var DISC =
  "I partly agree with Claire, but I think Mark's point is closer to how business really works. " +
  "Transparency is necessary when a company's decisions affect people outside the company. For " +
  "example, if a factory changes the chemicals it uses, the people who live near it have a right " +
  "to know, and hiding that information destroys trust much faster than sharing bad news does.\n\n" +
  "However, I do not believe that \"everyone\" should see everything. A company that publishes its " +
  "product plans or its salary negotiations is not being ethical; it is only giving its competitors " +
  "a free advantage, and in the end the employees are the ones who lose their jobs. So my position " +
  "is that transparency should be a duty about impact, not about every internal detail. Companies " +
  "should open the information that affects the public, and protect the information that only " +
  "affects their competition.";

answers['set9-W3-disc'] = {
  t: stamp(), v: DISC, kind: 'discussion',
  words: DISC.split(/\s+/).filter(Boolean).length, minWords: 100
};

/* ── Speaking · 답안 칸은 "녹음했다" 표시다(실제 글은 전사문에 있다) ──────── */
ALL.filter(function (q) { return q.kind === 'repeat' || q.kind === 'interview'; })
   .forEach(function (q) {
     answers[q.id] = { t: stamp(), v: 'idb:' + q.id, media: 'idb:' + q.id, recorded: true };
   });

/* ── 전사문 — 녹음 대신 심는다. 충실도를 일부러 다르게 둔다 ───────────────── */
var TRANSCRIPT = {
  // Listen and Repeat — 그대로 따라 한 것, 한두 낱말 빠진 것, 크게 무너진 것이 섞여야
  // 루브릭의 fidelity 축이 실제로 갈린다.
  'set9-S1-q01': 'Is this your first time in our cafeteria?',
  'set9-S1-q02': "You can find today's menu on the board.",
  'set9-S1-q03': 'The hot food station is on the left side.',
  'set9-S1-q04': 'We offer a variety of meals, snacks and drinks every day.',
  'set9-S1-q05': 'You can pay with cash or your student card.',
  'set9-S1-q06': 'Please remember to return your tray when you finished.',
  'set9-S1-q07': 'If you have any food allergy, please let the staff know, uh, before you order the food.',

  // Interview — 말한 그대로. 군말(uh, you know)과 자기 수정이 남아 있어야 전사문답다.
  'set9-S2-q01':
    "Um, I usually go to the gym, maybe three times a week, mostly after my class in the evening. " +
    "I do some weight training and then twenty minutes on the running machine. I choose the gym " +
    "because, uh, the weather here is very hot, so running outside is difficult for me, and also " +
    "at the gym I feel I have a routine, you know, I go at the same time so I don't skip it.",
  'set9-S2-q02':
    "I think I would invite them to exercise together, because, um, information is not really the " +
    "problem. Everybody already knows exercise is good for health, but knowing is not doing. If we " +
    "go together, there is a kind of promise between us, so it's harder to cancel. And also the " +
    "first time in a gym is a little embarrassing, so having a friend, uh, makes it more comfortable.",
  'set9-S2-q03':
    "The biggest one is time, I think. Many people work late and when they come home they are " +
    "already tired. Money also, because gym is expensive in my city. And, um, some people start " +
    "too strong, like every day two hours, and after one week their body hurts so they stop " +
    "completely. So the wrong plan is also a reason.",
  'set9-S2-q04':
    "Uh, I think small goals. If the goal is very big, like lose twenty kilograms, you cannot see " +
    "the progress, so you give up. But if the goal is small, you can feel success every week. " +
    "Also recording, like a app or a notebook, because when you see, uh, you see the record you " +
    "don't want to break the line. And exercising with friend, that also helps for long time."
};

/* ── 점수 계산 — 화면과 같은 코드로 ──────────────────────────────────────── */
var S = global.window.SG_RESULTS.score(PACK, answers);

/* ── SQL ─────────────────────────────────────────────────────────────────── */
function lit(obj) { return '$seed$' + JSON.stringify(obj) + '$seed$'; }

var taskRows = ALL.filter(function (q) { return TRANSCRIPT[q.id]; }).map(function (q) {
  return "('" + OWNER + "','" + SESSION + "','" + q.id + "','speaking','" + q.kind + "'," +
         "$seed$" + TRANSCRIPT[q.id] + "$seed$,'sample','" + SUBMITTED + "')";
});

var sql = [
  'begin;',
  '',
  '-- 1) 응시 한 건 (Writing·Speaking 만 채워진 샘플)',
  "insert into sg_results (owner, session, set_code, mode, started_at, submitted_at," +
  ' score, total, percent, by_section, answers)',
  "values ('" + OWNER + "', '" + SESSION + "', 'SET9', 'exam', '" + STARTED + "', '" + SUBMITTED + "', " +
    S.score + ', ' + S.total + ', ' + S.percent + ', ' + lit(S.bySection) + ', ' + lit(answers) + ')',
  'on conflict (owner, session) do update set',
  '  answers = excluded.answers, score = excluded.score, total = excluded.total,',
  '  percent = excluded.percent, by_section = excluded.by_section,',
  '  submitted_at = excluded.submitted_at;',
  '',
  '-- 2) 스피킹 전사문 — 녹음 대신. /api/score 가 이 글을 그대로 채점한다.',
  'insert into sg_task_scores (owner, session, question_id, skill, task_kind,',
  '  transcript, transcript_model, transcript_at)',
  'values',
  taskRows.join(',\n'),
  'on conflict (owner, session, question_id) do update set',
  '  transcript = excluded.transcript, transcript_model = excluded.transcript_model,',
  '  transcript_at = excluded.transcript_at',
  '  where sg_task_scores.confirmed_at is null;',
  '',
  'commit;'
].join('\n');

console.log(sql);
console.error('score ' + S.score + '/' + S.total + ' (' + S.percent + '%)  by_section=' +
              JSON.stringify(S.bySection) + '  answers=' + Object.keys(answers).length +
              '  transcripts=' + taskRows.length);
