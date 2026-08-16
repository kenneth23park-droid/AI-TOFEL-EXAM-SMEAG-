-- SMEAG StudyGround — 세션 분리로 0점이 된 응시의 복구 (SET 9)
--
-- 무엇이 있었나
--   시험 앱은 제출 시점에 **그 브라우저의 로컬 답안만** 보고 채점해 sg_results 에
--   올린다. 학생이 도중에 기기·브라우저를 바꾸면 새 세션에는 이전 답안이 없고,
--   그 빈 세션이 제출되면 성적은 0 이 된다. 답안 자체는 toefl_answers 에 살아 있다.
--
--   확인된 피해자는 두 명이다(2026-08-15 감사).
--     smeag025 LI YUHAI  2026-08-14  마이크 체크에서 멈춘 뒤 스피킹만 새 세션에서 응시
--     smeag022 KIM SOMIN 2026-08-13  응시 기록 5건이 전부 조각, 본 시험이 통째로 누락
--
--   2026-08-12 이전은 라이브 백업(toefl_answers)이 없어 서버로는 복구할 수 없다.
--   제출된 응시는 전건 대조 결과 서버 답안과 성적이 일치한다 — 숨은 손상은 없다.
--
-- 원칙
--   지우지 않는다. 복구는 **새 행을 세우는 것**이고, 못 쓰게 된 옛 행은 hidden 으로
--   가릴 뿐이다(attempt-data-never-destroyed).
--
-- 실행
--   service_role 로 실행할 것. 전체가 한 트랜잭션이다 — 중간에 어긋나면 통째로 물러난다.
--   실행 뒤 §4 검증 쿼리가 기대한 두 행을 보여 주어야 한다.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  복구 성적 행을 세운다
--
--   점수는 toefl_answers 의 답안을 SET 9 정답지로 다시 채점해 만든다. 대소문자와
--   앞뒤 공백을 무시하는 것은 앱의 채점 규칙과 같다.
--   answers 에는 답안을 그대로 실어 둔다 — /api/score 는 라이팅 채점 대상 글을
--   언제나 sg_results.answers 에서 직접 읽으므로, 이게 있어야 §3 이 성립한다.
-- ─────────────────────────────────────────────────────────────────────────────

with src(attempt_id, owner, session, started, ended, att_no) as (values
  ('2ee7f244-0c16-4256-8b9d-6bc320f99194'::uuid,
   '97d41f19-6e5f-4c9a-bd0d-27d36709e830'::uuid,
   'offline-57676b2d-9c84-3428-0a5b-596b30f9a92e',
   '2026-08-14 10:49:02.185+00'::timestamptz,
   '2026-08-14 12:23:01.766+00'::timestamptz, 4),   -- smeag025 LI YUHAI
  ('e49be6f7-44bb-43ad-a548-6b0e02601ddd'::uuid,
   '1a0e582f-5ef6-401b-9174-7c8717643648'::uuid,
   'offline-167f9286-1f25-f85f-fb97-a19ddc87f1e4',
   '2026-08-13 11:05:48.784+00'::timestamptz,
   '2026-08-13 11:47:15.340+00'::timestamptz, 6)    -- smeag022 KIM SOMIN
),
k as (
  select question_id, section,
         case when jsonb_typeof(answer) = 'string' then answer #>> '{}' else answer::text end ans
  from toefl_answer_keys where set_code = 'SET9'
),
a as (select attempt_id, question_id, response, response ->> 'v' v from toefl_answers),
mc as (   -- Reading·Listening 객관식/빈칸 자동채점
  select s.session, k.section,
         count(*) filter (where lower(btrim(coalesce(a.v, ''))) = lower(btrim(k.ans))) correct
  from src s
  cross join k
  left join a on a.attempt_id = s.attempt_id and a.question_id = k.question_id
  where k.section in ('reading', 'listening')
  group by 1, 2
),
w1 as (   -- Writing W1(Build a sentence) 자동채점. 답이 배열이라 통째로 견준다.
  select s.session,
         count(*) filter (where lower(a.response ->> 'v') = lower(k2.answer::text)) correct
  from src s
  cross join (select question_id, answer from toefl_answer_keys
              where set_code = 'SET9' and module = 'W1') k2
  left join a on a.attempt_id = s.attempt_id and a.question_id = k2.question_id
  group by 1
),
ansmap as (
  select s.session, jsonb_object_agg(a.question_id, a.response) m
  from src s join a on a.attempt_id = s.attempt_id
  group by 1
)
insert into sg_results (owner, session, set_code, mode, scale, attempt_no,
                        started_at, submitted_at, score, total, percent,
                        by_section, answers, hidden, hidden_reason)
select s.owner, s.session, 'SET9', 'exam', 'toefl6', s.att_no, s.started, s.ended,
       r.correct + l.correct + w1.correct,
       107,
       round(((r.correct + l.correct + w1.correct)::numeric / 107) * 100, 1),
       jsonb_build_object(
         'reading',   jsonb_build_object('score', r.correct,  'total', 50),
         'listening', jsonb_build_object('score', l.correct,  'total', 47),
         'writing',   jsonb_build_object('score', w1.correct, 'total', 10),
         'speaking',  jsonb_build_object('score', 0,          'total', 0)),
       ansmap.m, false, ''
