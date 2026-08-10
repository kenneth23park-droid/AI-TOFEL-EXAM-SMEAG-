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

The per-item `verify` node only proves a file was written. The REAL gate runs
once at the end of the run: tools/verify_audio.py (layers 0-2 — mapping,
freshness, integrity, signal) over a derived manifest, with --update-index so
the freshness baseline is stamped at the one moment we know audio matches
script. FAIL there makes this script exit non-zero. --no-verify turns it off.

Why a *derived* manifest: media/tts/ is written by several generators
(tts-voices.json here, tts-voices-*-google.json elsewhere), and verify_audio
treats any mp3 in a covered folder that no manifest declares as an orphan and
any content-pack reference it cannot find as a publish blocker. Scoping the gate
to this file's 6 items would report the other 34 files as defects. So the
derived manifest is the UNION of sg2/tts-voices*.json.

Usage:
    export ELEVENLABS_API_KEY=sk_...
    python3 tools/tts_multivoice.py            # generate all (skip cached)
    python3 tools/tts_multivoice.py --force
    python3 tools/tts_multivoice.py --dry-run  # plan + cost, no API/ffmpeg
    python3 tools/tts_multivoice.py --no-verify
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

# tools/verify_audio.py lives in the sibling studyground/tools, not here.
VERIFIER = ROOT.parent / "tools" / "verify_audio.py"
# sg2 루트에 둔다. verify_audio.py 는 item["out"] 을 **매니페스트가 있는 디렉터리** 기준으로
# 푸는데, out 이 "media/tts/<id>.mp3" (sg2 루트 기준)이므로 매니페스트를 media/tts/ 안에 두면
# media/tts/media/tts/... 로 이중 해석된다. tts-manifest.set9.json 과 같은 자리에 두어야
# --base 같은 우회 없이도 그대로 검증된다.
VERIFY_MANIFEST = ROOT / ".verify-manifest.tts.json"
STITCH_GAP_MS = 400            # must match the silence woven in by stitch()

API_KEY = ""       # filled from args/env in main()
MODEL = "eleven_flash_v2_5"
OUTPUT = "mp3_44100_128"
FORCE = False


# ── ElevenLabs call ────────────────────────────────────────────────────────────
def synth_segment(voice: str, text: str, speed: float | None = None) -> bytes:
    """`speed` is ElevenLabs' delivery-rate control (0.7 slowest … 1.2 fastest).

    It matters here because Flash v2.5 reads short prompts much faster than the
    exam's own pacing — measured 220 wpm on one-line questions and 227 wpm on the
    listen-and-repeat drills, against a 150-180 wpm listening band. A drill a
    student cannot say along with is a defect, not a style preference.
    """
    payload: dict[str, Any] = {"text": text, "model_id": MODEL, "output_format": OUTPUT}
    if speed is not None:
        payload["voice_settings"] = {"speed": speed}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        API.format(voice=voice), data=body, method="POST",
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def seg_hash(voice: str, text: str, speed: float | None = None) -> str:
    """Speed joins the key so a re-paced item invalidates only its own segments."""
    return hashlib.sha1(f"{voice}|{MODEL}|{speed}|{text}".encode()).hexdigest()[:12]


# ── graph state ────────────────────────────────────────────────────────────────
class ItemState(TypedDict, total=False):
    id: str
    title: str
    kind: str
    speed: float           # optional per-item delivery rate, 0.7-1.2
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

    speed = state.get("speed")

    def one(i_seg):
        i, seg = i_seg
        h = seg_hash(seg["voice"], seg["text"], speed)
        f = SEG_DIR / f"{state['id']}.{i:02d}.{h}.mp3"
        if f.is_file() and not FORCE:
            return str(f)
        audio = synth_segment(seg["voice"], seg["text"], speed)
        f.write_bytes(audio)
        return str(f)

    with ThreadPoolExecutor(max_workers=4) as ex:
        files = list(ex.map(one, enumerate(segs)))
    return {"seg_files": files}


def stitch(state: ItemState) -> ItemState:
    """Concat segments into one mp3 (0.4s gap between speakers) via ffmpeg.

    An item may name its own destination with `out` (relative to sg2). The exam
    content pack plays media/audio/set9/, not media/tts/, so writing everything
    to OUT_DIR would render audio nothing actually loads.
    """
    rel = state.get("out")
    out = (ROOT / rel) if rel else (OUT_DIR / f"{state['id']}.mp3")
    out.parent.mkdir(parents=True, exist_ok=True)
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


