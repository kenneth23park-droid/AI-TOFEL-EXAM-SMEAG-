#!/usr/bin/env python3
"""SET 9 listening + speaking audio generator (macOS `say` backend).

Regenerates every audio file referenced by the SET 9 content pack into
    studyground/sg2/media/audio/set9/<id>.mp3

Source of truth is the ORIGINAL .docx files (read-only, never modified):
    NEW TOEFL MOCK TEST SET  9.docx   -- structure markers only
    SET 9 SCRIPT.docx                 -- the spoken text

Every docx-sourced segment is sliced out of SET 9 SCRIPT.docx by paragraph index,
so re-running this script after fixing the docx picks the corrections up
automatically.

ONE EXCEPTION, flagged everywhere it appears: Listening Module 2 Q4-15. The docx
prints those question stems but contains no transcript of the conversations and
talks they ask about, so the four bodies were AUTHORED to fit the printed answer
key. They are not read from the docx; they are read from
    sg2/config/_set9_l2/L2-B{2,3,4,5}.json   (origin: "authored")
and carried into the manifest under `authored_scripts`. Replace those JSON files
and re-run with --force if the original transcript is ever recovered.

Standard library only (zipfile / re / html / wave / subprocess / json).
External CLI tools, all preinstalled on macOS except `lame`:
    say         speech synthesis           (/usr/bin/say)
    afconvert   aiff -> 16bit PCM wav      (/usr/bin/afconvert)
    lame        wav -> mp3                 (brew install lame)

Usage:
    studyground/.venv/bin/python studyground/tools/tts_set9.py
    ... --list          print the id -> segment plan, synthesise nothing
    ... --only l1-q13-14,s2-q1
    ... --force         regenerate ids whose mp3 already exists
    ... --manifest-only rewrite the ElevenLabs upgrade manifest and exit
    ... --no-verify     skip the post-generation audio gate (NOT recommended)

POST-GENERATION GATE (on by default). After synthesis this script runs
    tools/verify_audio.py --manifest <manifest> --update-index --stamp-on-pass --base <base>
which re-checks every declared item -- layers 0-2 (mapping / freshness /
integrity / signal) plus layer 3, which transcribes the audio back to text and
compares it to the script (WER). Layer 3 is scoped to audio that changed, i.e.
what this run just wrote. The gate REWRITES the freshness baseline, because right
now is the only moment we know the mp3 matches the script -- except for items that
FAILed, which are left unstamped so they keep getting caught. If the gate reports
FAIL this script exits non-zero -- a generator that silently succeeds while
shipping a truncated or stale mp3 is exactly the accident this project already had.
See studyground/docs/audio-gate.md.
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile

# ---------------------------------------------------------------- paths ----

HERE = os.path.dirname(os.path.abspath(__file__))          # studyground/tools
STUDYGROUND = os.path.dirname(HERE)                        # studyground
REPO = os.path.dirname(STUDYGROUND)                        # project root
SG2 = os.path.join(STUDYGROUND, "sg2")

SCRIPT_DOCX = os.path.join(REPO, "SET 9 SCRIPT.docx")
ITEM_DOCX = os.path.join(REPO, "NEW TOEFL MOCK TEST SET  9.docx")

OUT_DIR = os.path.join(SG2, "media", "audio", "set9")
MANIFEST = os.path.join(SG2, "tts-manifest.set9.json")

# Listening Module 2 Q4-15: the docx has the question stems but no transcript of
# the conversations/talks they ask about, so the bodies were AUTHORED against the
# answer key rather than extracted. They live outside this script, one JSON per
# block, and are marked origin:"authored" there and in the manifest.
AUTHORED_DIR = os.path.join(SG2, "config", "_set9_l2")

# ---------------------------------------------------------------- voices ---
# macOS built-in en_US voices, verified present via `say -v '?'`.
VOICE_M = "Alex"        # male   -> script speaker "M:"
VOICE_W = "Samantha"    # female -> script speaker "W:", narrator, trainer
RATE_WPM = 165          # natural TOEFL listening pace (default 175 is brisk)

GAP_TURN_MS = 400       # pause between two speakers in a conversation
GAP_PARA_MS = 550       # pause between paragraphs of a talk
PAD_MS = 250            # lead-in / lead-out silence

SAMPLE_RATE = 22050
SAMPLE_WIDTH = 2
CHANNELS = 1


# --------------------------------------------------------------- docx io ---

def docx_paragraphs(path):
    """Return the plain text of every <w:p> in document order.

    NOTE the `<w:t(?: [^>]*)?>` form: a naive `<w:t[^>]*>` also matches the
    `<w:tab .../>` elements inside <w:pPr> and swallows raw XML into the text.
    """
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    out = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        text = "".join(re.findall(r"<w:t(?: [^>]*)?>(.*?)</w:t>", para, re.S))
        out.append(html.unescape(text).strip())
    return out


def norm(text):
    """Curly punctuation -> ASCII, so `say` pronounces it correctly."""
    for bad, good in (
        (u"\u2019", "'"), (u"\u2018", "'"),
        (u"\u201c", '"'), (u"\u201d", '"'),
        (u"\u2014", " - "), (u"\u2013", " - "),
        (u"\u2026", "..."), (u"\u00a0", " "),
    ):
        text = text.replace(bad, good)
    # "straight-that's inertia" -> insert a breath so `say` does not run words together
    text = re.sub(r"(\w)-(\w)", r"\1 - \2", text)
    return re.sub(r"\s+", " ", text).strip()


# ------------------------------------------------------------ the plan -----
# Each entry: (id, [(voice, text), ...], gap_ms)
#
# Paragraph indices below are into docx_paragraphs("SET 9 SCRIPT.docx") and are
# asserted at runtime by check_anchors() -- if the docx is edited such that the
# anchors move, the script fails loudly rather than emitting the wrong audio.

ANCHORS = {
    5: "QUESTIONS 1-12",
    19: "Questions 13-14",
    26: "Questions 15-16",
    34: "Questions 17-18",
    41: "Questions 19-20",
    45: "Questions 21-22",
    48: "Questions 23-24",
    51: "Questions 25-28",
    60: "Questions 29-32",
    72: "MODULE 2",
    93: "SPEAKING SECTION",
    105: "Questions 1-4",
}

# Listening Module 1, questions 1-12: one short prompt per question.
L1_SHORT = list(range(6, 18))                    # 12 paragraphs
# Listening Module 2, questions 1-3: one short prompt per question.
L2_SHORT = list(range(74, 77))                   # 3 paragraphs

# Multi-turn / monologue blocks: id -> (first_para, last_para_inclusive)
L1_BLOCKS = [
    ("l1-q13-14", 21, 25),      # conversation  M/W
    ("l1-q15-16", 28, 32),      # conversation  M/W
    ("l1-q17-18", 36, 40),      # conversation  W/M
    ("l1-q19-20", 44, 44),      # announcement  single speaker
    ("l1-q21-22", 47, 47),      # announcement  single speaker
    ("l1-q23-24", 50, 50),      # announcement  single speaker
    ("l1-q25-28", 54, 59),      # talk (cycling / inertia)
    ("l1-q29-32", 63, 70),      # talk (picture dice)
]

# Speaking Task 1 "Listen and Repeat": trainer is female ("repeat what she says").
S1_INSTRUCTION = 94
S1_SENTENCES = list(range(96, 103))              # 7 sentences
# Speaking Task 2 "Interview".
S2_INSTRUCTION = 107
S2_QUESTIONS = list(range(109, 113))             # 4 interviewer turns

# Listening Module 2 bodies that the source does NOT provide. SET 9 SCRIPT.docx
# jumps straight from the three short prompts to the printed question stems; no
# conversation or talk transcript exists for these four blocks in either .docx.
#
# They are therefore NOT sliced out of the docx like everything else above. Each
# body was authored to fit the printed answer key and stored in
#   sg2/config/_set9_l2/<blockId>.json   (origin:"authored")
# together with per-question evidence. This script reads those files and renders
# them exactly like a docx-sourced block, but tags them `authored` everywhere so
# the provenance is never lost. If the real transcript turns up, replace the JSON
# and re-run with --force.
AUTHORED_BLOCK_ORDER = ["L2-B2", "L2-B3", "L2-B4", "L2-B5"]

# audio id -> provenance, filled by build_plan(); consumed by write_manifest().
AUTHORED_META = {}


def load_authored_blocks():
    """[(audio_id, [(voice, text), ...], gap_ms, meta), ...] from _set9_l2/*.json."""
    out = []
    for block_id in AUTHORED_BLOCK_ORDER:
        path = os.path.join(AUTHORED_DIR, block_id + ".json")
        if not os.path.exists(path):
            sys.exit("authored block missing: %s" % path)
        with open(path, "r", encoding="utf-8") as fh:
            blk = json.load(fh)
        segs = []
        for seg in blk["segments"]:
            text = norm(seg["text"])
            if not text:
                continue
            if blk["kind"] == "conversation":
                spk = seg.get("speaker")
                if spk not in ("M", "W"):
                    sys.exit("%s: conversation segment without M/W speaker" % block_id)
                segs.append((VOICE_M if spk == "M" else VOICE_W, text))
            else:
                # A talk is one speaker throughout; match the L1 talks, which are male.
                segs.append((VOICE_M, text))
        gap = GAP_TURN_MS if blk["kind"] == "conversation" else GAP_PARA_MS
        out.append((blk["audioId"], segs, gap,
                    {"blockId": block_id, "kind": blk["kind"],
                     "origin": blk.get("origin", "authored"),
                     "originNote": blk.get("originNote", ""),
                     "wordCount": blk.get("wordCount")}))
    return out


def check_anchors(paras):
    bad = []
    for idx, expected in ANCHORS.items():
        got = paras[idx] if idx < len(paras) else "<out of range>"
        if got.lower() != expected.lower():
            bad.append("  para[%d] expected %r got %r" % (idx, expected, got))
    if bad:
        sys.exit("SET 9 SCRIPT.docx no longer matches the expected layout:\n"
                 + "\n".join(bad))


def split_turns(text):
    """'M: hello' -> (VOICE_M, 'hello'); unprefixed -> (VOICE_W, text)."""
    m = re.match(r"^([MW])\s*:\s*(.*)$", text)
    if m:
        return (VOICE_M if m.group(1) == "M" else VOICE_W), m.group(2)
    return None, text


def build_plan(paras):
    plan = []

    # -- Listening Module 1, short response Q1-Q12 -------------------------
    for n, idx in enumerate(L1_SHORT, start=1):
        # alternate the speaker so consecutive prompts are distinguishable
        voice = VOICE_W if n % 2 else VOICE_M
        plan.append(("l1-q%02d" % n, [(voice, norm(paras[idx]))], GAP_TURN_MS))

    # -- Listening Module 1, conversations / announcements / talks ---------
    for aid, first, last in L1_BLOCKS:
        segs = []
        tagged = False
        for idx in range(first, last + 1):
            raw = paras[idx].strip()
            if not raw:
                continue
            voice, body = split_turns(raw)
            if voice:
                tagged = True
            body = norm(body)
            # The docx hard-wraps some sentences across paragraphs (e.g. the
            # picture-dice talk breaks after "...at once, and"). Re-join those
            # so we do not insert a pause mid-sentence. No text is altered.
            if segs and voice is None and not re.search(r"[.!?\"']\s*$", segs[-1][1]):
                segs[-1] = (segs[-1][0], segs[-1][1] + " " + body)
                continue
            segs.append((voice or VOICE_W, body))
        # A monologue block carries no M:/W: tags -> read it in one voice.
        if not tagged:
            mono = VOICE_M if aid in ("l1-q25-28", "l1-q29-32") else VOICE_W
            segs = [(mono, t) for _v, t in segs]
        gap = GAP_TURN_MS if tagged else GAP_PARA_MS
        plan.append((aid, segs, gap))

    # -- Listening Module 2, short response Q1-Q3 --------------------------
    for n, idx in enumerate(L2_SHORT, start=1):
        voice = VOICE_W if n % 2 else VOICE_M
        plan.append(("l2-q%02d" % n, [(voice, norm(paras[idx]))], GAP_TURN_MS))

    # -- Listening Module 2, AUTHORED bodies Q4-15 -------------------------
    for aid, segs, gap, meta in load_authored_blocks():
        AUTHORED_META[aid] = meta
        plan.append((aid, segs, gap))

    # -- Speaking Task 1 ---------------------------------------------------
    plan.append(("s1-instructions",
                 [(VOICE_W, norm(paras[S1_INSTRUCTION]))], GAP_TURN_MS))
    for n, idx in enumerate(S1_SENTENCES, start=1):
        plan.append(("s1-q%d" % n, [(VOICE_W, norm(paras[idx]))], GAP_TURN_MS))

    # -- Speaking Task 2 ---------------------------------------------------
    plan.append(("s2-instructions",
                 [(VOICE_W, norm(paras[S2_INSTRUCTION]))], GAP_TURN_MS))
    for n, idx in enumerate(S2_QUESTIONS, start=1):
        plan.append(("s2-q%d" % n, [(VOICE_M, norm(paras[idx]))], GAP_TURN_MS))

    return plan


# ----------------------------------------------------------- synthesis -----

def run(cmd):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        sys.exit("command failed: %s\n%s" % (" ".join(cmd),
                                             proc.stderr.decode("utf-8", "replace")))


def say_to_wav(text, voice, dest, tmpdir):
    aiff = os.path.join(tmpdir, "seg.aiff")
    run(["say", "-v", voice, "-r", str(RATE_WPM), "-o", aiff, "--", text])
    run(["afconvert", "-f", "WAVE", "-d",
         "LEI16@%d" % SAMPLE_RATE, "-c", str(CHANNELS), aiff, dest])
    os.remove(aiff)


def silence(ms):
    return b"\x00" * (int(SAMPLE_RATE * ms / 1000.0) * SAMPLE_WIDTH * CHANNELS)


def concat_wavs(parts, gap_ms, dest):
    frames = [silence(PAD_MS)]
    for i, part in enumerate(parts):
        with wave.open(part, "rb") as w:
            if (w.getframerate(), w.getsampwidth(), w.getnchannels()) != \
               (SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS):
                sys.exit("unexpected wav format in %s" % part)
            frames.append(w.readframes(w.getnframes()))
        if i != len(parts) - 1:
            frames.append(silence(gap_ms))
    frames.append(silence(PAD_MS))
    with wave.open(dest, "wb") as out:
        out.setnchannels(CHANNELS)
        out.setsampwidth(SAMPLE_WIDTH)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(b"".join(frames))


def render(aid, segments, gap_ms, out_dir):
    dest = os.path.join(out_dir, aid + ".mp3")
    tmpdir = tempfile.mkdtemp(prefix="tts_set9_")
    try:
        parts = []
        for i, (voice, text) in enumerate(segments):
            if not text:
                continue
            part = os.path.join(tmpdir, "p%03d.wav" % i)
            say_to_wav(text, voice, part, tmpdir)
            parts.append(part)
        if not parts:
            sys.exit("no speakable text for %s" % aid)
        joined = os.path.join(tmpdir, "joined.wav")
        concat_wavs(parts, gap_ms, joined)
        run(["lame", "--quiet", "-q", "2", "-b", "96", "-m", "m", joined, dest])
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return dest


# ---------------------------------------------- ElevenLabs upgrade path ----

def write_manifest(plan):
    """Emit a manifest in the shape sg2/tools/tts_generate.py consumes.

    Multi-speaker blocks are kept as an explicit `segments` list so a future
    ElevenLabs run can give each speaker a distinct studio voice; `text` is the
    flattened fallback for single-voice synthesis.
    """
    items = []
    for aid, segments, gap_ms in plan:
        item = {
            "id": aid,
            "text": " ".join(t for _v, t in segments),
            "out": "media/audio/set9/%s.mp3" % aid,
            "gap_ms": gap_ms,
            "segments": [{"speaker": "M" if v == VOICE_M else "W",
                          "say_voice": v,
                          "text": t} for v, t in segments],
        }
        meta = AUTHORED_META.get(aid)
        if meta:
            item["origin"] = meta["origin"]
            item["originNote"] = meta["originNote"]
            item["sourceFile"] = "config/_set9_l2/%s.json" % meta["blockId"]
        else:
            item["origin"] = "docx"
        items.append(item)
    man = {
        "set": "SET9",
        "note": ("Generated by studyground/tools/tts_set9.py. Current audio is "
                 "macOS `say`. To upgrade to ElevenLabs: set ELEVENLABS_API_KEY, "
                 "map each segment speaker M/W to a voice id under `voices`, "
                 "then run sg2/tools/tts_generate.py against this manifest."),
        "voice": "JBFqnCBsd6RMkjVDRZzb",
        "voices": {"M": "", "W": ""},
        "model": "eleven_flash_v2_5",
        "output": "mp3_44100_128",
        "missing_scripts": [],
        "authored_scripts": [
            {"id": aid,
             "blockId": AUTHORED_META[aid]["blockId"],
             "type": AUTHORED_META[aid]["kind"],
             "wordCount": AUTHORED_META[aid]["wordCount"],
             "source": "config/_set9_l2/%s.json" % AUTHORED_META[aid]["blockId"],
             "reason": ("SET 9 SCRIPT.docx has the Q4-15 stems but no transcript of the "
                        "conversation/talk; this body was authored to fit the printed "
                        "answer key and is replaceable if the original surfaces")}
            for aid in sorted(AUTHORED_META)
        ],
        "items": items,
    }
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(man, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return MANIFEST


# ------------------------------------------------------ post-gen gate ------

VERIFY = os.path.join(HERE, "verify_audio.py")

# manifest `out` paths are "media/audio/set9/<id>.mp3", i.e. relative to SG2.
# --out may point somewhere else (a scratch tree while testing); the gate can
# only run there if that tree has the same shape, so we derive the base by
# stripping the known tail and REFUSE to guess when it does not match. Verifying
# the real sg2 files after writing mp3s somewhere else would be a lie.
OUT_TAIL = os.path.join("media", "audio", "set9")


def verify_base_for(out_dir):
    """(base_dir, reason). base_dir is None when the gate cannot apply."""
    out_abs = os.path.abspath(out_dir)
    if os.path.abspath(OUT_DIR) == out_abs:
        return SG2, ""
    if out_abs.endswith(os.sep + OUT_TAIL):
        return out_abs[: -(len(OUT_TAIL) + 1)], ""
    return None, ("--out %s does not end in %s, so the manifest's relative "
                  "paths cannot be resolved against it" % (out_abs, OUT_TAIL))


def run_audio_gate(out_dir):
    """Run verify_audio.py over the manifest. Returns its exit code (0/1/2).

    Non-zero here must reach the caller: FAIL means the audio must not ship.
    """
    base, why = verify_base_for(out_dir)
    if base is None:
        print("\n[audio gate] SKIPPED -- %s" % why)
        print("             run tools/verify_audio.py by hand against the real tree.")
        return 0
    if not os.path.exists(VERIFY):
        print("\n[audio gate] SKIPPED -- verifier not found: %s" % VERIFY)
        return 0
    cmd = [sys.executable, VERIFY, "--manifest", MANIFEST,
           "--update-index", "--stamp-on-pass", "--base", base]
    print("\n[audio gate] %s" % " ".join(cmd))
    sys.stdout.flush()   # else our buffered output lands AFTER the child's
    return subprocess.run(cmd).returncode


# ---------------------------------------------------------------- main -----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--manifest-only", action="store_true")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip the post-generation audio gate (default: gate runs)")
    args = ap.parse_args()

    for tool in ("say", "afconvert", "lame"):
        if shutil.which(tool) is None:
            sys.exit("required tool not on PATH: %s" % tool)

    paras = docx_paragraphs(SCRIPT_DOCX)
    check_anchors(paras)
    full_plan = build_plan(paras)

    # The manifest always describes the COMPLETE set, never the --only subset.
    plan = full_plan
    if args.only:
        wanted = set(x.strip() for x in args.only.split(",") if x.strip())
        plan = [p for p in full_plan if p[0] in wanted]
        unknown = wanted - set(p[0] for p in full_plan)
        if unknown:
            sys.exit("unknown id(s): %s" % ", ".join(sorted(unknown)))

    if args.list:
        for aid, segments, gap in plan:
            print("%-18s %2d seg  gap=%dms" % (aid, len(segments), gap))
            for v, t in segments:
                print("    [%-8s] %s" % (v, t[:96]))
        print("\nAUTHORED (no transcript in source; body from config/_set9_l2):")
        for aid in sorted(AUTHORED_META):
            m = AUTHORED_META[aid]
            print("  %-16s %-12s %-14s %s words"
                  % (aid, m["blockId"], m["kind"], m["wordCount"]))
        return 0

    path = write_manifest(full_plan)
    print("manifest: %s" % path)
    if args.manifest_only:
        return 0

    os.makedirs(args.out, exist_ok=True)
    made, skipped = 0, 0
    for aid, segments, gap in plan:
        dest = os.path.join(args.out, aid + ".mp3")
        if os.path.exists(dest) and not args.force:
            skipped += 1
            continue
        render(aid, segments, gap, args.out)
        made += 1
        print("  wrote %s" % os.path.basename(dest))

    print("\ngenerated=%d skipped=%d total=%d" % (made, skipped, len(plan)))
    print("AUTHORED (body from config/_set9_l2, not from the docx): %s"
          % ", ".join(sorted(AUTHORED_META)))

    if args.no_verify:
        print("\n[audio gate] DISABLED by --no-verify. "
              "Nothing checked the mp3s against the script.")
        return 0

    # The gate runs even when everything was skipped: an unchanged mp3 next to a
    # changed script is precisely the stale-audio accident, and only the gate
    # sees it. Exit code 1 = FAIL -> do not ship.
    rc = run_audio_gate(args.out)
    if rc:
        print("[audio gate] FAILED (exit %d) -- audio must not be published." % rc)
    return rc


if __name__ == "__main__":
    sys.exit(main())
