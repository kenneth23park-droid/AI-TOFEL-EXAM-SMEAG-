"""Exam Statistics and Rankings by Grade — Stories 4.6 / 4.7.

Charts are inline SVG built in the template from numbers computed here; no chart
library and no CDN (P1/P2). The CSV export writes a UTF-8 BOM so Excel opens the
Korean columns without mojibake (4.7 AC7).
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.models import SKILLS
from app.routers.admin import admin_render, admin_t, parse_date
from app.templating import resolve_lang

router = APIRouter()

# Story 4.6 AC4 — rows below this correct rate are highlighted as problem questions.
HARD_QUESTION_RATE = 30


def _filters(exam_id, campus, date_from, date_to, include_scoring):
    """Completed sittings only by default (4.6 AC6 / 4.7 AC6)."""
    statuses = ("completed", "scoring") if include_scoring else ("completed",)
    return {
        "exam_id": exam_id,
        "campus": campus,
        "date_from": parse_date(date_from),
        "date_to": parse_date(date_to),
        "statuses": statuses,
    }


@router.get("/statistics")
async def statistics(
    request: Request,
    exam_id: int | None = None,
    campus: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    include_scoring: int = 0,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    filters = _filters(exam_id, campus, date_from, date_to, bool(include_scoring))
    summary = crud.exam_statistics(db, **filters)
    accuracy = crud.question_accuracy(db, **filters)
    return admin_render(request, "admin_stats.html", lang, "statistics", {
        "page_title": admin_t(lang)("stats.title"),
        "s": summary,
        "accuracy": accuracy,
        "skills_order": SKILLS,
        "exams": crud.list_exams(db),
        "q": {"exam_id": exam_id or "", "campus": campus or "",
              "date_from": date_from or "", "date_to": date_to or "",
              "include_scoring": int(bool(include_scoring))},
        "hard_rate": HARD_QUESTION_RATE,
    })


@router.get("/rankings")
async def rankings(
    request: Request,
    exam_id: int | None = None,
    campus: str | None = None,
    grade: str | None = None,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    rows = crud.rankings(db, grade=grade, **_filters(exam_id, campus, None, None, False))
    return admin_render(request, "admin_rankings.html", lang, "rankings", {
        "page_title": admin_t(lang)("rank.title"),
        "rows": rows,
        "bands": crud.CEFR_BANDS,
        "exams": crud.list_exams(db),
        "skills_order": SKILLS,
        "q": {"exam_id": exam_id or "", "campus": campus or "", "grade": grade or ""},
    })


@router.get("/rankings.csv")
async def rankings_csv(
    exam_id: int | None = None,
    campus: str | None = None,
    grade: str | None = None,
    db: Session = Depends(get_db),
):
    rows = crud.rankings(db, grade=grade, **_filters(exam_id, campus, None, None, False))
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["RANK", "STUDENT", "STUDENT NO", "CAMPUS", "TOTAL",
                     "GRADE", "R", "L", "S", "W", "EXAM DATE"])
    for row in rows:
        attempt = row["attempt"]
        sections = row["sections"]
        writer.writerow([
            row["rank"], attempt.student.name, attempt.student.student_no,
            attempt.campus or attempt.student.campus, attempt.total_score, attempt.grade,
            sections.get("reading", 0), sections.get("listening", 0),
            sections.get("speaking", 0), sections.get("writing", 0),
            attempt.exam_date.isoformat() if attempt.exam_date else "",
        ])
    # BOM first — Excel decodes UTF-8 only when it sees one.
    body = "﻿" + buffer.getvalue()
    return Response(
        body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="rankings.csv"'},
    )
