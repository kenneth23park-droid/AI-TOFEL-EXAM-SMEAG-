#!/usr/bin/env python3
"""ElevenLabs TTS generator for SMEAG StudyGround.

Reads ../tts-manifest.json and writes one mp3 per item into ../media/tts/<id>.mp3,
so the app can play studio-quality narration OFFLINE after a one-time online run.

Usage:
    export ELEVENLABS_API_KEY=xi_xxx        # or pass --api-key
    python3 tools/tts_generate.py           # generate all missing
    python3 tools/tts_generate.py --force   # regenerate everything
    python3 tools/tts_generate.py --dry-run # list items + character cost, no API call
    python3 tools/tts_generate.py --voice <voice_id> --model eleven_flash_v2_5

Endpoint: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
Auth header: xi-api-key. Body: {text, model_id, output_format}. Returns mp3 bytes.
No third-party SDK required — uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MANIFEST = ROOT / "tts-manifest.json"
OUT_DIR = ROOT / "media" / "tts"
INDEX = OUT_DIR / "index.json"          # id → {file, hash, chars} for the app to consult
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}"


def load_manifest() -> dict:
    if not MANIFEST.is_file():
        sys.exit(f"manifest not found: {MANIFEST}")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def synth(text: str, voice: str, model: str, output: str, api_key: str) -> bytes:
    body = json.dumps({
        "text": text,
        "model_id": model,
        "output_format": output,
    }).encode("utf-8")
    req = urllib.request.Request(
        API.format(voice=voice),
        data=body,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key", default=os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY", ""))
    ap.add_argument("--voice", default="")
    ap.add_argument("--model", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    man = load_manifest()
    voice = args.voice or man.get("voice", "JBFqnCBsd6RMkjVDRZzb")
    model = args.model or man.get("model", "eleven_flash_v2_5")
    output = man.get("output", "mp3_44100_128")
    items = man.get("items", [])
    total_chars = sum(len(it.get("text", "")) for it in items)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = json.loads(INDEX.read_text()) if INDEX.is_file() else {}

    print(f"items: {len(items)} · characters: {total_chars} · voice: {voice} · model: {model}")

    if args.dry_run:
        for it in items:
            print(f"  - {it['id']:42s} {len(it.get('text','')):>5} chars")
        print("\n[dry-run] no API calls made. Set ELEVENLABS_API_KEY and re-run to generate.")
        return

    if not args.api_key:
        sys.exit(
            "\nELEVENLABS_API_KEY is not set.\n"
            "  1) elevenlabs.io → profile → API Keys → Create\n"
            "  2) export ELEVENLABS_API_KEY=xi_xxx\n"
            "  3) python3 tools/tts_generate.py\n"
            "Meanwhile the app falls back to the browser's built-in voice (offline, no key)."
        )

    made = skipped = failed = 0
    for it in items:
        iid, text = it["id"], it.get("text", "")
        digest = hashlib.sha1(f"{voice}|{model}|{text}".encode("utf-8")).hexdigest()[:12]
        out = OUT_DIR / f"{iid}.mp3"
        if out.is_file() and not args.force and index.get(iid, {}).get("hash") == digest:
            skipped += 1
            continue
        try:
            audio = synth(text, voice, model, output, args.api_key)
            out.write_bytes(audio)
            index[iid] = {"file": f"media/tts/{iid}.mp3", "hash": digest, "chars": len(text)}
            made += 1
            print(f"  ✓ {iid}  ({len(audio)//1024} KB)")
        except urllib.error.HTTPError as e:
            failed += 1
            print(f"  ✗ {iid}  HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:120]}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ {iid}  {e}")

    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\ndone — generated {made}, skipped {skipped}, failed {failed}. index → {INDEX}")


if __name__ == "__main__":
    main()
