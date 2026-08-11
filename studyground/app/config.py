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
    openai_api_key: str
    openai_model: str
    openai_base_url: str          # 비면 OpenAI 본사. 값이 있으면 그 주소(=캠퍼스 vLLM)
    llm_provider: str             # 'both' | 'anthropic' | 'openai' — 병행 시 앞에서부터 시도

    # ── 스킬별 라우팅 (architecture: 산출형은 판단, 수용형은 코멘트) ──
    # Writing·Speaking 은 사람의 판단에 준하는 채점이 필요하다 → Codex.
    # Reading·Listening 은 정답지로 이미 채점이 끝나 있고 LLM 은 리뷰 코멘트만
    # 쓴다 → 캠퍼스 안의 작은 모델(Gemma 4 E2B)로 충분하다.
    codex_model: str
    codex_base_url: str
    gemma_model: str
    gemma_base_url: str
    default_lang: str             # UI 기본은 영어
    seed_on_start: bool
    sqlite_path: Path
    media_root: Path              # FileMediaStore root (architecture.md 6.4 strategy A)
    max_media_bytes: int          # per-upload ceiling for a Speaking recording
    default_profile: str          # 'toefl' | 'ielts' — seeds attempts.profile/scale

    @property
    def is_local(self) -> bool:
        return self.app_mode == "local"

    @property
    def is_cloud(self) -> bool:
        return self.app_mode == "cloud"

    @property
    def llm_providers(self) -> tuple[str, ...]:
        """실제로 호출 가능한 프로바이더를 시도 순서대로. 키 없는 쪽은 아예 빠진다.

        llm_provider='both' 는 병행 운용 — 앞의 프로바이더가 죽거나 한도에 걸리면
        뒤가 같은 프롬프트를 이어받는다. 둘 다 실패해야 규칙 기반 초안으로 내려간다.
        """
        order = {
            "anthropic": ("anthropic",),
            "openai": ("openai",),
        }.get(self.llm_provider, ("anthropic", "openai"))
        have = {
            "anthropic": bool(self.anthropic_api_key),
            # 자체 호스팅(vLLM)은 인증이 없다 — base_url 자체가 "쓸 수 있다"는 신호다.
            "openai": bool(self.openai_api_key) or bool(self.openai_base_url),
        }
        return tuple(p for p in order if have[p])

    @property
    def llm_enabled(self) -> bool:
        """LLM 채점을 시도할 수 있는가.

        원래는 cloud 모드 전용이었다. 캠퍼스 GPU 노드는 local 모드로 돌면서도
        LAN 안의 vLLM 을 쓴다 — base_url 이 잡힌 경우만 예외로 연다.
        인터넷 의존은 여전히 없다.
        """
        if not self.llm_providers:
            return False
        return self.is_cloud or bool(self.openai_base_url)

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

    # Recordings sit next to the SQLite file so a local install is one folder to back up.
    default_media = Path("/tmp/sg-media") if _env("VERCEL") else PROJECT_DIR / "data" / "media"
    media_root = Path(_env("MEDIA_ROOT") or default_media)

    provider = _env("LLM_PROVIDER", "both").lower()
    if provider not in ("both", "anthropic", "openai"):
        provider = "both"

    openai_base_url = _env("OPENAI_BASE_URL", "").rstrip("/")

    profile = _env("DEFAULT_PROFILE", "toefl").lower()
    if profile not in ("toefl", "ielts"):
        profile = "toefl"

    try:
        # 8 MB covers a ~20 s opus clip many times over; a bad client can't fill the disk.
        max_media_bytes = int(_env("MAX_MEDIA_BYTES", "8388608"))
    except ValueError:
        max_media_bytes = 8388608

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
        openai_api_key=_env("OPENAI_API_KEY"),
        openai_model=_env("OPENAI_MODEL", "gpt-4o"),
        # 캠퍼스 vLLM: OPENAI_BASE_URL=http://127.0.0.1:8000/v1
        openai_base_url=openai_base_url,
        llm_provider=provider,
        # 기본값은 "라우팅 없음" — 값을 주지 않으면 기존 프로바이더 체인 그대로다.
        codex_model=_env("CODEX_MODEL", ""),
        codex_base_url=_env("CODEX_BASE_URL", "").rstrip("/"),
        gemma_model=_env("GEMMA_MODEL", ""),
        # 캠퍼스 노드에서는 vLLM 이 곧 Gemma 다 — 주소를 따로 주지 않으면 그걸 쓴다.
        gemma_base_url=(_env("GEMMA_BASE_URL", "").rstrip("/") or openai_base_url),
        default_lang=_env("DEFAULT_LANG", "en"),
        seed_on_start=_env("SEED_ON_START", "1") not in ("0", "false", "no"),
        sqlite_path=sqlite_path,
        media_root=media_root,
        max_media_bytes=max_media_bytes,
        default_profile=profile,
    )
