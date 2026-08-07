"""3-Subject Answer Management — list, tabbed detail, per-question feedback save.

Stories 4.2 / 4.3 / 4.5. The feedback endpoint answers both a `fetch()` (JSON in,
JSON out) and a plain `<form method="post">` (303 back to the card), so grading
still works with JavaScript switched off — progressive enhancement, one route.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.routers.admin import admin_render, admin_t, keep_query, parse_date
from app.templating import render, resolve_lang

router = APIRouter()
api = APIRouter()

# Story 4.3 AC1 — the three tabs of the observed screen, in the observed order.
TABS = ("reading", "listening", "writing")

# Story 4.3 AC3 — the card's type tag reproduces the observed back-office wording.
QTYPE_LABEL = {
    "WORD_FILLING": "WORD FILLING",
    "MCQ": "MULTIPLE CHOICE",
    "CLOZE": "CLOZE",
    "INSERT": "INSERT SENTENCE",
    "BUILD_SENTENCE": "BUILD SENTENCE",
    "WRITING": "WRITING",
    "SPEAKING": "SPEAKING",
}


@router.get("/answers")
async def answers_list(
    request: Request,
    session: str | None = None,
    student: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    page = max(1, page)
    size = crud.ADMIN_PAGE_SIZE
    total, rows = crud.search_attempts(
        db,
        session=session,
        student=student,
        date_from=parse_date(date_from),
        date_to=parse_date(date_to),
        offset=(page - 1) * size,
        limit=size,
    )
    pages = max(1, -(-total // size))       # ceil without importing math
    return admin_render(request, "admin_list.html", lang, "answers", {
        "page_title": admin_t(lang)("answers.title"),
        "rows": rows,
        "total": total,
        "page": page,
        "pages": pages,
        "q": {"session": session or "", "student": student or "",
              "date_from": date_from or "", "date_to": date_to or ""},
        "prev_url": "/admin/answers" + keep_query(request, page=page - 1) if page > 1 else "",
        "next_url": "/admin/answers" + keep_query(request, page=page + 1) if page < pages else "",
    })


@router.get("/answers/{attempt_id}")
async def answer_detail(
    request: Request,
    attempt_id: int,
    mode: str = "view",
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        return render(request, "404.html", lang, {}, status_code=404)

    rows = crud.attempt_responses(db, attempt_id, skills=TABS)
    tabs = {skill: [r for r in rows if r.skill == skill] for skill in TABS}
    return admin_render(request, "admin_detail.html", lang, "answers", {
        "page_title": admin_t(lang)("detail.adminTitle"),
        "a": attempt,
        "tabs": TABS,
        "rows_by_tab": tabs,
        "editable": mode == "write",
        "qtype_label": QTYPE_LABEL,
        "progress": attempt.feedback_progress,
    })


@router.post("/answers/{attempt_id}/feedback")
async def save_feedback_form(
    request: Request,
    attempt_id: int,
    db: Session = Depends(get_db),
):
    """No-JavaScript path: save, then bounce back to the same card (Story 4.5 PE).

    The urlencoded body is decoded by hand: both FastAPI's `Form(...)` and
    Starlette's `request.form()` require python-multipart, a new dependency this
    project forbids (B4). `parse_qs` on the raw body is exact for the
    `application/x-www-form-urlencoded` the templates post.
    """
    raw = (await request.body()).decode("utf-8")
    data = {key: values[0] for key, values in parse_qs(raw, keep_blank_values=True).items()}
    raw_score = str(data.get("score") or "").strip()
    try:
        response_id = int(str(data.get("response_id") or "0"))
    except ValueError:
        response_id = 0
    try:
        result = crud.save_question_feedback(
            db,
            response_id,
            feedback=str(data.get("feedback") or ""),
            score=float(raw_score) if raw_score else None,
            graded_by="teacher",
        )
    except ValueError:
        result = None

    tab = str(data.get("tab") or "reading")
    mode = str(data.get("mode") or "write")
    saved = "0" if result is None else "1"
    url = "/admin/answers/" + str(attempt_id) + "?mode=" + mode + "&saved=" + saved + "#" + tab
    return RedirectResponse(url, status_code=303)


@api.put("/responses/{response_id}/feedback")
@api.post("/responses/{response_id}/feedback")
async def save_feedback_json(
    response_id: int,
    payload: dict,
    db: Session = Depends(get_db),
):
    """architecture.md 7.2 — `{feedback, score?, graded_by}` in, progress out."""
    feedback = str(payload.get("feedback") or "")
    raw_score = payload.get("score")
    graded_by = str(payload.get("graded_by") or "teacher")
    score: float | None = None
    if raw_score not in (None, ""):
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            return JSONResponse({"detail": "Score must be a number."}, status_code=422)

    try:
        result = crud.save_question_feedback(
            db, response_id, feedback=feedback, score=score, graded_by=graded_by
        )
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=422)
    if result is None:
        return JSONResponse({"detail": "Response not found."}, status_code=404)

    row, attempt = result
    return {
        "ok": True,
        "response_id": row.id,
        "feedback": row.feedback,
        "score": row.auto_score,
        "feedback_progress": attempt.feedback_progress if attempt else 100,
    }
