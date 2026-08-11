#!/usr/bin/env python3
"""Supabase → 로컬 백업 (400MB 를 넘으면 자동으로 받아 둔다)

    python3 tools/backup_supabase.py --check       # 지금 몇 MB 쓰는지만 본다
    python3 tools/backup_supabase.py               # 400MB 넘었으면 백업, 아니면 그냥 끝
    python3 tools/backup_supabase.py --force       # 임계값과 무관하게 지금 받는다
    python3 tools/backup_supabase.py --force --zip # 한 파일(.zip)로 묶어서
    python3 tools/backup_supabase.py --threshold-mb 300 --out ~/smeag-backups

필요한 것:  SUPABASE_URL,  SUPABASE_SERVICE_ROLE_KEY
그리고 supabase/usage.sql 을 한 번 적용해 두어야 한다(sg_usage · sg_storage_objects).

── 왜 400MB 인가 ─────────────────────────────────────────────────────────
무료 플랜은 DB 500MB · Storage 1GB 다. DB 가 한도에 닿으면 쓰기가 막히고,
그때는 이미 늦다 — 지우기 전에 원본이 손에 있어야 한다. 그래서 한도가
아니라 그 앞(기본 400MB)에서 백업을 뜬다. 임계값은 **DB + Storage 합계**를
본다. 둘 중 하나가 커져도 결국 손으로 정리해야 하는 건 같기 때문이다.

── 무엇을 받는가 ─────────────────────────────────────────────────────────
    <out>/smeag-backup-<날짜-시각>/
      manifest.json          받은 파일 목록 · 크기 · sha256 · 행 수
      usage.json             그 시점의 사용량 스냅숏
      tables/<테이블>.jsonl  public 스키마 전 테이블, 한 줄 = 한 행
      storage/<버킷>/<경로>  녹음 원본 그대로

JSONL 인 이유는 이어붙이기·grep·부분 복구가 쉬워서다. 한 테이블이 통째로
한 배열이면 379 행 중 한 행을 보려고 파일 전체를 파싱해야 한다.

── 페이지네이션 ──────────────────────────────────────────────────────────
PK 가 있으면 offset 이 아니라 키셋(`pk=gt.<마지막값>`)으로 넘긴다. 백업
도중에도 시험은 돌아가고 행은 계속 들어온다. offset 은 그 사이에 행이
늘면 같은 행을 두 번 받거나 건너뛴다 — 키셋은 그러지 않는다.

── 삭제는 따로 ───────────────────────────────────────────────────────────
백업은 아무것도 지우지 않는다. 자리를 비우려면 --prune-recordings N 을
명시적으로 준다. 그때도 (1) 방금 백업에 같은 크기로 들어 있고
(2) N 일보다 오래된 녹음만 지운다. 답안·점수 테이블은 절대 건드리지 않는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = 1000
TIMEOUT = 120
MB = 1024 * 1024


# ── Supabase REST ─────────────────────────────────────────────────────────


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    def _req(self, method: str, path: str, body: bytes | None = None,
             headers: dict | None = None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read(), dict(resp.headers)

    def rpc(self, fn: str, args: dict):
        body = json.dumps(args).encode("utf-8")
        raw, _ = self._req("POST", f"/rest/v1/rpc/{fn}", body,
                           {"Content-Type": "application/json"})
        return json.loads(raw or b"null")

    def rows(self, table: str, pk: str | None):
        """한 테이블을 페이지 단위로 흘려보낸다. PK 가 있으면 키셋."""
        last = None
        offset = 0
        while True:
            q = [("select", "*"), ("limit", str(PAGE))]
            if pk:
                q.append(("order", f"{pk}.asc"))
                if last is not None:
                    q.append((pk, f"gt.{last}"))
            else:
                # PK 가 없는 테이블(뷰 성격·조인 테이블)은 offset 말고 방법이 없다.
                q.append(("offset", str(offset)))
            path = f"/rest/v1/{table}?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
            raw, _ = self._req("GET", path, None, {"Accept": "application/json"})
            page = json.loads(raw or b"[]")
            if not page:
                return
            yield page
            if len(page) < PAGE:
                return
            if pk:
                last = page[-1].get(pk)
                if last is None:            # PK 가 null? 더 돌면 무한루프다.
                    return
            else:
                offset += len(page)

    def get_object(self, bucket: str, name: str) -> bytes:
        path = "/storage/v1/object/" + urllib.parse.quote(f"{bucket}/{name}")
        raw, _ = self._req("GET", path)
        return raw

    def delete_object(self, bucket: str, name: str) -> None:
        path = "/storage/v1/object/" + urllib.parse.quote(f"{bucket}/{name}")
        self._req("DELETE", path)


# ── 사용량 ────────────────────────────────────────────────────────────────


def human(n: int) -> str:
    return f"{n / MB:,.1f} MB"


def print_usage(u: dict, threshold: int) -> None:
    print(f"  DB       {human(u['db_bytes']):>12}")
    print(f"  Storage  {human(u['storage_bytes']):>12}   ({u['storage_objects']:,} 개)")
    print(f"  합계     {human(u['total_bytes']):>12}   / 임계 {human(threshold)}"
          f"   ({u['total_bytes'] / threshold * 100:.0f}%)")
    big = [t for t in u["tables"] if t["bytes"] >= MB][:5]
    if big:
        print("  큰 테이블:", ", ".join(f"{t['name']} {human(t['bytes'])}" for t in big))


# ── 백업 ──────────────────────────────────────────────────────────────────


def dump_tables(sb: Supabase, usage: dict, dest: Path, manifest: dict) -> int:
    out = dest / "tables"
    out.mkdir(parents=True, exist_ok=True)
    failed = 0
    for t in sorted(usage["tables"], key=lambda x: x["name"]):
        name, pk = t["name"], t.get("pk")
        path = out / f"{name}.jsonl"
        sha = hashlib.sha256()
        n = 0
        try:
            with path.open("wb") as f:
                for page in sb.rows(name, pk):
                    for row in page:
                        line = (json.dumps(row, ensure_ascii=False, sort_keys=True)
                                + "\n").encode("utf-8")
                        f.write(line)
                        sha.update(line)
                        n += 1
        except urllib.error.HTTPError as e:
            print(f"  ✗ {name} — HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
            failed += 1
            continue
        except OSError as e:
            print(f"  ✗ {name} — {e}", file=sys.stderr)
            failed += 1
            continue

        if n == 0:
            path.unlink()               # 빈 테이블은 파일도 남기지 않는다
        else:
            manifest["tables"].append({
                "name": name, "rows": n, "pk": pk,
                "file": f"tables/{name}.jsonl",
                "bytes": path.stat().st_size, "sha256": sha.hexdigest(),
            })
        print(f"  ✓ {name:<24} {n:>7,} 행")
    return failed


def dump_storage(sb: Supabase, dest: Path, manifest: dict) -> int:
    """녹음 원본. 목록은 sg_storage_objects 로 키셋을 돌며 받는다."""
    after, failed, total = "", 0, 0
    while True:
        try:
            page = sb.rpc("sg_storage_objects", {"p_after": after, "p_limit": PAGE})
        except urllib.error.HTTPError as e:
            print(f"  ✗ 목록 — HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
            return failed + 1
        if not page:
            break
        for obj in page:
            after = obj["key"]
            path = dest / "storage" / obj["bucket_id"] / obj["name"]
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                data = sb.get_object(obj["bucket_id"], obj["name"])
            except (urllib.error.HTTPError, OSError) as e:
                print(f"  ✗ {obj['key']} — {e}", file=sys.stderr)
                failed += 1
                continue
            path.write_bytes(data)
            manifest["storage"].append({
                "bucket": obj["bucket_id"], "name": obj["name"],
                "file": f"storage/{obj['bucket_id']}/{obj['name']}",
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "mime": obj.get("mime"), "updated_at": obj.get("updated_at"),
            })
            total += 1
        if len(page) < PAGE:
            break
    if total:
        print(f"  ✓ 녹음 {total:,} 개 "
              f"({human(sum(o['bytes'] for o in manifest['storage']))})")
    return failed


def prune_recordings(sb: Supabase, manifest: dict, dest: Path, days: int) -> int:
    """백업이 확인된 것만, 그것도 days 일보다 오래된 것만 지운다."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    gone = failed = 0
    for obj in manifest["storage"]:
        stamp = obj.get("updated_at")
        if not stamp:
            continue
        try:
            when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when >= cutoff:
            continue
        local = dest / obj["file"]
        # 손에 원본이 없으면 절대 지우지 않는다.
        if not local.exists() or local.stat().st_size != obj["bytes"]:
            print(f"  ! 백업 확인 실패, 건너뜀: {obj['name']}", file=sys.stderr)
            failed += 1
            continue
        try:
            sb.delete_object(obj["bucket"], obj["name"])
            gone += 1
        except (urllib.error.HTTPError, OSError) as e:
            print(f"  ✗ 삭제 실패 {obj['name']} — {e}", file=sys.stderr)
            failed += 1
    print(f"  정리: {gone:,} 개 삭제 ({days}일 초과)")
    return failed


