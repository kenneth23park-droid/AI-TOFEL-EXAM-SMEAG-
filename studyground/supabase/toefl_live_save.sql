-- SMEAG · StudyGround — 응시 중 실시간 저장 + 정전 복구 체크포인트
-- 적용됨: 2026-08-12 (Supabase qrmidnmlethqvdbmnyun, 마이그레이션
--   toefl_live_save_and_checkpoints · toefl_attempts_allow_in_progress)
--
-- 왜 필요한가 —
--   toefl_attempts / toefl_answers 는 "다 친 뒤에 한 번" 올라오는 표로 만들어졌다.
--   그래서 status 체크가 submitted/synced 만 받았고, 진행 중 상태를 담을 열이 없었다.
--   실시간 저장은 시험이 시작될 때 행을 먼저 만들고 그 위에 답안을 얹는다.
--
-- 멱등성 —
--   attempt      upsert on (id)                     클라이언트가 만든 uuid
--   answers      upsert on (attempt_id, question_id)
--   checkpoints  upsert on (attempt_id, step)
--   그래서 정전 뒤 큐가 다시 흘러도 값이 겹쳐 쓰일 뿐 줄이 늘지 않는다.

alter table public.toefl_attempts
  add column if not exists session text,
  add column if not exists cursor jsonb not null default '{}'::jsonb,
  add column if not exists clocks jsonb not null default '{}'::jsonb,
  add column if not exists step int not null default 0,
  add column if not exists last_seen_at timestamptz;

create unique index if not exists toefl_attempts_user_session_key
  on public.toefl_attempts (user_id, session) where session is not null;

-- 진행 중(in_progress)과 버려진 응시(abandoned)를 받는다.
alter table public.toefl_attempts drop constraint if exists toefl_attempts_status_check;
alter table public.toefl_attempts add constraint toefl_attempts_status_check
  check (status = any (array['in_progress'::text, 'submitted'::text, 'synced'::text, 'abandoned'::text]));

alter table public.toefl_answers
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists client_ts bigint;

create table if not exists public.toefl_checkpoints (
  id bigserial primary key,
  attempt_id uuid not null references public.toefl_attempts(id) on delete cascade,
  step int not null,
  screen_id text not null default '',
  screen_index int not null default 0,
  phase_index int not null default 0,
  section text not null default '',
  cursor jsonb not null default '{}'::jsonb,
  clocks jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  client_ts bigint,
  created_at timestamptz not null default now(),
  unique (attempt_id, step)
);

create index if not exists toefl_checkpoints_attempt_idx
  on public.toefl_checkpoints (attempt_id, step desc);

alter table public.toefl_checkpoints enable row level security;

-- 자기 응시의 체크포인트만 읽고 쓴다 — toefl_answers 와 같은 규칙이다.
drop policy if exists toefl_checkpoints_select_own on public.toefl_checkpoints;
create policy toefl_checkpoints_select_own on public.toefl_checkpoints
  for select using (exists (
    select 1 from public.toefl_attempts a
    where a.id = toefl_checkpoints.attempt_id and a.user_id = (select auth.uid())));

drop policy if exists toefl_checkpoints_insert_own on public.toefl_checkpoints;
create policy toefl_checkpoints_insert_own on public.toefl_checkpoints
  for insert with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = toefl_checkpoints.attempt_id and a.user_id = (select auth.uid())));

drop policy if exists toefl_checkpoints_update_own on public.toefl_checkpoints;
create policy toefl_checkpoints_update_own on public.toefl_checkpoints
  for update using (exists (
    select 1 from public.toefl_attempts a
    where a.id = toefl_checkpoints.attempt_id and a.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = toefl_checkpoints.attempt_id and a.user_id = (select auth.uid())));

-- 링버퍼: 한 응시당 최근 12개. 되감기는 3스텝까지지만 여유를 둔다.
create or replace function public.toefl_checkpoints_trim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.toefl_checkpoints c
  where c.attempt_id = new.attempt_id
    and c.step <= (
      select max(step) - 12 from public.toefl_checkpoints where attempt_id = new.attempt_id
    );
  return null;
end;
$$;

drop trigger if exists toefl_checkpoints_trim_trg on public.toefl_checkpoints;
create trigger toefl_checkpoints_trim_trg
  after insert on public.toefl_checkpoints
  for each row execute function public.toefl_checkpoints_trim();

-- 답안이 언제 바뀌었는지는 서버 시각으로 남긴다(정전 시점 추정·되감기 검증).
create or replace function public.toefl_answers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists toefl_answers_touch_trg on public.toefl_answers;
create trigger toefl_answers_touch_trg
  before insert or update on public.toefl_answers
  for each row execute function public.toefl_answers_touch();
