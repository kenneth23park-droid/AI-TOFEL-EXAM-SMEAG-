"""HTML pages — the score list and the score report."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.models import PRODUCTIVE, RECEPTIVE
from app.templating import render, resolve_lang

router = APIRouter(tags=["pages"], include_in_schema=False)


@router.get("/")
async def score_list(
    request: Request,
    student_id: int | None = None,
    exam_id: int | None = None,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    attempts = crud.list_attempts(db, student_id=student_id, exam_id=exam_id)
    return render(
        request,
        "list.html",
        lang,
        {
            "rows": [crud.to_summary(a) for a in attempts],
            "students": crud.list_students(db),
            "exams": crud.list_exams(db),
            "sel_student": student_id,
            "sel_exam": exam_id,
        },
    )


@router.get("/attempts/{attempt_id}")
async def score_detail(
    request: Request,
    attempt_id: int,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        return render(request, "404.html", lang, {}, status_code=404)

    detail = crud.to_detail(attempt, lang=lang)
    feedback = {f.scope: f for f in detail.feedback}

    # Group the per-question and rubric rows by skill for the report sections.
    review = {
        skill: [q for q in detail.question_responses if q.skill == skill] for skill in RECEPTIVE
    }
    rubrics = {
        skill: [r for r in detail.rubric_scores if r.skill == skill] for skill in PRODUCTIVE
    }
    return render(
        request,
        "detail.html",
        lang,
        {
            "d": detail,
            "feedback": feedback,
            "review": review,
            "rubrics": rubrics,
            "receptive": RECEPTIVE,
            "productive": PRODUCTIVE,
        },
    )
