#!/usr/bin/env python3
"""교실 서버 → Supabase 업로더 [제안 · 미반영]

    python3 tools/sync_to_supabase.py --dry-run     # 무엇이 올라갈지만 본다
    python3 tools/sync_to_supabase.py               # 실제 업로드
    python3 tools/sync_to_supabase.py --all         # 이미 보낸 것까지 다시

시험이 끝나고 노트북이 인터넷에 붙었을 때 한 번 돌린다.

── 왜 "한 응시 = 한 JSON 봉투" 인가 ────────────────────────────────────────
교실마다 SQLite 가 따로 있고 PK 는 전부 1부터 시작한다. 테이블을 행 단위로
그대로 밀어 넣으면 A 교실의 attempt 3 번과 B 교실의 attempt 3 번이 충돌한다.
로컬 id 를 클라우드 id 로 다시 매핑하는 코드는 길고, 중간에 끊기면 절반만
매핑된 상태로 남는다 — 오프라인 도구에서 가장 피해야 할 실패다.

그래서 응시 하나를 통째로 직렬화해 `sg_attempt_imports` 한 행에 넣고,
자연키인 `session`(attempts 에 이미 unique index 가 걸려 있다)으로 upsert 한다.
행 하나가 원자적이므로 **재실행이 언제나 안전하다.** 어디까지 갔는지 셀 필요가 없다.
정규화는 Supabase 쪽 함수가 맡는다(supabase_import.sql).

── 멱등성 ────────────────────────────────────────────────────────────────
    upsert on (session)   ·   payload 해시가 같으면 서버가 no-op
재전송이 무해하다는 계약은 exam-sync.js 가 학생→교실 구간에서 쓰는 것과 같다.
같은 규칙을 교실→클라우드 구간에도 그대로 적용한다.

── 녹음 파일 ─────────────────────────────────────────────────────────────
JSON 봉투에는 media 의 **메타데이터만** 담는다. 오디오 본체는 별도로,
답안이 다 올라간 뒤에 Storage 로 보낸다. 녹음 하나가 막혀서 점수 전체가
밀리면 안 된다. (--with-media 로 같은 실행에서 이어서 할 수 있다.)
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import SessionLocal, create_all  # noqa: E402
from app.migrations import run_migrations  # noqa: E402
from app.models import (  # noqa: E402
    AiFeedback,
    Attempt,
    AttemptEvent,
    MediaAsset,
    QuestionResponse,
    RubricScore,
    SectionScore,
)

IMPORT_TABLE = "sg_attempt_imports"
BUCKET = "sg-recordings"
TIMEOUT = 30


# ── 직렬화 ────────────────────────────────────────────────────────────────


def _val(v):
    """SQLAlchemy 컬럼 값을 JSON 이 받는 형태로."""
    if isinstance(v, datetime):
        # 순진한 datetime 은 UTC 로 본다 — 교실 서버는 UTC 로 스탬프한다.
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    if isinstance(v, date):        # exam_date 처럼 시각 없는 컬럼
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return base64.b64encode(v).decode("ascii")
    return v


def _row(obj, skip: set[str] = frozenset()) -> dict:
    cols = obj.__table__.columns.keys()
    return {c: _val(getattr(obj, c)) for c in cols if c not in skip}


def serialize(db, attempt: Attempt) -> dict:
    """응시 하나를 봉투 하나로. 로컬 PK 는 전부 뺀다 — 클라우드에서 무의미하다."""
    drop = {"id", "attempt_id", "student_id", "exam_id"}
    q = db.query

    return {
        "schema": 1,
        "session": attempt.session,
        "student_no": attempt.student.student_no,
        "student": _row(attempt.student, skip={"id"}),
        "exam_code": attempt.exam.code,
        "attempt": _row(attempt, skip=drop),
        "question_responses": [
            _row(r, skip=drop) for r in q(QuestionResponse).filter_by(attempt_id=attempt.id).all()
        ],
        "section_scores": [
            _row(r, skip=drop) for r in q(SectionScore).filter_by(attempt_id=attempt.id).all()
        ],
        "rubric_scores": [
            _row(r, skip=drop) for r in q(RubricScore).filter_by(attempt_id=attempt.id).all()
        ],
        "ai_feedback": [
            _row(r, skip=drop) for r in q(AiFeedback).filter_by(attempt_id=attempt.id).all()
        ],
        "events": [
            _row(r, skip=drop) for r in q(AttemptEvent).filter_by(attempt_id=attempt.id).all()
        ],
        # 오디오 본체는 여기 없다 — uri 만 담고 Storage 로 따로 보낸다.
        "media": [_row(r, skip=drop) for r in q(MediaAsset).filter_by(attempt_id=attempt.id).all()],
    }


def digest(envelope: dict) -> str:
    raw = json.dumps(envelope, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


# ── Supabase ──────────────────────────────────────────────────────────────


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def _req(self, method: str, path: str, body: bytes | None, headers: dict) -> bytes:
        base = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
        }
        base.update(headers)
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=base)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read()

    def upsert_attempt(self, envelope: dict, sha: str) -> None:
        row = {
            "session": envelope["session"],
            "student_no": envelope["student_no"],
            "exam_code": envelope["exam_code"],
            "payload": envelope,
            "payload_sha256": sha,
            "imported_at": datetime.now(timezone.utc).isoformat(),
        }
        self._req(
            "POST",
            f"/rest/v1/{IMPORT_TABLE}?on_conflict=session",
            json.dumps(row, ensure_ascii=False).encode("utf-8"),
            {
                "Content-Type": "application/json",
                # merge-duplicates = 진짜 upsert. 같은 session 을 다시 보내도 행이 늘지 않는다.
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )

    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self._req(
            "POST",
            f"/storage/v1/object/{BUCKET}/{key}",
            data,
            {"Content-Type": content_type, "x-upsert": "true"},
        )


# ── 로컬 진행 기록 ────────────────────────────────────────────────────────
# app 의 스키마는 건드리지 않는다. 사이드카 파일에만 남긴다.


class Ledger:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, str] = {}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))

    def sent(self, session: str, sha: str) -> bool:
        return self.data.get(session) == sha

    def mark(self, session: str, sha: str) -> None:
        self.data[session] = sha
        self.path.write_text(json.dumps(self.data, indent=1, sort_keys=True), encoding="utf-8")


# ── main ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="교실 SQLite → Supabase 업로더")
    ap.add_argument("--dry-run", action="store_true", help="무엇이 올라갈지만 출력")
    ap.add_argument("--all", action="store_true", help="이미 보낸 것도 다시 보낸다")
    ap.add_argument("--with-media", action="store_true", help="답안 뒤에 녹음까지 올린다")
    ap.add_argument("--ledger", default=str(ROOT / "data" / "sync-ledger.json"))
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.dry_run and not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.", file=sys.stderr)
        print("service_role 키는 이 서버에만 둡니다 — 학생 기기에 절대 내려보내지 마십시오.",
              file=sys.stderr)
        return 2

    # 교실 노트북의 DB 는 앱보다 오래됐을 수 있다(예: rubric_scores.question_key 이전).
    # 앱이 부팅 때 하는 것과 같은 정렬을 여기서도 한 번 해 둔다 — 안 하면
    # 봉투를 만들다 컬럼이 없어 죽는다.
    create_all()
    run_migrations()

    ledger_path = Path(args.ledger)
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(ledger_path)
    sb = Supabase(url, key) if not args.dry_run else None

    db = SessionLocal()
    ok = skipped = failed = 0
    try:
        # 아직 진행 중인 응시는 건드리지 않는다 — 시험 도중에 돌려도 안전하다.
        attempts = db.query(Attempt).filter(Attempt.status != "in_progress").all()
        if not attempts:
            print("올릴 응시가 없습니다.")
            return 0

        for attempt in attempts:
            if not attempt.session:
                # session 이 자연키다. 없으면 클라우드에서 식별할 방법이 없다.
                print(f"  ! attempt {attempt.id}: session 이 비어 건너뜁니다")
                failed += 1
                continue

            envelope = serialize(db, attempt)
            sha = digest(envelope)

            if not args.all and ledger.sent(attempt.session, sha):
                skipped += 1
                continue

            size_kb = len(json.dumps(envelope, ensure_ascii=False).encode()) // 1024
            label = f"{attempt.session}  {attempt.student.student_no}  {size_kb} KB"

            if args.dry_run:
                print(f"  → {label}")
                ok += 1
                continue

            try:
                sb.upsert_attempt(envelope, sha)
                ledger.mark(attempt.session, sha)
                print(f"  ✓ {label}")
                ok += 1
            except urllib.error.HTTPError as e:
                print(f"  ✗ {label} — HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
                failed += 1
            except OSError as e:
                # 회선이 다시 끊겼다. 여기서 멈춰도 다음 실행이 이어받는다.
                print(f"  ✗ {label} — {e}", file=sys.stderr)
                failed += 1

        if args.with_media and not args.dry_run:
            failed += upload_media(db, sb)

    finally:
        db.close()

    print(f"\n올림 {ok} · 건너뜀 {skipped} · 실패 {failed}")
    if failed:
        print("실패분은 그냥 다시 실행하십시오 — upsert 라 중복은 생기지 않습니다.")
    return 1 if failed else 0


def upload_media(db, sb: Supabase) -> int:
    """녹음 본체. 답안이 다 올라간 뒤에만 부른다."""
    from app.config import get_settings

    root = get_settings().media_root
    failed = 0
    for asset in db.query(MediaAsset).all():
        path = root / asset.uri.lstrip("/")
        if not path.exists():
            print(f"  ! 파일 없음: {asset.uri}")
            failed += 1
            continue
        # 교실 로컬 경로가 아니라 session 으로 키를 만든다 — 교실 간 충돌이 없다.
        key = f"{asset.attempt.session}/{asset.question_key}.{path.suffix.lstrip('.')}"
        try:
            sb.put_object(key, path.read_bytes(), asset.mime or "audio/webm")
            print(f"  ✓ media {key}")
        except (urllib.error.HTTPError, OSError) as e:
            print(f"  ✗ media {key} — {e}", file=sys.stderr)
            failed += 1
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
