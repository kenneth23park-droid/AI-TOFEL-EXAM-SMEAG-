"""Data layer — every query the routers and the scoring graph need."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AiFeedback,
    Attempt,
    Exam,
    QuestionResponse,
    RubricScore,
    SectionScore,
    Student,
    cefr_for,
)
from app.schemas import AttemptDetail, AttemptSummary, FeedbackBundle

_DETAIL_LOADS = (
    selectinload(Attempt.student),
    selectinload(Attempt.exam),
    selectinload(Attempt.section_scores),
    selectinload(Attempt.question_responses),
    selectinload(Attempt.rubric_scores),
    selectinload(Attempt.ai_feedback),
)


def list_students(db: Session) -> list[Student]:
    return list(db.scalars(select(Student).order_by(Student.student_no)))


def list_exams(db: Session) -> list[Exam]:
    return list(db.scalars(select(Exam).order_by(Exam.code.desc())))


def count_rows(db: Session) -> tuple[int, int]:
    students = db.scalar(select(func.count()).select_from(Student)) or 0
    attempts = db.scalar(select(func.count()).select_from(Attempt)) or 0
    return students, attempts


def list_attempts(
    db: Session,
    *,
    student_id: int | None = None,
    exam_id: int | None = None,
    limit: int = 200,
) -> list[Attempt]:
    stmt = (
        select(Attempt)
        .options(selectinload(Attempt.student), selectinload(Attempt.exam),
                 selectinload(Attempt.section_scores))
        .order_by(Attempt.taken_at.desc(), Attempt.id.desc())
        .limit(limit)
    )
    if student_id:
        stmt = stmt.where(Attempt.student_id == student_id)
    if exam_id:
        stmt = stmt.where(Attempt.exam_id == exam_id)
    return list(db.scalars(stmt))


def get_attempt(db: Session, attempt_id: int) -> Attempt | None:
    return db.scalar(select(Attempt).options(*_DETAIL_LOADS).where(Attempt.id == attempt_id))


def to_summary(attempt: Attempt) -> AttemptSummary:
    return AttemptSummary(
        id=attempt.id,
        student=attempt.student,
        exam=attempt.exam,
        taken_at=attempt.taken_at,
        total_score=attempt.total_score,
        grade=attempt.grade,
        status=attempt.status,
        sections={s.skill: s.scaled for s in attempt.section_scores},
    )


def to_detail(attempt: Attempt, *, lang: str = "en") -> AttemptDetail:
    feedback = [f for f in attempt.ai_feedback if f.lang == lang]
    if not feedback:  # a language we haven't generated yet — show what we have
        feedback = list(attempt.ai_feedback)
    return AttemptDetail(
        **to_summary(attempt).model_dump(),
        section_scores=sorted(attempt.section_scores, key=lambda s: _SKILL_ORDER.get(s.skill, 9)),
        question_responses=sorted(
            attempt.question_responses, key=lambda q: (_SKILL_ORDER.get(q.skill, 9), q.no)
        ),
        rubric_scores=sorted(attempt.rubric_scores, key=lambda r: (_SKILL_ORDER.get(r.skill, 9), r.criterion)),
        feedback=feedback,
    )


_SKILL_ORDER = {"reading": 0, "listening": 1, "speaking": 2, "writing": 3}


def recalc_totals(db: Session, attempt: Attempt) -> Attempt:
    """Total is the sum of the scaled section scores; the grade follows from it."""
    attempt.total_score = sum(s.scaled for s in attempt.section_scores)
    attempt.grade = cefr_for(attempt.total_score)
    db.add(attempt)
    return attempt


def save_feedback(db: Session, attempt: Attempt, bundle: FeedbackBundle) -> list[AiFeedback]:
    """Replace this attempt's feedback for the bundle's language (re-score is idempotent)."""
    for old in [f for f in attempt.ai_feedback if f.lang == bundle.lang]:
        db.delete(old)
    db.flush()

    rows = [
        AiFeedback(
            attempt_id=attempt.id,
            scope=item.scope,
            lang=bundle.lang,
            mode=bundle.mode,
            summary=item.summary,
            strengths=list(item.strengths),
            improvements=list(item.improvements),
        )
        for item in bundle.items
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


__all__ = [
    "AiFeedback",
    "Attempt",
    "Exam",
    "QuestionResponse",
    "RubricScore",
    "SectionScore",
    "Student",
    "count_rows",
    "get_attempt",
    "list_attempts",
    "list_exams",
    "list_students",
    "recalc_totals",
    "save_feedback",
    "to_detail",
    "to_summary",
]
