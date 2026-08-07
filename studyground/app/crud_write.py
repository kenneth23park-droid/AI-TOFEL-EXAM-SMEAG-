"""Write side of the data layer — every mutation the runtime API performs.

Reads stay in `crud.py`, writes live here (coding standard B3: a router never
touches `db.query()` itself). Status transitions exist in exactly one function,
`set_status()`, so Story 3.5 AC6 can be proved with a grep.
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime
from typing import Any, Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud
from app.media import MediaRef
from app.models import (
    ATTEMPT_STATUSES,
    Attempt,
    AttemptEvent,
    Exam,
    MediaAsset,
    QuestionResponse,
    SectionScore,
    Student,
    normalize_status,
    utcnow,
)
from app.scoring import autoscore
from app.scoring.answer_key_set1 import (
    ANSWER_KEY,
    AUTO_TOTAL_BY_SKILL,
    PRODUCTIVE_KEYS,
    TOTAL_QUESTIONS,
)

# architecture.md §7.2 defines the denominator as the productive rows only.
# ⚠️ 가설(검증필요, PRD OQ-9): the live system may want every question to carry
# feedback, so the scope is a switch rather than a hard-coded query.
FEEDBACK_SCOPE = "productive_only"      # "productive_only" | "all_questions"

PRODUCTIVE_QTYPES = ("WRITING", "SPEAKING")

# Only forward moves plus a re-open of a finished attempt are legal.
_ALLOWED_TRANSITIONS = {
    "in_progress": {"in_progress", "scoring", "completed"},
    "scoring": {"scoring", "completed", "in_progress"},
    "completed": {"completed", "scoring"},
}

# Internal event types — the runtime cursor/clocks and the answer sequence ride on
# `attempt_events` so no schema change (and therefore no migration of someone
# else's file) is needed for them.
EV_STATE = "state_sync"
EV_SEQ = "answer_seq"


# ── students / exams / attempts ────────────────────────────────────────────


def get_or_create_student(
    db: Session, student_no: str, *, name: str = "", klass: str = "", campus: str = ""
) -> Student:
    """Story 3.2 AC2 — an unknown 학번 enrols itself; a known one is reused as is."""
    student = db.scalar(select(Student).where(Student.student_no == student_no))
    if student is not None:
        # Late-arriving profile data fills blanks but never overwrites what exists.
        if name and not student.name:
            student.name = name
        if campus and not student.campus:
            student.campus = campus
        if klass and not student.klass:
            student.klass = klass
        db.flush()
        return student

    student = Student(student_no=student_no, name=name or student_no, klass=klass, campus=campus)
    db.add(student)
    db.flush()
    return student


def get_exam_by_code(db: Session, exam_code: str) -> Exam | None:
    """Exams are pre-registered — the runtime never creates one (Story 3.2 AC2)."""
    return db.scalar(select(Exam).where(Exam.code == exam_code))


def new_session_id(exam_code: str, student_no: str, when: datetime | None = None) -> str:
    """Same shape the offline client mints in exam-store.js: CODE-YYYYMMDD-NO-xxxx."""
    stamp = (when or utcnow()).strftime("%Y%m%d")
    suffix = "".join(random.choice("0123456789abcdef") for _ in range(4))
    return f"{exam_code or 'SET1'}-{stamp}-{student_no or 'GUEST'}-{suffix}"


def find_resumable(db: Session, student_id: int, exam_id: int) -> Attempt | None:
    """architecture.md §7.1 — one live sitting per (student, exam) at a time."""
    return db.scalar(
        select(Attempt)
        .where(
            Attempt.student_id == student_id,
            Attempt.exam_id == exam_id,
            Attempt.status == "in_progress",
        )
        .order_by(Attempt.id.desc())
    )


def create_attempt(
    db: Session,
    *,
    student: Student,
    exam: Exam,
    profile: str = "toefl",
    scale: str = "",
    campus: str = "",
    content_hash: str = "",
    session: str = "",
) -> Attempt:
    now = utcnow()
    attempt = Attempt(
        student_id=student.id,
        exam_id=exam.id,
        taken_at=now,
        status="in_progress",
        session=session or new_session_id(exam.code, student.student_no, now),
        campus=campus or student.campus or "",
        exam_date=now.date(),
        profile=profile,
        scale=scale or ("ielts9" if profile == "ielts" else "toefl120"),
        content_hash=content_hash,
        started_at=now,
        total_questions=TOTAL_QUESTIONS,
    )
    db.add(attempt)
    db.flush()
    return attempt


# ── status (Story 3.5 AC1/AC6 — the single transition point) ───────────────


def set_status(db: Session, attempt: Attempt, status: str, *, reason: str = "") -> str:
    """The only place `attempts.status` is assigned.

    in_progress → scoring → completed, plus the reverse `completed → scoring`
    when a teacher deletes feedback (Story 3.5 AC4). An illegal move is ignored
    rather than raised: a stuck exam must never 500 on the student.
    """
    target = normalize_status(status)
    current = normalize_status(attempt.status)
    if target not in ATTEMPT_STATUSES or target not in _ALLOWED_TRANSITIONS[current]:
        return current
    if target != current:
        attempt.status = target
        log_event(db, attempt, "status", detail={"from": current, "to": target, "reason": reason})
        db.flush()
    return target


# ── answers ────────────────────────────────────────────────────────────────


def _last_client_seq(db: Session, attempt_id: int) -> int:
    row = db.scalar(
        select(AttemptEvent)
        .where(AttemptEvent.attempt_id == attempt_id, AttemptEvent.type == EV_SEQ)
        .order_by(AttemptEvent.id.desc())
    )
    if row is None:
        return 0
    try:
        return int(json.loads(row.detail or "{}").get("seq") or 0)
    except (ValueError, TypeError):
        return 0


def _response_map(attempt: Attempt) -> dict[str, QuestionResponse]:
    return {r.question_key: r for r in attempt.question_responses if r.question_key}


def _answer_text(qtype: str, value: Any) -> str:
    if isinstance(value, (list, dict)):
        return autoscore.display_answer(qtype, value) if isinstance(value, list) else json.dumps(value)
    return autoscore.display_answer(qtype, value)


def upsert_answers(
    db: Session,
    attempt: Attempt,
    items: Sequence[dict],
    *,
    client_seq: int | None = None,
) -> dict:
    """Idempotent (attempt_id, question_key) upsert — an outbox replay is safe.

    A request whose `client_seq` is older than the newest one already applied is
    rejected wholesale with reason 'stale' (architecture.md §7.1 멱등성 규칙).
    """
    last_seq = _last_client_seq(db, attempt.id)
    if client_seq is not None and client_seq < last_seq:
        return {
            "accepted": 0,
            "rejected": [{"question_key": i.get("question_key", ""), "reason": "stale"} for i in items],
            "submitted_count": attempt.submitted_count,
        }

    existing = _response_map(attempt)
    accepted = 0
    rejected: list[dict] = []

    for item in items:
        key = (item.get("question_key") or "").strip()
        if not key:
            rejected.append({"question_key": "", "reason": "missing_question_key"})
            continue

        known = ANSWER_KEY.get(key) or PRODUCTIVE_KEYS.get(key) or {}
        qtype = (item.get("qtype") or known.get("qtype") or "MCQ").strip().upper()
        skill = (item.get("skill") or known.get("skill") or "").strip()
        module = (item.get("module") or known.get("module") or "").strip()
        no = item.get("no")
        if no is None:
            no = known.get("no") or 0

        row = existing.get(key)
        if row is None:
            row = QuestionResponse(attempt_id=attempt.id, question_key=key, skill=skill, no=int(no))
            db.add(row)
            existing[key] = row
            attempt.question_responses.append(row)

        row.skill = skill or row.skill
        row.module = module or row.module
        row.qtype = qtype
        row.no = int(no)
        row.student_answer = _answer_text(qtype, item.get("answer"))
        row.max_score = float(known.get("max_score") or row.max_score or 1)
        if item.get("prompt"):
            row.prompt = str(item["prompt"])
        accepted += 1

    db.flush()
    if client_seq is not None and client_seq > last_seq:
        log_event(db, attempt, EV_SEQ, detail={"seq": client_seq})
    recalc_progress(db, attempt)
    return {"accepted": accepted, "rejected": rejected, "submitted_count": attempt.submitted_count}


# ── media ──────────────────────────────────────────────────────────────────


def record_media(
    db: Session,
    attempt: Attempt,
    *,
    question_key: str,
    ref: MediaRef,
    duration_ms: int = 0,
    kind: str = "audio",
) -> MediaAsset:
    """Store the blob's metadata and mirror the path onto the response row."""
    asset = db.scalar(
        select(MediaAsset).where(
            MediaAsset.attempt_id == attempt.id,
            MediaAsset.question_key == question_key,
            MediaAsset.kind == kind,
        )
    )
    if asset is None:
        asset = MediaAsset(attempt_id=attempt.id, question_key=question_key, kind=kind)
        db.add(asset)

    asset.storage = ref.storage
    asset.uri = ref.uri
    asset.mime = ref.mime
    asset.bytes = ref.bytes
    asset.sha256 = ref.sha256
    asset.duration_ms = int(duration_ms or 0)
    db.flush()

    known = PRODUCTIVE_KEYS.get(question_key) or ANSWER_KEY.get(question_key) or {}
    row = _response_map(attempt).get(question_key)
    if row is None:
        row = QuestionResponse(
            attempt_id=attempt.id,
            question_key=question_key,
            skill=known.get("skill") or "speaking",
            no=int(known.get("no") or 0),
            qtype=known.get("qtype") or "SPEAKING",
        )
        db.add(row)
        attempt.question_responses.append(row)
    row.audio_ref = ref.uri
    row.module = row.module or (known.get("module") or "")
    db.flush()
    recalc_progress(db, attempt)
    return asset


