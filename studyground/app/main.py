"""FastAPI app — one entry point for both APP_MODE=local and APP_MODE=cloud."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import BASE_DIR, get_settings
from app.db import create_all
from app.migrations import run_migrations
from app.routers import admin, attempts, pages, scores
from app.templating import render, resolve_lang

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("studyground")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    create_all()
    run_migrations()   # architecture.md 6.3 — brings an existing DB up to the new shape
    if settings.seed_on_start:
        from app.seed import seed

        result = seed()
        log.info(
            "db ready (%s) — students=%s attempts=%s%s",
            settings.app_mode, result["students"], result["attempts"],
            "" if result["seeded"] else " (already populated)",
        )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="MockTest",
        description="SMEAG score reports — offline + cloud dual mode.",
        version="1.0.0",
        lifespan=lifespan,
    )

    # Bundled CSS/JS only — no CDN, so the local build works with zero network.
    app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "static")), name="assets")

    app.include_router(scores.router)
    app.include_router(attempts.router)   # architecture.md §7.1 test-taker runtime API
    app.include_router(pages.router)
    app.include_router(admin.router)      # architecture.md §7.2 admin grading back office

    @app.exception_handler(404)
    async def not_found(request: Request, exc):  # noqa: ANN001, ARG001
        if request.url.path.startswith("/api"):
            detail = getattr(exc, "detail", None) or "Not found."
            return JSONResponse({"detail": detail}, status_code=404)
        return render(request, "404.html", resolve_lang(request), {}, status_code=404)

    log.info("MockTest starting — mode=%s scoring=%s", settings.app_mode, settings.scoring_mode)
    return app


app = create_app()
