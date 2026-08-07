-- StudyGround — Postgres / Supabase schema.
-- Mirrors app/models.py exactly. SQLAlchemy's create_all() produces the same
-- shape on SQLite; this file is the contract Stream A and Stream C code against
-- and what you run once against a fresh Supabase project.
--
-- The whole file is idempotent: every statement carries IF NOT EXISTS (or a
-- DROP-then-ADD for constraints), so running it twice in a row is a no-op.
-- docs/bmad/architecture.md 6.2.x is the source of truth; the ALTER blocks below
-- exist so a database created before Story 3.1 catches up to the same shape.

create table if not exists students (
    id          serial primary key,
    student_no  varchar(32)  not null unique,     -- 학번
    name        varchar(120) not null,
    klass       varchar(64)  not null default '', -- 반
    campus      varchar(64)  not null default '', -- 캠퍼스
    created_at  timestamp    not null default now()
);
create index if not exists ix_students_student_no on students (student_no);

create table if not exists exams (
    id          serial primary key,
    code        varchar(32)  not null unique,     -- SET 9 / SET 8 / SET 7
    title       varchar(200) not null,
    created_at  timestamp    not null default now()
);

create table if not exists attempts (
    id                serial primary key,
    student_id        integer     not null references students (id) on delete cascade,
    exam_id           integer     not null references exams (id),
    taken_at          timestamp   not null default now(),
    total_score       integer     not null default 0,  -- /120
    grade             varchar(16) not null default '', -- CEFR
    status            varchar(24) not null default 'in_progress',  -- in_progress | scoring | completed
    session           varchar(64),
    campus            varchar(64) not null default '',
    exam_date         date,
    submitted_count   integer     not null default 0,
    total_questions   integer     not null default 0,
    feedback_progress integer     not null default 0,  -- 0..100
    profile           varchar(16) not null default 'toefl',     -- toefl | ielts
    scale             varchar(16) not null default 'toefl120',  -- toefl120 | ielts9
    band_score        numeric(2,1),                   -- IELTS 0.0..9.0, TOEFL 은 NULL
    started_at        timestamptz,
    submitted_at      timestamptz,
    content_hash      varchar(32) not null default ''
);
create index if not exists ix_attempts_student on attempts (student_id);
create index if not exists ix_attempts_exam    on attempts (exam_id);
create index if not exists ix_attempts_taken   on attempts (taken_at desc);

create table if not exists section_scores (
    id           serial primary key,
    attempt_id   integer     not null references attempts (id) on delete cascade,
    skill        varchar(16) not null,            -- reading | listening | speaking | writing
    raw_correct  double precision not null default 0,
    raw_total    double precision not null default 0,
    scaled       integer     not null default 0,  -- /30
    module       varchar(8)  not null default '', -- 'R1'/'L2'… blank = whole skill
    constraint uq_section_attempt_skill unique (attempt_id, skill)
);
create index if not exists ix_section_attempt on section_scores (attempt_id);

create table if not exists question_responses (
    id              serial primary key,
    attempt_id      integer     not null references attempts (id) on delete cascade,
    skill           varchar(16) not null,
    no              integer     not null,
    prompt          text        not null default '',
    student_answer  text        not null default '',
    correct_answer  text        not null default '',
    is_correct      boolean     not null default false,
    question_key    varchar(32) not null default '',   -- set1.js id: 'R1-1', 'S-8'
    qtype           varchar(24) not null default 'MCQ',
    module          varchar(8)  not null default '',   -- 'R1','L2','W1','S2'
    auto_score      double precision,                  -- NULL = 자동채점 불가(주관식)
    max_score       double precision not null default 1,
    feedback        text        not null default '',
    audio_ref       varchar(255) not null default '',
    graded_by       varchar(64) not null default '',
    graded_at       timestamptz
);
create index if not exists ix_qr_attempt on question_responses (attempt_id);
create index if not exists ix_qr_skill    on question_responses (skill);

create table if not exists rubric_scores (
    id          serial primary key,
    attempt_id  integer     not null references attempts (id) on delete cascade,
    skill       varchar(16) not null,
    criterion   varchar(64) not null,
    score       double precision not null default 0,
    max_score   double precision not null default 5,
    comment     text        not null default '',
    band        numeric(2,1)                     -- IELTS 전용, 0.5 단위
);
create index if not exists ix_rubric_attempt on rubric_scores (attempt_id);
create index if not exists ix_rubric_skill   on rubric_scores (skill);

create table if not exists ai_feedback (
    id           serial primary key,
    attempt_id   integer     not null references attempts (id) on delete cascade,
    scope        varchar(16) not null,            -- 'overall' or a skill name
    lang         varchar(8)  not null default 'en',
    mode         varchar(16) not null default 'offline',  -- offline (rules) | online (LLM)
    summary      text        not null default '',
    strengths    json        not null default '[]',
    improvements json        not null default '[]',
    created_at   timestamp   not null default now(),
    constraint uq_feedback_attempt_scope_lang unique (attempt_id, scope, lang)
);
create index if not exists ix_feedback_attempt on ai_feedback (attempt_id);

-- === 6.2.5 신규 테이블 ===
create table if not exists attempt_events (
    id          bigserial primary key,
    attempt_id  integer     not null references attempts (id) on delete cascade,
    ts          timestamptz not null default now(),
    -- screen_enter | timer_expire | reload | clock_skew | record_start | record_stop | submit
    type        varchar(32) not null,
    screen_id   varchar(64) not null default '',
    detail      text        not null default ''   -- JSON 문자열
);
create index if not exists ix_events_attempt on attempt_events (attempt_id, ts);

