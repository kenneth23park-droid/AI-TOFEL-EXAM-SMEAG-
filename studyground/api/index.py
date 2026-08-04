"""Vercel serverless entry point — the identical FastAPI app, in cloud mode.

Vercel's @vercel/python runtime looks for a module-level ASGI `app`.
The project root is added to sys.path so `app.*` imports resolve from /api.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Deploys default to cloud mode; vercel.json sets this too, this is the belt-and-braces.
os.environ.setdefault("APP_MODE", "cloud")

from app.main import app  # noqa: E402

__all__ = ["app"]
