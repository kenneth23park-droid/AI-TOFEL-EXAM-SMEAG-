#!/usr/bin/env python3
"""Google Cloud Text-to-Speech generator — LangGraph-orchestrated, parallel, offline-bundling.

Same pipeline as the ElevenLabs tool, different provider:  plan → synth → stitch → verify
  • synth : POST texttospeech.googleapis.com/v1/text:synthesize (per segment, thread-parallel)
  • stitch: ffmpeg concat with a 0.4s gap → one mp3 with each speaker in a distinct voice
Diverse characters via Google Neural2 voices across US/GB/AU accents.

Auth: an API key (simplest). Get one at console.cloud.google.com → APIs & Services →
Credentials → Create API key, with "Cloud Text-to-Speech API" enabled.

Usage:
    export GOOGLE_TTS_API_KEY=AIza...        # or GOOGLE_API_KEY
    python3 tools/tts_google.py              # generate all
    python3 tools/tts_google.py --force
    python3 tools/tts_google.py --dry-run    # plan + voices, no API/ffmpeg
    python3 tools/tts_google.py --list-voices  # print available en-* voices (needs key)
"""

from __future__ import annotations

import argparse
import base64
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
from typing import TypedDict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VOICES = ROOT / "tts-voices-google.json"   # default; override with --manifest
OUT_DIR = ROOT / "media" / "tts"
SEG_DIR = OUT_DIR / "_segments_google"
INDEX = OUT_DIR / "index.json"
SYNTH_BASE = "https://texttospeech.googleapis.com/v1/text:synthesize"
VOICES_BASE = "https://texttospeech.googleapis.com/v1/voices"

API_KEY = ""          # API-key auth (?key=)
_CREDS = None         # service-account credentials (Bearer)
_PROJECT = ""         # SA project id (x-goog-user-project)
ENCODING = "MP3"
FORCE = False


