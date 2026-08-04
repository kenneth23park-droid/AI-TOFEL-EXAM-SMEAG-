"""JSON API — the same data the pages render, plus the AI re-score action."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import crud
from app.config import get_settings
from app.db import engine, get_db
from app.i18n import normalize
from app.schemas import (
    AttemptDetail,
    AttemptSummary,
    ExamOut,
    HealthOut,
    RescoreResponse,
    StudentOut,
)
from app.scoring import graph as scoring_graph

router = APIRouter(prefix="/api", tags=["scores"])


@router.get("/health", response_model=HealthOut)
async def health(db: Session = Depends(get_db)) -> HealthOut:
    settings = get_settings()
    students, attempts = crud.count_rows(db)
    return HealthOut(
        app_mode=settings.app_mode,
        scoring_mode=settings.scoring_mode,
        database=engine.dialect.name,
        langgraph=scoring_graph.uses_langgraph(),
        students=students,
        attempts=attempts,
    )


@router.get("/students", response_model=list[StudentOut])
async def students(db: Session = Depends(get_db)):
    return crud.list_students(db)


@router.get("/exams", response_model=list[ExamOut])
async def exams(db: Session = Depends(get_db)):
    return crud.list_exams(db)


@router.get("/attempts", response_model=list[AttemptSummary])
async def attempts(
    student_id: int | None = None,
    exam_id: int | None = None,
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = crud.list_attempts(db, student_id=student_id, exam_id=exam_id, limit=limit)
    return [crud.to_summary(a) for a in rows]


@router.get("/attempts/{attempt_id}", response_model=AttemptDetail)
async def attempt_detail(
    attempt_id: int,
    lang: str = Query("en"),
    db: Session = Depends(get_db),
):
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Attempt not found.")
    return crud.to_detail(attempt, lang=normalize(lang))


@router.post("/attempts/{attempt_id}/rescore", response_model=RescoreResponse)
async def rescore(
    attempt_id: int,
    lang: str = Query("en"),
    mode: str = Query("auto", pattern="^(auto|offline|online)$"),
    db: Session = Depends(get_db),
):
    """Run the LangGraph pipeline again and replace this attempt's feedback."""
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Attempt not found.")

    lang = normalize(lang)
    detail = crud.to_detail(attempt, lang=lang)
    bundle = scoring_graph.run(detail, lang=lang, mode=mode)
    rows = crud.save_feedback(db, attempt, bundle)

    return RescoreResponse(
        attempt_id=attempt_id,
        mode=bundle.mode,
        fell_back=bundle.fell_back,
        note=bundle.note,
        feedback=rows,
    )
