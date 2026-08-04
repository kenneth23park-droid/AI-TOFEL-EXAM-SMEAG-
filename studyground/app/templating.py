"""Jinja2 environment — shared by every router so there is one template config."""

from __future__ import annotations

from datetime import datetime

from fastapi import Request
from fastapi.templating import Jinja2Templates

from app.config import BASE_DIR, get_settings
from app.i18n import LANG_COOKIE, normalize, translator
from app.models import SECTION_MAX, SKILLS, TOTAL_MAX

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def resolve_lang(request: Request, lang: str | None = None) -> str:
    """Query param wins (shareable links), then the cookie, then the default."""
    if lang:
        return normalize(lang)
    return normalize(request.cookies.get(LANG_COOKIE) or get_settings().default_lang)


def fmt_date(value: datetime | None, lang: str = "en") -> str:
    if not value:
        return "—"
    return value.strftime("%Y-%m-%d") if lang == "ko" else value.strftime("%d %b %Y")


def render(request: Request, template: str, lang: str, context: dict, status_code: int = 200):
    settings = get_settings()
    ctx = {
        "request": request,
        "lang": lang,
        "other_lang": "ko" if lang == "en" else "en",
        "t": translator(lang),
        "settings": settings,
        "skills": SKILLS,
        "section_max": SECTION_MAX,
        "total_max": TOTAL_MAX,
        "fmt_date": lambda v: fmt_date(v, lang),
        **context,
    }
    response = templates.TemplateResponse(request, template, ctx, status_code=status_code)
    response.set_cookie(LANG_COOKIE, lang, max_age=60 * 60 * 24 * 365, samesite="lax")
    return response
