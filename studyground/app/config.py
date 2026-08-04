"""Central settings — one env var (APP_MODE) switches the whole app.

    APP_MODE=local  → SQLite file DB, deterministic rule-based scoring, zero network
    APP_MODE=cloud  → Postgres (Supabase) + LLM scoring node

Everything else (templates, JS, CSS, routers, schema) is identical between the
two modes; only the database URL and the scoring node differ.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _load_dotenv() -> None:
    """Minimal .env loader — avoids a python-dotenv dependency for local runs."""
    path = PROJECT_DIR / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    app_mode: str                 # 'local' | 'cloud'
    database_url: str
    anthropic_api_key: str
    anthropic_model: str
    default_lang: str             # UI 기본은 영어
    seed_on_start: bool
    sqlite_path: Path

    @property
    def is_local(self) -> bool:
        return self.app_mode == "local"

    @property
    def is_cloud(self) -> bool:
        return self.app_mode == "cloud"

    @property
    def llm_enabled(self) -> bool:
        """Online (LLM) feedback is only attempted in cloud mode with a key."""
        return self.is_cloud and bool(self.anthropic_api_key)

    @property
    def scoring_mode(self) -> str:
        return "online" if self.llm_enabled else "offline"


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()

    mode = _env("APP_MODE", "local").lower()
    if mode not in ("local", "cloud"):
        mode = "local"

    # Vercel's filesystem is read-only except /tmp, so the SQLite fallback lives there.
    default_sqlite = (
        Path("/tmp/studyground.db") if _env("VERCEL") else PROJECT_DIR / "data" / "studyground.db"
    )
    sqlite_path = Path(_env("SQLITE_PATH") or default_sqlite)

    database_url = _env("DATABASE_URL")
    if mode == "local" or not database_url:
        database_url = f"sqlite:///{sqlite_path}"
    elif database_url.startswith("postgres://"):
        # Supabase hands out postgres:// — SQLAlchemy 2.x wants postgresql://
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    return Settings(
        app_mode=mode,
        database_url=database_url,
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        anthropic_model=_env("ANTHROPIC_MODEL", "claude-sonnet-5"),
        default_lang=_env("DEFAULT_LANG", "en"),
        seed_on_start=_env("SEED_ON_START", "1") not in ("0", "false", "no"),
        sqlite_path=sqlite_path,
    )
