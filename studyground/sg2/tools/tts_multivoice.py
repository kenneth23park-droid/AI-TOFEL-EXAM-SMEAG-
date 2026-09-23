#!/usr/bin/env python3
"""Multi-voice TTS generator — LangGraph-orchestrated, parallel, offline-bundling.

Pipeline (per item):  plan → synth → stitch → verify
  • plan   : read tts-voices.json → segments [{speaker, voice, text}]
  • synth  : ElevenLabs TTS per segment (thread-parallel), cached by content hash
  • stitch : concat segments with ffmpeg (short gap between speakers) → one mp3
  • verify : output exists and is a valid, non-trivial mp3

Diverse characters: a chat/discussion becomes ONE mp3 where each speaker has a
distinct voice. Single-narrator items pass straight through stitch.

If `langgraph` is installed the four nodes run as a compiled StateGraph; otherwise
the SAME node functions run sequentially (offline demos never depend on it).

Usage:
    export ELEVENLABS_API_KEY=sk_...
    python3 tools/tts_multivoice.py            # generate all (skip cached)
    python3 tools/tts_multivoice.py --force
    python3 tools/tts_multivoice.py --dry-run  # plan + cost, no API/ffmpeg
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypedDict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VOICES = ROOT / "tts-voices.json"
OUT_DIR = ROOT / "media" / "tts"
SEG_DIR = OUT_DIR / "_segments"
INDEX = OUT_DIR / "index.json"
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}"

API_KEY = ""       # filled from args/env in main()
MODEL = "eleven_flash_v2_5"
OUTPUT = "mp3_44100_128"
FORCE = False


# ── ElevenLabs call ────────────────────────────────────────────────────────────
def synth_segment(voice: str, text: str) -> bytes:
    body = json.dumps({"text": text, "model_id": MODEL, "output_format": OUTPUT}).encode()
    req = urllib.request.Request(
        API.format(voice=voice), data=body, method="POST",
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def seg_hash(voice: str, text: str) -> str:
    return hashlib.sha1(f"{voice}|{MODEL}|{text}".encode()).hexdigest()[:12]


# ── graph state ────────────────────────────────────────────────────────────────
class ItemState(TypedDict, total=False):
    id: str
    title: str
    kind: str
    segments: list[dict]
    seg_files: list[str]
    out: str
    ok: bool
    note: str


# ── nodes ──────────────────────────────────────────────────────────────────────
def plan(state: ItemState) -> ItemState:
    # Normalise segments; drop empties.
    segs = [s for s in state.get("segments", []) if s.get("text", "").strip()]
    return {"segments": segs}


def synth(state: ItemState) -> ItemState:
    """Thread-parallel per-segment synthesis, content-hash cached to _segments/."""
    SEG_DIR.mkdir(parents=True, exist_ok=True)
    segs = state["segments"]

    def one(i_seg):
        i, seg = i_seg
        h = seg_hash(seg["voice"], seg["text"])
        f = SEG_DIR / f"{state['id']}.{i:02d}.{h}.mp3"
        if f.is_file() and not FORCE:
            return str(f)
        audio = synth_segment(seg["voice"], seg["text"])
        f.write_bytes(audio)
        return str(f)

    with ThreadPoolExecutor(max_workers=4) as ex:
        files = list(ex.map(one, enumerate(segs)))
    return {"seg_files": files}


def stitch(state: ItemState) -> ItemState:
    """Concat segments into one mp3 (0.4s gap between speakers) via ffmpeg."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{state['id']}.mp3"
    files = state["seg_files"]

    if len(files) == 1:
        out.write_bytes(Path(files[0]).read_bytes())
        return {"out": str(out)}

    # Build a silence clip once, weave between segments, concat via demuxer.
    with tempfile.TemporaryDirectory() as td:
        gap = Path(td) / "gap.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
             "-t", "0.4", "-q:a", "9", str(gap)],
            check=True, capture_output=True,
        )
        listing = Path(td) / "list.txt"
        lines = []
        for i, f in enumerate(files):
            if i:
                lines.append(f"file '{gap}'")
            lines.append(f"file '{f}'")
        listing.write_text("\n".join(lines), encoding="utf-8")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-c:a", "libmp3lame", "-q:a", "4", str(out)],
            check=True, capture_output=True,
        )
    return {"out": str(out)}


