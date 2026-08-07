"""MediaStore — where a Speaking recording's bytes live (architecture.md §6.4).

Strategy A (`FileMediaStore`) is the local default: `data/media/{session}/{key}.webm`.
Strategy C (`ObjectMediaStore`) keeps the same interface for object storage, so the
router never learns which one is in play — it only ever sees a `MediaRef`.

No new dependency: the object backend takes an injected `uploader` callable, so a
Supabase Storage client can be wired in later without boto3 or a vendor SDK here.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from app.config import get_settings

# Story 3.3 AC3 — browsers give us webm/opus, Safari gives mp4, ogg is the fallback.
ALLOWED_MIME = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
}

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class MediaError(Exception):
    """Raised for an unusable upload; the router maps it onto 413/415."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class MediaRef:
    """What the DB records about one stored blob."""

    storage: str            # file | object | inline
    uri: str
    mime: str
    bytes: int
    sha256: str


def extension_for(mime: str) -> str:
    return ALLOWED_MIME.get((mime or "").split(";")[0].strip().lower(), ".bin")


def normalize_mime(mime: str) -> str:
    """'audio/webm;codecs=opus' → 'audio/webm'; unknown types are rejected (415)."""
    base = (mime or "").split(";")[0].strip().lower()
    if base not in ALLOWED_MIME:
        raise MediaError("Unsupported media type.", status=415)
    return base


def safe_name(value: str) -> str:
    """Path component hardening — a question key must never escape its folder."""
    cleaned = _SAFE.sub("_", (value or "").strip())
    return cleaned or "unknown"


def check_size(data: bytes) -> None:
    limit = get_settings().max_media_bytes
    if len(data) > limit:
        raise MediaError(f"Recording exceeds {limit} bytes.", status=413)


class MediaStore(Protocol):
    def put(self, session: str, question_key: str, data: bytes, mime: str) -> MediaRef: ...

    def get_url(self, ref: MediaRef) -> str: ...

    def read(self, ref: MediaRef) -> bytes: ...


class FileMediaStore:
    """Local disk. One folder per session so a sitting is one `rm -rf` to purge."""

    storage = "file"

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or get_settings().media_root)

    def _path(self, session: str, question_key: str, mime: str) -> Path:
        return self.root / safe_name(session) / (safe_name(question_key) + extension_for(mime))

    def put(self, session: str, question_key: str, data: bytes, mime: str) -> MediaRef:
        mime = normalize_mime(mime)
        check_size(data)
        target = self._path(session, question_key, mime)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return MediaRef(
            storage=self.storage,
            # Relative to media_root so moving the folder does not invalidate rows.
            uri=str(target.relative_to(self.root)),
            mime=mime,
            bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
        )

    def get_url(self, ref: MediaRef) -> str:
        # Never a public static mount — the admin endpoint streams it (Story 3.3 AC6).
        return "/api/admin/media/by-uri/" + ref.uri

    def read(self, ref: MediaRef) -> bytes:
        return (self.root / ref.uri).read_bytes()


class ObjectMediaStore:
    """Object storage (Supabase Storage bucket) behind the same interface.

    `uploader(path, data, mime) -> url` is injected, so this module stays free of
    HTTP clients and vendor SDKs (P1: no new Python dependency).
    """

    storage = "object"

    def __init__(self, uploader: Callable[[str, bytes, str], str], bucket: str = "speaking") -> None:
        self.uploader = uploader
        self.bucket = bucket

    def put(self, session: str, question_key: str, data: bytes, mime: str) -> MediaRef:
        mime = normalize_mime(mime)
        check_size(data)
        path = f"{self.bucket}/{safe_name(session)}/{safe_name(question_key)}{extension_for(mime)}"
        url = self.uploader(path, data, mime)
        return MediaRef(
            storage=self.storage,
            uri=url or path,
            mime=mime,
            bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
        )

    def get_url(self, ref: MediaRef) -> str:
        return ref.uri

    def read(self, ref: MediaRef) -> bytes:  # pragma: no cover — needs the bucket
        raise MediaError("Object storage reads go through the signed URL.", status=501)


_object_uploader: Callable[[str, bytes, str], str] | None = None


def register_object_uploader(fn: Callable[[str, bytes, str], str] | None) -> None:
    """Cloud deployments call this once at start-up to enable ObjectMediaStore."""
    global _object_uploader
    _object_uploader = fn


def get_media_store() -> MediaStore:
    """Cloud with an uploader registered → object storage, otherwise local files.

    Vercel's serverless filesystem loses writes between requests, so cloud mode
    without a registered uploader is a misconfiguration — we still return the file
    store (an upload that vanishes beats an exam that stops, F12) but the caller
    can detect it through `MediaRef.storage`.
    """
    settings = get_settings()
    if settings.is_cloud and _object_uploader is not None:
        return ObjectMediaStore(_object_uploader)
    return FileMediaStore()


__all__ = [
    "ALLOWED_MIME",
    "FileMediaStore",
    "MediaError",
    "MediaRef",
    "MediaStore",
    "ObjectMediaStore",
    "check_size",
    "extension_for",
    "get_media_store",
    "normalize_mime",
    "register_object_uploader",
    "safe_name",
]