from src s
join mc r   on r.session = s.session and r.section = 'reading'
join mc l   on l.session = s.session and l.section = 'listening'
join w1     on w1.session = s.session
join ansmap on ansmap.session = s.session
on conflict (owner, session) do nothing;

-- 기대: smeag025 → 24 + 33 + 7 = 64 / 107 (59.8%)
--       smeag022 → 37 + 38 + 0 = 75 / 107 (70.1%)


-- ─────────────────────────────────────────────────────────────────────────────
-- §2  smeag025 의 스피킹 채점을 복구 세션으로 옮겨 붙인다
--
--   스피킹은 두 번째(빈) 세션에서 실제로 응시했고 AI 채점도 정상으로 끝나 있다.
--   그 세션을 §3 에서 가릴 것이므로, 채점 결과를 복구 세션에도 복사해 둔다.
--   원본 행은 지우지 않는다. media_path 는 옛 세션 폴더를 그대로 가리키는데,
--   스토리지 경로는 성적 행과 무관하므로 그대로 두는 것이 맞다.
-- ─────────────────────────────────────────────────────────────────────────────

insert into sg_task_scores (owner, session, question_id, skill, task_kind,
                            ai_score, ai_rubric, ai_provider, ai_model, ai_at,
                            ai_usage, transcript, transcript_model, transcript_at, media_path)
select owner, 'offline-57676b2d-9c84-3428-0a5b-596b30f9a92e', question_id, skill, task_kind,
       ai_score, ai_rubric, ai_provider, ai_model, ai_at,
       ai_usage, transcript, transcript_model, transcript_at, media_path
from sg_task_scores
where owner = '97d41f19-6e5f-4c9a-bd0d-27d36709e830'
  and session = 'offline-c3795e3c-be9c-b0e4-c01d-6c1addbfb79b'
  and skill = 'speaking'
on conflict (owner, session, question_id) do nothing;

-- 기대: 11행 (S1 복창 7 + S2 인터뷰 4, 합계 42 / 55)


-- ─────────────────────────────────────────────────────────────────────────────
-- §3  못 쓰게 된 옛 행을 가린다 — 지우지 않는다
--
--   모든 섹션이 0 이라 정보가 전혀 없고, 같은 날 복구 행이 대신 서는 것만 고른다.
--   smeag022 의 2026-08-12 0점 행(offline-63e919c1)은 **건드리지 않는다** — 다른
--   날의 응시라 이 복구가 대신해 주지 못한다. 선생님 판단이 필요하다.
-- ─────────────────────────────────────────────────────────────────────────────

update sg_results
set hidden = true,
    hidden_reason = '세션 분리로 R·L·W 가 0 으로 기록됨. 같은 날 복구 행으로 대체 (2026-08-15 감사)'
where session in (
  'offline-c3795e3c-be9c-b0e4-c01d-6c1addbfb79b',   -- smeag025 2026-08-14
  'offline-0080f26b-b57d-ce76-d909-1184b4bae879'    -- smeag022 2026-08-13
)
and hidden = false;


-- ─────────────────────────────────────────────────────────────────────────────
-- §4  검증 — 커밋 전에 눈으로 본다
-- ─────────────────────────────────────────────────────────────────────────────

select e.student_id, e.name, r.submitted_at::date d, r.attempt_no,
       r.score, r.total, r.percent, r.hidden,
       r.by_section -> 'reading'   ->> 'score' rd,
       r.by_section -> 'listening' ->> 'score' ls,
       r.by_section -> 'writing'   ->> 'score' wr
from sg_results r
left join sg_exam_accounts e on e.user_id = r.owner
where r.owner in ('97d41f19-6e5f-4c9a-bd0d-27d36709e830',
                  '1a0e582f-5ef6-401b-9174-7c8717643648')
order by e.student_id, r.submitted_at;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- §5  이 스크립트가 하지 않는 것 — 다음 손
--
--   (a) smeag025 의 Writing 은 아직 W1 자동채점(7/10)뿐이다. W2 이메일과 W3 토론은
--       글이 answers 에 실려 있으니, 관리자 화면에서 복구 세션
--       offline-57676b2d-9c84-3428-0a5b-596b30f9a92e 의 AI 채점을 한 번 돌리면
--       /api/score 가 그 글을 읽어 0~5 를 매긴다. 그래야 Writing 밴드가 선다.
--
--   (b) smeag022 는 라이팅·스피킹 답안이 서버에 없다. R·L 만으로 남는다.
--
--   (c) 근본 원인은 그대로다. 채점 기준을 서버(toefl_answers)로 옮기거나, 최소한
--       제출 직전에 같은 학생의 미제출 세션을 감지해 감독관에게 경고해야 한다.
--       고치지 않으면 다음 시험일에 또 생긴다.
-- ─────────────────────────────────────────────────────────────────────────────
