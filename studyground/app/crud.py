"""Data layer — every query the routers and the scoring graph need."""

from __future__ import annotations

from datetime import date, datetime
from datetime import time as dtime

from sqlalchemy import String, case, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AiFeedback,
    Attempt,
    Exam,
    LlmUsage,
    MediaAsset,
    QuestionResponse,
    RubricScore,
    SectionScore,
    Student,
    cefr_for,
    utcnow,
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
        session=attempt.session,
        campus=attempt.campus,
        exam_date=attempt.exam_date,
        submitted_count=attempt.submitted_count,
        total_questions=attempt.total_questions,
        feedback_progress=attempt.feedback_progress,
        profile=attempt.profile,
        scale=attempt.scale,
        band_score=attempt.band_score,
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


# ─────────────────────────────────────────────────────────────────────────────
# Admin grading back office — Epic 4 (architecture.md 7.2).
# Read-only helpers plus the two feedback writes; every aggregate is a SQL
# GROUP BY so a class-sized result set never lands in Python (Story 4.6 AC7).
# ─────────────────────────────────────────────────────────────────────────────

# architecture.md 7.2 — the feedback_progress denominator is exactly the set of
# responses a teacher must comment on, i.e. the productive question kinds.
FEEDBACK_QTYPES = ("WRITING", "SPEAKING")

# Story 4.6 AC5 — must match models._CEFR_BANDS, highest band first.
CEFR_BANDS = ("C1", "B2+", "B2", "B1+", "B1", "A2", "A1")

ADMIN_PAGE_SIZE = 50


def _like(value: str) -> str:
    """Case-insensitive contains — lower() on both sides works on SQLite and PG."""
    return "%" + value.strip().lower() + "%"


def _attempt_filters(
    *,
    session: str | None = None,
    student: str | None = None,
    campus: str | None = None,
    exam_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    statuses: tuple[str, ...] | None = None,
    grade: str | None = None,
) -> list:
    """AND-combined admin search predicates; blank inputs are dropped (4.2 AC5)."""
    conds: list = []
    if session and session.strip():
        conds.append(func.lower(Attempt.session).like(_like(session)))
    if student and student.strip():
        # Story 4.2 AC6 — name OR student_no, both partial and case-insensitive.
        conds.append(
            func.lower(Student.name).like(_like(student))
            | func.lower(Student.student_no).like(_like(student))
        )
    if campus and campus.strip():
        conds.append(func.lower(Attempt.campus).like(_like(campus)))
    if exam_id:
        conds.append(Attempt.exam_id == exam_id)
    if date_from:
        conds.append(Attempt.exam_date >= date_from)
    if date_to:
        conds.append(Attempt.exam_date <= date_to)
    if statuses:
        conds.append(Attempt.status.in_(statuses))
    if grade and grade.strip():
        conds.append(Attempt.grade == grade.strip())
    return conds


