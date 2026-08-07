"""SQLAlchemy data model — designed from the ground up, identical on SQLite and Postgres.

    students ──< attempts >── exams
                    │
                    ├──< section_scores        R·L·S·W scaled score (/30)
                    ├──< question_responses    per-question right/wrong (R·L)
                    ├──< rubric_scores         rubric criteria (S·W)
                    ├──< ai_feedback           per-skill + overall AI feedback
                    ├──< attempt_events        runtime event log (timer / reload / submit)
                    └──< media_assets          Speaking recording metadata

Only portable column types are used (Integer / String / Text / Float / Boolean /
DateTime / Date / Numeric / JSON) so the same models back both engines without a
dialect branch. `Numeric(2, 1, asdecimal=False)` keeps the NUMERIC(2,1) DDL that
schema.sql declares while still handing plain floats back on SQLite.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, validates
from sqlalchemy.types import JSON

SKILLS = ("reading", "listening", "speaking", "writing")
SECTION_MAX = 30                    # each skill is scaled to /30
TOTAL_MAX = SECTION_MAX * len(SKILLS)   # → /120

# Receptive skills are auto-scored per question; productive skills use rubrics.
RECEPTIVE = ("reading", "listening")
PRODUCTIVE = ("speaking", "writing")

# architecture.md 6.2.2 — the unified attempt status set. Postgres gets a CHECK
# constraint from migrations.py; SQLite cannot, so the validators below enforce it.
ATTEMPT_STATUSES = ("in_progress", "scoring", "completed")

# Legacy statuses ('scored' | 'pending' | 'reviewing') map onto the unified set.
LEGACY_STATUS_MAP = {"scored": "completed", "pending": "scoring", "reviewing": "scoring"}

# architecture.md 6.2.3 — the screen compiler's question kinds.
QTYPES = ("WORD_FILLING", "MCQ", "CLOZE", "INSERT", "BUILD_SENTENCE", "WRITING", "SPEAKING")

PROFILES = ("toefl", "ielts")
SCALES = ("toefl120", "ielts9")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_status(value: str | None) -> str:
    """Legacy or unified status in, unified status out (unknown → 'completed')."""
    raw = (value or "").strip()
    if raw in ATTEMPT_STATUSES:
        return raw
    return LEGACY_STATUS_MAP.get(raw, "completed")


class Base(DeclarativeBase):
    pass


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # 학번
    name: Mapped[str] = mapped_column(String(120))
    klass: Mapped[str] = mapped_column(String(64), default="")                    # 반
    campus: Mapped[str] = mapped_column(String(64), default="")                   # 캠퍼스 (OQ-13)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempts: Mapped[list["Attempt"]] = relationship(
        back_populates="student", cascade="all, delete-orphan", order_by="Attempt.taken_at.desc()"
    )


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)   # SET 9 / SET 8 / SET 7
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempts: Mapped[list["Attempt"]] = relationship(back_populates="exam")


class Attempt(Base):
    """One sitting: total score, CEFR grade, and workflow status."""

    __tablename__ = "attempts"
    __table_args__ = (
        # Partial unique index — legacy rows are backfilled to 'legacy-<id>', but a
        # NULL session must never collide. SQLite ≥3.8 supports the same WHERE form.
        Index(
            "uq_attempts_session", "session", unique=True,
            sqlite_where=text("session IS NOT NULL"),
            postgresql_where=text("session IS NOT NULL"),
        ),
        Index("ix_attempts_exam_date", "exam_date"),
        Index("ix_attempts_campus", "campus"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    total_score: Mapped[int] = mapped_column(Integer, default=0)      # /120
    grade: Mapped[str] = mapped_column(String(16), default="")        # CEFR (A2…C1)
    # in_progress | scoring | completed — see ATTEMPT_STATUSES.
    status: Mapped[str] = mapped_column(String(24), default="in_progress")

    # ── admin list columns (architecture.md 6.2.2) ──
    session: Mapped[str | None] = mapped_column(String(64), nullable=True)
    campus: Mapped[str] = mapped_column(String(64), default="")
    exam_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    submitted_count: Mapped[int] = mapped_column(Integer, default=0)
    total_questions: Mapped[int] = mapped_column(Integer, default=0)
    feedback_progress: Mapped[int] = mapped_column(Integer, default=0)     # 0..100
    profile: Mapped[str] = mapped_column(String(16), default="toefl")      # toefl | ielts
    scale: Mapped[str] = mapped_column(String(16), default="toefl120")     # toefl120 | ielts9
    # IELTS overall band 0.0..9.0; NULL on the TOEFL scale.
    band_score: Mapped[float | None] = mapped_column(Numeric(2, 1, asdecimal=False), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(32), default="")

    @validates("status")
    def _validate_status(self, _key: str, value: str) -> str:
        """SQLite has no CHECK here — normalize legacy values instead of failing."""
        return normalize_status(value)

    student: Mapped[Student] = relationship(back_populates="attempts")
    exam: Mapped[Exam] = relationship(back_populates="attempts")
    section_scores: Mapped[list["SectionScore"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )
    question_responses: Mapped[list["QuestionResponse"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan", order_by="QuestionResponse.no"
    )
    rubric_scores: Mapped[list["RubricScore"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )
    ai_feedback: Mapped[list["AiFeedback"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )
    events: Mapped[list["AttemptEvent"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan", order_by="AttemptEvent.ts"
    )
    media_assets: Mapped[list["MediaAsset"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )


class SectionScore(Base):
    __tablename__ = "section_scores"
    __table_args__ = (UniqueConstraint("attempt_id", "skill", name="uq_section_attempt_skill"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(16))            # reading | listening | speaking | writing
    raw_correct: Mapped[float] = mapped_column(Float, default=0)
    raw_total: Mapped[float] = mapped_column(Float, default=0)
    scaled: Mapped[int] = mapped_column(Integer, default=0)   # /30
    module: Mapped[str] = mapped_column(String(8), default="")  # 'R1'/'L2'… blank = whole skill

    attempt: Mapped[Attempt] = relationship(back_populates="section_scores")

    @property
    def percent(self) -> int:
        return round(self.scaled / SECTION_MAX * 100) if SECTION_MAX else 0


class QuestionResponse(Base):
    """Per-question review row for Reading/Listening — my answer vs. the key."""

    __tablename__ = "question_responses"
    __table_args__ = (
        # Legacy rows carry 'reading-1' style keys, new sittings carry 'R1-1'; the
        # WHERE clause lets the two coexist and still blocks duplicate submissions.
        Index(
            "uq_qr_attempt_key", "attempt_id", "question_key", unique=True,
            sqlite_where=text("question_key <> ''"),
            postgresql_where=text("question_key <> ''"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(16), index=True)
    no: Mapped[int] = mapped_column(Integer)
    prompt: Mapped[str] = mapped_column(Text, default="")
    student_answer: Mapped[str] = mapped_column(Text, default="")
    correct_answer: Mapped[str] = mapped_column(Text, default="")
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── runtime / grading columns (architecture.md 6.2.3) ──
    question_key: Mapped[str] = mapped_column(String(32), default="")   # 'R1-20', 'S-8'
    qtype: Mapped[str] = mapped_column(String(24), default="MCQ")       # see QTYPES
    module: Mapped[str] = mapped_column(String(8), default="")          # 'R1','L2','W1','S2'
    auto_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # NULL = needs a human
    max_score: Mapped[float] = mapped_column(Float, default=1)
    feedback: Mapped[str] = mapped_column(Text, default="")
    audio_ref: Mapped[str] = mapped_column(String(255), default="")     # media_assets.uri mirror
    graded_by: Mapped[str] = mapped_column(String(64), default="")
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @validates("qtype")
    def _validate_qtype(self, _key: str, value: str) -> str:
        """SQLite has no CHECK here — unknown kinds fall back to 'MCQ' rather than raise."""
        raw = (value or "").strip().upper()
        return raw if raw in QTYPES else "MCQ"

    attempt: Mapped[Attempt] = relationship(back_populates="question_responses")


class RubricScore(Base):
    """Rubric criterion for Speaking/Writing (0–5 per criterion)."""

    __tablename__ = "rubric_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(16), index=True)
    criterion: Mapped[str] = mapped_column(String(64))
    score: Mapped[float] = mapped_column(Float, default=0)
    max_score: Mapped[float] = mapped_column(Float, default=5)
    comment: Mapped[str] = mapped_column(Text, default="")
    # IELTS band for this criterion in 0.5 steps; NULL on the TOEFL rubric.
    band: Mapped[float | None] = mapped_column(Numeric(2, 1, asdecimal=False), nullable=True)

    attempt: Mapped[Attempt] = relationship(back_populates="rubric_scores")


class AiFeedback(Base):
    """Feedback produced by the LangGraph pipeline — one row per scope."""

    __tablename__ = "ai_feedback"
    __table_args__ = (
        UniqueConstraint("attempt_id", "scope", "lang", name="uq_feedback_attempt_scope_lang"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(16))            # 'overall' or a skill name
    lang: Mapped[str] = mapped_column(String(8), default="en")
    mode: Mapped[str] = mapped_column(String(16), default="offline")  # offline (rules) | online (LLM)
    summary: Mapped[str] = mapped_column(Text, default="")
    strengths: Mapped[list] = mapped_column(JSON, default=list)
    improvements: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    attempt: Mapped[Attempt] = relationship(back_populates="ai_feedback")


class AttemptEvent(Base):
    """Runtime event log — why a sitting ended the way it did (architecture.md 6.2.5)."""

    __tablename__ = "attempt_events"
    __table_args__ = (Index("ix_events_attempt", "attempt_id", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # screen_enter | timer_expire | reload | clock_skew | record_start | record_stop | submit
    type: Mapped[str] = mapped_column(String(32))
    screen_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[str] = mapped_column(Text, default="")   # JSON string, kept opaque here

    attempt: Mapped[Attempt] = relationship(back_populates="events")


class MediaAsset(Base):
    """Speaking recording metadata. The bytes live wherever `storage` says."""

    __tablename__ = "media_assets"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_key", "kind", name="uq_media_attempt_key_kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    question_key: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16), default="audio")
    storage: Mapped[str] = mapped_column(String(16), default="file")   # file | inline | object
    uri: Mapped[str] = mapped_column(String(512), default="")          # path or URL
    inline_b64: Mapped[str | None] = mapped_column(Text, nullable=True)  # storage='inline' only
    mime: Mapped[str] = mapped_column(String(64), default="audio/webm")
    bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")        # dedupe + integrity
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    attempt: Mapped[Attempt] = relationship(back_populates="media_assets")


# ── CEFR banding — total /120 → grade shown on the list and the report ──
_CEFR_BANDS = ((102, "C1"), (90, "B2+"), (78, "B2"), (66, "B1+"), (54, "B1"), (36, "A2"), (0, "A1"))


def cefr_for(total: int) -> str:
    for floor, label in _CEFR_BANDS:
        if total >= floor:
            return label
    return "A1"
