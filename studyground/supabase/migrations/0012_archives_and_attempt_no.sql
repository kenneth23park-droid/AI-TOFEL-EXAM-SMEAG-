-- 0012 — 다시 시작해도 기존 데이터는 남는다, 그리고 회차로 구분된다.
--
-- 두 가지를 세운다.
--
--  [1] sg_archives — 되감기·다시 시작 직전의 한 벌을 클라우드에 남긴다.
--      지금까지 백업본은 학생 기기 IndexedDB(SG_LDB.arch)에만 있었다. 기기를
--      초기화하거나 브라우저 저장소가 비워지면 그대로 사라졌고, 선생님은 애초에
--      볼 수가 없었다. append-only 다 — 수정·삭제 정책을 두지 않는다(감사 기록).
--
--  [2] sg_results.attempt_no / hidden — 같은 학생이 같은 세트를 여러 번 친 결과를
--      회차로 가른다. 지금까지는 행이 여럿일 뿐, 어느 것이 몇 번째인지 알 길이
--      없었다. hidden 은 지우지 않고 가리는 자리다 — 기기를 공유하다 남의 계정에
--      잘못 붙은 응시처럼, 지워서는 안 되지만 성적에 세어서도 안 되는 것들.

-- ── [1] 백업본 ────────────────────────────────────────────────
create table if not exists sg_archives (
    id         uuid        primary key default gen_random_uuid(),
    owner      uuid        not null default auth.uid() references auth.users (id),
    session    text        not null,
    set_code   text        not null default '',
    -- rewind_step_N | course_restart_reading | restart_all
    reason     text        not null default '',
    step       integer     not null default 0,
    -- 기기 시계. 같은 세션·같은 사유가 여러 번 나올 수 있어 여기까지 묶어야 유일하다.
    client_ts  bigint      not null default 0,
    answers    jsonb       not null default '{}'::jsonb,
    clocks     jsonb       not null default '{}'::jsonb,
    cursor     jsonb       not null default '{}'::jsonb,
    meta       jsonb       not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint uq_sg_archives unique (owner, session, reason, client_ts)
);

comment on table sg_archives is
  '되감기·다시 시작 직전의 답안 백업본. append-only — 지우지 않는다. 원본은 학생 기기(SG_LDB.arch)이고 이것은 그 사본이다.';
comment on column sg_archives.reason is
  'rewind_step_N(되감기) | course_restart_{section}(이 코스 처음부터) | restart_all(전체 다시)';

create index if not exists ix_sg_archives_owner_session on sg_archives (owner, session);
create index if not exists ix_sg_archives_created on sg_archives (created_at desc);

alter table sg_archives enable row level security;

drop policy if exists sg_archives_read on sg_archives;
create policy sg_archives_read on sg_archives
    for select using (sg_can_see(owner));

drop policy if exists sg_archives_write on sg_archives;
create policy sg_archives_write on sg_archives
    for insert with check (owner = auth.uid());
-- update·delete 정책은 두지 않는다 = service_role 전용. 백업본은 고쳐 쓰지 않는다.

-- ── [2] 회차 · 숨김 ───────────────────────────────────────────
alter table sg_results add column if not exists attempt_no    integer not null default 1;
alter table sg_results add column if not exists hidden        boolean not null default false;
alter table sg_results add column if not exists hidden_reason text    not null default '';

comment on column sg_results.attempt_no is
  '같은 학생·같은 세트에서 몇 번째 응시인가(1부터). 숨긴 응시(hidden)는 0 이며 회차를 먹지 않는다.';
comment on column sg_results.hidden is
  '성적 목록에서 가린다. 지우지는 않는다 — 기기를 공유하다 잘못 붙은 응시, 리허설 기록 등.';

create index if not exists ix_sg_results_owner_set on sg_results (owner, set_code, attempt_no);

-- 새 응시의 회차는 서버가 센다. 클라이언트는 오프라인이라 남의 회차를 알 수 없다.
create or replace function sg_results_set_attempt_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.hidden then
        new.attempt_no := 0;
        return new;
    end if;
    if new.attempt_no is null or new.attempt_no <= 1 then
        select coalesce(max(attempt_no), 0) + 1
          into new.attempt_no
          from sg_results
         where owner = new.owner and set_code = new.set_code and not hidden;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_sg_results_attempt_no on sg_results;
create trigger trg_sg_results_attempt_no
    before insert on sg_results
    for each row execute function sg_results_set_attempt_no();

-- 선생님·관리자가 숨김을 켜고 끌 수 있어야 한다(학생 본인은 자기 것만, 기존 정책 그대로).
drop policy if exists sg_results_staff_update on sg_results;
create policy sg_results_staff_update on sg_results
    for update using (sg_is_staff() and sg_can_see(owner))
    with check (sg_is_staff() and sg_can_see(owner));
