#!/usr/bin/env python3
"""Local CPU Kokoro synthesis; run the project audio gate separately before release.

Requires kokoro-onnx and soundfile. Model and voice assets are explicit paths;
no keys or automatic network requests are used. All output paths come from the
manifest, and only that manifest's items are modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import tts_kokoro as base

PROCESSING_VERSION = "chunk180-v2-headroom075"


def text_chunks(text: str, limit: int = 180) -> list[str]:
    """Split only at whitespace; verify every spoken word remains in order."""
    chunks = []
    remaining = text.strip()
    while len(remaining) > limit:
        window = remaining[:limit + 1]
        boundaries = [m.end() for m in re.finditer(r"[.!?](?:[\"'])?\s+", window)]
        cut = boundaries[-1] if boundaries else window.rfind(" ")
        if cut <= 0:
            raise ValueError("source contains a word longer than chunk limit")
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    assert " ".join(" ".join(chunks).split()) == " ".join(text.split())
    return chunks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--model-file", required=True)
    ap.add_argument("--voices-file", required=True)
    ap.add_argument("--only", default="", help="one item id or comma-separated item ids")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cache-dir", default="")
    ap.add_argument("--skip-existing", action="store_true", help="skip valid outputs already recorded in generated metadata")
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()
    root = base.ROOT.resolve()
    manifest = Path(args.manifest).resolve()
    man = json.loads(manifest.read_text(encoding="utf-8-sig"))
    items = man.get("items", [])
    if args.only:
        chosen = set(args.only.split(","))
        items = [item for item in items if item["id"] in chosen]
        missing = chosen - {item["id"] for item in items}
        if missing:
            raise ValueError(f"unknown selected ids: {sorted(missing)}")
    if not items:
        raise ValueError("manifest has no selected items")
    for item in items:
        out = (root / item["out"]).resolve()
        if not out.is_relative_to(root / "media"):
            raise ValueError(f"audio output must be within sg2/media: {out}")
        for seg in item["segments"]:
            if not seg.get("text", "").strip():
                raise ValueError(f"empty segment in {item['id']}")
            if not seg.get("kokoro_voice") and seg.get("voice_name") not in base.VOICE_MAP:
                raise ValueError(f"unmapped voice in {item['id']}: {seg.get('voice_name')}")
    print(f"items={len(items)} segments={sum(len(i['segments']) for i in items)} provider=kokoro-onnx", flush=True)
    if args.dry_run:
        for item in items:
            print(item["id"], item["out"], item.get("kokoro_speed", item.get("speed", base.speed_for(item.get("kind", "")))))
        return 0

    import soundfile as sf
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    model = Path(args.model_file).resolve()
    voices = Path(args.voices_file).resolve()
    for file in (model, voices):
        if not file.is_file():
            raise FileNotFoundError(file)
    digest = hashlib.sha256()
    for asset in (model, voices):
        with asset.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    asset_hash = digest.hexdigest()[:16]
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    engine = Kokoro.from_session(ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"]), str(voices))
    cache = Path(args.cache_dir).resolve() if args.cache_dir else root / "media/tts/_segments_kokoro_onnx"
    cache.mkdir(parents=True, exist_ok=True)
    index_path = manifest.with_suffix(".generated.json")
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    failures = 0
    for item in items:
        try:
            existing = (root / item["out"]).resolve()
            expected_text_hash = hashlib.sha256(json.dumps([s["text"] for s in item["segments"]], ensure_ascii=False).encode()).hexdigest()
            requested_speed = float(item.get("kokoro_speed", item.get("speed", base.speed_for(item.get("kind", "")))))
            expected_voices = list(dict.fromkeys(s.get("kokoro_voice", s.get("voice") if man.get("provider") == "kokoro-onnx" else base.resolve_voice(s)[0]) for s in item["segments"]))
            recorded = index.get(item["id"], {})
            if args.skip_existing and not args.force and recorded.get("textHash") == expected_text_hash and recorded.get("speed") == requested_speed and recorded.get("voices") == expected_voices and recorded.get("modelAssetsHash") == asset_hash and recorded.get("processingVersion") == PROCESSING_VERSION and existing.is_file() and existing.stat().st_size > 1500:
                print(f"SKIP {item['id']} previously synthesized", flush=True)
                continue
            speed = requested_speed
            files, used = [], []
            for n, seg in enumerate(item["segments"]):
                mapped_voice, mapped_lang = base.resolve_voice(seg)
                voice = seg.get("kokoro_voice", seg.get("voice", mapped_voice) if man.get("provider") == "kokoro-onnx" else mapped_voice)
                lang = seg.get("kokoro_lang", mapped_lang)
                lang = {"a": "en-us", "b": "en-gb"}.get(lang, lang)
                if voice not in engine.get_voices():
                    raise ValueError(f"model voice unavailable: {voice}")
                key = hashlib.sha256(f"{asset_hash}|{PROCESSING_VERSION}|{voice}|{lang}|{speed}|{seg['text']}".encode()).hexdigest()[:20]
                wav = cache / f"{item['id']}.{n:02d}.{key}.wav"
                if args.force or not wav.is_file():
                    chunks = text_chunks(seg["text"])
                    partial = wav.with_suffix(".partial.wav")
                    with sf.SoundFile(str(partial), mode="w", samplerate=24000, channels=1, subtype="FLOAT") as target:
                        for chunk_n, chunk in enumerate(chunks):
                            audio, rate = engine.create(chunk, voice=voice, speed=speed, lang=lang)
                            if len(audio) == 0 or rate != 24000:
                                raise ValueError("synthesizer returned invalid audio")
                            if chunk_n:
                                target.write(np.zeros(3600, dtype=np.float32))
                            target.write(audio)
                            print(f"  {item['id']} turn{n} chunk{chunk_n + 1}/{len(chunks)}", flush=True)
                    segment_audio, rate = sf.read(str(partial), dtype="float32")
                    peak = float(np.max(np.abs(segment_audio)))
                    if peak > 0.75:
                        segment_audio *= 0.75 / peak
                    sf.write(str(partial), segment_audio, rate, subtype="PCM_16")
                    partial.replace(wav)
                files.append(str(wav))
                used.append(voice)
            out = (root / item["out"]).resolve()
            out.parent.mkdir(parents=True, exist_ok=True)
            if out.exists():
                backup = out.with_suffix(out.suffix + ".bak-kokoro-onnx")
                if not backup.exists():
                    shutil.copy2(out, backup)
            base.OUT_DIR = out.parent
            result = base.stitch({"id": out.stem, "seg_files": files})
            result.update(base.verify(result))
            if not result["ok"]:
                raise ValueError(result["note"])
            index[item["id"]] = {"file": item["out"], "provider": "kokoro-onnx", "modelAssetsHash": asset_hash,
                "voices": list(dict.fromkeys(used)), "speed": speed, "segments": len(files),
                "textHash": expected_text_hash, "processingVersion": PROCESSING_VERSION, "chunking": "180chars, 150ms gap within speaker, peak headroom 0.75",
                "validation": "synthesized; audio gate and transcript verification pending"}
            print(f"OK {item['id']} {out.stat().st_size} bytes voices={','.join(dict.fromkeys(used))}", flush=True)
        except Exception as exc:
            failures += 1
            print(f"FAIL {item['id']}: {type(exc).__name__}: {exc}", flush=True)
        if index_path.exists() and not index_path.with_suffix(index_path.suffix + ".bak").exists():
            shutil.copy2(index_path, index_path.with_suffix(index_path.suffix + ".bak"))
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Synthesis finished: {len(items) - failures}/{len(items)}; transcript gate still required.", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
