-- =============================================================
-- SMEAG MockTest — 담당 선생님(teacher scope)
-- =============================================================
--
-- 선생님 계정을 "전체 열람"에서 "내 학생만 열람"으로 좁힌다.
--
--   sg_profiles.teacher_id  학생 한 명에게 선생님 한 명. 가입 화면의 드롭다운이 채운다.
--   sg_can_see(owner)       그 학생의 자료를 볼 수 있는가 — 본인 · 관리자 · 담당 선생님.
--
-- 관리자는 그대로 전부 본다. 선생님은 teacher_id 가 자기를 가리키는 학생만 본다.
-- 화면(admin-results.html 등)에서 거르는 게 아니라 RLS 가 행 자체를 안 돌려준다 —
-- 학생 명단이 URL 을 바꿔치기해서 새는 길을 막는다.
--
-- 적용: Supabase SQL Editor 에 통째로 붙여넣고 Run. 멱등이라 여러 번 실행해도 안전하다.
-- 관련 문서: studyground/docs/review-and-roles.md
-- =============================================================

-- -------------------------------------------------------------
-- 1. 담당 선생님 열
-- -------------------------------------------------------------
alter table public.sg_profiles
  add column if not exists teacher_id uuid references public.sg_profiles (id) on delete set null;

create index if not exists sg_profiles_teacher_idx on public.sg_profiles (teacher_id);

-- 시험일 명부에도 같은 값을 남긴다. 계정이 지워져도 "그날 누구 반이었나"가 남는다.
alter table public.sg_exam_accounts
  add column if not exists teacher_id uuid;


-- -------------------------------------------------------------
-- 2. 판정 함수
--    SECURITY DEFINER 라 sg_profiles 의 RLS 를 타지 않는다 — 정책 안에서
--    자기 자신을 다시 읽어 무한 재귀에 빠지는 것을 막는다.
-- -------------------------------------------------------------
create or replace function public.sg_is_teacher()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select role = 'teacher' from public.sg_profiles where id = auth.uid()), false);
$$;

/* 이 학생(owner)의 자료를 볼 수 있는가.
   본인이거나, 관리자이거나, 그 학생의 담당 선생님일 때만 참. */
create or replace function public.sg_can_see(p_owner uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    p_owner = auth.uid()
    or public.sg_is_admin()
    or (
      public.sg_is_teacher()
      and exists (
        select 1 from public.sg_profiles s
        where s.id = p_owner and s.teacher_id = auth.uid()
      )
    );
$$;

grant execute on function public.sg_is_teacher()      to authenticated, anon;
grant execute on function public.sg_can_see(uuid)     to authenticated, anon;


-- -------------------------------------------------------------
-- 3. 프로필 — 읽기 범위를 좁히고, 관리자에게 수정 권한을 준다
-- -------------------------------------------------------------
-- 이전: id = auth.uid() OR sg_is_staff()  (선생님이 전교생 프로필을 읽었다)
drop policy if exists sg_profiles_read on public.sg_profiles;
create policy sg_profiles_read on public.sg_profiles for select
  using (id = auth.uid() or public.sg_is_admin() or teacher_id = auth.uid());

-- 담당 배정·해제와 선생님 승격은 관리자만 한다.
drop policy if exists sg_profiles_admin_write on public.sg_profiles;
create policy sg_profiles_admin_write on public.sg_profiles for update
  using (public.sg_is_admin()) with check (public.sg_is_admin());

/* 본인 수정에서 지켜야 할 열이 하나 늘었다 — teacher_id.
   담당 선생님을 학생이 스스로 바꿀 수 있으면 열람 범위를 스스로 고르는 셈이 된다. */
create or replace function public.sg_profiles_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is not null and not public.sg_is_admin() then
    new.is_admin   := old.is_admin;
    new.verified   := old.verified;
    new.plan       := old.plan;
    new.student_id := old.student_id;
    new.email      := old.email;
    new.role       := old.role;
    new.teacher_id := old.teacher_id;
  end if;
  return new;
end;
$$;

/* 가입 때 고른 담당 선생님은 auth 메타데이터로 들어와 프로필 첫 줄에 그대로 박힌다.
   Edge Function 이 값을 검증한 뒤에만 넣으므로 여기서는 형태만 본다. */
create or replace function public.sg_handle_new_user()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.sg_profiles (id, email, name, student_id, plan, teacher_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'student_id', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'plan', ''), 'lite'),
    nullif(new.raw_user_meta_data ->> 'teacher_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- -------------------------------------------------------------
-- 4. 응시 결과 · 채점 · 코멘트 — sg_is_staff() → sg_can_see(owner)
--    쓰기는 "직원이면서(sg_is_staff) 그 학생을 맡은 사람" 두 조건을 다 만족해야 한다.
-- -------------------------------------------------------------
drop policy if exists sg_results_own_read on public.sg_results;
create policy sg_results_own_read on public.sg_results for select
  using (public.sg_can_see(owner));

drop policy if exists sg_task_scores_select on public.sg_task_scores;
create policy sg_task_scores_select on public.sg_task_scores for select
  using (public.sg_can_see(owner));

drop policy if exists sg_task_scores_insert on public.sg_task_scores;
create policy sg_task_scores_insert on public.sg_task_scores for insert
  with check (public.sg_is_staff() and public.sg_can_see(owner));

drop policy if exists sg_task_scores_update on public.sg_task_scores;
create policy sg_task_scores_update on public.sg_task_scores for update
  using (public.sg_is_staff() and public.sg_can_see(owner))
  with check (public.sg_is_staff() and public.sg_can_see(owner));

drop policy if exists sg_comments_read on public.sg_comments;
create policy sg_comments_read on public.sg_comments for select
  using (public.sg_can_see(owner));

drop policy if exists sg_comments_staff_write on public.sg_comments;
create policy sg_comments_staff_write on public.sg_comments for insert
  with check (public.sg_is_staff() and public.sg_can_see(owner));

drop policy if exists sg_comments_staff_update on public.sg_comments;
create policy sg_comments_staff_update on public.sg_comments for update
  using (public.sg_is_staff() and public.sg_can_see(owner))
  with check (public.sg_is_staff() and public.sg_can_see(owner));

drop policy if exists sg_comments_staff_delete on public.sg_comments;
create policy sg_comments_staff_delete on public.sg_comments for delete
  using (public.sg_is_staff() and public.sg_can_see(owner));

-- QR 카드·명부도 담당 학생까지만.
drop policy if exists sg_exam_accounts_read on public.sg_exam_accounts;
create policy sg_exam_accounts_read on public.sg_exam_accounts for select
  using (public.sg_can_see(user_id));