# ── main ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="Supabase 사용량 확인 · 로컬 백업")
    ap.add_argument("--check", action="store_true", help="사용량만 보고 끝낸다")
    ap.add_argument("--force", action="store_true", help="임계값과 무관하게 백업한다")
    ap.add_argument("--threshold-mb", type=int, default=400,
                    help="DB+Storage 합계가 이 값을 넘으면 백업 (기본 400)")
    ap.add_argument("--out", default=str(ROOT / "backups"), help="백업을 받을 폴더")
    ap.add_argument("--zip", action="store_true", help="받은 뒤 한 파일로 묶는다")
    ap.add_argument("--no-storage", action="store_true", help="녹음은 빼고 테이블만")
    ap.add_argument("--prune-recordings", type=int, metavar="DAYS", default=0,
                    help="백업 성공 후 DAYS 일 지난 녹음을 클라우드에서 지운다")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.", file=sys.stderr)
        print("service_role 키는 이 컴퓨터에만 둡니다 — 학생 기기·프런트엔드에 절대 넣지 마십시오.",
              file=sys.stderr)
        return 2

    sb = Supabase(url, key)
    try:
        usage = sb.rpc("sg_usage", {})
    except urllib.error.HTTPError as e:
        print(f"사용량 조회 실패 — HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
        print("supabase/usage.sql 을 SQL Editor 에서 한 번 실행했는지 확인하십시오.",
              file=sys.stderr)
        return 2

    threshold = args.threshold_mb * MB
    print("사용량")
    print_usage(usage, threshold)

    if args.check:
        return 0
    if usage["total_bytes"] < threshold and not args.force:
        print("\n임계값 미만입니다. 백업하지 않습니다. (지금 받으려면 --force)")
        return 0

    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d-%H%M%S")
    dest = Path(args.out).expanduser() / f"smeag-backup-{stamp}"
    dest.mkdir(parents=True, exist_ok=True)
    print(f"\n백업 → {dest}")

    manifest: dict = {
        "schema": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project_url": url,
        "threshold_bytes": threshold,
        "usage": usage,
        "tables": [],
        "storage": [],
    }
    (dest / "usage.json").write_text(
        json.dumps(usage, ensure_ascii=False, indent=1), encoding="utf-8")

    failed = dump_tables(sb, usage, dest, manifest)
    if not args.no_storage:
        failed += dump_storage(sb, dest, manifest)

    manifest["failed"] = failed
    (dest / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(f["bytes"] for f in manifest["tables"] + manifest["storage"])
    print(f"\n받음: 테이블 {len(manifest['tables'])} · 녹음 {len(manifest['storage'])} "
          f"· {human(total)} · 실패 {failed}")

    if failed:
        # 하나라도 빠졌으면 정리는 하지 않는다. 다시 돌리면 새 폴더에 처음부터 받는다.
        print("실패가 있어 정리(--prune-recordings)는 건너뜁니다. 다시 실행하십시오.",
              file=sys.stderr)
    elif args.prune_recordings:
        failed += prune_recordings(sb, manifest, dest, args.prune_recordings)

    if args.zip and not failed:
        archive = shutil.make_archive(str(dest), "zip", root_dir=dest)
        shutil.rmtree(dest)
        print(f"묶음: {archive}  ({human(Path(archive).stat().st_size)})")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
