-- toefl-recordings — 선생님·관리자가 학생 녹음을 회수/재생할 수 있게 한다.
--
-- 왜 필요한가. 원래 정책은 "첫 칸(user_id)이 auth.uid() 와 같을 때만" 이었다.
-- 그래서 녹음이 학생 기기에 갇힌 채 남았을 때(2026-08-12 시험: 업로드가 전부
-- 400 InvalidMimeType 으로 거절), 감독 선생님이 그 PC 앞에 앉아도 학생 폴더로
-- 올릴 길이 없었다 — 학생을 한 명씩 다시 로그인시켜야 했다. 시험장에서 그건
-- 회수를 포기하는 것과 같다.
--
-- 범위는 넓히지 않는다: public.sg_can_see(owner) 가 이미 "본인 · 관리자 ·
-- 그 학생의 담당 선생님" 만 참이다. 결과·코멘트에 쓰는 것과 같은 판정을 쓴다.
-- 지우기는 주지 않는다 — 회수 도구가 원본을 지울 이유는 없다.
--
-- 경로 첫 칸이 uuid 가 아닌 파일이 섞여도 캐스트에서 터지지 않도록 모양을 먼저 본다.

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

-- 버킷이 받는 타입 — MediaRecorder 는 'audio/webm;codecs=opus' 처럼 코덱을 달아 온다.
-- 클라이언트가 코덱을 떼고 보내지만(assets/sg-results.js baseMime), 캐시된 옛 사본이
-- 남은 기기가 그대로 보내도 다시는 시험 하루치를 잃지 않도록 여기서도 받아 준다.
update storage.buckets
set allowed_mime_types = array['audio/webm','audio/ogg','audio/mp4','audio/mpeg',
                               'audio/wav','audio/x-m4a','audio/aac','audio/*']
where id = 'toefl-recordings';