# ── events / runtime state ─────────────────────────────────────────────────


def log_event(
    db: Session,
    attempt: Attempt,
    type_: str,
    *,
    screen_id: str = "",
    detail: Any = "",
    ts: datetime | None = None,
) -> AttemptEvent:
    row = AttemptEvent(
        attempt_id=attempt.id,
        ts=ts or utcnow(),
        type=(type_ or "")[:32],
        screen_id=(screen_id or "")[:64],
        detail=detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False),
    )
    db.add(row)
    return row


def log_events(db: Session, attempt: Attempt, events: Iterable[dict]) -> int:
    n = 0
    for e in events:
        log_event(
            db,
            attempt,
            e.get("type") or "client",
            screen_id=e.get("screen_id") or "",
            detail=e.get("detail") if e.get("detail") is not None else "",
        )
        n += 1
    db.flush()
    return n


def save_runtime_state(db: Session, attempt: Attempt, *, cursor: dict, clocks: dict) -> None:
    """Cursor + wall-clock deadlines, so a reload on another device can resume.

    Kept as an `attempt_events` row (latest wins) — the runtime state is a log
    entry by nature and this avoids adding columns another story owns.
    """
    log_event(db, attempt, EV_STATE, detail={"cursor": cursor or {}, "clocks": clocks or {}})
    db.flush()


