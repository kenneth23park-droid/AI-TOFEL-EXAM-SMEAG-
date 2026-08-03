-- =============================================================
-- SMEAG TOEFL 모의고사 — Supabase 스키마
-- =============================================================
--
-- [적용 방법]
--  1) Supabase 프로젝트를 만든다 (https://supabase.com → New project).
--  2) 대시보드 좌측 [SQL Editor] → [New query] 에 이 파일 전체를 붙여넣고 Run.
--     - 이 스크립트는 **멱등(idempotent)** 하다. 몇 번을 다시 실행해도 안전하다.
--     - CLI 를 쓴다면:  supabase db push   또는
--       psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--  3) 대시보드 [Authentication] → [Providers] → **Anonymous sign-ins 를 Enable**.
--     (앱은 익명 로그인으로 auth.uid() 를 확보한다. 켜지 않으면 동기화가 실패한다.)
--  4) 대시보드 [Project Settings] → [API] 에서 Project URL 과 anon public key 를 복사해
--     app/js/config.js 의 supabaseUrl / supabaseAnonKey 에 넣는다.
--     storageBucket 은 아래에서 만드는 'toefl-recordings' 그대로 둔다.
--  5) Storage 정책(맨 아래 블록)은 storage.objects 소유권 문제로 SQL Editor 에서만
--     정상 실행된다. 권한 오류가 나면 대시보드 [Storage] → 버킷 → Policies 에서
--     동일한 조건(경로 첫 폴더 = auth.uid())으로 수동 생성하면 된다.
--
-- [데이터 모델 요약]
--   toefl_attempts     : 한 번의 응시(회차). 학생 1명 = auth.uid() 1개.
--   toefl_answers      : 자동채점 대상 문항의 응답(리딩/리스닝/Build a Sentence).
--   toefl_submissions  : 사람이 채점할 산출물(이메일/토론 본문, 스피킹 녹음 경로).
--   storage 'toefl-recordings' : 스피킹 녹음 webm. 경로 = <uid>/<attemptId>/<questionId>.webm
--
-- 모든 테이블에 RLS 를 켜고 "본인 행만" 접근하도록 막는다.
-- =============================================================

-- gen_random_uuid() 용 (Supabase 는 기본 활성화지만 안전하게 한 번 더)
create extension if not exists pgcrypto;


-- -------------------------------------------------------------
-- 1. toefl_attempts — 응시 회차
-- -------------------------------------------------------------
create table if not exists public.toefl_attempts (
  id                  uuid primary key,
  user_id             uuid not null default auth.uid(),
  set_code            text,
  started_at          timestamptz,
  submitted_at        timestamptz,
  status              text check (status in ('submitted', 'synced')),

  reading_correct     int,
  reading_total       int,
  listening_correct   int,
  listening_total     int,
  writing_correct     int,
  writing_total       int,
  speaking_submitted  int,
  speaking_total      int,

  auto_correct        int,
  auto_total          int,
  auto_pct            numeric,

  client_created_at   timestamptz,
  created_at          timestamptz default now()
);


-- -------------------------------------------------------------
-- 2. toefl_answers — 문항별 응답 (자동채점 결과 포함)
-- -------------------------------------------------------------
create table if not exists public.toefl_answers (
  id           bigserial primary key,
  attempt_id   uuid references public.toefl_attempts (id) on delete cascade,
  question_id  text,
  section      text,
  module       text,
  q_no         int,
  kind         text,
  response     jsonb,
  is_correct   boolean,
  unique (attempt_id, question_id)
);


-- -------------------------------------------------------------
-- 3. toefl_submissions — 사람이 채점할 산출물
--    kind='email' | 'discussion' → text_body 사용
--    kind='speaking'             → storage_path / duration_ms 사용
-- -------------------------------------------------------------
create table if not exists public.toefl_submissions (
  id            bigserial primary key,
  attempt_id    uuid references public.toefl_attempts (id) on delete cascade,
  question_id   text,
  kind          text check (kind in ('email', 'discussion', 'speaking')),
  text_body     text,
  storage_path  text,
  duration_ms   int,
  unique (attempt_id, question_id)
);


