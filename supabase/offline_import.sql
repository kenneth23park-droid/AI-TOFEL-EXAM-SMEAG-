-- Supabase 수신측 — 교실 서버가 올린 응시 봉투를 받는다  [제안 · 미반영]
--
-- 설계: 착륙(landing)과 정규화(normalise)를 분리한다.
--   교실 서버는 sg_attempt_imports 에 봉투 하나만 넣는다. 그게 성공하면 그 응시는
--   "도착했다"가 확정이다 — 네트워크가 다시 끊겨도 데이터는 이미 클라우드에 있다.
--   정규화가 실패해도 원본이 남아 있으므로 고쳐서 다시 돌리면 된다.
--   반대 순서(바로 정규화)면 실패한 절반을 손으로 되짚어야 한다.

-- ── 1. 착륙 테이블 ────────────────────────────────────────────────────────

create table if not exists public.sg_attempt_imports (
  session          text primary key,          -- 자연키. attempts.session 과 같다
  student_no       text not null,
  exam_code        text not null,
  payload          jsonb not null,
  payload_sha256   text not null,
  imported_at      timestamptz not null default now(),
  processed_at     timestamptz,               -- null = 아직 정규화 안 됨
  process_error    text
);

create index if not exists ix_sg_imports_unprocessed
  on public.sg_attempt_imports (imported_at)
  where processed_at is null;

comment on column public.sg_attempt_imports.payload_sha256 is
  '같은 해시가 다시 오면 내용이 그대로다 — 트리거가 재처리를 건너뛴다.';

-- ── 2. 접근 통제 ──────────────────────────────────────────────────────────
-- 학생 토큰은 이 테이블을 아예 못 본다. 쓰기는 service_role 만 — 그 키는
-- 교실 서버에만 둔다. 학생 기기에 내려보내면 남의 응시를 덮어쓸 수 있다.

alter table public.sg_attempt_imports enable row level security;
-- 정책을 하나도 만들지 않는다 = anon/authenticated 는 전부 차단.
-- service_role 은 RLS 를 우회하므로 별도 정책이 필요 없다.

-- ── 3. 재처리를 막는 가드 ────────────────────────────────────────────────
-- 같은 봉투를 다시 올려도(재실행·중복 실행) 정규화는 한 번만 돈다.

create or replace function public.sg_mark_import_dirty()
returns trigger
language plpgsql
as $$
begin
  -- 내용이 바뀐 경우에만 재처리 대상으로 되돌린다.
  if tg_op = 'UPDATE' and new.payload_sha256 = old.payload_sha256 then
    new.processed_at := old.processed_at;
    new.process_error := old.process_error;
  else
    new.processed_at := null;
    new.process_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sg_import_dirty on public.sg_attempt_imports;
create trigger trg_sg_import_dirty
  before insert or update on public.sg_attempt_imports
  for each row execute function public.sg_mark_import_dirty();

-- ── 4. 정규화 ─────────────────────────────────────────────────────────────
-- 봉투를 실제 성적 테이블로 펼친다. 대상 테이블 이름은 확정 후 채운다.
--
-- 지켜야 할 것:
--   · 학생은 student_no 로 upsert (교실마다 로컬 PK 가 다르므로 id 는 쓰지 않는다)
--   · 응시는 session 으로 upsert
--   · 문항은 (session, question_key) 로 upsert  ← exam-sync.js 와 같은 자연키
--   · 실패는 process_error 에 남기고 예외를 삼킨다 — 한 응시가 배치를 세우면 안 된다

create or replace function public.sg_process_imports(p_limit int default 100)
returns table (session text, ok boolean, err text)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select * from public.sg_attempt_imports
    where processed_at is null
    order by imported_at
    limit p_limit
  loop
    begin
      -- TODO: 대상 스키마 확정 후 아래를 채운다.
      --   insert into students   ... on conflict (student_no) do update ...
      --   insert into attempts   ... on conflict (session)    do update ...
      --   insert into question_responses ... on conflict (attempt_id, question_key) ...
      --
      -- 지금은 착륙만 확인하고 통과 처리한다.
      update public.sg_attempt_imports
         set processed_at = now(), process_error = null
       where sg_attempt_imports.session = rec.session;

      session := rec.session; ok := true; err := null;
      return next;
    exception when others then
      update public.sg_attempt_imports
         set process_error = sqlerrm
       where sg_attempt_imports.session = rec.session;

      session := rec.session; ok := false; err := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.sg_process_imports(int) from public, anon, authenticated;

-- 확인:
--   select session, imported_at, processed_at, process_error
--     from public.sg_attempt_imports order by imported_at desc limit 20;
--   select * from public.sg_process_imports(50);