create table if not exists media_assets (
    id           bigserial primary key,
    attempt_id   integer     not null references attempts (id) on delete cascade,
    question_key varchar(32) not null,
    kind         varchar(16) not null default 'audio',
    storage      varchar(16) not null default 'file',   -- file | inline | object
    uri          varchar(512) not null default '',      -- file/object 경로 또는 URL
    inline_b64   text,                                   -- storage='inline' 일 때만
    mime         varchar(64) not null default 'audio/webm',
    bytes        integer     not null default 0,
    duration_ms  integer     not null default 0,
    sha256       varchar(64) not null default '',
    created_at   timestamptz not null default now(),
    constraint uq_media_attempt_key_kind unique (attempt_id, question_key, kind)
);
create index if not exists ix_media_attempt on media_assets (attempt_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Story 3.1 이전에 만들어진 DB 를 따라잡게 하는 구간. 새 프로젝트에서는 전부 no-op.
-- app/migrations.py 의 스텝과 1:1 대응한다.
-- ─────────────────────────────────────────────────────────────────────────────

-- === 6.2.1 students ===
alter table students add column if not exists campus varchar(64) not null default '';

-- === 6.2.2 attempts ===
alter table attempts add column if not exists session           varchar(64);
alter table attempts add column if not exists campus            varchar(64) not null default '';
alter table attempts add column if not exists exam_date         date;
alter table attempts add column if not exists submitted_count   integer not null default 0;
alter table attempts add column if not exists total_questions   integer not null default 0;
alter table attempts add column if not exists feedback_progress integer not null default 0;
alter table attempts add column if not exists profile           varchar(16) not null default 'toefl';
alter table attempts add column if not exists scale             varchar(16) not null default 'toefl120';
alter table attempts add column if not exists band_score        numeric(2,1);
alter table attempts add column if not exists started_at        timestamptz;
alter table attempts add column if not exists submitted_at      timestamptz;
alter table attempts add column if not exists content_hash      varchar(32) not null default '';

create unique index if not exists uq_attempts_session on attempts (session) where session is not null;
create index if not exists ix_attempts_exam_date on attempts (exam_date);
create index if not exists ix_attempts_campus    on attempts (campus);

-- status: 기존 'scored|pending|reviewing' → 'in_progress|scoring|completed'.
-- CHECK 은 반드시 UPDATE 뒤에 건다.
update attempts set status = 'completed' where status = 'scored';
update attempts set status = 'scoring'   where status in ('pending', 'reviewing');
update attempts set status = 'completed' where status not in ('in_progress', 'scoring', 'completed');

alter table attempts drop constraint if exists ck_attempts_status;
alter table attempts add constraint ck_attempts_status
  check (status in ('in_progress', 'scoring', 'completed'));

-- === 6.2.3 question_responses ===
alter table question_responses add column if not exists question_key varchar(32) not null default '';
alter table question_responses add column if not exists qtype        varchar(24) not null default 'MCQ';
alter table question_responses add column if not exists module       varchar(8)  not null default '';
alter table question_responses add column if not exists auto_score   double precision;
alter table question_responses add column if not exists max_score    double precision not null default 1;
alter table question_responses add column if not exists feedback     text not null default '';
alter table question_responses add column if not exists audio_ref    varchar(255) not null default '';
alter table question_responses add column if not exists graded_by    varchar(64) not null default '';
alter table question_responses add column if not exists graded_at    timestamptz;

alter table question_responses drop constraint if exists ck_qr_qtype;
alter table question_responses add constraint ck_qr_qtype
  check (qtype in ('WORD_FILLING', 'MCQ', 'CLOZE', 'INSERT', 'BUILD_SENTENCE', 'WRITING', 'SPEAKING'));

-- === 6.2.4 section_scores / rubric_scores ===
alter table section_scores add column if not exists module varchar(8) not null default '';
alter table rubric_scores  add column if not exists band   numeric(2,1);

-- === 6.3 기존 seed 데이터 백필 (모두 "아직 기본값일 때만" 조건이라 재실행 안전) ===
update attempts set session = 'legacy-' || id where session is null;
update attempts set exam_date = cast(taken_at as date) where exam_date is null;
update question_responses set question_key = skill || '-' || no where question_key = '';
update attempts set total_questions =
  (select count(*) from question_responses q where q.attempt_id = attempts.id)
  where total_questions = 0;
update attempts set submitted_count =
  (select count(*) from question_responses q where q.attempt_id = attempts.id)
  where submitted_count = 0;
update attempts set feedback_progress = 100 where feedback_progress = 0 and status = 'completed';

-- === 0007 부분 유니크 인덱스는 백필 뒤에 만든다(legacy 키가 채워진 뒤라야 충돌을 정확히 잡는다) ===
create unique index if not exists uq_qr_attempt_key
  on question_responses (attempt_id, question_key) where question_key <> '';

-- === app/migrations.py 의 원장 — SQL Editor 로 올린 DB 도 러너와 상태를 공유한다 ===
create table if not exists schema_migrations (
    version    varchar(64) primary key,
    applied_at timestamp   not null
);
insert into schema_migrations (version, applied_at) values
    ('0001_students_campus',          now()),
    ('0002_attempt_admin_fields',     now()),
    ('0003_question_response_fields', now()),
    ('0004_section_rubric_fields',    now()),
    ('0005_event_media_tables',       now()),
    ('0006_backfill_legacy_rows',     now()),
    ('0007_qr_key_unique_index',      now())
on conflict (version) do nothing;