def load_runtime_state(db: Session, attempt: Attempt) -> dict:
    row = db.scalar(
        select(AttemptEvent)
        .where(AttemptEvent.attempt_id == attempt.id, AttemptEvent.type == EV_STATE)
        .order_by(AttemptEvent.id.desc())
    )
    if row is None:
        return {"cursor": None, "clocks": {}}
    try:
        payload = json.loads(row.detail or "{}")
    except ValueError:
        return {"cursor": None, "clocks": {}}
    return {"cursor": payload.get("cursor"), "clocks": payload.get("clocks") or {}}


# ── progress (Story 3.5) ───────────────────────────────────────────────────


def _is_answered(row: QuestionResponse) -> bool:
    return bool((row.student_answer or "").strip()) or bool((row.audio_ref or "").strip())


def feedback_counts(attempt: Attempt) -> tuple[int, int]:
    """(numerator, denominator) for feedback_progress under the active scope."""
    rows = list(attempt.question_responses)
    if FEEDBACK_SCOPE == "all_questions":
        pool = rows
    else:
        pool = [r for r in rows if (r.qtype or "").upper() in PRODUCTIVE_QTYPES]
    done = [r for r in pool if (r.feedback or "").strip()]
    return len(done), len(pool)


def recalc_progress(db: Session, attempt: Attempt) -> Attempt:
    """Refresh submitted_count / total_questions / feedback_progress, then status.

    Called after every write that can move any of the three (Story 3.5 AC3).
    """
    rows = list(attempt.question_responses)
    attempt.submitted_count = sum(1 for r in rows if _is_answered(r))
    # Only the SET 1 content pack exists server-side, so its 91 is the floor; a
    # future pack with more questions still reports its own real count.
    attempt.total_questions = max(TOTAL_QUESTIONS, len(rows))

    done, total = feedback_counts(attempt)
    attempt.feedback_progress = 100 if total == 0 else round(done / total * 100)

    # AC4 — the transition follows the number, in both directions, but only once
    # the sitting has actually been submitted.
    if attempt.submitted_at is not None and normalize_status(attempt.status) != "in_progress":
        set_status(
            db,
            attempt,
            "completed" if attempt.feedback_progress >= 100 else "scoring",
            reason="feedback_progress",
        )

    db.add(attempt)
    db.flush()
    return attempt


