-- StudyGround — Postgres / Supabase schema.
-- Mirrors app/models.py exactly. SQLAlchemy's create_all() produces the same
-- shape on SQLite; this file is the contract Stream A and Stream C code against
-- and what you run once against a fresh Supabase project.

create table if not exists students (
    id          serial primary key,
    student_no  varchar(32)  not null unique,     -- 학번
    name        varchar(120) not null,
    klass       varchar(64)  not null default '', -- 반
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
    id           serial primary key,
    student_id   integer     not null references students (id) on delete cascade,
    exam_id      integer     not null references exams (id),
    taken_at     timestamp   not null default now(),
    total_score  integer     not null default 0,  -- /120
    grade        varchar(16) not null default '', -- CEFR
    status       varchar(24) not null default 'scored'  -- scored | pending | reviewing
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
    is_correct      boolean     not null default false
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
    comment     text        not null default ''
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
