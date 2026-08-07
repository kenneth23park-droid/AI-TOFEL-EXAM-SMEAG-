"""Test-taker runtime API — architecture.md §7.1.

Everything here is written for a flaky classroom network: the same request may
arrive twice (offline outbox replay) and must produce the same row. Writes go
through `crud_write`, reads through `crud` (B3); the router never assigns
`attempt.status` itself (Story 3.5 AC6).
"""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app import crud, crud_write
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.i18n import normalize
from app.media import MediaError, get_media_store
from app.models import Attempt, utcnow
from app.schemas import (
    AnswersIn,
    AnswersOut,
    AttemptCreateIn,
    AttemptCreateOut,
    AttemptDetail,
    AttemptResultPending,
    AttemptStateIn,
    AttemptStateOut,
    AttemptSubmitIn,
    AttemptSubmitOut,
    EventsIn,
    MediaUploadIn,
    MediaUploadOut,
)

router = APIRouter(prefix="/api/attempts", tags=["runtime"])


def _load(db: Session, attempt_id: int) -> Attempt:
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Attempt not found.")
    return attempt


def _require_open(attempt: Attempt) -> None:
    """Writes are refused once the sitting has been handed in (§7.1 409 rows)."""
    if attempt.status != "in_progress":
        raise HTTPException(409, "Attempt is no longer in progress.")


def _grade_in_background(attempt_id: int) -> None:
    """Auto-scoring runs off the request so submit answers immediately (Story 3.4).

    Its own session — the request's session is closed by the time this runs.
    """
    db = SessionLocal()
    try:
        attempt = crud.get_attempt(db, attempt_id)
        if attempt is not None:
            crud_write.grade_attempt(db, attempt)
    except Exception:  # noqa: BLE001 — a grading crash must not lose the answers
        db.rollback()
    finally:
        db.close()


@router.post("", response_model=AttemptCreateOut, status_code=201)
@router.post("/", response_model=AttemptCreateOut, status_code=201, include_in_schema=False)
async def create_attempt(payload: AttemptCreateIn, response: Response, db: Session = Depends(get_db)):
    """Start (or resume) a sitting. Resuming answers 200 with `resume:true`."""
    student_no = (payload.student_no or "").strip()
    if not student_no:
        raise HTTPException(422, "student_no is required.")

    exam = crud_write.get_exam_by_code(db, (payload.exam_code or "").strip())
    if exam is None:
        # Exams are pre-registered by staff; the runtime never invents one.
        raise HTTPException(400, "Unknown exam_code.")

    student = crud_write.get_or_create_student(
        db, student_no, name=payload.name, klass=payload.klass, campus=payload.campus
    )

    existing = crud_write.find_resumable(db, student.id, exam.id)
    if existing is not None:
        db.commit()
        response.status_code = 200
        return AttemptCreateOut(
            attempt_id=existing.id,
            session=existing.session or "",
            server_time=utcnow(),
            resume=True,
            status=existing.status,
            total_questions=existing.total_questions,
        )

    profile = payload.profile if payload.profile in ("toefl", "ielts") else get_settings().default_profile
    attempt = crud_write.create_attempt(
        db,
        student=student,
        exam=exam,
        profile=profile,
        campus=payload.campus,
        content_hash=payload.content_hash,
        session=(payload.session or "").strip(),
    )
    crud_write.log_event(
        db, attempt, "attempt_start",
        detail={"content_hash": payload.content_hash, "timing_hash": payload.timing_hash},
    )
    db.commit()
    return AttemptCreateOut(
        attempt_id=attempt.id,
        session=attempt.session or "",
        server_time=utcnow(),
        resume=False,
        status=attempt.status,
        total_questions=attempt.total_questions,
    )


@router.get("/{attempt_id}/state", response_model=AttemptStateOut)
async def get_state(attempt_id: int, db: Session = Depends(get_db)):
    attempt = _load(db, attempt_id)
    state = crud_write.load_runtime_state(db, attempt)
    return AttemptStateOut(
        session=attempt.session,
        status=attempt.status,
        cursor=state["cursor"],
        clocks=state["clocks"],
        answered_count=attempt.submitted_count,
        server_time=utcnow(),
    )