def init_auth(api_key: str, sa_file: str) -> str:
    """Prefer a service-account file (Bearer) over an API key. Returns the mode."""
    global API_KEY, _CREDS, _PROJECT
    if sa_file:
        import google.auth.transport.requests  # noqa: F401
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(
            sa_file, scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        _CREDS = creds
        _PROJECT = json.loads(Path(sa_file).read_text()).get("project_id", "")
        return "service_account"
    API_KEY = api_key
    return "api_key" if api_key else "none"


def _headers() -> dict:
    if _CREDS is not None:
        import google.auth.transport.requests as gart
        if not _CREDS.valid:
            _CREDS.refresh(gart.Request())
        h = {"Authorization": f"Bearer {_CREDS.token}", "Content-Type": "application/json; charset=utf-8"}
        if _PROJECT:
            h["x-goog-user-project"] = _PROJECT
        return h
    return {"Content-Type": "application/json; charset=utf-8"}


def _url(base: str) -> str:
    return base if _CREDS is not None else f"{base}?key={API_KEY}"


def synth_segment(voice: str, lang: str, text: str) -> bytes:
    body = json.dumps({
        "input": {"text": text},
        "voice": {"languageCode": lang, "name": voice},
        "audioConfig": {"audioEncoding": ENCODING},
    }).encode()
    req = urllib.request.Request(_url(SYNTH_BASE), data=body, method="POST", headers=_headers())
    with urllib.request.urlopen(req, timeout=90) as r:
        payload = json.loads(r.read())
    audio_b64 = payload.get("audioContent")
    if not audio_b64:
        raise ValueError("no audioContent in response")
    return base64.b64decode(audio_b64)


def seg_hash(voice: str, text: str) -> str:
    return hashlib.sha1(f"google|{voice}|{text}".encode()).hexdigest()[:12]


class ItemState(TypedDict, total=False):
    id: str
    title: str
    kind: str
    segments: list[dict]
    seg_files: list[str]
    out: str
    ok: bool
    note: str


def plan(state: ItemState) -> ItemState:
    return {"segments": [s for s in state.get("segments", []) if s.get("text", "").strip()]}


def synth(state: ItemState) -> ItemState:
    SEG_DIR.mkdir(parents=True, exist_ok=True)
    segs = state["segments"]

    def one(i_seg):
        i, seg = i_seg
        h = seg_hash(seg["voice"], seg["text"])
        f = SEG_DIR / f"{state['id']}.{i:02d}.{h}.mp3"
        if f.is_file() and not FORCE:
            return str(f)
        f.write_bytes(synth_segment(seg["voice"], seg.get("lang", "en-US"), seg["text"]))
        return str(f)

    with ThreadPoolExecutor(max_workers=4) as ex:
        files = list(ex.map(one, enumerate(segs)))
    return {"seg_files": files}


def stitch(state: ItemState) -> ItemState:
    """Concat segments with a 0.4s gap. Uses the concat *filter* (not the demuxer)
    so segments with differing sample rates (Google MP3 is 24 kHz) are resampled
    and joined cleanly instead of erroring out."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{state['id']}.mp3"
    files = state["seg_files"]
    if len(files) == 1:
        out.write_bytes(Path(files[0]).read_bytes())
        return {"out": str(out)}

    with tempfile.TemporaryDirectory() as td:
        gap = Path(td) / "gap.mp3"
        subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                        "-t", "0.4", "-q:a", "9", str(gap)], check=True, capture_output=True)
        # inputs: seg0, gap, seg1, gap, seg2, ...
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
        n = idx
        filt = "".join(parts) + f"concat=n={n}:v=0:a=1[a]"
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
        for name, fn in (("plan", plan), ("synth", synth), ("stitch", stitch), ("verify", verify)):
            g.add_node(name, fn)
        g.add_edge(START, "plan"); g.add_edge("plan", "synth")
        g.add_edge("synth", "stitch"); g.add_edge("stitch", "verify"); g.add_edge("verify", END)
        _backend = "langgraph"
        return g.compile()
    except Exception:
        _backend = "sequential"
        return None


def run_item(item: dict) -> ItemState:
    global _graph
    if _graph is None:
        _graph = _build()
    state: ItemState = dict(item)  # type: ignore[assignment]
    if _graph is not None:
        return _graph.invoke(state)
    for node in (plan, synth, stitch, verify):
        state.update(node(state))
    return state


def list_voices() -> None:
    req = urllib.request.Request(_url(VOICES_BASE), headers=_headers())
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    for v in data.get("voices", []):
        codes = ",".join(v.get("languageCodes", []))
        if codes.startswith("en"):
            print(f"  {v['name']:26s} {v.get('ssmlGender',''):8s} {codes}")


def main() -> None:
    global API_KEY, ENCODING, FORCE
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key", default=os.getenv("GOOGLE_TTS_API_KEY") or os.getenv("GOOGLE_API_KEY", ""))
    ap.add_argument("--sa-file", default=os.getenv("GOOGLE_APPLICATION_CREDENTIALS", ""))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--manifest", default="", help="voices manifest path (default tts-voices-google.json)")
    args = ap.parse_args()
    FORCE = args.force
    mode = init_auth(args.api_key, args.sa_file)
    global VOICES
    if args.manifest:
        VOICES = Path(args.manifest)

    if args.list_voices:
        if mode == "none":
            sys.exit("No credentials. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_TTS_API_KEY.")
        list_voices()
        return

    if not VOICES.is_file():
        sys.exit(f"voices manifest not found: {VOICES}")
    man = json.loads(VOICES.read_text(encoding="utf-8"))
    ENCODING = man.get("audioEncoding", "MP3")
    items = man.get("items", [])
    seg_total = sum(len(it["segments"]) for it in items)
    char_total = sum(len(s["text"]) for it in items for s in it["segments"])
    print(f"items: {len(items)} · segments: {seg_total} · characters: {char_total} · provider: google")
    _build()
    print(f"orchestration backend: {_backend}")

    if args.dry_run:
        for it in items:
            vs = ", ".join(dict.fromkeys(s.get("voice_name", "?") for s in it["segments"]))
            print(f"  - {it['id']:42s} segs={len(it['segments']):>2}  voices=[{vs}]")
        print("\n[dry-run] no API calls, no ffmpeg.")
        return

    if mode == "none":
        sys.exit(
            "\nNo Google credentials.\n"
            "  • Service account (recommended): export GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json\n"
            "  • Or API key: export GOOGLE_TTS_API_KEY=AIza...\n"
            "Enable 'Cloud Text-to-Speech API' on the project first."
        )
    print(f"auth mode: {mode}" + (f" · project {_PROJECT}" if _PROJECT else ""))

    index = json.loads(INDEX.read_text()) if INDEX.is_file() else {}
    made = failed = 0
    for it in items:
        try:
            res = run_item(it)
            if res.get("ok"):
                index[it["id"]] = {
                    "file": f"media/tts/{it['id']}.mp3",
                    "provider": "google",
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
            print(f"  ✗ {it['id']}  HTTP {e.code}: {e.read().decode('utf-8','ignore')[:160]}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ {it['id']}  {e}")

    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\ndone — generated {made}, failed {failed}. backend={_backend}. index → {INDEX}")


if __name__ == "__main__":
    main()
