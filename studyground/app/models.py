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

# 루브릭 행의 출처. 'teacher' 만 **확정본**이고 나머지는 전부 잠정 초안이다 —
# 완료(status='completed') 판정이 이 값 하나에 걸린다(crud_write.grade_attempt).
# 값의 정본은 app/scoring/rubric.py 의 DRAFT_SOURCE 인데, 그 모듈은 scale.py 를 거쳐
# 이 파일을 import 한다(rubric → scale → models). 여기서 되끌어오면 순환이므로
# 문자열을 한 번 더 적는다. 두 값이 어긋나면 tests/test_rubric_source.py 가 잡는다.
RUBRIC_SOURCE_DRAFT = "ai_draft"
RUBRIC_SOURCE_TEACHER = "teacher"
RUBRIC_SOURCES = (RUBRIC_SOURCE_DRAFT, RUBRIC_SOURCE_TEACHER)

# 교사 확정으로 읽어야 하는 별칭들. nodes._apply_teacher_rubrics 는 교사 행에
# source='manual' 을 붙인다 — 그 값이 DB 로 흘러들어도 초안으로 강등되면 안 된다.
_TEACHER_ALIASES = frozenset({RUBRIC_SOURCE_TEACHER, "manual", "human"})


def normalize_rubric_source(value: str | None) -> str:
    """알 수 없는 값은 초안으로 본다 — 확정은 명시적으로만 얻는다."""
    raw = (value or "").strip().lower()
    return RUBRIC_SOURCE_TEACHER if raw in _TEACHER_ALIASES else RUBRIC_SOURCE_DRAFT


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
    # 잠정 점수인가 — 산출형(에세이·스피킹)이 아직 교사 확정 루브릭을 못 받은 섹션은
    # 점수가 나와도 확정이 아니다. 화면이 "잠정"을 표시할 수 있게 데이터에 남긴다.
    provisional: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )

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
    # 어느 문항의 행인가. 스킬 단위로 합쳐 채점하는 과제(에세이·인터뷰)는 ''.
    # Listen and Repeat 은 문항마다 원문이 달라 문항 단위로 채점하므로, 이 컬럼이
    # 없으면 7문항이 (attempt, skill, criterion) 한 자리를 두고 서로 덮어쓴다.
    question_key: Mapped[str] = mapped_column(
        String(64), default="", server_default=text("''"), nullable=False
    )
    criterion: Mapped[str] = mapped_column(String(64))
    score: Mapped[float] = mapped_column(Float, default=0)
    max_score: Mapped[float] = mapped_column(Float, default=5)
    comment: Mapped[str] = mapped_column(Text, default="")
    # IELTS band for this criterion in 0.5 steps; NULL on the TOEFL rubric.
    band: Mapped[float | None] = mapped_column(Numeric(2, 1, asdecimal=False), nullable=True)
    # ai_draft | teacher — 가산형 컬럼(server_default). 이미 있던 행은 마이그레이션이
    # 'ai_draft' 로 채운다: 출처를 모르는 행을 확정본으로 승격시키지 않기 위해서다.
    source: Mapped[str] = mapped_column(
        String(16),
        default=RUBRIC_SOURCE_DRAFT,
        server_default=text("'" + RUBRIC_SOURCE_DRAFT + "'"),
        nullable=False,
    )

    @validates("source")
    def _validate_source(self, _key: str, value: str) -> str:
        """SQLite 에는 CHECK 이 없다 — 모르는 값은 초안으로 눌러 둔다."""
        return normalize_rubric_source(value)

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


class LlmUsage(Base):
    """LLM 호출 원장 — 한 번의 API 호출이 한 행이다.

    **집계 단위는 호출이지 응시가 아니다.** 리포트를 다시 열 때마다 채점 그래프가
    한 번 더 돌기 때문에, 한 응시에 여러 행이 붙는 것이 정상이다. 그 사실 자체가
    "재조회가 돈을 쓴다"는 관측값이라 원장에 남긴다 — attempt_id 는 추적용 참고
    컬럼이고, 금액 집계는 언제나 행 단위로 한다.

    attempt_id 가 nullable + ON DELETE SET NULL 인 것도 같은 이유다. 응시 기록을
    지운다고 이미 지출한 돈이 사라지지는 않는다. 학생 데이터가 삭제돼도 회계는
    남아야 하므로 CASCADE 를 쓰지 않는다(이 저장소에서 유일한 예외다).

    cost_micros 는 마이크로달러 정수이며 **NULL 이 될 수 있다** — 단가를 모르는
    모델/프로바이더라는 뜻이고, 0 원이라는 뜻이 아니다(app/scoring/pricing.py).
    price_version 을 함께 박아 두어, 나중에 단가표를 고쳐도 과거 행이 소급
    변조되지 않는다.
    """

    __tablename__ = "llm_usage"
    __table_args__ = (Index("ix_llm_usage_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 회계 기록이므로 응시가 지워져도 살아남는다 — CASCADE 가 아니라 SET NULL.
    attempt_id: Mapped[int | None] = mapped_column(
        ForeignKey("attempts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # feedback (리포트 서술) | rubric (산출형 채점) | 그 외 호출 지점 이름
    scope: Mapped[str] = mapped_column(String(32), default="")
    provider: Mapped[str] = mapped_column(String(16), default="")   # anthropic | openai
    model: Mapped[str] = mapped_column(String(64), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # 마이크로달러(1/1,000,000 USD). NULL = 단가 미등록, 0 = 실제로 0원.
    cost_micros: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_version: Mapped[str] = mapped_column(String(32), default="")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    # 실패했거나 폴백으로 넘어간 이유. 성공 호출은 빈 문자열.
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── CEFR banding — total /120 → grade shown on the list and the report ──
_CEFR_BANDS = ((102, "C1"), (90, "B2+"), (78, "B2"), (66, "B1+"), (54, "B1"), (36, "A2"), (0, "A1"))


def cefr_for(total: int) -> str:
    for floor, label in _CEFR_BANDS:
        if total >= floor:
            return label
    return "A1"
