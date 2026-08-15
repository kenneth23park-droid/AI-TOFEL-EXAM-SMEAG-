-- 0015_recordings_staff_read.sql
--
-- 스피킹 녹음을 "어느 컴퓨터에서든" 들을 수 있게 하는 두 가지를 넣는다.
--
--   [1] 선생님 읽기 정책 — 지금 버킷 정책은 첫 칸(폴더 이름)을 auth.uid() 와
--       대조한다. 학생 본인은 어느 기기에서 로그인하든 들리지만, 남의 응시를
--       여는 선생님에게는 서명 URL 이 나오지 않아 재생기가 조용히 안 붙는다
--       (sg2/review.html 의 wireCloudPlayback 주석이 그 상태를 적어 두었다).
--       staff 면 누구의 녹음이든 읽을 수 있게 SELECT 정책을 하나 더한다.
--
--   [2] media_path 메우기 — 재생기는 sg_task_scores.media_path 만 보고 연다.
--       이 값은 채점이 돌 때 api/score.js 가 버킷을 뒤져 채우므로, 채점 전이거나
--       파일이 다른 계정 폴더에 있으면 비어 있다. 파일이 버킷에 멀쩡히 있는데도
--       "이 기기에는 녹음이 없습니다" 가 뜨는 자리가 그것이다.
--
-- 보존 기간은 90일 그대로다. 이 파일은 보존 정책을 바꾸지 않는다.
--
-- 되돌리기: [1] 은 맨 아래 주석의 drop policy 두 줄. [2] 는 되돌리지 않는다
--          (없던 값을 채우기만 하고 기존 값은 건드리지 않는다).

begin;

-- ─────────────────────────────────────────────────────────────
-- [1] 선생님은 모든 학생의 녹음을 읽는다
--
-- permissive 정책이라 기존 "자기 폴더" 정책과 OR 로 합쳐진다. 기존 정책을
-- 지우지 않으므로 학생 본인 접근은 그대로 유지된다.
--
-- 담당 학생으로 좁히려면 using 절에 sg_can_see() 를 and 로 붙이면 된다.
-- 지금은 채점자가 바뀌어도 막히지 않도록 staff 전체로 연다.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "recordings staff read" on storage.objects;

create policy "recordings staff read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'toefl-recordings'
    and public.sg_is_staff()
  );

comment on policy "recordings staff read" on storage.objects is
  'staff 는 toefl-recordings 의 모든 녹음을 읽는다(서명 URL 발급 포함). '
  '학생 본인 접근은 기존 폴더 대조 정책이 그대로 담당한다.';


-- ─────────────────────────────────────────────────────────────
-- [2] 파일은 있는데 경로가 비어 있는 과제에 media_path 를 채운다
--
-- 매칭 열쇠는 session + question_id 다. owner 는 일부러 보지 않는다 —
-- 같은 응시가 다른 계정 폴더에 올라간 건들(고아 200개)이 바로 이 경우이고,
-- 그것까지 살려야 재생이 된다.
--
-- 후보가 여럿이면 가장 최근 업로드를 고른다. 같은 녹음이 두 벌 있는
-- 상황이므로 어느 쪽을 골라도 내용은 같지만, 재업로드가 원본을 고친
-- 경우까지 감안하면 최신이 안전하다.
-- ─────────────────────────────────────────────────────────────

with candidate as (
  select
    split_part(o.name, '/', 2) as session,
    regexp_replace(split_part(o.name, '/', 3), '\.[a-z0-9]+$', '') as question_id,
    o.name as path,
    row_number() over (
      partition by split_part(o.name, '/', 2),
                   regexp_replace(split_part(o.name, '/', 3), '\.[a-z0-9]+$', '')
      order by o.created_at desc
    ) as rn
  from storage.objects o
  where o.bucket_id = 'toefl-recordings'
    and split_part(o.name, '/', 3) <> ''      -- {owner}/{session}/{file} 형태만
)
update sg_task_scores t
   set media_path = c.path
  from candidate c
 where c.rn = 1
   and t.session     = c.session
   and t.question_id = c.question_id
   and coalesce(t.media_path, '') = '';

commit;


-- ── 확인 ─────────────────────────────────────────────────────
--
-- 메운 뒤 재생 가능 상태가 얼마나 늘었는지:
--
--   select count(*) as 스피킹과제,
--          count(nullif(media_path, '')) as 경로있음,
--          count(*) - count(nullif(media_path, '')) as 재생불가
--   from sg_task_scores
--   where question_id like '%-S%';
--
-- 아직 비어 있는 것들 — 파일 자체가 버킷에 없다는 뜻이므로
-- recover-recordings.html 로 그 기기에서 회수해야 한다:
--
--   select owner, session, question_id
--   from sg_task_scores
--   where question_id like '%-S%' and coalesce(media_path, '') = ''
--   order by session;
--
-- 되돌리기:
--   drop policy if exists "recordings staff read" on storage.objects;
