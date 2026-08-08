#!/usr/bin/env python3
"""Kokoro-82M offline TTS generator — same pipeline shape as tools/tts_google.py.

  plan → synth → stitch → verify

Difference from the Google tool: synthesis runs locally on this machine (no API key,
no network, no per-character cost). Kokoro-82M is Apache-2.0, so the output mp3s are
free of the usage restrictions that come with a hosted provider.

It reads the SAME voices manifest the Google tool uses (tts-voices-set9-google.json)
and maps each `voice_name` (US-Ava, GB-Oliver, ...) onto a Kokoro preset voice, so the
per-speaker casting already chosen for SET 9 carries over unchanged. Output paths,
the 0.4s inter-speaker gap, and media/tts/index.json are identical to the Google run,
which means these files drop straight into the existing player with no app changes.

Setup:
    pip install kokoro soundfile
    brew install espeak-ng      # optional: g2p fallback for out-of-dictionary words

Usage:
    python3 tools/tts_kokoro.py --manifest tts-voices-set9-google.json
    python3 tools/tts_kokoro.py --manifest tts-voices-set9-google.json --dry-run
    python3 tools/tts_kokoro.py --manifest tts-voices-set9-google.json --force
    python3 tools/tts_kokoro.py --only set9-M1-conv-13-14      # regenerate one item
    python3 tools/tts_kokoro.py --list-voices
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TypedDict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VOICES = ROOT / "tts-voices-set9-google.json"
OUT_DIR = ROOT / "media" / "tts"
SEG_DIR = OUT_DIR / "_segments_kokoro"
INDEX = OUT_DIR / "index.json"

SAMPLE_RATE = 24000       # Kokoro's native rate
FORCE = False
SPEED = 1.0               # global multiplier applied on top of SPEED_BY_KIND

# Kokoro reads slower than the Google Neural2 voices it replaces, and by different
# amounts per item type. Measured delivery on the first full SET 9 run (words/minute,
# gaps excluded) was: announcement 180, conversation 157, interview 162, short 155,
# repeat 121 — against ~176-198 for the Google originals.
#
# These factors pull each kind back to a natural TOEFL delivery band. Lectures and
# announcements already land at 180 wpm, so they stay at 1.0. `repeat` is deliberately
# left slowest of all (~150 wpm) because it is a listen-and-repeat drill where a
# measured pace is the point — it just should not be the 121 wpm crawl it was.
SPEED_BY_KIND: dict[str, float] = {
    "announcement": 1.00,   # 180 wpm — already natural, leave alone
    "conversation": 1.10,   # 157 → ~173
    "interview":    1.12,   # 162 → ~181
    "short":        1.12,   # 155 → ~174
    "repeat":       1.25,   # 121 → ~151, still the slowest kind by design
}


def speed_for(kind: str) -> float:
    return round(SPEED_BY_KIND.get(kind, 1.0) * SPEED, 3)

# voice_name in the manifest → (kokoro voice, lang_code).
# lang_code 'a' = American English, 'b' = British English.
# Kokoro ships no Australian voices, so AU-Lily borrows a British one (see --list-voices).
VOICE_MAP: dict[str, tuple[str, str]] = {
    "US-Ava":    ("af_heart",    "a"),
    "US-Emma":   ("af_nicole",   "a"),
    "US-Mia":    ("af_bella",    "a"),
    "US-Zoe":    ("af_aoede",    "a"),
    "US-Liam":   ("am_michael",  "a"),
    "US-Mason":  ("am_fenrir",   "a"),
    "US-Noah":   ("am_puck",     "a"),
    "US-Ethan":  ("am_eric",     "a"),
    "GB-Alice":  ("bf_alice",    "b"),
    "GB-Ivy":    ("bf_isabella", "b"),
    "GB-Henry":  ("bm_george",   "b"),
    "GB-Oliver": ("bm_lewis",    "b"),
    "AU-Lily":   ("bf_lily",     "b"),
}

# Fallback when a manifest voice_name isn't in VOICE_MAP: pick by accent+gender guess.
_FALLBACK = ("af_heart", "a")

# Items deliberately NOT synthesized by Kokoro — their existing mp3 is kept as-is.
# Without this, a --force run would silently overwrite them and quietly drop whatever
# the exception was protecting.
PRESERVE: dict[str, str] = {
    "set9-M1-sr-07": "AU accent — Kokoro ships no Australian voice, so the Google "
                     "original is kept to preserve SET 9's US/GB/AU accent spread",
}

_pipelines: dict[str, object] = {}


def get_pipeline(lang_code: str):
    """One KPipeline per language code, built lazily and reused across items."""
    if lang_code not in _pipelines:
        from kokoro import KPipeline
        _pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang_code]


def resolve_voice(seg: dict) -> tuple[str, str]:
    name = seg.get("voice_name", "")
    if name in VOICE_MAP:
        return VOICE_MAP[name]
    print(f"    ! unmapped voice_name {name!r} → falling back to {_FALLBACK[0]}")
    return _FALLBACK


def synth_segment(voice: str, lang_code: str, text: str, dest: Path, speed: float) -> None:
    """Synthesize one speaker turn to a 24 kHz mono wav.

    Kokoro chunks long text internally and yields one audio tensor per chunk, so a
    300-word lecture comes back as several pieces that we concatenate before writing.
    """
    import numpy as np
    import soundfile as sf

    pipeline = get_pipeline(lang_code)
    chunks = [audio for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed)]
    if not chunks:
        raise ValueError("kokoro produced no audio")
    wav = np.concatenate([np.asarray(c, dtype="float32").reshape(-1) for c in chunks])
    sf.write(str(dest), wav, SAMPLE_RATE)


def seg_hash(voice: str, text: str, speed: float) -> str:
    """Speed is part of the key so re-pacing a kind invalidates only its cached segments."""
    return hashlib.sha1(f"kokoro|{voice}|{speed}|{text}".encode()).hexdigest()[:12]


class ItemState(TypedDict, total=False):
    id: str
    title: str
    kind: str
    segments: list[dict]
    seg_files: list[str]
    seg_voices: list[str]
    speed: float
    out: str
    ok: bool
    note: str


def plan(state: ItemState) -> ItemState:
    return {"segments": [s for s in state.get("segments", []) if s.get("text", "").strip()]}


def synth(state: ItemState) -> ItemState:
    """Sequential, unlike the Google tool's thread pool — Kokoro is CPU/MPS-bound here,
    so parallel turns would contend for the same cores rather than overlap latency."""
    SEG_DIR.mkdir(parents=True, exist_ok=True)
    speed = speed_for(state.get("kind", ""))
    files: list[str] = []
    used: list[str] = []
    for i, seg in enumerate(state["segments"]):
        voice, lang = resolve_voice(seg)
        used.append(voice)
        h = seg_hash(voice, seg["text"], speed)
        f = SEG_DIR / f"{state['id']}.{i:02d}.{h}.wav"
        if not (f.is_file() and not FORCE):
            synth_segment(voice, lang, seg["text"], f, speed)
        files.append(str(f))
    return {"seg_files": files, "seg_voices": used, "speed": speed}


def stitch(state: ItemState) -> ItemState:
    """Concat segments with a 0.4s gap, encode to mp3. Matches the Google tool's
    output format (44.1 kHz, libmp3lame -q:a 4) so both runs are interchangeable."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{state['id']}.mp3"
    files = state["seg_files"]

    if len(files) == 1:
        subprocess.run(
            ["ffmpeg", "-y", "-i", files[0], "-ar", "44100",
             "-c:a", "libmp3lame", "-q:a", "4", str(out)],
            check=True, capture_output=True,
        )
        return {"out": str(out)}

    with tempfile.TemporaryDirectory() as td:
        gap = Path(td) / "gap.wav"
        subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono",
                        "-t", "0.4", str(gap)], check=True, capture_output=True)
        inputs: list[str] = []
        parts: list[str] = []
        idx = 0
        for i, f in enumerate(files):
            if i:
                inputs += ["-i", str(gap)]
                parts.append(f"[{idx}:a]")
                idx += 1
            inputs += ["-i", str(f)]
            parts.append(f"[{idx}:a]")
            idx += 1
        filt = "".join(parts) + f"concat=n={idx}:v=0:a=1[a]"
        subprocess.run(
            ["ffmpeg", "-y", *inputs, "-filter_complex", filt, "-map", "[a]",
             "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "4", str(out)],
            check=True, capture_output=True,
        )
    return {"out": str(out)}


def verify(state: ItemState) -> ItemState:
    out = Path(state.get("out", ""))
    ok = out.is_file() and out.stat().st_size > 1500
    return {"ok": ok, "note": "" if ok else "output missing or too small"}


def run_item(item: dict) -> ItemState:
    state: ItemState = dict(item)  # type: ignore[assignment]
    for node in (plan, synth, stitch, verify):
        state.update(node(state))
    return state


def list_voices() -> None:
    print("Kokoro-82M English presets (lang_code 'a' = American, 'b' = British):\n")
    print("  American female : af_heart af_bella af_nicole af_aoede af_kore af_sarah")
    print("                    af_nova af_sky af_alloy af_jessica af_river")
    print("  American male   : am_michael am_fenrir am_puck am_echo am_eric am_liam")
    print("                    am_onyx am_adam am_santa")
    print("  British female  : bf_emma bf_isabella bf_alice bf_lily")
    print("  British male    : bm_george bm_lewis bm_daniel bm_fable")
    print("\nCurrent SET 9 mapping (edit VOICE_MAP in this file to recast):")
    for name, (voice, lang) in VOICE_MAP.items():
        note = "   ← no AU voice in Kokoro; substituted" if name.startswith("AU-") else ""
        print(f"  {name:12s} → {voice:12s} (lang '{lang}'){note}")


def main() -> None:
    global FORCE, VOICES, SPEED
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="", help="voices manifest (default tts-voices-set9-google.json)")
    ap.add_argument("--force", action="store_true", help="re-synthesize even if a cached segment exists")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--only", default="", help="generate just this item id")
    ap.add_argument("--speed", type=float, default=1.0,
                    help="global multiplier applied on top of the per-kind SPEED_BY_KIND factors")
    args = ap.parse_args()
    FORCE = args.force
    SPEED = args.speed
    if args.manifest:
        VOICES = Path(args.manifest) if Path(args.manifest).is_absolute() else ROOT / args.manifest

    if args.list_voices:
        list_voices()
        return

    if not VOICES.is_file():
        sys.exit(f"voices manifest not found: {VOICES}")
    man = json.loads(VOICES.read_text(encoding="utf-8"))
    items = man.get("items", [])
    if args.only:
        items = [it for it in items if it["id"] == args.only]
        if not items:
            sys.exit(f"no item with id {args.only!r} in {VOICES.name}")

    seg_total = sum(len(it["segments"]) for it in items)
    char_total = sum(len(s["text"]) for it in items for s in it["segments"])
    print(f"items: {len(items)} · segments: {seg_total} · characters: {char_total} · provider: kokoro-82M")

    unmapped = {s.get("voice_name", "") for it in items for s in it["segments"]} - set(VOICE_MAP)
    if unmapped:
        print(f"warning: unmapped voice_name(s) {sorted(unmapped)} → {_FALLBACK[0]}")

    if args.dry_run:
        for it in items:
            if it["id"] in PRESERVE:
                print(f"  - {it['id']:42s} PRESERVED — {PRESERVE[it['id']]}")
                continue
            vs = ", ".join(dict.fromkeys(
                f"{s.get('voice_name','?')}→{resolve_voice(s)[0]}" for s in it["segments"]))
            print(f"  - {it['id']:42s} segs={len(it['segments']):>2}  "
                  f"×{speed_for(it.get('kind','')):<5} [{vs}]")
        print("\n[dry-run] no synthesis, no ffmpeg.")
        return

    index = json.loads(INDEX.read_text()) if INDEX.is_file() else {}
    made = failed = kept = 0
    for it in items:
        if it["id"] in PRESERVE:
            kept += 1
            # Rewrite the entry rather than leaving whatever a previous run put there,
            # so the index never claims a preserved file was Kokoro-generated.
            index[it["id"]] = {
                "file": f"media/tts/{it['id']}.mp3",
                "provider": "google (preserved)",
                "voices": list(dict.fromkeys(s.get("voice_name", "") for s in it["segments"])),
                "preservedReason": PRESERVE[it["id"]],
                "segments": len(it["segments"]),
            }
            print(f"  · {it['id']}  preserved — {PRESERVE[it['id']]}")
            continue
        try:
            res = run_item(it)
            if res.get("ok"):
                index[it["id"]] = {
                    "file": f"media/tts/{it['id']}.mp3",
                    "provider": "kokoro-82M",
                    "voices": list(dict.fromkeys(s.get("voice_name", "") for s in it["segments"])),
                    "kokoroVoices": list(dict.fromkeys(res.get("seg_voices", []))),
                    "speed": res.get("speed", 1.0),
                    "segments": len(it["segments"]),
                }
                made += 1
                print(f"  ✓ {it['id']}  [{', '.join(index[it['id']]['kokoroVoices'])}]"
                      f"  ×{res.get('speed', 1.0)}")
            else:
                failed += 1
                print(f"  ✗ {it['id']}  {res.get('note')}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ {it['id']}  {type(e).__name__}: {e}")

    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\ndone — generated {made}, preserved {kept}, failed {failed}. index → {INDEX}")


if __name__ == "__main__":
    main()
