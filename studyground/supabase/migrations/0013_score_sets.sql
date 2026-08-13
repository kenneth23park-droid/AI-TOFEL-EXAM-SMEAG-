-- 0013 — 여러 번 친 시험에서 한 벌의 성적을 고른다.
--
-- 왜 필요한가
--   학생은 선생님의 동의를 받아 같은 시험을 다시 친다. 리딩만 다시 치기도 하고,
--   스피킹만 다시 치기도 한다(sg_results 는 그때마다 한 줄씩 늘고, attempt_no 로
--   회차가 갈린다). 그러면 성적표에 쓸 "한 벌"이 어디에도 없다 — 8월 3일 응시의
--   리딩과 8월 9일 응시의 스피킹을 함께 적어야 하는데, 그 둘은 서로 다른 행이다.
--
--   화면이 알아서 고르게 두지 않는다. smeag.com 의 「내 최고 점수」는 영역별 최고를
--   기계적으로 집는데, 그것은 참고값이지 성적이 아니다. 어느 회차를 성적으로 삼을지는
--   사람이 정한다 — 다시 친 것을 허락한 선생님이 동의하고, 관리자가 확정한다.
--
-- 무엇을 저장하는가
--   picks       영역 넷을 각각 어느 응시(session)에서 가져오는가. 이것이 정본이다.
--   snapshot    확정하던 순간의 밴드. 나중에 채점이 바뀌면 화면은 새 점수를 보여 주되,
--               이 값이 남아 있어 "그때 무엇을 보고 확정했는가"를 되짚을 수 있다.
--   approved_*  동의한 선생님. 관리자 혼자 만든 성적은 없다는 뜻을 표로 굳힌다.
--
-- 지우지 않는다
--   delete 정책을 두지 않는다. 잘못 만든 성적 세트는 voided_at 으로 무효가 되고
--   자리에는 남는다 — sg_results 의 hidden, sg_archives 와 같은 원칙이다.

create table if not exists sg_score_sets (
    id            uuid        primary key default gen_random_uuid(),
    owner         uuid        not null references auth.users (id) on delete cascade,

    -- 성적표에 적힐 이름. 비면 화면이 만든 날짜로 부른다.
    label         text        not null default '',
    -- 대표 세트 코드. 회차가 세트를 넘나들면 'SET 9 + SET 8' 처럼 이어 붙는다.
    set_code      text        not null default '',

    -- { "reading": {"session": "...", "set_code": "SET 9", "attempt_no": 2}, ... }
    picks         jsonb       not null default '{}'::jsonb,
    -- { "sections": {"reading": 5.0, ...}, "overall": 4.5, "cefr": "B2" }
    snapshot      jsonb       not null default '{}'::jsonb,

    -- 다시 치는 것을 허락한 선생님. 이름을 함께 굳힌다 — 계정이 지워져도 남아야 한다.
    approved_by   uuid        references auth.users (id) on delete set null,
    approved_name text        not null default '',
    approved_note text        not null default '',

    created_by    uuid        not null default auth.uid(),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    voided_at     timestamptz,
    voided_reason text        not null default '',

    -- 동의 없는 성적 세트는 만들 수 없다. 계정을 고르든 이름을 적든 둘 중 하나는 있어야 한다.
    constraint ck_sg_score_sets_consent
        check (approved_by is not null or approved_name <> '')
);

comment on table sg_score_sets is
  '여러 회차에서 영역별로 하나씩 골라 묶은 성적 한 벌. 선생님 동의 + 관리자 확정.';
comment on column sg_score_sets.picks is
  '영역 → {session, set_code, attempt_no}. 점수를 복사하지 않고 응시를 가리킨다 — 채점이 고쳐지면 성적도 따라 고쳐진다.';
comment on column sg_score_sets.snapshot is
  '확정하던 순간의 밴드. 감사용이며 화면이 보여 주는 값은 아니다(화면은 picks 로 다시 계산한다).';
comment on column sg_score_sets.voided_at is
  '무효로 돌린 시각. 지우지 않는다 — 잘못 만든 성적도 만들어졌다는 사실은 남는다.';

create index if not exists ix_sg_score_sets_owner on sg_score_sets (owner, created_at desc);

-- ── 고른 응시가 정말 그 학생의 것인가 ──────────────────────────────
-- 화면이 보내는 session 문자열을 그대로 믿지 않는다. 남의 응시를 붙여 성적을 부풀리는
-- 길이 여기 말고는 없다 — sg_results 의 RLS 는 읽기를 막을 뿐, 이 표의 jsonb 안에
-- 무엇이 적히는지는 보지 않기 때문이다.
create or replace function sg_score_sets_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    skill text;
    sess  text;
begin
    foreach skill in array array['reading', 'listening', 'writing', 'speaking'] loop
        sess := new.picks -> skill ->> 'session';
        if sess is null or sess = '' then
            continue;                                   -- 그 영역은 비워 둔다(아직 안 골랐다)
        end if;
        if not exists (
            select 1 from sg_results r
             where r.session = sess and r.owner = new.owner
        ) then
            raise exception '% 영역이 이 학생의 응시가 아닌 session(%) 을 가리킵니다', skill, sess;
        end if;
    end loop;

    if new.picks = '{}'::jsonb then
        raise exception '영역을 하나도 고르지 않은 성적 세트는 만들 수 없습니다';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_sg_score_sets_check on sg_score_sets;
create trigger trg_sg_score_sets_check
    before insert or update on sg_score_sets
    for each row execute function sg_score_sets_check();

-- ── 권한 ───────────────────────────────────────────────────────────
-- 읽기는 sg_can_see(owner) — 본인 · 관리자 · 담당 선생님.
-- 쓰기는 관리자뿐이다. 선생님은 동의하는 사람이지 확정하는 사람이 아니다.
alter table sg_score_sets enable row level security;

drop policy if exists sg_score_sets_read on sg_score_sets;
create policy sg_score_sets_read on sg_score_sets
    for select using (sg_can_see(owner));

drop policy if exists sg_score_sets_admin_insert on sg_score_sets;
create policy sg_score_sets_admin_insert on sg_score_sets
    for insert with check (sg_is_admin());

drop policy if exists sg_score_sets_admin_update on sg_score_sets;
create policy sg_score_sets_admin_update on sg_score_sets
    for update using (sg_is_admin()) with check (sg_is_admin());
-- delete 정책은 두지 않는다 = service_role 전용.
