#!/usr/bin/env python3
"""음원을 새로 넣거나 교체했을 때 도는 게이트 — 생성기를 안 거친 경로까지 덮는다.

tools/tts_set9.py 와 sg2/tools/tts_multivoice.py 는 생성 직후 스스로 verify_audio.py 를
부른다. 그런데 실제로 음원이 바뀌는 경로는 그 둘만이 아니다. 손으로 mp3 를 덮어쓰거나,
외부에서 받은 파일을 복사하거나, 게이트가 없는 다른 생성기(tts_google/tts_kokoro)를
돌리면 아무것도 검사하지 않은 음원이 그대로 발행된다. 그 구멍을 막는 진입점이다.

무엇이 바뀌었는지는 git 이 아니라 **사이드카 인덱스**(.audio-index.<매니페스트>.json)가 판단한다.
git 을 기준으로 삼으면 커밋하지 않은 교체나 git 밖에서 복사한 파일을 놓친다. 인덱스는
mp3 바이트 해시와 대본·음성정책 해시를 들고 있으므로, 어느 경로로 바뀌었든 걸린다.

계층 3(ASR)은 기본으로 켜져 있고, 바뀐 음원에만 돈다. 항목당 2~3초라 40개 세트 전체를
매번 전사하면 분 단위가 되지만, 실제로 교체되는 건 보통 한두 개다.

인덱스 갱신은 --stamp-on-pass 로만 한다. FAIL 이 있으면 기준을 굳히지 않으므로, 고치기
전까지 다음 실행이 같은 파일을 계속 잡는다.

    studyground/.venv/bin/python tools/audio_gate.py            # 바뀐 음원 검사 + 통과 시 기준 갱신
    studyground/.venv/bin/python tools/audio_gate.py --dry-run  # 무엇이 바뀌었는지만 본다
    studyground/.venv/bin/python tools/audio_gate.py --all      # 전수 재검사(ASR 포함)
    studyground/.venv/bin/python tools/audio_gate.py --require-stt   # ASR 없으면 차단
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
STUDYGROUND = TOOLS.parent
SG2 = STUDYGROUND / "sg2"
_MULTIVOICE = SG2 / "tools" / "tts_multivoice.py"

sys.path.insert(0, str(TOOLS))
import verify_audio as va  # noqa: E402

#: 기본 매니페스트. tts_multivoice 가 tts-voices*.json 의 합집합으로 굽는 파생 매니페스트로,
#: media/audio/set9/ 와 media/tts/ 를 모두 덮는다(80항목). 세트별 매니페스트를 따로 돌리면
#: 같은 파일을 두 번 전사하게 된다.
DERIVED = SG2 / ".verify-manifest.tts.json"


def refresh_derived() -> tuple[Path | None, str]:
    """파생 매니페스트를 tts-voices*.json 에서 다시 굽는다.

    대본을 고쳤는데 파생 매니페스트가 낡아 있으면, 게이트는 옛 대본과 대조해 '통과'를
    낸다. 검사 직전에 다시 굽는 것이 그 거짓 통과를 막는 유일한 방법이다.
    """
    spec = importlib.util.spec_from_file_location("_tts_multivoice", _MULTIVOICE)
    if spec is None or spec.loader is None or not _MULTIVOICE.exists():
        return (DERIVED if DERIVED.exists() else None,
                f"tts_multivoice.py 를 못 읽어 파생 매니페스트를 다시 굽지 못했다 ({_MULTIVOICE})")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        return mod.build_verify_manifest(), ""
    except Exception as exc:  # noqa: BLE001
        return (DERIVED if DERIVED.exists() else None,
                f"파생 매니페스트 재생성 실패({exc}) — 디스크에 있던 것을 쓴다")


#: 대조 화면(admin-audio-sync.html)이 읽는 받아쓰기 파일들.
REVIEW_CONFIGS = SG2 / "config"


#: 이 사유로 걸린 항목만 받아쓰기를 새로 쓴다 — 음원 바이트가 실제로 달라진 경우.
#: 'ASR 미대조'(최초 백필)나 '대본 변경'은 음원이 그대로라 기존 받아쓰기가 여전히 옳다.
_AUDIO_REPLACED = ("음원 교체됨", "인덱스에 기준이 없음(신규)", "음원 파일 없음")


def sync_review_page(rep: dict, base: Path, reasons: dict[str, str] | None = None) -> dict:
    """`config/audio-check.<set>.json` 의 받아쓰기를 갱신한다.

    그 화면은 대본 옆에 '실제로 뭐라고 읽혔는지'를 놓고 어긋난 단어를 형광으로 칠한다.
    음원을 교체했는데 이 파일이 그대로면, 화면은 **옛 음원의 받아쓰기**와 새 대본을 견주며
    "일치"라고 말한다 — 검증 화면이 낼 수 있는 가장 나쁜 형태의 거짓 초록이다.

    **음원 바이트가 실제로 달라진 클립만** 갱신한다. 이미 들어 있는 받아쓰기는
    CrisperWhisper 산출물이라 이 게이트의 small 모델보다 정밀하다 — 멀쩡한 것을 덮어쓰면
    화면 품질이 내려간다. 최초 백필('ASR 미대조')처럼 음원은 그대로인 경우에는 받아쓰기를
    건드리지 않고 **지금 바이트의 해시만 찍어 둔다**(그 받아쓰기는 지금 이 파일로 만든 것이
    맞다). 그 다음부터 바이트가 달라지면 그때 갱신한다. 받아쓰기가 아예 없던 항목은 채운다.
    """
    out = {"updated": [], "stamped": [], "filled": [], "unknown": [], "files": []}
    if not REVIEW_CONFIGS.is_dir():
        return out

    # id → 이번 실행이 실제로 전사한 결과
    fresh: dict[str, dict] = {}
    for it in rep.get("items", []):
        l3 = (it.get("layers") or {}).get("layer3_transcript") or {}
        if l3.get("status") == "OK" and (l3.get("transcript") or "").strip():
            fresh[it["id"]] = {
                "transcript": l3["transcript"],
                "sha": (it["layers"].get("layer0_mapping") or {}).get("audioSha256", ""),
                "backend": l3.get("backend", ""),
            }
    if not fresh:
        return out

    seen: set[str] = set()
    for cfg in sorted(REVIEW_CONFIGS.glob("audio-check.*.json")):
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
        except Exception:                                    # noqa: BLE001
            continue
        dirty = False
        for row in data.get("items", []):
            f = fresh.get(row.get("id"))
            if not f:
                continue
            seen.add(row["id"])
            if row.get("asrAudioSha256") == f["sha"]:
                continue                                      # 이미 이 바이트의 받아쓰기다
            had = bool((row.get("asr") or "").strip())
            replaced = (reasons or {}).get(row["id"]) in _AUDIO_REPLACED
            if had and not replaced:
                # 음원은 그대로다 — 더 정밀한 기존 받아쓰기를 살리고 해시만 도장 찍는다
                row["asrAudioSha256"] = f["sha"]
                out["stamped"].append(row["id"])
                dirty = True
                continue
            row["asr"] = f["transcript"]
            row["asrAudioSha256"] = f["sha"]
            row["asrSource"] = f"verify_audio layer3 ({f['backend']})"
            (out["updated"] if had else out["filled"]).append(row["id"])
            dirty = True
        if dirty:
            cfg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
            out["files"].append(cfg.name)
    out["unknown"] = sorted(set(fresh) - seen)
    return out


def changed_ids(manifest_path: Path, base: Path) -> list[tuple[str, str]]:
    """검사 대상 (id, 사유) 목록. verify() 와 같은 판정 함수를 쓴다."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = manifest.get("items") or []
    out_dirs = {(base / it["out"]).parent for it in items if it.get("out")}
    mkey = va.manifest_key_for(manifest_path)
    indexes = {d: va.load_index(d, mkey) for d in out_dirs}
    out = []
    for it in items:
        why = va.change_reason(it, manifest, base, indexes)
        if why:
            out.append((it.get("id", "?"), why))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", default=str(DERIVED))
    ap.add_argument("--base", default=str(SG2))
    ap.add_argument("--all", action="store_true",
                    help="바뀐 것만이 아니라 전수 검사(ASR 포함). 느리다")
    ap.add_argument("--dry-run", action="store_true",
                    help="무엇이 바뀌었는지만 나열하고 검사는 하지 않는다")
    ap.add_argument("--no-stamp", action="store_true",
                    help="통과해도 신선도 기준을 굳히지 않는다(검사 전용)")
    ap.add_argument("--require-stt", action="store_true",
                    help="ASR 백엔드가 없으면 통과시키지 않고 에러 종료")
    ap.add_argument("--no-page-sync", action="store_true",
                    help="대조 화면(config/audio-check.*.json)의 받아쓰기를 갱신하지 않는다")
    ap.add_argument("--json", dest="json_out")
    args = ap.parse_args()
    va.reexec_under_venv(Path(__file__).resolve())

    base = Path(args.base).resolve()
    man = Path(args.manifest).resolve()
    if man == DERIVED.resolve():
        rebuilt, why = refresh_derived()
        if why:
            print(f"[audio gate] {why}")
        if rebuilt is None:
            print(f"[audio gate] 매니페스트가 없다: {DERIVED}", file=sys.stderr)
            return 2
        man = Path(rebuilt).resolve()
    if not man.is_file():
        print(f"[audio gate] 매니페스트가 없다: {man}", file=sys.stderr)
        return 2

    ids = changed_ids(man, base)
    if args.dry_run:
        print(f"[audio gate] 매니페스트 {man.name} — 검사 대상 {len(ids)}개")
        for i, why in ids:
            print(f"    {i:<18} {why}")
        return 0
    if not ids and not args.all:
        print(f"[audio gate] 새로 들어오거나 교체된 음원이 없고 전부 ASR 대조를 마쳤다 "
              f"({man.name}) — 검사할 것이 없다.")
        return 0

    print(f"[audio gate] {man.name} — "
          + ("전수 검사" if args.all else f"검사 대상 {len(ids)}개")
          + " (계층 0~3, ASR 포함)")
    sys.stdout.flush()

    rep = va.verify(man, update_index=not args.no_stamp, base=base,
                    stt_scope="all" if args.all else "changed",
                    changed_only=not args.all, stamp_on_pass=True)
    va.print_report(rep)

    if not args.no_page_sync:
        sync = sync_review_page(rep, base, dict(ids))
        if sync["updated"] or sync["filled"]:
            print(f"대조 화면 갱신 ({', '.join(sync['files'])}) — "
                  f"교체분 받아쓰기 {len(sync['updated'])}건"
                  + (f", 처음 채운 것 {len(sync['filled'])}건" if sync["filled"] else "")
                  + ": " + ", ".join((sync["updated"] + sync["filled"])[:8]))
        if sync["stamped"]:
            print(f"대조 화면 — 기존 받아쓰기 {len(sync['stamped'])}건은 그대로 두고 "
                  "현재 바이트 해시만 도장 찍었다 (다음 교체부터 갱신된다)")
        if sync["unknown"]:
            print(f"대조 화면에 항목이 없어 못 실은 받아쓰기 {len(sync['unknown'])}건: "
                  + ", ".join(sync["unknown"][:8]))

    sys.stdout.flush()   # 아래 stderr 결론이 리포트보다 먼저 뜨지 않게
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n",
                                       encoding="utf-8")

    has_fail = (rep["counts"]["FAIL"] > 0
                or any(g.startswith("[FAIL]") for g in rep["globalReasons"]))
    if has_fail:
        print("\n[audio gate] FAIL — 이 음원은 발행하면 안 된다.", file=sys.stderr)
        return 1
    stt = rep.get("stt") or {}
    if args.require_stt and stt.get("queued") and not stt.get("backend"):
        print(f"\n[audio gate] --require-stt: ASR 백엔드가 없어 대본 대조를 못 했다 — "
              f"{stt.get('reason')}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
