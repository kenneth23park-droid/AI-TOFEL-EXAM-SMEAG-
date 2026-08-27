-- 0017_recordings_staff_access.sql
--
-- 2026-08-27 라이브(smeag-mocktest)에 적용함. supabase/recordings_staff.sql 의 내용을
-- 마이그레이션으로 다시 적어 둔다 — 그 파일은 저장소에만 있었고 이 프로젝트에는
-- 한 번도 적용된 적이 없었다. 버킷에는 "첫 폴더 = 본인 uid" 정책 셋뿐이라,
-- ADMIN 으로 로그인한 회수 페이지의 업로드가 전부 403 으로 거절당했다:
--   {"statusCode":"403","error":"Unauthorized",
--    "message":"new row violates row-level security policy"}
-- 시험장에서 이것은 회수를 포기하는 것과 같다 — 학생을 한 명씩 다시 로그인시켜야 한다.
--
-- 범위는 넓히지 않는다. public.sg_can_see(owner) 가 이미 "본인 · 관리자 ·
-- 그 학생의 담당 선생님" 만 참이고, 결과·코멘트에 쓰는 것과 같은 판정이다.
-- 지우기(delete)는 주지 않는다. 학생 본인 정책(*_own)은 그대로 두었다 — permissive
-- 정책이라 OR 로 합쳐진다.
--
-- 되돌리기:
--   drop policy if exists toefl_recordings_staff_read   on storage.objects;
--   drop policy if exists toefl_recordings_staff_write  on storage.objects;
--   drop policy if exists toefl_recordings_staff_update on storage.objects;

create or replace function public.sg_path_owner(p_name text)
returns uuid
language sql immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
    else null
  end;
$$;

drop policy if exists toefl_recordings_staff_read on storage.objects;
create policy toefl_recordings_staff_read on storage.objects for select
  using (
    bucket_id = 'toefl-recordings'
    and public.sg_path_owner(name) is not null
    and public.sg_can_see(public.sg_path_owner(name))
  );

drop policy if exists toefl_recordings_staff_write on storage.objects;
create policy toefl_recordings_staff_write on storage.objects for insert
  with check (
    bucket_id = 'toefl-recordings'
    and public.sg_path_owner(name) is not null
    and public.sg_can_see(public.sg_path_owner(name))
  );

drop policy if exists toefl_recordings_staff_update on storage.objects;
create policy toefl_recordings_staff_update on storage.objects for update
  using (
    bucket_id = 'toefl-recordings'
    and public.sg_path_owner(name) is not null
    and public.sg_can_see(public.sg_path_owner(name))
  )
  with check (
    bucket_id = 'toefl-recordings'
    and public.sg_path_owner(name) is not null
    and public.sg_can_see(public.sg_path_owner(name))
  );

-- MediaRecorder 는 'audio/webm;codecs=opus' 처럼 코덱을 달아 온다. 클라이언트가
-- 코덱을 떼고 보내지만(baseMime), 캐시된 옛 사본이 그대로 보내도 다시는 시험
-- 하루치를 잃지 않도록 버킷에서도 받아 준다.
update storage.buckets
set allowed_mime_types = array['audio/webm','audio/ogg','audio/mp4','audio/mpeg',
                               'audio/wav','audio/x-m4a','audio/aac','audio/*']
where id = 'toefl-recordings';
