"""Engine / session — the only place that knows whether we're on SQLite or Postgres."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models import Base

_settings = get_settings()

_kwargs: dict = {"future": True, "pool_pre_ping": True}
if _settings.database_url.startswith("sqlite"):
    # The file DB is created on first run; check_same_thread=False lets FastAPI's
    # threadpool hand a session to any worker thread.
    _settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    _kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(_settings.database_url, **_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def create_all() -> None:
    Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Standalone transaction for seeding and scripts."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