-- -------------------------------------------------------------
-- 4. 조회 성능용 인덱스
-- -------------------------------------------------------------
create index if not exists toefl_attempts_user_idx
  on public.toefl_attempts (user_id, submitted_at desc);
create index if not exists toefl_attempts_set_idx
  on public.toefl_attempts (set_code);
create index if not exists toefl_attempts_status_idx
  on public.toefl_attempts (status);

create index if not exists toefl_answers_attempt_idx
  on public.toefl_answers (attempt_id);
create index if not exists toefl_answers_question_idx
  on public.toefl_answers (question_id);
create index if not exists toefl_answers_wrong_idx
  on public.toefl_answers (attempt_id) where is_correct = false;   -- 오답노트용

create index if not exists toefl_submissions_attempt_idx
  on public.toefl_submissions (attempt_id);
create index if not exists toefl_submissions_kind_idx
  on public.toefl_submissions (kind);


-- -------------------------------------------------------------
-- 5. RLS — 본인 행만
-- -------------------------------------------------------------
alter table public.toefl_attempts    enable row level security;
alter table public.toefl_answers     enable row level security;
alter table public.toefl_submissions enable row level security;

-- 5-1. toefl_attempts : auth.uid() = user_id
drop policy if exists "toefl_attempts_select_own" on public.toefl_attempts;
create policy "toefl_attempts_select_own"
  on public.toefl_attempts for select
  using (auth.uid() = user_id);

drop policy if exists "toefl_attempts_insert_own" on public.toefl_attempts;
create policy "toefl_attempts_insert_own"
  on public.toefl_attempts for insert
  with check (auth.uid() = user_id);

drop policy if exists "toefl_attempts_update_own" on public.toefl_attempts;
create policy "toefl_attempts_update_own"
  on public.toefl_attempts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5-2. toefl_answers : 부모 attempt 가 내 것일 때만
drop policy if exists "toefl_answers_select_own" on public.toefl_answers;
create policy "toefl_answers_select_own"
  on public.toefl_answers for select
  using (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

drop policy if exists "toefl_answers_insert_own" on public.toefl_answers;
create policy "toefl_answers_insert_own"
  on public.toefl_answers for insert
  with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

drop policy if exists "toefl_answers_update_own" on public.toefl_answers;
create policy "toefl_answers_update_own"
  on public.toefl_answers for update
  using (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

-- 5-3. toefl_submissions : 부모 attempt 가 내 것일 때만
drop policy if exists "toefl_submissions_select_own" on public.toefl_submissions;
create policy "toefl_submissions_select_own"
  on public.toefl_submissions for select
  using (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

drop policy if exists "toefl_submissions_insert_own" on public.toefl_submissions;
create policy "toefl_submissions_insert_own"
  on public.toefl_submissions for insert
  with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

drop policy if exists "toefl_submissions_update_own" on public.toefl_submissions;
create policy "toefl_submissions_update_own"
  on public.toefl_submissions for update
  using (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.toefl_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));


-- -------------------------------------------------------------
-- 6. Storage — 스피킹 녹음 버킷 (private)
--    경로 규칙: <auth.uid()>/<attemptId>/<questionId>.webm
--    → 경로의 첫 폴더가 자기 uid 인 객체만 올리고 읽을 수 있다.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('toefl-recordings', 'toefl-recordings', false)
on conflict (id) do nothing;

drop policy if exists "toefl_recordings_select_own" on storage.objects;
create policy "toefl_recordings_select_own"
  on storage.objects for select
  using (
    bucket_id = 'toefl-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "toefl_recordings_insert_own" on storage.objects;
create policy "toefl_recordings_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'toefl-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 재업로드(upsert) 를 허용하려면 update 도 필요하다.
drop policy if exists "toefl_recordings_update_own" on storage.objects;
create policy "toefl_recordings_update_own"
  on storage.objects for update
  using (
    bucket_id = 'toefl-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'toefl-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
