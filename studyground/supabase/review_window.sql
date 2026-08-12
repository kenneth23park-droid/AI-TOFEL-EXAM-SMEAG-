-- 리뷰 열람 창 — 문항과 정답에는 기한이 있고, 다시 여는 것은 관리자뿐이다.
--
-- 왜 서버에 두는가
--   화면에서 감추는 것은 잠금이 아니다. 지금까지 정답은 공개 파일
--   (smeag-studyground.vercel.app/assets/set9.js)에 있었고, 주소를 아는 학생은
--   화면이 무엇을 감추든 그대로 받아 볼 수 있었다. 그래서 정답을 이 표로 옮기고,
--   이 표는 service_role 말고는 아무도 읽지 못하게 둔다. 학생 화면은 Edge
--   Function `sg-review` 에게 물어야 하고, 그 함수가 소유·기한·해제를 확인한
--   뒤에만 문항과 정답을 내려준다.
--
-- 기한
--   응시일과 교사 리뷰일 중 **늦은 쪽 + 7일**. 교사가 아직 보지 않았으면 응시일이
--   기준이다 — 그래야 리뷰가 없는 응시도 언젠가는 닫힌다.
--
-- 적용:  psql "$SUPABASE_DB_URL" -f studyground/supabase/review_window.sql
--        (또는 Supabase SQL Editor 에 그대로 붙여넣기)

begin;

-- ── 1. 문항과 정답 ────────────────────────────────────────────────────────
create table if not exists public.sg_set_questions (
  set_code    text not null,
  question_id text not null,
  no          integer,
  section     text,
  prompt      text not null default '',
  answer      jsonb,                       -- 문자열 하나 또는 복수 정답 배열
  ord         integer,                     -- 세트 안에서의 순서(1부터). 리뷰의 문항 번호가 된다
  updated_at  timestamptz not null default now(),
  primary key (set_code, question_id)
);

alter table public.sg_set_questions enable row level security;

-- ⚠️ 이 표에는 정책을 **하나도** 두지 않는다. RLS 가 켜져 있고 정책이 없으면
--    anon·authenticated 는 한 행도 못 읽고, RLS 를 지나치는 service_role
--    (= Edge Function)만 읽는다. 여기에 select 정책을 더하는 순간 정답이 학생
--    브라우저로 새어 나간다 — 편의를 위해서라도 더하지 말 것.

comment on table public.sg_set_questions is
  '문항·정답 보관소. RLS 정책 없음 = service_role 전용. sg-review 함수만 읽는다.';

-- ── 2. 관리자 해제 ────────────────────────────────────────────────────────
create table if not exists public.sg_review_grants (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  session    text not null,
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  note       text not null default ''
);

create index if not exists sg_review_grants_lookup
  on public.sg_review_grants (session, expires_at desc);

alter table public.sg_review_grants enable row level security;

-- 학생은 자기 것을 본다 — 화면이 "언제까지 열려 있다"를 말해 줘야 하기 때문이다.
drop policy if exists sg_review_grants_read on public.sg_review_grants;
create policy sg_review_grants_read on public.sg_review_grants
  for select using (public.sg_can_see(owner));

-- 여는 것은 관리자뿐이다(교사도 아니다 — 요청이 'admin permission' 이었다).
drop policy if exists sg_review_grants_admin_write on public.sg_review_grants;
create policy sg_review_grants_admin_write on public.sg_review_grants
  for all using (public.sg_is_admin()) with check (public.sg_is_admin());

comment on table public.sg_review_grants is
  '만료된 리뷰를 관리자가 다시 연 기록. expires_at 까지만 유효하고, 지나면 저절로 닫힌다.';

