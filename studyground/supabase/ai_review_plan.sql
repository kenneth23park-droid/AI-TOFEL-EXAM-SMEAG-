-- SMEAG StudyGround — AI 리뷰에 '학습 계획' 자리를 낸다. (2026-08-12)
--
-- 제출이 끝나고 인터넷이 있으면 /api/feedback 이 그 자리에서 리뷰를 쓴다. 리뷰는
-- 영역 총평·문항별 코멘트까지는 예전 그대로 sg_comments 에 들어가는데, "그래서
-- 무엇을 어떻게 공부하나" 는 문장 한 덩어리가 아니라 구조(주차·과제·분량)라서
-- body 한 칸에 넣으면 화면이 다시 파싱해야 한다. scope 하나와 jsonb 한 칸을 낸다.
--
--   scope='plan', question_id=''  →  body 는 한 문단 요약, data 는 계획 전문
--
-- 쓰기 권한은 그대로 둔다. 학생은 sg_comments 에 못 쓴다(RLS) — 이 표에 리뷰를
-- 넣는 것은 언제나 서버(service_role)다. 학생 토큰으로 자기 코멘트를 쓸 수 있으면
-- '선생님이 남긴 말' 과 '학생이 적어 넣은 말' 이 같은 표에서 구별되지 않는다.

alter table public.sg_comments drop constraint if exists sg_comments_scope_check;
alter table public.sg_comments add constraint sg_comments_scope_check
  check (scope = any (array['question', 'reading', 'listening', 'writing',
                            'speaking', 'overall', 'plan']));

-- 계획 전문. 'plan' 이 아닌 행에서는 늘 비어 있다.
alter table public.sg_comments add column if not exists data jsonb not null default '{}'::jsonb;
