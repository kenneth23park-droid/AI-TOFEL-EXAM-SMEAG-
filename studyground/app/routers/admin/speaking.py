"""SPEAKING ANSWERS — recording playback, rubric score, per-question feedback.

Story 4.4. Audio never sits behind a public StaticFiles mount: the only way to the
bytes is `GET /api/admin/media/{asset_id}`, which refuses a request that carries no
admin session cookie (AC7).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.routers.admin import admin_render, admin_t, is_admin
from app.templating import render, resolve_lang

router = APIRouter()
api = APIRouter()

# Story 4.4 AC2 — the two observed Speaking question kinds, derived from the module
# the compiler stamped on the response ('S1' = repeat drill, 'S2' = interview).
SPEAKING_KIND = {"S1": "Listen and Repeat", "S2": "Interview"}


@router.get("/speaking")
async def speaking_index(
    request: Request,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    return admin_render(request, "admin_speaking.html", lang, "speaking", {
        "page_title": admin_t(lang)("speaking.title"),
        "rows": crud.speaking_attempts(db),
        "a": None,
        "cards": [],
    })


@router.get("/speaking/{attempt_id}")
async def speaking_detail(
    request: Request,
    attempt_id: int,
    mode: str = "write",
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        return render(request, "404.html", lang, {}, status_code=404)

    media = crud.media_by_question_key(db, attempt_id)
    cards = []
    for row in crud.attempt_responses(db, attempt_id, skills=("speaking",)):
        asset = media.get(row.question_key)
        cards.append({
            "r": row,
            "kind": SPEAKING_KIND.get(row.module, "Speaking"),
            "asset_id": asset.id if asset else None,
            "duration_s": round((asset.duration_ms or 0) / 1000) if asset else 0,
        })
    reviewed = len([c for c in cards if c["r"].feedback])
    return admin_render(request, "admin_speaking.html", lang, "speaking", {
        "page_title": admin_t(lang)("speaking.title"),
        "rows": [],
        "a": attempt,
        "cards": cards,
        "reviewed": reviewed,
        "editable": mode != "view",
    })


@api.get("/media/{asset_id}")
async def stream_media(request: Request, asset_id: int, db: Session = Depends(get_db)):
    """Story 4.4 AC7 — 403 without an admin session, 404 when the bytes are gone."""
    if not is_admin(request):
        return JSONResponse({"detail": "Admin session required."}, status_code=403)

    asset = crud.get_media_asset(db, asset_id)
    if asset is None:
        return JSONResponse({"detail": "Media asset not found."}, status_code=404)

    if asset.storage == "inline" and asset.inline_b64:
        import base64

        return Response(base64.b64decode(asset.inline_b64), media_type=asset.mime)

    path = Path(asset.uri)
    if not path.is_file():
        return JSONResponse({"detail": "Media file is missing on disk."}, status_code=404)
    return FileResponse(path, media_type=asset.mime)