def search_attempts(
    db: Session,
    *,
    session: str | None = None,
    student: str | None = None,
    campus: str | None = None,
    exam_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    statuses: tuple[str, ...] | None = None,
    offset: int = 0,
    limit: int = ADMIN_PAGE_SIZE,
) -> tuple[int, list[Attempt]]:
    """(total, page) for the 3-Subject Answer Management list — newest exam_date first."""
    conds = _attempt_filters(
        session=session, student=student, campus=campus, exam_id=exam_id,
        date_from=date_from, date_to=date_to, statuses=statuses,
    )
    total = db.scalar(
        select(func.count()).select_from(Attempt).join(Student, Attempt.student_id == Student.id).where(*conds)
    ) or 0
    stmt = (
        select(Attempt)
        .join(Student, Attempt.student_id == Student.id)
        .options(selectinload(Attempt.student), selectinload(Attempt.exam))
        .where(*conds)
        .order_by(Attempt.exam_date.desc(), Attempt.taken_at.desc(), Attempt.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return total, list(db.scalars(stmt))


def attempt_responses(db: Session, attempt_id: int, *, skills: tuple[str, ...] | None = None) -> list[QuestionResponse]:
    """Per-question rows for one sitting, ordered the way the tabs render them."""
    stmt = select(QuestionResponse).where(QuestionResponse.attempt_id == attempt_id)
    if skills:
        stmt = stmt.where(QuestionResponse.skill.in_(skills))
    rows = list(db.scalars(stmt))
    rows.sort(key=lambda q: (_SKILL_ORDER.get(q.skill, 9), q.no))
    return rows


def media_by_question_key(db: Session, attempt_id: int) -> dict[str, MediaAsset]:
    """question_key → recording, so a Speaking card can find its audio in O(1)."""
    rows = db.scalars(select(MediaAsset).where(MediaAsset.attempt_id == attempt_id))
    return {row.question_key: row for row in rows}


def get_media_asset(db: Session, asset_id: int) -> MediaAsset | None:
    return db.scalar(select(MediaAsset).where(MediaAsset.id == asset_id))


def speaking_attempts(db: Session, *, limit: int = ADMIN_PAGE_SIZE) -> list[Attempt]:
    """Sittings that actually carry Speaking responses — the SPEAKING ANSWERS index."""
    keys = select(QuestionResponse.attempt_id).where(QuestionResponse.skill == "speaking")
    stmt = (
        select(Attempt)
        .options(selectinload(Attempt.student), selectinload(Attempt.exam))
        .where(Attempt.id.in_(keys))
        .order_by(Attempt.exam_date.desc(), Attempt.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt))


def feedback_progress_for(db: Session, attempt_id: int) -> int:
    """architecture.md 7.2 — productive responses commented / productive responses."""
    total = db.scalar(
        select(func.count()).select_from(QuestionResponse).where(
            QuestionResponse.attempt_id == attempt_id,
            QuestionResponse.qtype.in_(FEEDBACK_QTYPES),
        )
    ) or 0
    if not total:
        return 100                      # nothing needs a human — the sitting is done
    done = db.scalar(
        select(func.count()).select_from(QuestionResponse).where(
            QuestionResponse.attempt_id == attempt_id,
            QuestionResponse.qtype.in_(FEEDBACK_QTYPES),
            QuestionResponse.feedback != "",
        )
    ) or 0
    return round(done / total * 100)


def save_question_feedback(
    db: Session,
    response_id: int,
    *,
    feedback: str,
    score: float | None = None,
    graded_by: str = "teacher",
) -> tuple[QuestionResponse, Attempt] | None:
    """Store one card's feedback and re-derive the attempt's progress (Story 4.5).

    An empty string is a deletion, which is why the progress recalculation runs on
    every save and not only when text was added (AC7). A teacher-supplied `score`
    lands in `auto_score` — it is the only per-response score column, and `graded_by`
    is what tells the two apart afterwards.
    """
    row = db.get(QuestionResponse, response_id)
    if row is None:
        return None
    if score is not None:
        if score < 0 or score > row.max_score:
            raise ValueError("Score must be between 0 and " + str(row.max_score) + ".")
        row.auto_score = score
    row.feedback = feedback
    row.graded_by = graded_by
    row.graded_at = utcnow()
    db.add(row)
    db.flush()

    attempt = db.get(Attempt, row.attempt_id)
    if attempt is not None:
        attempt.feedback_progress = feedback_progress_for(db, attempt.id)
        db.add(attempt)
    db.commit()
    db.refresh(row)
    return row, attempt


def exam_statistics(db: Session, **filters) -> dict:
    """Summary card values + per-skill averages + CEFR distribution, all GROUP BY."""
    conds = _attempt_filters(**filters)
    joined = select(Attempt).join(Student, Attempt.student_id == Student.id).where(*conds).subquery()

    row = db.execute(
        select(
            func.count(joined.c.id),
            func.avg(joined.c.total_score),
            func.max(joined.c.total_score),
            func.min(joined.c.total_score),
        )
    ).first()
    count = int(row[0] or 0)

    skills = {
        skill: round(float(avg or 0), 1)
        for skill, avg in db.execute(
            select(SectionScore.skill, func.avg(SectionScore.scaled))
            .where(SectionScore.attempt_id.in_(select(joined.c.id)))
            .group_by(SectionScore.skill)
        )
    }
    counted = {
        grade: n
        for grade, n in db.execute(
            select(joined.c.grade, func.count()).group_by(joined.c.grade)
        )
    }
    return {
        "count": count,
        "avg_total": round(float(row[1] or 0), 1),
        "max_total": int(row[2] or 0),
        "min_total": int(row[3] or 0),
        "avg_by_skill": skills,
        "distribution": [
            {"band": band, "n": counted.get(band, 0),
             "pct": round(counted.get(band, 0) / count * 100) if count else 0}
            for band in CEFR_BANDS
        ],
    }


def question_accuracy(db: Session, *, limit: int = 200, **filters) -> list[dict]:
    """Per-question correct rate over the filtered sittings, hardest question first."""
    conds = _attempt_filters(**filters)
    ids = (
        select(Attempt.id)
        .join(Student, Attempt.student_id == Student.id)
        .where(*conds)
        .scalar_subquery()
    )
    correct = func.sum(case((QuestionResponse.is_correct.is_(True), 1), else_=0))
    stmt = (
        select(
            QuestionResponse.skill,
            QuestionResponse.no,
            QuestionResponse.qtype,
            func.count().label("n"),
            correct.label("ok"),
        )
        .where(
            QuestionResponse.attempt_id.in_(ids),
            QuestionResponse.qtype.not_in(FEEDBACK_QTYPES),
        )
        .group_by(QuestionResponse.skill, QuestionResponse.no, QuestionResponse.qtype)
        .order_by((correct * 1.0 / func.count()).asc(), QuestionResponse.skill, QuestionResponse.no)
        .limit(limit)
    )
    return [
        {
            "skill": r.skill,
            "no": r.no,
            "qtype": r.qtype,
            "responses": int(r.n or 0),
            "rate": round(float(r.ok or 0) / r.n * 100) if r.n else 0,
        }
        for r in db.execute(stmt)
    ]


def rankings(db: Session, *, grade: str | None = None, limit: int = 500, **filters) -> list[dict]:
    """Competition ranking (1,1,3). The `grade` filter narrows the rows shown but
    never the ranking base, so a B2 student keeps their whole-cohort position."""
    conds = _attempt_filters(**filters)
    stmt = (
        select(Attempt)
        .join(Student, Attempt.student_id == Student.id)
        .options(selectinload(Attempt.student), selectinload(Attempt.exam),
                 selectinload(Attempt.section_scores))
        .where(*conds)
        .order_by(Attempt.total_score.desc(), Attempt.id.asc())
        .limit(limit)
    )
    rows: list[dict] = []
    rank = 0
    previous: int | None = None
    for index, attempt in enumerate(db.scalars(stmt), start=1):
        if attempt.total_score != previous:
            rank = index                       # ties share a rank, the next one skips
            previous = attempt.total_score
        sections = {s.skill: s.scaled for s in attempt.section_scores}
        rows.append({
            "rank": rank,
            "attempt": attempt,
            "sections": sections,
        })
    if grade and grade.strip():
        rows = [r for r in rows if r["attempt"].grade == grade.strip()]
    return rows



# ── LLM 사용량 집계 (호출 단위) ─────────────────────────────────────────────
# 어드민은 돈을, 개발자는 토큰과 실패를 본다. 두 화면이 같은 원장을 다르게 자른다.


def _usage_window(date_from: date | None, date_to: date | None):
    conds = []
    if date_from:
        conds.append(LlmUsage.created_at >= datetime.combine(date_from, dtime.min))
    if date_to:
        conds.append(LlmUsage.created_at <= datetime.combine(date_to, dtime.max))
    return conds


def llm_usage_totals(db: Session, *, date_from=None, date_to=None) -> dict:
    """기간 합계. cost_micros IS NULL(단가 미등록)은 금액에서 빼고 따로 센다."""
    conds = _usage_window(date_from, date_to)
    row = db.execute(
        select(
            func.count(LlmUsage.id),
            func.coalesce(func.sum(LlmUsage.input_tokens), 0),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cache_read_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cache_write_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cost_micros), 0),
            func.sum(case((LlmUsage.cost_micros.is_(None), 1), else_=0)),
            func.sum(case((LlmUsage.ok.is_(False), 1), else_=0)),
            func.count(func.distinct(LlmUsage.attempt_id)),
        ).where(*conds)
    ).one()
    calls = int(row[0] or 0)
    attempts = int(row[8] or 0)
    cost = int(row[5] or 0)
    return {
        "calls": calls,
        "input_tokens": int(row[1] or 0),
        "output_tokens": int(row[2] or 0),
        "cache_read_tokens": int(row[3] or 0),
        "cache_write_tokens": int(row[4] or 0),
        "cost_micros": cost,
        "unpriced_calls": int(row[6] or 0),
        "failed_calls": int(row[7] or 0),
        "attempts": attempts,
        # 어드민이 실제로 쓰는 숫자 — 학생 수를 곱하면 예산이 나온다.
        "cost_per_attempt_micros": (cost // attempts) if attempts else 0,
    }


def llm_usage_by(db: Session, column, *, date_from=None, date_to=None, limit: int = 50) -> list[dict]:
    """모델별 / 프로바이더별 / scope 별 절단면. column 은 LlmUsage 의 컬럼이다."""
    conds = _usage_window(date_from, date_to)
    rows = db.execute(
        select(
            column,
            func.count(LlmUsage.id),
            func.coalesce(func.sum(LlmUsage.input_tokens), 0),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cost_micros), 0),
            func.sum(case((LlmUsage.cost_micros.is_(None), 1), else_=0)),
            func.sum(case((LlmUsage.ok.is_(False), 1), else_=0)),
        ).where(*conds).group_by(column).order_by(func.coalesce(func.sum(LlmUsage.cost_micros), 0).desc()).limit(limit)
    ).all()
    return [
        {
            "key": r[0] or "—", "calls": int(r[1] or 0),
            "input_tokens": int(r[2] or 0), "output_tokens": int(r[3] or 0),
            "cost_micros": int(r[4] or 0), "unpriced_calls": int(r[5] or 0),
            "failed_calls": int(r[6] or 0),
        }
        for r in rows
    ]


