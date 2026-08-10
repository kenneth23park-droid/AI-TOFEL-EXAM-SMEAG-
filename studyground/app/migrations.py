"""Minimal migration runner — architecture.md 6.3, no Alembic (B4: no new deps).

Each step is a `(version, ops)` pair. `run_migrations()` applies every step whose
version is missing from `schema_migrations` and records it, so booting twice is a
no-op. Every op is *also* individually idempotent (column/table/index existence is
checked first), which means a database created by `Base.metadata.create_all()` —
already carrying the new shape — passes straight through and just gets stamped.

Dialect handling (SQLite has no `ADD COLUMN IF NOT EXISTS`, no `DROP CONSTRAINT`,
no `ADD CONSTRAINT`):

    | op          | sqlite                          | postgresql                  |
    |-------------|---------------------------------|-----------------------------|
    | add_column  | PRAGMA-checked ALTER            | ALTER ... IF NOT EXISTS     |
    | check       | skipped (models.py validators)  | DROP + ADD CONSTRAINT       |
    | index / sql | same statement                  | same statement              |

Deviation from the doc's sketch: steps are structured ops rather than raw
per-dialect SQL lists, because the SQLite branch needs the existence check the
doc itself calls for and duplicating whole statements per dialect invited drift.
Raw SQL is still available via the `sql` op when the two dialects truly differ.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, Engine

log = logging.getLogger("studyground.migrations")

# ── op constructors — each returns a plain tuple so STEPS stays readable ──


def add_column(table: str, column: str, ddl: str, *, pg_ddl: str | None = None) -> tuple:
    """ADD COLUMN <ddl>; skipped when the column already exists."""
    return ("add_column", table, column, ddl, pg_ddl or ddl)


def create_table(name: str, sqlite_ddl: str, pg_ddl: str) -> tuple:
    return ("create_table", name, sqlite_ddl, pg_ddl)


def sql(statement: str, *, pg: str | None = None, sqlite: str | None = None) -> tuple:
    """A statement that is portable as written, or differs only by dialect."""
    return ("sql", sqlite or statement, pg or statement)


def check(table: str, name: str, expression: str) -> tuple:
    """CHECK constraint — Postgres only; SQLite relies on models.py validators."""
    return ("check", table, name, expression)


# ── migration steps ──────────────────────────────────────────────────────────
# NOTE: append only. Never edit or reorder an applied version.

_TS = "TIMESTAMP WITH TIME ZONE"

STEPS: list[tuple[str, list[tuple]]] = [
    (
        "0001_students_campus",
        [add_column("students", "campus", "VARCHAR(64) NOT NULL DEFAULT ''")],
    ),
    (
        "0002_attempt_admin_fields",
        [
            add_column("attempts", "session", "VARCHAR(64)"),
            add_column("attempts", "campus", "VARCHAR(64) NOT NULL DEFAULT ''"),
            add_column("attempts", "exam_date", "DATE"),
            add_column("attempts", "submitted_count", "INTEGER NOT NULL DEFAULT 0"),
            add_column("attempts", "total_questions", "INTEGER NOT NULL DEFAULT 0"),
            add_column("attempts", "feedback_progress", "INTEGER NOT NULL DEFAULT 0"),
            add_column("attempts", "profile", "VARCHAR(16) NOT NULL DEFAULT 'toefl'"),
            add_column("attempts", "scale", "VARCHAR(16) NOT NULL DEFAULT 'toefl120'"),
            add_column("attempts", "band_score", "NUMERIC(2,1)"),
            add_column("attempts", "started_at", _TS),
            add_column("attempts", "submitted_at", _TS),
            add_column("attempts", "content_hash", "VARCHAR(32) NOT NULL DEFAULT ''"),
            sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_attempts_session "
                "ON attempts (session) WHERE session IS NOT NULL"
            ),
            sql("CREATE INDEX IF NOT EXISTS ix_attempts_exam_date ON attempts (exam_date)"),
            sql("CREATE INDEX IF NOT EXISTS ix_attempts_campus ON attempts (campus)"),
            # Status values are unified *before* the CHECK lands, or the constraint
            # would reject the rows already in the table (architecture.md 6.3 step 2).
            sql("UPDATE attempts SET status = 'completed' WHERE status = 'scored'"),
            sql("UPDATE attempts SET status = 'scoring' WHERE status IN ('pending', 'reviewing')"),
            sql(
                "UPDATE attempts SET status = 'completed' "
                "WHERE status NOT IN ('in_progress', 'scoring', 'completed')"
            ),
            check("attempts", "ck_attempts_status",
                  "status IN ('in_progress','scoring','completed')"),
        ],
    ),
    (
        "0003_question_response_fields",
        [
            add_column("question_responses", "question_key", "VARCHAR(32) NOT NULL DEFAULT ''"),
            add_column("question_responses", "qtype", "VARCHAR(24) NOT NULL DEFAULT 'MCQ'"),
            add_column("question_responses", "module", "VARCHAR(8) NOT NULL DEFAULT ''"),
            add_column("question_responses", "auto_score", "REAL", pg_ddl="DOUBLE PRECISION"),
            add_column("question_responses", "max_score", "REAL NOT NULL DEFAULT 1",
                       pg_ddl="DOUBLE PRECISION NOT NULL DEFAULT 1"),
            add_column("question_responses", "feedback", "TEXT NOT NULL DEFAULT ''"),
            add_column("question_responses", "audio_ref", "VARCHAR(255) NOT NULL DEFAULT ''"),
            add_column("question_responses", "graded_by", "VARCHAR(64) NOT NULL DEFAULT ''"),
            add_column("question_responses", "graded_at", _TS),
            check("question_responses", "ck_qr_qtype",
                  "qtype IN ('WORD_FILLING','MCQ','CLOZE','INSERT',"
                  "'BUILD_SENTENCE','WRITING','SPEAKING')"),
        ],
    ),
    (
        "0004_section_rubric_fields",
        [
            add_column("section_scores", "module", "VARCHAR(8) NOT NULL DEFAULT ''"),
            add_column("rubric_scores", "band", "NUMERIC(2,1)"),
        ],
    ),
    (
        "0005_event_media_tables",
        [
            create_table(
                "attempt_events",
                """
                CREATE TABLE attempt_events (
                  id          INTEGER PRIMARY KEY AUTOINCREMENT,
                  attempt_id  INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
                  ts          DATETIME NOT NULL,
                  type        VARCHAR(32) NOT NULL,
                  screen_id   VARCHAR(64) NOT NULL DEFAULT '',
                  detail      TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE TABLE attempt_events (
                  id          BIGSERIAL PRIMARY KEY,
                  attempt_id  INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
                  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
                  type        VARCHAR(32) NOT NULL,
                  screen_id   VARCHAR(64) NOT NULL DEFAULT '',
                  detail      TEXT NOT NULL DEFAULT ''
                )
                """,
            ),
            sql("CREATE INDEX IF NOT EXISTS ix_events_attempt ON attempt_events (attempt_id, ts)"),
            create_table(
                "media_assets",
                """
                CREATE TABLE media_assets (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  attempt_id   INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
                  question_key VARCHAR(32) NOT NULL,
                  kind         VARCHAR(16) NOT NULL DEFAULT 'audio',
                  storage      VARCHAR(16) NOT NULL DEFAULT 'file',
                  uri          VARCHAR(512) NOT NULL DEFAULT '',
                  inline_b64   TEXT,
                  mime         VARCHAR(64) NOT NULL DEFAULT 'audio/webm',
                  bytes        INTEGER NOT NULL DEFAULT 0,
                  duration_ms  INTEGER NOT NULL DEFAULT 0,
                  sha256       VARCHAR(64) NOT NULL DEFAULT '',
                  created_at   DATETIME NOT NULL,
                  CONSTRAINT uq_media_attempt_key_kind UNIQUE (attempt_id, question_key, kind)
                )
                """,
                """
                CREATE TABLE media_assets (
                  id           BIGSERIAL PRIMARY KEY,
                  attempt_id   INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
                  question_key VARCHAR(32) NOT NULL,
                  kind         VARCHAR(16) NOT NULL DEFAULT 'audio',
                  storage      VARCHAR(16) NOT NULL DEFAULT 'file',
                  uri          VARCHAR(512) NOT NULL DEFAULT '',
                  inline_b64   TEXT,
                  mime         VARCHAR(64) NOT NULL DEFAULT 'audio/webm',
                  bytes        INTEGER NOT NULL DEFAULT 0,
                  duration_ms  INTEGER NOT NULL DEFAULT 0,
                  sha256       VARCHAR(64) NOT NULL DEFAULT '',
                  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                  CONSTRAINT uq_media_attempt_key_kind UNIQUE (attempt_id, question_key, kind)
                )
                """,
            ),
            sql("CREATE INDEX IF NOT EXISTS ix_media_attempt ON media_assets (attempt_id)"),
        ],
    ),
    (
        # architecture.md 6.3 steps 3–6 — existing seed rows keep working because
        # every backfill is guarded by the "still at its default" predicate.
        "0006_backfill_legacy_rows",
        [
            sql("UPDATE attempts SET session = 'legacy-' || id WHERE session IS NULL"),
            sql(
                "UPDATE attempts SET exam_date = date(taken_at) WHERE exam_date IS NULL",
                pg="UPDATE attempts SET exam_date = CAST(taken_at AS DATE) "
                   "WHERE exam_date IS NULL",
            ),
            # Legacy keys read 'reading-1'; new sittings write 'R1-1'. The partial
            # unique index tolerates both because neither is empty.
            sql(
                "UPDATE question_responses SET question_key = skill || '-' || no "
                "WHERE question_key = ''"
            ),
            sql(
                "UPDATE attempts SET total_questions = "
                "(SELECT COUNT(*) FROM question_responses q WHERE q.attempt_id = attempts.id) "
                "WHERE total_questions = 0"
            ),
            sql(
                "UPDATE attempts SET submitted_count = "
                "(SELECT COUNT(*) FROM question_responses q WHERE q.attempt_id = attempts.id) "
                "WHERE submitted_count = 0"
            ),
            # A finished legacy attempt already has all of its feedback.
            sql(
                "UPDATE attempts SET feedback_progress = 100 "
                "WHERE feedback_progress = 0 AND status = 'completed'"
            ),
        ],
    ),
    (
        # The partial unique index is created *after* 0006 filled question_key —
        # before the backfill every legacy row is '' and the WHERE clause would
        # simply exclude them all. create_all() cannot add it either, because it
        # skips tables that already exist, so an upgraded DB only gets the guard
        # from here (schema.sql line "uq_qr_attempt_key" is the Postgres twin).
        "0007_qr_key_unique_index",
        [
            sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_attempt_key "
                "ON question_responses (attempt_id, question_key) WHERE question_key <> ''"
            )
        ],
    ),
    (
        # 상태를 셋으로 가르기 위한 두 컬럼(둘 다 가산형이다).
        #   rubric_scores.source     — 'teacher' 만 확정본. 완료 판정이 여기 걸린다.
        #   section_scores.provisional — 점수는 나왔지만 확정은 아니라는 표시.
        # 기존 행은 그대로 둔다: DEFAULT 가 채우는 값('ai_draft' / false)이 곧
        # "출처를 모르니 확정이 아니다"라는 사실이라, 백필 UPDATE 가 따로 필요 없다.
        # 로컬 SQLite 와 클라우드 Postgres 어느 쪽에 먼저 닿아도 결과가 같다.
        "0008_rubric_source_section_provisional",
        [
            add_column("rubric_scores", "source", "VARCHAR(16) NOT NULL DEFAULT 'ai_draft'"),
            add_column("section_scores", "provisional", "BOOLEAN NOT NULL DEFAULT 0",
                       pg_ddl="BOOLEAN NOT NULL DEFAULT false"),
            check("rubric_scores", "ck_rubric_source", "source IN ('ai_draft','teacher')"),
        ],
    ),
]


# ── runner ───────────────────────────────────────────────────────────────────


def _dialect(conn: Connection) -> str:
    return conn.dialect.name


def _table_names(conn: Connection) -> set[str]:
    return set(inspect(conn).get_table_names())


def _column_names(conn: Connection, table: str) -> set[str]:
    # SQLAlchemy's inspector wraps PRAGMA table_info on SQLite and the catalog on PG.
    return {c["name"] for c in inspect(conn).get_columns(table)}


def _has_constraint(conn: Connection, table: str, name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
            "WHERE t.relname = :table AND c.conname = :name"
        ),
        {"table": table, "name": name},
    ).first()
    return row is not None


def _apply_op(conn: Connection, op: tuple[Any, ...]) -> None:
    kind = op[0]
    dialect = _dialect(conn)

    if kind == "add_column":
        _, table, column, sqlite_ddl, pg_ddl = op
        if table not in _table_names(conn):
            return                                  # table arrives via create_all()
        if column in _column_names(conn, table):
            return                                  # already present — nothing to do
        ddl = pg_ddl if dialect == "postgresql" else sqlite_ddl
        conn.execute(text("ALTER TABLE " + table + " ADD COLUMN " + column + " " + ddl))
        return

    if kind == "create_table":
        _, name, sqlite_ddl, pg_ddl = op
        if name in _table_names(conn):
            return
        conn.execute(text(pg_ddl if dialect == "postgresql" else sqlite_ddl))
        return

    if kind == "check":
        _, table, name, expression = op
        if dialect != "postgresql":
            return                                  # enforced by models.py validators
        if table not in _table_names(conn):
            return
        if _has_constraint(conn, table, name):
            conn.execute(text("ALTER TABLE " + table + " DROP CONSTRAINT " + name))
        conn.execute(
            text("ALTER TABLE " + table + " ADD CONSTRAINT " + name + " CHECK (" + expression + ")")
        )
        return

    if kind == "sql":
        _, sqlite_stmt, pg_stmt = op
        conn.execute(text(pg_stmt if dialect == "postgresql" else sqlite_stmt))
        return

    raise ValueError("Unknown migration op: " + str(kind))


def _ensure_ledger(conn: Connection) -> None:
    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "  version    VARCHAR(64) PRIMARY KEY,"
            "  applied_at TIMESTAMP NOT NULL"
            ")"
        )
    )


def applied_versions(engine: Engine | None = None) -> set[str]:
    """Versions already recorded in `schema_migrations`."""
    engine = engine or _default_engine()
    with engine.begin() as conn:
        _ensure_ledger(conn)
        return {row[0] for row in conn.execute(text("SELECT version FROM schema_migrations"))}


def _default_engine() -> Engine:
    # Imported lazily: app.db imports models, and models must not import app.db.
    from app.db import engine as default_engine

    return default_engine


def run_migrations(engine: Engine | None = None) -> list[str]:
    """Apply every pending step. Returns the versions applied by this call."""
    engine = engine or _default_engine()
    done: list[str] = []

    with engine.begin() as conn:
        _ensure_ledger(conn)
        already = {row[0] for row in conn.execute(text("SELECT version FROM schema_migrations"))}

    for version, ops in STEPS:
        if version in already:
            continue
        # One transaction per step, so a failure leaves earlier steps recorded.
        with engine.begin() as conn:
            for op in ops:
                _apply_op(conn, op)
            conn.execute(
                text("INSERT INTO schema_migrations (version, applied_at) "
                     "VALUES (:v, CURRENT_TIMESTAMP)"),
                {"v": version},
            )
        done.append(version)

    if done:
        log.info("migrations applied: %s", ", ".join(done))
    return done


__all__ = ["STEPS", "applied_versions", "run_migrations"]