# ── grading (Story 3.4) ────────────────────────────────────────────────────


def upsert_section_score(
    db: Session, attempt: Attempt, skill: str, *, raw_correct: float, raw_total: float
) -> SectionScore:
    row = next((s for s in attempt.section_scores if s.skill == skill and not s.module), None)
    if row is None:
        row = SectionScore(attempt_id=attempt.id, skill=skill)
        db.add(row)
        attempt.section_scores.append(row)
    row.raw_correct = float(raw_correct)
    row.raw_total = float(raw_total)
    row.scaled = round(raw_correct / raw_total * 30) if raw_total else 0
    db.flush()
    return row


def grade_attempt(db: Session, attempt: Attempt) -> dict:
    """The single entry point into auto-scoring (Story 3.4 AC1).

    Answers are compared against the server-side key only — whatever the browser
    claimed is correct is ignored (AC6). Productive rows keep `auto_score = NULL`.
    """
    correct_by_skill: dict[str, float] = {}
    graded = 0
    pending = 0

    for row in attempt.question_responses:
        entry = ANSWER_KEY.get(row.question_key or "")
        if entry is None:
            # Productive (or unknown) — a teacher decides; leave auto_score NULL.
            row.auto_score = None
            row.is_correct = False
            if (row.qtype or "").upper() in PRODUCTIVE_QTYPES:
                pending += 1
            continue

        qtype = entry["qtype"]
        raw = _client_answer_value(row, qtype)
        value = autoscore.score(qtype, raw, entry["answer"])
        row.qtype = qtype
        row.skill = row.skill or entry["skill"]
        row.module = row.module or entry["module"]
        row.max_score = float(entry.get("max_score") or 1)
        row.auto_score = 0.0 if value is None else float(value)
        row.is_correct = row.auto_score >= row.max_score
        row.correct_answer = autoscore.display_answer(qtype, entry["answer"])
        correct_by_skill[entry["skill"]] = correct_by_skill.get(entry["skill"], 0.0) + row.auto_score
        graded += 1

    for skill, raw_total in AUTO_TOTAL_BY_SKILL.items():
        # Speaking has no auto-scorable item — scaled stays 0 until the rubric lands.
        upsert_section_score(
            db, attempt, skill, raw_correct=correct_by_skill.get(skill, 0.0), raw_total=raw_total
        )

    crud.recalc_totals(db, attempt)
    recalc_progress(db, attempt)
    # AC8 — auto-scoring alone never completes an attempt that still owes rubrics.
    set_status(db, attempt, "completed" if pending == 0 else "scoring", reason="autoscore")
    db.commit()
    return {"graded": graded, "pending_productive": pending, "total_score": attempt.total_score}


def _client_answer_value(row: QuestionResponse, qtype: str) -> Any:
    """`student_answer` is stored as display text; turn it back into a comparable."""
    text = row.student_answer or ""
    if qtype == "BUILD_SENTENCE":
        return text.split()
    return text


# ── submission ─────────────────────────────────────────────────────────────


def mark_submitted(db: Session, attempt: Attempt, *, client_finished_at: datetime | None = None) -> Attempt:
    """Freeze the sitting and move it into the scoring queue (Story 3.2 AC6)."""
    if attempt.submitted_at is None:
        attempt.submitted_at = utcnow()
    if client_finished_at is not None:
        log_event(db, attempt, "submit", detail={"client_finished_at": client_finished_at.isoformat()})
    if attempt.exam_date is None:
        attempt.exam_date = date.today()
    recalc_progress(db, attempt)
    set_status(db, attempt, "scoring", reason="submit")
    db.add(attempt)
    db.commit()
    return attempt


__all__ = [
    "FEEDBACK_SCOPE",
    "create_attempt",
    "feedback_counts",
    "find_resumable",
    "get_exam_by_code",
    "get_or_create_student",
    "grade_attempt",
    "load_runtime_state",
    "log_event",
    "log_events",
    "mark_submitted",
    "new_session_id",
    "recalc_progress",
    "record_media",
    "save_runtime_state",
    "set_status",
    "upsert_answers",
    "upsert_section_score",
]