@router.put("/{attempt_id}/state", status_code=204)
async def put_state(attempt_id: int, payload: AttemptStateIn, db: Session = Depends(get_db)):
    attempt = _load(db, attempt_id)
    _require_open(attempt)
    crud_write.save_runtime_state(
        db,
        attempt,
        cursor=payload.cursor.model_dump() if payload.cursor else {},
        clocks=payload.clocks,
    )
    db.commit()
    return Response(status_code=204)


@router.post("/{attempt_id}/answers", response_model=AnswersOut)
async def post_answers(attempt_id: int, payload: AnswersIn, db: Session = Depends(get_db)):
    attempt = _load(db, attempt_id)
    _require_open(attempt)
    result = crud_write.upsert_answers(
        db,
        attempt,
        [item.model_dump() for item in payload.items],
        client_seq=payload.client_seq,
    )
    db.commit()
    return AnswersOut(**result)


@router.post("/{attempt_id}/media", response_model=MediaUploadOut, status_code=201)
async def post_media(attempt_id: int, payload: MediaUploadIn, db: Session = Depends(get_db)):
    """Speaking recording upload (Story 3.3). base64 in, MediaRef out."""
    attempt = _load(db, attempt_id)
    _require_open(attempt)

    question_key = (payload.question_key or "").strip()
    if not question_key:
        raise HTTPException(422, "question_key is required.")

    try:
        data = base64.b64decode(payload.data_b64 or "", validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "data_b64 is not valid base64.") from None
    if not data:
        raise HTTPException(422, "Recording is empty.")

    store = get_media_store()
    try:
        ref = store.put(attempt.session or f"attempt-{attempt.id}", question_key, data, payload.mime)
    except MediaError as exc:
        raise HTTPException(exc.status, str(exc)) from None

    asset = crud_write.record_media(
        db, attempt, question_key=question_key, ref=ref, duration_ms=payload.duration_ms
    )
    db.commit()
    return MediaUploadOut(
        audio_ref=ref.uri, bytes=ref.bytes, sha256=ref.sha256, storage=ref.storage, asset_id=asset.id
    )


@router.post("/{attempt_id}/events", status_code=204)
async def post_events(attempt_id: int, payload: EventsIn, db: Session = Depends(get_db)):
    attempt = _load(db, attempt_id)
    crud_write.log_events(db, attempt, [e.model_dump() for e in payload.events])
    db.commit()
    return Response(status_code=204)


@router.post("/{attempt_id}/submit", response_model=AttemptSubmitOut, status_code=202)
async def submit(
    attempt_id: int,
    payload: AttemptSubmitIn,
    background: BackgroundTasks,
    response: Response,
    db: Session = Depends(get_db),
):
    """Hand in. Idempotent: a second call reports the first one's numbers (200)."""
    attempt = _load(db, attempt_id)

    if attempt.submitted_at is not None:
        response.status_code = 200
        return AttemptSubmitOut(
            attempt_id=attempt.id,
            status=attempt.status,
            submitted_count=attempt.submitted_count,
            total_questions=attempt.total_questions,
            feedback_progress=attempt.feedback_progress,
            already_submitted=True,
        )

    crud_write.mark_submitted(db, attempt, client_finished_at=payload.client_finished_at)
    background.add_task(_grade_in_background, attempt.id)
    return AttemptSubmitOut(
        attempt_id=attempt.id,
        status=attempt.status,
        submitted_count=attempt.submitted_count,
        total_questions=attempt.total_questions,
        feedback_progress=attempt.feedback_progress,
    )


@router.get("/{attempt_id}/result", response_model=AttemptDetail | AttemptResultPending)
async def result(attempt_id: int, lang: str = Query("en"), db: Session = Depends(get_db)):
    """Full report once scored; a `ready:false` stub while grading is outstanding."""
    attempt = _load(db, attempt_id)
    if attempt.status == "in_progress" or (attempt.submitted_at is not None and not attempt.section_scores):
        return AttemptResultPending(attempt_id=attempt.id, status=attempt.status, ready=False)
    return crud.to_detail(attempt, lang=normalize(lang))
