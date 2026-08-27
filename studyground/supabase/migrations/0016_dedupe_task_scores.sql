-- sg_task_scores 중복 정리 + 재발 방지
-- 교사 확정 > 교사 점수 > 최근 AI 채점 순으로 문항당 한 행만 남긴다.

begin;

with ranked as (
  select ctid,
         row_number() over (
           partition by owner, session, question_id
           order by
             (confirmed_at is not null) desc,
             (teacher_score is not null) desc,
             (ai_score is not null) desc,
             ai_at desc nulls last,
             ctid desc
         ) as rn
  from public.sg_task_scores
)
delete from public.sg_task_scores t
using ranked r
where t.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists sg_task_scores_owner_session_question_uidx
  on public.sg_task_scores (owner, session, question_id);

commit;