-- ── 3. 창 계산 ────────────────────────────────────────────────────────────
-- 규칙은 한 벌만 있어야 한다. 화면과 서버가 서로 다른 날짜를 말하면 그것 자체가
-- 버그다 — 그래서 날짜 계산은 여기 하나뿐이고, 화면은 이 값을 받아 쓰기만 한다.
create or replace function public.sg_review_status(p_session text, p_owner uuid default null)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with r as (
    -- 같은 session 이 두 번 올라온 응시가 실제로 있고(재제출·중복 동기화), 심지어
    -- **소유자가 다른** 행까지 있다(관리자 seed). 그래서 소유자를 함께 받고,
    -- 그 안에서 마지막 제출을 기준으로 삼는다 — 아무 행이나 집으면 남의 기한이 된다.
    select owner, submitted_at, set_code from public.sg_results
     where session = p_session
       and (p_owner is null or owner = p_owner)
     order by submitted_at desc
     limit 1
  ),
  t as (
    select max(created_at) as at from public.sg_comments
     where session = p_session and source = 'teacher'
       and (p_owner is null or owner = p_owner)
  ),
  g as (
    select max(expires_at) as until from public.sg_review_grants
     where session = p_session and expires_at > now()
       and (p_owner is null or owner = p_owner)
  ),
  b as (
    select r.owner, r.submitted_at, r.set_code, t.at as teacher_at, g.until as granted_until,
           greatest(r.submitted_at, coalesce(t.at, r.submitted_at)) + interval '7 days' as until
      from r, t, g
  )
  select jsonb_build_object(
    'session',       p_session,
    'owner',         b.owner,
    'set_code',      b.set_code,
    'submitted_at',  b.submitted_at,
    'teacher_at',    b.teacher_at,
    'until',         b.until,
    'granted_until', b.granted_until,
    'unlocked',      b.granted_until is not null,
    'open',          (now() <= b.until) or (b.granted_until is not null)
  ) from b;
$$;

comment on function public.sg_review_status(text, uuid) is
  '리뷰 열람 창. 응시일과 교사 리뷰일 중 늦은 쪽 + 7일, 관리자 해제가 있으면 그 기한까지.';

-- 학생 화면이 직접 부를 일은 없다(Edge Function 이 service_role 로 부른다).
revoke all on function public.sg_review_status(text, uuid) from anon, authenticated;
-- 소유자 없이 부를 수 있는 옛 한 인자짜리는 남겨 두지 않는다.
drop function if exists public.sg_review_status(text);

-- ── 4. 관리자 화면용 목록 ─────────────────────────────────────────────────
-- 응시 여러 건의 열람 창을 한 번에. 정답은 한 글자도 나가지 않는다 — 기한과 해제뿐.
-- 볼 수 있는 범위는 sg_can_see() 가 정한다(선생님은 자기 학생만).
drop function if exists public.sg_review_windows(text[]);
create function public.sg_review_windows(p_sessions text[])
returns table (session text, owner uuid, open boolean, until timestamptz, granted_until timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with r as (
    select distinct on (x.session, x.owner) x.session, x.owner, x.submitted_at
      from public.sg_results x
     where x.session = any(p_sessions)
       and public.sg_can_see(x.owner)
     order by x.session, x.owner, x.submitted_at desc
  )
  select r.session, r.owner,
         (now() <= base.until) or (g.until is not null) as open,
         base.until,
         g.until as granted_until
    from r
    cross join lateral (
      select greatest(
               r.submitted_at,
               coalesce((select max(c.created_at) from public.sg_comments c
                          where c.session = r.session and c.owner = r.owner and c.source = 'teacher'),
                        r.submitted_at)
             ) + interval '7 days' as until
    ) base
    left join lateral (
      select max(v.expires_at) as until from public.sg_review_grants v
       where v.session = r.session and v.owner = r.owner and v.expires_at > now()
    ) g on true;
$$;

revoke all on function public.sg_review_windows(text[]) from public, anon;
grant execute on function public.sg_review_windows(text[]) to authenticated;

comment on function public.sg_review_windows(text[]) is
  '여러 응시의 리뷰 열람 창(기한·해제)만 돌려준다. 정답은 포함하지 않는다. 범위는 sg_can_see().';

-- ── 5. 옛 정답지 잠그기 ───────────────────────────────────────────────────
-- sg_answer_keys(레거시 IELTS 리스닝 정답지)는 RLS 가 **꺼져** 있었다. 정책이 있어도
-- 켜지 않으면 아무 일도 하지 않는다 — anon 키만 있으면 정답지를 통째로 읽고 지울 수도
-- 있었다(anon 에게 SELECT·INSERT·UPDATE·DELETE 가 다 열려 있었다).
alter table public.sg_answer_keys enable row level security;

drop policy if exists sg_read_keys on public.sg_answer_keys;
drop policy if exists sg_answer_keys_staff_read on public.sg_answer_keys;
create policy sg_answer_keys_staff_read on public.sg_answer_keys
  for select using (public.sg_is_staff());
-- 쓰기 정책은 두지 않는다 = service_role 말고는 아무도 못 쓴다.

comment on table public.sg_answer_keys is
  '레거시(IELTS 리스닝) 정답지. 학생에게 열지 말 것 — 읽기는 staff 전용.';

commit;