# ── post-run audio gate ────────────────────────────────────────────────────────
def build_verify_manifest(dest: Path = VERIFY_MANIFEST) -> Path:
    """Union of sg2/tts-voices*.json, rewritten in verify_audio's manifest shape.

    Voice POLICY is folded per item into `say_voice` ("<model>|<output>|<voice>")
    instead of the manifest-level model/output fields, which are left empty on
    purpose: those fields feed verify_audio's freshness hash, and one shared
    top-level model would make every google-generated item look stale the moment
    the ElevenLabs model string changed here. Per item, the policy still moves
    the hash — swapping a voice id correctly marks that one mp3 for regeneration.
    """
    items: dict[str, dict] = {}
    for src in sorted(ROOT.glob("tts-voices*.json")):     # deterministic, later wins
        man = json.loads(src.read_text(encoding="utf-8"))
        # "later wins" is only safe while no two manifests claim the same item.
        # When a set is re-rendered by a different provider the old manifest is
        # still on disk and, if it sorts later, silently overrides the one that
        # actually produced the audio — the freshness hash then describes a voice
        # policy no file was made with, and the gate reports FAIL forever.
        # A superseded manifest marks itself `"active": false` and drops out here.
        if man.get("active") is False:
            continue
        policy = f"{man.get('model', '')}|{man.get('output', '')}"
        for it in man.get("items", []):
            segs = [
                {"speaker": s.get("speaker", ""),
                 "say_voice": f"{policy}|{s.get('voice') or s.get('voice_name', '')}",
                 "text": s.get("text", "")}
                for s in it.get("segments", []) if s.get("text", "").strip()
            ]
            items[it["id"]] = {
                "id": it["id"],
                "text": " ".join(s["text"] for s in segs),
                # Honour a declared destination — the exam pack lives in
                # media/audio/set9/, and hardcoding media/tts/ here would point the
                # gate at files that do not exist while leaving the real ones
                # uncovered (and therefore reported as orphans).
                "out": it.get("out") or f"media/tts/{it['id']}.mp3",
                "gap_ms": STITCH_GAP_MS,
                "segments": segs,
                "origin": src.name,
            }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({
        "set": "tts",
        "note": ("Derived by tools/tts_multivoice.py from the union of "
                 "sg2/tts-voices*.json, purely so tools/verify_audio.py has a "
                 "manifest for media/tts/. Do not hand-edit; regenerate."),
        "voice": "", "voices": {}, "model": "", "output": "",
        "missing_scripts": [], "authored_scripts": [],
        "items": [items[k] for k in sorted(items)],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return dest


def run_audio_gate() -> int:
    """verify_audio.py over the derived manifest. Returns its exit code."""
    if not VERIFIER.is_file():
        print(f"\n[audio gate] SKIPPED — verifier not found: {VERIFIER}")
        return 0
    man = build_verify_manifest()
    cmd = [sys.executable, str(VERIFIER), "--manifest", str(man),
           "--update-index", "--base", str(ROOT)]
    print(f"\n[audio gate] {' '.join(cmd)}")
    sys.stdout.flush()   # else our buffered output lands AFTER the child's
    return subprocess.run(cmd).returncode


# ── driver ─────────────────────────────────────────────────────────────────────
def main() -> int:
    global API_KEY, MODEL, OUTPUT, FORCE, VOICES
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-key", default=os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY", ""))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--manifest", default="",
                    help="voices manifest to render (default tts-voices.json). "
                         "The post-run gate still scopes itself to the UNION of "
                         "sg2/tts-voices*.json, so a per-set manifest does not make "
                         "the other sets' files look like orphans.")
    ap.add_argument("--only", default="", help="render just this item id")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip the post-run audio gate (default: gate runs)")
    args = ap.parse_args()

    if args.manifest:
        p = Path(args.manifest)
        VOICES = p if p.is_absolute() else ROOT / args.manifest

    if not VOICES.is_file():
        sys.exit(f"voices manifest not found: {VOICES}")
    man = json.loads(VOICES.read_text(encoding="utf-8"))
    MODEL = man.get("model", MODEL)
    OUTPUT = man.get("output", OUTPUT)
    FORCE = args.force
    items = man.get("items", [])
    if args.only:
        items = [it for it in items if it.get("id") == args.only]
        if not items:
            sys.exit(f"no item with id {args.only!r} in {VOICES.name}")

    seg_total = sum(len(it.get("segments", [])) for it in items)
    char_total = sum(len(s.get("text", "")) for it in items for s in it.get("segments", []))
    print(f"items: {len(items)} · segments: {seg_total} · characters: {char_total} · model: {MODEL}")

    _build()
    print(f"orchestration backend: {_backend}")

    if args.dry_run:
        for it in items:
            voices = ", ".join(dict.fromkeys(s.get("voice_name", "?") for s in it["segments"]))
            print(f"  - {it['id']:42s} segs={len(it['segments']):>2}  voices=[{voices}]")
        print("\n[dry-run] no API calls, no ffmpeg, no audio gate.")
        return 0

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

    if args.no_verify:
        print("[audio gate] DISABLED by --no-verify. Nothing checked the mp3s "
              "against their scripts.")
        return 1 if failed else 0

    rc = run_audio_gate()
    if rc:
        print(f"[audio gate] FAILED (exit {rc}) — audio must not be published.")
    return rc or (1 if failed else 0)


if __name__ == "__main__":
    sys.exit(main())
