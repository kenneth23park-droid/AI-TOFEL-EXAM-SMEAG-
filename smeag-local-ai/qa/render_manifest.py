"""
Build a render manifest for the TTS QA gate from a StudyGround TTS manifest.

`qa/stt_loopback.py` consumes a flat list of segments:

    {"segment_id": ..., "audio_path": ..., "text_tts": ..., "asr_text": ...}

The exam packs carry that information in a different shape (an authoring
manifest with `id` / `out` / `text` per item), so this script flattens one into
the other. It is deliberately stdlib-only and does no ASR — `asr_text` is left
absent for `qa/transcribe.py` to fill in.

Splitting manifest-building out of transcription means a manifest can be
rebuilt after a re-render without discarding transcriptions that are still
valid: `transcribe.py` merges by `segment_id` rather than starting over.

    python3 qa/render_manifest.py \
        --tts-manifest ../studyground/sg2/tts-manifest.set9.json \
        --media-root ../studyground/sg2 \
        --out data/render_manifest.set9.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def build(tts_manifest: Path, media_root: Path) -> list[dict]:
    doc = json.loads(tts_manifest.read_text(encoding="utf-8"))
    items = doc.get("items")
    if not isinstance(items, list):
        raise SystemExit(f"{tts_manifest}: no `items` array — not a TTS manifest?")

    out: list[dict] = []
    for it in items:
        sid = it.get("id")
        rel = it.get("out")
        if not sid or not rel:
            raise SystemExit(f"{tts_manifest}: item missing id/out: {it!r}")

        # `text` is the flattened single-voice string. When an item has
        # per-speaker segments, the rendered audio is their concatenation, so
        # the WER reference must be the concatenation too — otherwise every
        # multi-speaker clip reports a huge deletion count against a reference
        # that only covers the first turn.
        segs = it.get("segments") or []
        if len(segs) > 1:
            text = " ".join(s.get("text", "") for s in segs).strip()
        else:
            text = it.get("text") or (segs[0].get("text", "") if segs else "")
        if not text:
            raise SystemExit(f"{tts_manifest}: item {sid} has no text to compare against")

        entry = {
            "segment_id": sid,
            "audio_path": str((media_root / rel).resolve()),
            "text_tts": text,
            # Carried through for triage only; the gate ignores them.
            "voices": [s.get("say_voice") or s.get("voice_name") for s in segs] or None,
            "segment_count": len(segs) or 1,
        }
        out.append(entry)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tts-manifest", required=True)
    ap.add_argument("--media-root", required=True,
                    help="directory the manifest's `out` paths are relative to")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    items = build(Path(args.tts_manifest), Path(args.media_root))

    missing = [i["segment_id"] for i in items if not Path(i["audio_path"]).is_file()]
    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(items)} segments -> {dest}")
    if missing:
        # Not fatal: a manifest can legitimately be built before every clip is
        # rendered. But transcription will reject these, so say it now.
        print(f"WARNING  {len(missing)} audio file(s) not on disk: "
              f"{', '.join(missing[:8])}{' ...' if len(missing) > 8 else ''}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
