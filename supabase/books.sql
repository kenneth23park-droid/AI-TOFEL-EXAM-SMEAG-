-- =============================================================
-- SMEAG TOEFL Practice Book (B2 Level Up) — 교재 원고·산출물 스키마
-- =============================================================
--
-- [적용 방법]
--  1) 먼저 supabase/schema.sql → supabase/teacher_scope.sql 이 적용되어 있어야 한다.
--     이 파일은 거기서 만든 역할 판정 함수(public.sg_is_staff / public.sg_is_admin)를
--     **그대로 쓴다**. 교재 전용 역할을 새로 만들지 않는다 — 판정이 둘로 갈리면
--     "성적에서는 담당 선생님인데 교재에서는 아닌" 계정이 생긴다.
--  2) Supabase 대시보드 [SQL Editor] → [New query] 에 이 파일 전체를 붙여넣고 Run.
--     멱등(idempotent)하다. 몇 번을 다시 실행해도 안전하다.
--     CLI: psql "$SUPABASE_DB_URL" -f supabase/books.sql
--  3) 맨 아래 Storage 블록은 storage.objects 소유권 때문에 SQL Editor 에서만 정상
--     실행된다. 권한 오류가 나면 대시보드 [Storage] → books 버킷 → Policies 에서
--     같은 조건으로 수동 생성한다.
--
-- [데이터 모델 요약]
--   sg_books                    책 4권(reading·listening·speaking·writing)의 표지 정보.
--   sg_book_chapters            챕터 원고 1장 = 1행. **정답이 들어 있는 원본.**
--                               chapter(jsonb) · status · schema_version · gate_report.
--   sg_book_chapters_public     같은 챕터에서 정답·모범답안·대본을 **떼어 낸 사본**.
--                               트리거가 자동으로 만든다. 학생이 볼 수 있는 유일한 원고.
--   sg_book_builds              뽑아낸 PDF 1장 = 1행. edition: student|answer_key|teacher.
--   storage 'books'             실제 PDF 파일. 경로 = <slug>/<edition>/<파일명>.pdf
--
-- [왜 원고 테이블이 둘인가 — 이 파일에서 가장 중요한 결정]
--   Postgres 의 RLS 는 **행** 단위다. 열 단위 GRANT 는 역할(role) 단위여서, 선생님과
--   학생이 똑같이 'authenticated' 인 Supabase 에서는 "이 열은 선생님만"을 표현하지 못한다.
--   그래서 정답을 열로 숨기지 않고 **행을 갈랐다** —
--     · sg_book_chapters        : select 정책이 sg_is_staff() 다. 학생에게는 행이 0개다.
--     · sg_book_chapters_public : 정답을 떼어 낸 사본. status='built' 인 것만 보인다.
--   화면 코드가 정답을 지우도록 맡기지 않는다. 화면은 언젠가 하나가 잊는다.
--   지우는 일은 트리거가 하고, 학생이 닿는 테이블에는 애초에 정답이 들어가지 않는다.
--
-- [교재 관련 문서]
--   docs/bmad/book-schema.md          챕터 JSON 계약(슬러그·상태·gate 모양)
--   studyground/sg2/assets/book-store.js  같은 모양을 브라우저 localStorage 에 담는 쪽
-- =============================================================

create extension if not exists pgcrypto;


-- -------------------------------------------------------------
-- 0. 선행 조건 확인
--    함수가 없는 프로젝트에 이 파일만 적용하면, 정책은 만들어지는데 판정이 없어
--    "아무도 못 보는 테이블"이 된다. 원인을 찾기 어려우므로 여기서 먼저 멈춘다.
-- -------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.sg_is_staff()') is null
     or to_regprocedure('public.sg_is_admin()') is null then
    raise exception
      'public.sg_is_staff() / public.sg_is_admin() 이 없습니다. supabase/schema.sql 과 supabase/teacher_scope.sql 을 먼저 적용한 뒤 다시 실행하세요.';
  end if;
end
$$;


