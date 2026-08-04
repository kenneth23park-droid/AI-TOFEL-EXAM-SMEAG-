"""SQLAlchemy data model — designed from the ground up, identical on SQLite and Postgres.

    students ──< attempts >── exams
                    │
                    ├──< section_scores        R·L·S·W scaled score (/30)
                    ├──< question_responses    per-question right/wrong (R·L)
                    ├──< rubric_scores         rubric criteria (S·W)
                    └──< ai_feedback           per-skill + overall AI feedback

Only portable column types are used (Integer / String / Text / Float / Boolean /
DateTime / JSON) so the same models back both engines without a dialect branch.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

SKILLS = ("reading", "listening", "speaking", "writing")
SECTION_MAX = 30                    # each skill is scaled to /30
TOTAL_MAX = SECTION_MAX * len(SKILLS)   # → /120

# Receptive skills are auto-scored per question; productive skills use rubrics.
RECEPTIVE = ("reading", "listening")
PRODUCTIVE = ("speaking", "writing")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # 학번
    name: Mapped[str] = mapped_column(String(120))
    klass: Mapped[str] = mapped_column(String(64), default="")                    # 반
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    total_score: Mapped[int] = mapped_column(Integer, default=0)      # /120
    grade: Mapped[str] = mapped_column(String(16), default="")        # CEFR (A2…C1)
    status: Mapped[str] = mapped_column(String(24), default="scored")  # scored | pending | reviewing

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


class SectionScore(Base):
    __tablename__ = "section_scores"
    __table_args__ = (UniqueConstraint("attempt_id", "skill", name="uq_section_attempt_skill"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(16))            # reading | listening | speaking | writing
    raw_correct: Mapped[float] = mapped_column(Float, default=0)
    raw_total: Mapped[float] = mapped_column(Float, default=0)
    scaled: Mapped[int] = mapped_column(Integer, default=0)   # /30

    attempt: Mapped[Attempt] = relationship(back_populates="section_scores")

    @property
    def percent(self) -> int:
        return round(self.scaled / SECTION_MAX * 100) if SECTION_MAX else 0


class QuestionResponse(Base):
    """Per-question review row for Reading/Listening — my answer vs. the key."""

    __tablename__ = "question_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(16), index=True)
    no: Mapped[int] = mapped_column(Integer)
    prompt: Mapped[str] = mapped_column(Text, default="")
    student_answer: Mapped[str] = mapped_column(Text, default="")
    correct_answer: Mapped[str] = mapped_column(Text, default="")
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)

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


# ── CEFR banding — total /120 → grade shown on the list and the report ──
_CEFR_BANDS = ((102, "C1"), (90, "B2+"), (78, "B2"), (66, "B1+"), (54, "B1"), (36, "A2"), (0, "A1"))


def cefr_for(total: int) -> str:
    for floor, label in _CEFR_BANDS:
        if total >= floor:
            return label
    return "A1"
