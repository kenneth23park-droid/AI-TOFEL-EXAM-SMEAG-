#!/usr/bin/env python3
"""시험 당일 — 학생 한 명 = 파일 하나. 로컬에 두고, 같은 것을 Supabase 에도 올린다.

    python3 tools/backup_students.py --source cloud     # sg2 실전 응시(Supabase) — 시험 당일 기본
    python3 tools/backup_students.py                    # 교실 SQLite(오프라인 채점 서버) 응시
    python3 tools/backup_students.py --date 2026-08-12  # 다른 날짜
    python3 tools/backup_students.py --no-upload        # 로컬에만
    python3 tools/backup_students.py --dry-run          # 누가 몇 KB 인지만

필요한 것(업로드·cloud 소스일 때):  SUPABASE_URL,  SUPABASE_SERVICE_ROLE_KEY

── 두 소스 ───────────────────────────────────────────────────────────────
학생 답안이 사는 곳이 두 군데다. 시험을 어느 쪽으로 쳤든 같은 모양의
학생별 파일이 나오도록 두 소스를 모두 받는다.

  --source cloud   sg2 → Supabase.  sg_results · sg_task_scores · sg_comments
                   학생 식별은 sg_exam_accounts (smeagNNN ↔ owner uuid).
                   녹음은 toefl-recordings 의 media_path 로 받는다.
  --source local   교실 SQLite.      attempts · question_responses · …
                   녹음은 media_root 에서 복사한다.

레거시 리플리카(sg_attempts)는 날마다 바뀌는 물건이 아니라 여기서 다루지
않는다. 그쪽은 전체 덤프(backup_supabase.py)가 맡는다.

── 왜 전체 덤프(backup_supabase.py) 로는 부족한가 ─────────────────────────
전체 덤프는 "그날 DB 가 이랬다" 를 말해 준다. 그런데 시험 당일 실제로 터지는
질문은 언제나 한 명 단위다 — "3번 학생 스피킹이 안 들어갔다는데요". 그때
379행짜리 테이블 덤프에서 그 학생 행을 골라내는 일을 사고 난 뒤에 하고 싶지는
않다. 그래서 당일에는 학생별로 미리 갈라 둔다. 파일 하나만 열면 그 학생의
응시·문항응답·섹션점수·루브릭·AI피드백·이벤트·녹음이 다 들어 있다.

── 두 곳에 두는 이유 ─────────────────────────────────────────────────────
로컬(교실 노트북)은 빠르지만 그 노트북이 죽으면 같이 죽는다. Supabase 는
살아남지만 회선이 끊기면 그날은 못 만든다. 그래서 로컬을 먼저 완성하고,
그다음 같은 바이트를 올린다. 업로드가 실패해도 로컬 백업은 이미 손에 있다.

── 무엇이 만들어지는가 ───────────────────────────────────────────────────
    backups/students/<시험날짜>/
      manifest.json                    그날 만든 파일 목록 · 크기 · sha256
      <학번>-<이름>/
        bundle.json                    이 학생의 그날 전부 (아래 참조)
        media/<question_id>.webm       스피킹 녹음 원본 (--no-media 로 생략)

    Supabase Storage  sg-backups/<시험날짜>/<학번>.json      ← bundle.json 과 동일

녹음 본체는 클라우드로 다시 올리지 않는다. 이미 toefl-recordings 에 있고
(무료 플랜 1GB), 백업이 같은 파일을 두 벌 차지할 이유가 없다. bundle.json
안의 media[].storage_key 가 그 원본을 가리킨다. 반대로 로컬에는 받아 둔다 —
녹음은 90일 뒤 클라우드에서 지워지고(purge_after), 그때 남는 건 이 파일뿐이다.

── 멱등성 ────────────────────────────────────────────────────────────────
같은 날짜로 몇 번을 돌려도 같은 경로를 덮어쓴다(로컬 파일 · Storage x-upsert).
시험 중간에 한 번, 끝나고 한 번 돌리는 운용을 그대로 받는다.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

BUCKET = "sg-backups"                    # 이 도구가 만드는 곳
RECORDINGS_BUCKET = "toefl-recordings"   # sg2 가 녹음을 올리는 곳
SYNC_BUCKET = "sg-recordings"            # sync_to_supabase.py(교실 서버) 규약
TIMEOUT = 60
PAGE = 1000


# ── 값 변환 ───────────────────────────────────────────────────────────────


def _val(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:                 # 교실 서버는 UTC 로 스탬프한다
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return base64.b64encode(v).decode("ascii")
    return v


def _row(obj, skip: frozenset = frozenset()) -> dict:
    cols = obj.__table__.columns.keys()
    return {c: _val(getattr(obj, c)) for c in cols if c not in skip}


def safe(part: str) -> str:
    """폴더 이름으로 쓸 수 있게. 한글은 그대로 두고 경로 문자만 막는다."""
    part = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", (part or "").strip())
    return part[:64] or "_"


# ── 로컬(SQLite) 에서 읽기 ────────────────────────────────────────────────


def collect_local(target: date) -> list[dict]:
    from app.db import SessionLocal, create_all
    from app.migrations import run_migrations
    from app.models import (
        AiFeedback, Attempt, AttemptEvent, MediaAsset,
        QuestionResponse, RubricScore, SectionScore,
    )

    # 교실 노트북 DB 가 앱보다 오래됐을 수 있다. 앱이 부팅 때 하는 정렬을 여기서도.
    create_all()
    run_migrations()

    drop = frozenset({"id", "attempt_id", "student_id", "exam_id"})
    day_start = datetime.combine(target, datetime.min.time())
    day_end = day_start + timedelta(days=1)

    db = SessionLocal()
    try:
        rows = (db.query(Attempt)
                .filter((Attempt.exam_date == target)
                        | ((Attempt.exam_date.is_(None))
                           & (Attempt.taken_at >= day_start)
                           & (Attempt.taken_at < day_end)))
                .order_by(Attempt.id).all())

        by_student: dict[str, dict] = {}
        for a in rows:
            q = db.query
            envelope = {
                "session": a.session,
                "exam_code": a.exam.code if a.exam else None,
                "attempt": _row(a, skip=drop),
                "section_scores": [_row(r, skip=drop)
                                   for r in q(SectionScore).filter_by(attempt_id=a.id).all()],
                "question_responses": [_row(r, skip=drop)
                                       for r in q(QuestionResponse).filter_by(attempt_id=a.id).all()],
                "rubric_scores": [_row(r, skip=drop)
                                  for r in q(RubricScore).filter_by(attempt_id=a.id).all()],
                "ai_feedback": [_row(r, skip=drop)
                                for r in q(AiFeedback).filter_by(attempt_id=a.id).all()],
                "events": [_row(r, skip=drop)
                           for r in q(AttemptEvent).filter_by(attempt_id=a.id).all()],
                "media": [],
            }
            for m in q(MediaAsset).filter_by(attempt_id=a.id).all():
                meta = _row(m, skip=drop)
                # sync_to_supabase.py 가 쓰는 것과 같은 키. 그 도구로 올렸다면
                # 원본을 다시 올리지 않아도 이 값으로 클라우드의 녹음을 찾는다.
                meta["storage_key"] = (f"{SYNC_BUCKET}/{a.session}/{m.question_key}"
                                       f"{Path(m.uri).suffix}") if a.session else None
                meta["_local_uri"] = m.uri
                envelope["media"].append(meta)

            no = a.student.student_no
            bundle = by_student.setdefault(no, {
                "student_no": no,
                "student": _row(a.student, skip=frozenset({"id"})),
                "attempts": [],
            })
            bundle["attempts"].append(envelope)
        return list(by_student.values())
    finally:
        db.close()


def copy_media(bundle: dict, dest: Path) -> tuple[int, int]:
    """녹음 원본을 학생 폴더로 복사. (성공, 실패) 를 돌려준다."""
    from app.config import get_settings

    root = get_settings().media_root
    ok = missing = 0
    for att in bundle["attempts"]:
        for m in att["media"]:
            uri = m.pop("_local_uri", "") or ""
            if not uri:
                continue
            src = root / uri.lstrip("/")
            if not src.exists():
                m["file"] = None
                m["missing"] = True
                missing += 1
                continue
            name = f"{safe(m.get('question_key') or 'media')}{Path(uri).suffix}"
            out = dest / "media" / name
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
            data = out.read_bytes()
            m["file"] = f"media/{name}"
            m["bytes"] = len(data)
            m["sha256"] = hashlib.sha256(data).hexdigest()
            ok += 1
    return ok, missing


def strip_internal(bundle: dict) -> None:
    """파일로 나가기 전에 내부용 힌트를 턴다."""
    for att in bundle["attempts"]:
        for m in att["media"]:
            m.pop("_local_uri", None)
            m.pop("_cloud_path", None)


# ── 클라우드(Supabase REST) 에서 읽기 ─────────────────────────────────────


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def _req(self, method: str, path: str, body: bytes | None = None,
             headers: dict | None = None) -> bytes:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read()

    def select(self, table: str, query: list[tuple[str, str]], pk: str = "id") -> list[dict]:
        """PK 키셋으로 전부 받는다 — offset 은 시험 중 행이 늘면 어긋난다."""
        out: list[dict] = []
        last = None
        while True:
            q = list(query) + [("select", "*"), ("order", f"{pk}.asc"), ("limit", str(PAGE))]
            if last is not None:
                q.append((pk, f"gt.{last}"))
            path = f"/rest/v1/{table}?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
            page = json.loads(self._req("GET", path, None, {"Accept": "application/json"}) or b"[]")
            out.extend(page)
            if len(page) < PAGE:
                return out
            last = page[-1].get(pk)
            if last is None:
                return out

    def get_object(self, bucket: str, key: str) -> bytes:
        path = "/storage/v1/object/" + urllib.parse.quote(f"{bucket}/{key}")
        return self._req("GET", path)

    def ensure_bucket(self, name: str) -> None:
        try:
            self._req("POST", "/storage/v1/bucket",
                      json.dumps({"id": name, "name": name, "public": False}).encode("utf-8"),
                      {"Content-Type": "application/json"})
        except urllib.error.HTTPError as e:
            if e.code not in (400, 409):       # 이미 있으면 그대로 쓴다
                raise

    def put_object(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        path = "/storage/v1/object/" + urllib.parse.quote(f"{bucket}/{key}")
        self._req("POST", path, data, {"Content-Type": content_type, "x-upsert": "true"})


def collect_cloud(sb: Supabase, target: date) -> list[dict]:
    """sg2 응시. 한 응시 = sg_results 한 행이고, 나머지는 (owner, session) 으로 붙는다."""
    # 시험은 이 컴퓨터의 시간대로 하루다. timestamptz 비교는 offset 을 붙여 보낸다 —
    # UTC 로 잘라 버리면 아침 9시(KST) 이전 응시가 전날로 새어 나간다.
    lo = datetime.combine(target, datetime.min.time()).astimezone()
    hi = lo + timedelta(days=1)

    results = sb.select("sg_results", [("created_at", f"gte.{lo.isoformat()}"),
                                       ("created_at", f"lt.{hi.isoformat()}")])
    if not results:
        return []

    owners = sorted({r["owner"] for r in results})
    sessions = sorted({r["session"] for r in results if r.get("session")})
    owner_in = "(" + ",".join(f'"{o}"' for o in owners) + ")"
    session_in = "(" + ",".join(f'"{s}"' for s in sessions) + ")" if sessions else "()"

    # 계정(smeagNNN ↔ owner). 시험 계정은 그날치만 만들어지지만, 다른 날 계정으로
    # 친 응시도 있으므로 owner 로 찾는다 — exam_date 로 거르지 않는다.
    accounts = {a["user_id"]: a for a in
                sb.select("sg_exam_accounts", [("user_id", f"in.{owner_in}")])}

    tasks: dict[tuple, list] = {}
    comments: dict[tuple, list] = {}
    if sessions:
        for t in sb.select("sg_task_scores", [("session", f"in.{session_in}")]):
            tasks.setdefault((t["owner"], t["session"]), []).append(t)
        for c in sb.select("sg_comments", [("session", f"in.{session_in}")]):
            comments.setdefault((c["owner"], c["session"]), []).append(c)

    by_student: dict[str, dict] = {}
    for r in sorted(results, key=lambda x: (x["owner"], x.get("created_at") or "")):
        owner, session = r["owner"], r.get("session")
        acct = accounts.get(owner, {})
        key = (owner, session)

        envelope = {
            "session": session,
            "exam_code": r.get("set_code"),
            "attempt": r,
            "task_scores": tasks.get(key, []),
            "comments": comments.get(key, []),
            "media": [],
        }
        # 녹음 경로는 sg_task_scores.media_path 가 이미 정확히 갖고 있다
        # ({owner}/{session}/{question_id}.ext). 따로 목록 API 를 돌 필요가 없다.
        for t in tasks.get(key, []):
            path = (t.get("media_path") or "").strip()
            if path:
                envelope["media"].append({
                    "question_id": t.get("question_id"),
                    "skill": t.get("skill"),
                    "storage_key": f"{RECORDINGS_BUCKET}/{path}",
                    "_cloud_path": path,
                })

        # 학번은 유일하지 않다 — smeag000 을 여러 사람이 쓴다(시험 계정 재사용).
        # 파일을 학번으로만 가르면 남남이 한 파일에 섞인다. 진짜 열쇠는 owner 다.
        no = f"{acct.get('student_id') or 'unknown'}-{owner[:8]}"
        bundle = by_student.setdefault(no, {
            "student_no": no,
            "student": {"student_id": acct.get("student_id"), "name": acct.get("name", ""),
                        "email": acct.get("email"), "owner": owner,
                        "exam_date": acct.get("exam_date"),
                        "teacher_id": acct.get("teacher_id")},
            "attempts": [],
        })
        bundle["attempts"].append(envelope)
    return list(by_student.values())


def download_media(sb: Supabase, bundle: dict, dest: Path) -> tuple[int, int]:
    """클라우드 녹음을 학생 폴더로. 90일 뒤 지워지는 원본을 여기서 붙잡는다."""
    ok = missing = 0
    for att in bundle["attempts"]:
        for m in att["media"]:
            path = m.pop("_cloud_path", "") or ""
            if not path:
                continue
            name = f"{safe(m.get('question_id') or 'media')}{Path(path).suffix or '.webm'}"
            out = dest / "media" / name
            out.parent.mkdir(parents=True, exist_ok=True)
            try:
                data = sb.get_object(RECORDINGS_BUCKET, path)
            except (urllib.error.HTTPError, OSError) as e:
                print(f"  ! 녹음 없음 {path} — {e}", file=sys.stderr)
                m["file"] = None
                m["missing"] = True
                missing += 1
                continue
            out.write_bytes(data)
            m["file"] = f"media/{name}"
            m["bytes"] = len(data)
            m["sha256"] = hashlib.sha256(data).hexdigest()
            ok += 1
    return ok, missing


# ── main ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="시험 당일 학생별 백업 (로컬 + Supabase)")
    ap.add_argument("--date", help="시험 날짜 YYYY-MM-DD (기본: 오늘)")
    ap.add_argument("--source", choices=("cloud", "local"), default="cloud",
                    help="어디서 읽을지 (기본 cloud = sg2 실전 응시)")
    ap.add_argument("--out", default=str(ROOT / "backups" / "students"), help="받을 폴더")
    ap.add_argument("--no-upload", action="store_true", help="Supabase 로 올리지 않는다")
    ap.add_argument("--no-media", action="store_true", help="녹음 복사를 생략한다")
    ap.add_argument("--zip", action="store_true", help="학생 폴더를 각각 zip 으로 묶는다")
    ap.add_argument("--dry-run", action="store_true", help="누가 얼마인지만 출력")
    args = ap.parse_args()

    try:
        target = date.fromisoformat(args.date) if args.date else date.today()
    except ValueError:
        print("--date 는 YYYY-MM-DD 형식입니다.", file=sys.stderr)
        return 2

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    need_key = (args.source == "cloud") or not (args.no_upload or args.dry_run)
    if need_key and not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.", file=sys.stderr)
        print("service_role 키는 이 컴퓨터에만 둡니다 — 학생 기기·프런트엔드에 넣지 마십시오.",
              file=sys.stderr)
        return 2
    sb = Supabase(url, key) if (url and key) else None

    print(f"시험 날짜 {target}  ·  소스 {args.source}")
    try:
        bundles = collect_cloud(sb, target) if args.source == "cloud" else collect_local(target)
    except urllib.error.HTTPError as e:
        print(f"조회 실패 — HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
        return 2
    if not bundles:
        print("그날 응시가 없습니다.")
        return 0

    bundles.sort(key=lambda b: b["student_no"])
    stamp = datetime.now(timezone.utc).isoformat()
    day_dir = Path(args.out).expanduser() / target.isoformat()
    manifest = {"schema": 1, "created_at": stamp, "exam_date": target.isoformat(),
                "source": args.source, "students": []}
    uploaded = failed = 0

    for b in bundles:
        no = b["student_no"]
        name = b["student"].get("name", "")
        folder = day_dir / f"{safe(no)}-{safe(name)}"

        payload = {
            "schema": 1,
            "created_at": stamp,
            "exam_date": target.isoformat(),
            "source": args.source,
            "student_no": no,
            "student": b["student"],
            "attempts": b["attempts"],
        }

        if args.dry_run:
            strip_internal(payload)
            kb = len(json.dumps(payload, ensure_ascii=False).encode()) // 1024
            n_media = sum(len(a["media"]) for a in payload["attempts"])
            print(f"  → {no:<12} {name:<12} 응시 {len(payload['attempts'])} · "
                  f"녹음 {n_media} · {kb} KB")
            continue

        folder.mkdir(parents=True, exist_ok=True)
        media_ok = media_missing = 0
        if not args.no_media:
            if args.source == "local":
                media_ok, media_missing = copy_media(payload, folder)
            elif sb:
                media_ok, media_missing = download_media(sb, payload, folder)
        strip_internal(payload)

        raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
        (folder / "bundle.json").write_bytes(raw)
        sha = hashlib.sha256(raw).hexdigest()

        entry = {
            "student_no": no, "name": name,
            "dir": folder.name, "bytes": len(raw), "sha256": sha,
            "attempts": len(payload["attempts"]),
            "media_files": media_ok, "media_missing": media_missing,
            "uploaded": False,
        }

        # 로컬이 먼저 완성된 다음에 올린다. 업로드가 실패해도 백업은 이미 손에 있다.
        if sb and not args.no_upload:
            try:
                sb.ensure_bucket(BUCKET)
                sb.put_object(BUCKET, f"{target.isoformat()}/{safe(no)}.json",
                              raw, "application/json")
                entry["uploaded"] = True
                uploaded += 1
            except (urllib.error.HTTPError, OSError) as e:
                detail = e.read()[:200] if isinstance(e, urllib.error.HTTPError) else e
                print(f"  ✗ 업로드 {no} — {detail}", file=sys.stderr)
                failed += 1

        if args.zip:
            archive = shutil.make_archive(str(folder), "zip", root_dir=folder)
            shutil.rmtree(folder)
            entry["zip"] = Path(archive).name

        manifest["students"].append(entry)
        mark = "↑" if entry["uploaded"] else " "
        warn = f"  ! 녹음 {media_missing} 개 없음" if media_missing else ""
        print(f"  ✓{mark} {no:<12} {name:<12} 응시 {entry['attempts']} · "
              f"녹음 {media_ok} · {len(raw) // 1024} KB{warn}")

    if args.dry_run:
        print(f"\n학생 {len(bundles)} 명 (dry-run — 아무것도 쓰지 않았습니다)")
        return 0

    manifest["failed"] = failed
    day_dir.mkdir(parents=True, exist_ok=True)
    (day_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n로컬 {len(manifest['students'])} 명 → {day_dir}")
    if not args.no_upload:
        print(f"클라우드 {uploaded} 명 → {BUCKET}/{target.isoformat()}/  · 실패 {failed}")
        if failed:
            print("실패분은 그냥 다시 실행하십시오 — 같은 경로를 덮어씁니다.", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