-- -------------------------------------------------------------
-- 1. sg_books — 책 4권
--    id 는 챕터 JSON 의 book 값과 **같은 문자열**이다(docs/bmad/book-schema.md §6).
--    여기서 이름이 갈리면 슬러그(reading-03)가 어느 책 것인지 붙지 않는다.
-- -------------------------------------------------------------
create table if not exists public.sg_books (
  id                text primary key
                      check (id in ('reading', 'listening', 'speaking', 'writing')),
  title             text        not null,
  cefr              text        not null default 'B2',
  chapters_planned  int         not null default 10,
  editions_planned  int         not null default 3,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

insert into public.sg_books (id, title) values
  ('reading',   'TOEFL Practice Book — B2 Level Up · Reading'),
  ('listening', 'TOEFL Practice Book — B2 Level Up · Listening'),
  ('speaking',  'TOEFL Practice Book — B2 Level Up · Speaking'),
  ('writing',   'TOEFL Practice Book — B2 Level Up · Writing')
on conflict (id) do nothing;


-- -------------------------------------------------------------
-- 2. sg_book_chapters — 챕터 원고(정답 포함)
--
--    키가 (slug, edition_no) 인 이유: 슬러그는 '{book}-{NN}' 이라 판(1..3)을 담지 않는다.
--    같은 챕터의 3판을 슬러그 하나에 밀어 넣으면 2판을 저장하는 순간 1판이 사라진다.
--    status 사다리는 book-store.js 와 같다 — draft → gated → reviewed → built.
-- -------------------------------------------------------------
create table if not exists public.sg_book_chapters (
  slug           text not null
                   check (slug ~ '^(reading|listening|speaking|writing)-[0-9]{2}$'),
  edition_no     int  not null default 1 check (edition_no between 1 and 3),
  book           text not null references public.sg_books (id) on delete restrict,
  chapter_no     int  not null check (chapter_no between 1 and 10),
  title          text not null default '',
  status         text not null default 'draft'
                   check (status in ('draft', 'gated', 'reviewed', 'built')),
  schema_version text not null default '1.0.0',
  questions      int  not null default 0,

  -- 원고 전문. 정답(answer) · 모범답안(modelAnswers) · 대본(audio.script) 이 들어 있다.
  chapter        jsonb not null,

  -- 마지막 SG_BOOK_SCHEMA.validate() 결과. [{level,scope,message}] 모양 그대로 둔다.
  -- gate 메시지는 정답을 인용할 때가 있다(클로즈 힌트/정답 불일치). 그래서 이 열도
  -- 원고와 같은 취급을 받아야 하고, 학생용 사본에는 옮기지 않는다.
  gate_report    jsonb not null default '[]'::jsonb,
  gate_stop      int   not null default 0,
  gate_warn      int   not null default 0,

  authored_by    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  updated_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (slug, edition_no)
);

create index if not exists sg_book_chapters_book_idx
  on public.sg_book_chapters (book, chapter_no, edition_no);
create index if not exists sg_book_chapters_status_idx
  on public.sg_book_chapters (status);


-- -------------------------------------------------------------
-- 3. 정답을 떼어 내는 함수
--    떼는 것: 문항의 answer / answerTokens / answerSentence / sentence,
--             modelAnswers(모범답안), teaching.commonErrors(교사판 전용),
--             audio(대본이 통째로 들어 있다), provenance(집필 이력).
--    남기는 것: 지문 · 지시문 · 선택지 · 힌트 첫글자 · glossary · indexTerms.
--    힌트는 정답의 앞글자라서 남긴다 — 그게 문항의 일부다(book-schema.md §3-3).
-- -------------------------------------------------------------
create or replace function public.sg_book_strip_answers(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p is null then null else
    (p - 'modelAnswers' - 'audio' - 'provenance')
    || case when p ? 'teaching'
            then jsonb_build_object('teaching', (p -> 'teaching') - 'commonErrors')
            else '{}'::jsonb end
    || case when p ? 'modules' then jsonb_build_object('modules', (
         select coalesce(jsonb_agg(
           m || case when m ? 'blocks' then jsonb_build_object('blocks', (
             select coalesce(jsonb_agg(
               b || case when b ? 'questions' then jsonb_build_object('questions', (
                 select coalesce(jsonb_agg(
                   q - 'answer' - 'answerTokens' - 'answerSentence' - 'sentence'
                   order by qo), '[]'::jsonb)
                 from jsonb_array_elements(b -> 'questions') with ordinality as qq(q, qo)
               )) else '{}'::jsonb end
               order by bo), '[]'::jsonb)
             from jsonb_array_elements(m -> 'blocks') with ordinality as bb(b, bo)
           )) else '{}'::jsonb end
           order by mo), '[]'::jsonb)
         from jsonb_array_elements(p -> 'modules') with ordinality as mm(m, mo)
       )) else '{}'::jsonb end
  end;
$$;

grant execute on function public.sg_book_strip_answers(jsonb) to authenticated, anon;


-- -------------------------------------------------------------
-- 4. sg_book_chapters_public — 학생이 볼 수 있는 유일한 원고
--    사람이 채우지 않는다. 5절의 트리거만 쓴다.
-- -------------------------------------------------------------
create table if not exists public.sg_book_chapters_public (
  slug        text not null,
  edition_no  int  not null,
  book        text not null,
  chapter_no  int  not null,
  title       text not null default '',
  status      text not null default 'draft',
  questions   int  not null default 0,
  chapter     jsonb not null,          -- 정답이 제거된 사본
  updated_at  timestamptz not null default now(),
  primary key (slug, edition_no),
  foreign key (slug, edition_no)
    references public.sg_book_chapters (slug, edition_no) on delete cascade
);

create index if not exists sg_book_chapters_public_book_idx
  on public.sg_book_chapters_public (book, chapter_no, edition_no);


-- -------------------------------------------------------------
-- 5. 트리거 — 슬러그 검산(BEFORE) + 학생용 사본 자동 생성(AFTER)
--
--    사본 만들기를 BEFORE 에 두면 안 된다. sg_book_chapters_public 은 원고 행을
--    참조하는 FK 를 갖고 있어서, 원고가 아직 들어가기 전에 사본을 넣으면 FK 위반으로
--    저장 자체가 실패한다. 그래서 검산만 BEFORE, 사본은 AFTER 다.
--
--    사본 트리거는 SECURITY DEFINER 라 sg_book_chapters_public 의 RLS 를 타지 않는다.
--    그 테이블에는 쓰기 정책이 아예 없다(사람이 쓰는 곳이 아니다).
-- -------------------------------------------------------------
create or replace function public.sg_book_chapters_guard()
returns trigger
language plpgsql
as $$
declare
  want text;
begin
  -- 원고 하나가 두 이름을 갖는 사고를 여기서 막는다. 슬러그와 book/chapter_no 가
  -- 어긋나면 목차·러닝헤드·파일명이 서로 다른 챕터를 가리키게 된다.
  want := new.book || '-' || lpad(new.chapter_no::text, 2, '0');
  if new.slug <> want then
    raise exception 'slug "%" 가 book/chapter_no 와 맞지 않습니다. "%" 여야 합니다.', new.slug, want;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sg_book_chapters_guard_t on public.sg_book_chapters;
create trigger sg_book_chapters_guard_t
  before insert or update on public.sg_book_chapters
  for each row execute function public.sg_book_chapters_guard();


create or replace function public.sg_book_chapters_mirror()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.sg_book_chapters_public
    (slug, edition_no, book, chapter_no, title, status, questions, chapter, updated_at)
  values
    (new.slug, new.edition_no, new.book, new.chapter_no, new.title, new.status,
     new.questions, public.sg_book_strip_answers(new.chapter), now())
  on conflict (slug, edition_no) do update set
    book       = excluded.book,
    chapter_no = excluded.chapter_no,
    title      = excluded.title,
    status     = excluded.status,
    questions  = excluded.questions,
    chapter    = excluded.chapter,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

-- 예전에 한 함수로 두 일을 하던 판이 남아 있으면 걷어 낸다(멱등하게 다시 실행하는 경우).
drop trigger if exists sg_book_chapters_sync_t on public.sg_book_chapters;
drop function if exists public.sg_book_chapters_sync();

drop trigger if exists sg_book_chapters_mirror_t on public.sg_book_chapters;
create trigger sg_book_chapters_mirror_t
  after insert or update on public.sg_book_chapters
  for each row execute function public.sg_book_chapters_mirror();


-- -------------------------------------------------------------
-- 6. sg_book_builds — 뽑아낸 PDF 한 장 = 한 행
--    edition 은 챕터의 판(1..3, edition_no)이 아니라 **산출물의 종류**다.
--      student    학생용 본문
--      answer_key 정답지
--      teacher    교사판(정답 + 모범답안 + commonErrors)
--    지난 기록을 지우지 않는다 — "언제 뽑은 인쇄본이 교실에 있나"를 나중에 물어야 한다.
-- -------------------------------------------------------------
create table if not exists public.sg_book_builds (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,
  edition_no    int  not null default 1,
  edition       text not null check (edition in ('student', 'answer_key', 'teacher')),
  storage_path  text not null,          -- books 버킷 안의 경로. 6-1 의 규칙을 따른다.
  bytes         bigint not null default 0,
  pages         int,
  checksum      text,                   -- 같은 원고에서 같은 파일이 나왔는지 확인용
  built_by      uuid default auth.uid(),
  built_at      timestamptz not null default now(),
  notes         text,
  foreign key (slug, edition_no)
    references public.sg_book_chapters (slug, edition_no) on delete cascade
);

create index if not exists sg_book_builds_chapter_idx
  on public.sg_book_builds (slug, edition_no, built_at desc);
create index if not exists sg_book_builds_edition_idx
  on public.sg_book_builds (edition, built_at desc);


-- -------------------------------------------------------------
-- 7. RLS — 모든 테이블에 켠다
--
--    학생(로그인했지만 staff 아님)이 볼 수 있는 것은 딱 둘이다:
--      · sg_books
--      · sg_book_chapters_public 중 status='built' 인 행
--    원고 원본(sg_book_chapters)과 teacher/answer_key 빌드 행은 정책이 행 자체를
--    돌려주지 않는다. 화면에서 거르는 게 아니라 여기서 막는다.
-- -------------------------------------------------------------
alter table public.sg_books                enable row level security;
alter table public.sg_book_chapters        enable row level security;
alter table public.sg_book_chapters_public enable row level security;
alter table public.sg_book_builds          enable row level security;

-- anon 은 교재에 볼 일이 없다. Supabase 기본 grant 를 걷어 낸다.
revoke all on public.sg_books                from anon;
revoke all on public.sg_book_chapters        from anon;
revoke all on public.sg_book_chapters_public from anon;
revoke all on public.sg_book_builds          from anon;

-- 학생용 사본은 사람이 쓰는 테이블이 아니다. 트리거(SECURITY DEFINER)만 쓴다.
revoke insert, update, delete on public.sg_book_chapters_public from authenticated;

-- 7-1. sg_books : 로그인했으면 읽는다. 고치는 건 관리자만.
drop policy if exists sg_books_read on public.sg_books;
create policy sg_books_read on public.sg_books for select
  to authenticated
  using (true);

drop policy if exists sg_books_admin_write on public.sg_books;
create policy sg_books_admin_write on public.sg_books for all
  to authenticated
  using (public.sg_is_admin()) with check (public.sg_is_admin());

-- 7-2. sg_book_chapters : 원고 원본 — 직원만. 학생에게는 행이 0개다.
drop policy if exists sg_book_chapters_staff_read on public.sg_book_chapters;
create policy sg_book_chapters_staff_read on public.sg_book_chapters for select
  to authenticated
  using (public.sg_is_staff());

drop policy if exists sg_book_chapters_staff_insert on public.sg_book_chapters;
create policy sg_book_chapters_staff_insert on public.sg_book_chapters for insert
  to authenticated
  with check (public.sg_is_staff());

drop policy if exists sg_book_chapters_staff_update on public.sg_book_chapters;
create policy sg_book_chapters_staff_update on public.sg_book_chapters for update
  to authenticated
  using (public.sg_is_staff()) with check (public.sg_is_staff());

-- 지우기는 관리자만. 원고가 사라지면 PDF·세트·음원의 출처가 통째로 사라진다.
drop policy if exists sg_book_chapters_admin_delete on public.sg_book_chapters;
create policy sg_book_chapters_admin_delete on public.sg_book_chapters for delete
  to authenticated
  using (public.sg_is_admin());

-- 7-3. sg_book_chapters_public : 정답이 없는 사본. 인쇄까지 끝난(built) 것만 학생에게.
--      검토 중(draft/gated/reviewed)인 원고는 아직 학생 것이 아니다.
drop policy if exists sg_book_chapters_public_read on public.sg_book_chapters_public;
create policy sg_book_chapters_public_read on public.sg_book_chapters_public for select
  to authenticated
  using (public.sg_is_staff() or status = 'built');

-- 7-4. sg_book_builds : 학생은 student 판 기록만 본다.
--      answer_key · teacher 행은 경로 문자열 자체가 정답 파일을 가리키므로,
--      행을 돌려주는 순간 파일 이름이 새어 나간다. 그래서 행에서 막는다.
drop policy if exists sg_book_builds_read on public.sg_book_builds;
create policy sg_book_builds_read on public.sg_book_builds for select
  to authenticated
  using (public.sg_is_staff() or edition = 'student');

drop policy if exists sg_book_builds_staff_insert on public.sg_book_builds;
create policy sg_book_builds_staff_insert on public.sg_book_builds for insert
  to authenticated
  with check (public.sg_is_staff());

drop policy if exists sg_book_builds_staff_update on public.sg_book_builds;
create policy sg_book_builds_staff_update on public.sg_book_builds for update
  to authenticated
  using (public.sg_is_staff()) with check (public.sg_is_staff());

drop policy if exists sg_book_builds_admin_delete on public.sg_book_builds;
create policy sg_book_builds_admin_delete on public.sg_book_builds for delete
  to authenticated
  using (public.sg_is_admin());


-- -------------------------------------------------------------
-- 8. Storage — 'books' 버킷 (private)
--
--    경로 규칙:  <slug>/<edition>/<파일명>.pdf
--      reading-03/student/reading-03.student.pdf
--      reading-03/teacher/reading-03.teacher.pdf
--      reading-03/answer_key/reading-03.answer_key.pdf
--    두 번째 칸이 곧 산출물 종류다. 종류를 파일명에만 두면 정책이 그것을 읽을 수 없다.
--
--    지금 범위에서 PDF 는 **관리자·교사 전용 다운로드**다(docs/bmad/book-schema.md §8).
--    그래서 읽기도 sg_is_staff() 로 잠근다. 나중에 학생 배포를 열 때는 아래 select
--    정책의 조건을 다음으로 바꾸면 된다 —
--      public.sg_is_staff() or (storage.foldername(name))[2] = 'student'
--    student 칸을 미리 갈라 둔 이유가 그것이다. 그때 워터마킹을 함께 결정한다.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;

drop policy if exists books_staff_read on storage.objects;
create policy books_staff_read on storage.objects for select
  to authenticated
  using (bucket_id = 'books' and public.sg_is_staff());

drop policy if exists books_staff_insert on storage.objects;
create policy books_staff_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'books'
    and public.sg_is_staff()
    and (storage.foldername(name))[2] in ('student', 'answer_key', 'teacher')
  );

-- 같은 챕터를 다시 뽑으면 같은 경로에 덮어쓴다(upsert). update 가 없으면 두 번째
-- 빌드가 조용히 실패한다.
drop policy if exists books_staff_update on storage.objects;
create policy books_staff_update on storage.objects for update
  to authenticated
  using (bucket_id = 'books' and public.sg_is_staff())
  with check (
    bucket_id = 'books'
    and public.sg_is_staff()
    and (storage.foldername(name))[2] in ('student', 'answer_key', 'teacher')
  );

-- 지우기는 관리자만. 인쇄에 넘긴 파일이 조용히 사라지면 무엇을 인쇄했는지 알 수 없다.
drop policy if exists books_admin_delete on storage.objects;
create policy books_admin_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'books' and public.sg_is_admin());

update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/json', 'audio/mpeg']
where id = 'books';