def llm_usage_daily(db: Session, *, date_from=None, date_to=None, limit: int = 60) -> list[dict]:
    """일별 추이. 날짜 문자열로 묶어 SQLite/Postgres 모두에서 같은 결과를 낸다."""
    conds = _usage_window(date_from, date_to)
    day = func.substr(func.cast(LlmUsage.created_at, String(32)), 1, 10)
    rows = db.execute(
        select(day, func.count(LlmUsage.id), func.coalesce(func.sum(LlmUsage.cost_micros), 0))
        .where(*conds).group_by(day).order_by(day.desc()).limit(limit)
    ).all()
    return [{"day": r[0], "calls": int(r[1] or 0), "cost_micros": int(r[2] or 0)} for r in reversed(rows)]


def llm_usage_calls(db: Session, *, date_from=None, date_to=None, only_failed: bool = False,
                    limit: int = 200) -> list[LlmUsage]:
    """개발자 화면의 원장. 최신순."""
    conds = _usage_window(date_from, date_to)
    if only_failed:
        conds.append(LlmUsage.ok.is_(False))
    return list(db.execute(
        select(LlmUsage).where(*conds).order_by(LlmUsage.id.desc()).limit(limit)
    ).scalars())


def llm_latency_percentile(db: Session, pct: float = 0.95, *, date_from=None, date_to=None) -> int:
    """p95 지연. 윈도우 함수 없이 정렬 후 인덱싱한다 — 원장 규모에서 충분하다."""
    conds = _usage_window(date_from, date_to)
    conds.append(LlmUsage.ok.is_(True))
    values = list(db.execute(
        select(LlmUsage.latency_ms).where(*conds).order_by(LlmUsage.latency_ms)
    ).scalars())
    if not values:
        return 0
    idx = min(int(len(values) * pct), len(values) - 1)
    return int(values[idx])


__all__ = [
    "ADMIN_PAGE_SIZE",
    "AiFeedback",
    "Attempt",
    "CEFR_BANDS",
    "Exam",
    "FEEDBACK_QTYPES",
    "MediaAsset",
    "QuestionResponse",
    "RubricScore",
    "SectionScore",
    "Student",
    "attempt_responses",
    "count_rows",
    "exam_statistics",
    "feedback_progress_for",
    "get_attempt",
    "get_media_asset",
    "list_attempts",
    "list_exams",
    "list_students",
    "media_by_question_key",
    "question_accuracy",
    "rankings",
    "recalc_totals",
    "save_feedback",
    "save_question_feedback",
    "llm_latency_percentile",
    "llm_usage_by",
    "llm_usage_calls",
    "llm_usage_daily",
    "llm_usage_totals",
    "search_attempts",
    "speaking_attempts",
    "to_detail",
    "to_summary",
]