def verify(state: ItemState) -> ItemState:
    out = Path(state.get("out", ""))
    ok = out.is_file() and out.stat().st_size > 1500
    return {"ok": ok, "note": "" if ok else "output missing or too small"}


# ── graph wiring (LangGraph, with sequential fallback) ─────────────────────────
_graph = None
_backend = "sequential"


def _build():
    global _backend
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError:
        _backend = "sequential"
        return None
    try:
        g = StateGraph(ItemState)
        g.add_node("plan", plan)
        g.add_node("synth", synth)
        g.add_node("stitch", stitch)
        g.add_node("verify", verify)
        g.add_edge(START, "plan")
        g.add_edge("plan", "synth")
        g.add_edge("synth", "stitch")
        g.add_edge("stitch", "verify")
        g.add_edge("verify", END)
        _backend = "langgraph"
        return g.compile()
    except Exception:
        _backend = "sequential"
        return None


def run_item(item: dict) -> ItemState:
    global _graph
    state: ItemState = dict(item)  # type: ignore[assignment]
    if _graph is None:
        _graph = _build()
    if _graph is not None:
        return _graph.invoke(state)
    # sequential fallback — identical semantics
    for node in (plan, synth, stitch, verify):
        state.update(node(state))
    return state


# ── driver ─────────────────────────────────────────────────────────────────────
def main() -> None:
    global API_KEY, MODEL, OUTPUT, FORCE
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key", default=os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY", ""))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not VOICES.is_file():
        sys.exit(f"voices manifest not found: {VOICES}")
    man = json.loads(VOICES.read_text(encoding="utf-8"))
    MODEL = man.get("model", MODEL)
    OUTPUT = man.get("output", OUTPUT)
    FORCE = args.force
    items = man.get("items", [])

    seg_total = sum(len(it.get("segments", [])) for it in items)
    char_total = sum(len(s.get("text", "")) for it in items for s in it.get("segments", []))
    print(f"items: {len(items)} · segments: {seg_total} · characters: {char_total} · model: {MODEL}")

    _build()
    print(f"orchestration backend: {_backend}")

    if args.dry_run:
        for it in items:
            voices = ", ".join(dict.fromkeys(s.get("voice_name", "?") for s in it["segments"]))
            print(f"  - {it['id']:42s} segs={len(it['segments']):>2}  voices=[{voices}]")
        print("\n[dry-run] no API calls, no ffmpeg.")
        return

    API_KEY = args.api_key
    if not API_KEY:
        sys.exit("ELEVENLABS_API_KEY is not set. (elevenlabs.io → API Keys → Create, with Text to Speech access)")

    index = json.loads(INDEX.read_text()) if INDEX.is_file() else {}
    made = failed = 0
    for it in items:
        try:
            res = run_item(it)
            if res.get("ok"):
                index[it["id"]] = {
                    "file": f"media/tts/{it['id']}.mp3",
                    "voices": list(dict.fromkeys(s.get("voice_name", "") for s in it["segments"])),
                    "segments": len(it["segments"]),
                }
                made += 1
                print(f"  ✓ {it['id']}  [{', '.join(index[it['id']]['voices'])}]")
            else:
                failed += 1
                print(f"  ✗ {it['id']}  {res.get('note')}")
        except urllib.error.HTTPError as e:
            failed += 1
            print(f"  ✗ {it['id']}  HTTP {e.code}: {e.read().decode('utf-8','ignore')[:120]}")
        except subprocess.CalledProcessError as e:
            failed += 1
            print(f"  ✗ {it['id']}  ffmpeg: {(e.stderr or b'').decode('utf-8','ignore')[:120]}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ {it['id']}  {e}")

    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\ndone — generated {made}, failed {failed}. backend={_backend}. index → {INDEX}")


if __name__ == "__main__":
    main()
