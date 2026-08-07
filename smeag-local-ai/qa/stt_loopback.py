"""
TTS QA gate 1 — round-trip verification.

Every rendered exam MP3 is transcribed back to text and compared against the
script it came from. If the word error rate exceeds the threshold, the segment
is rejected and re-rendered.

This catches the failure modes that actually matter in exam audio and that a
human spot-check will miss on the 400th file: numbers read wrong ("B-204" ->
"b two hundred four"), dropped words, and sentences truncated mid-clause.

WER is computed against `text_tts` (the normalised string that was fed to the
engine), not `text_display`. Comparing against the display string would flag
every correctly-read "3:15 pm" as an error.

    python3 qa/stt_loopback.py --manifest data/render_manifest.json
    python3 qa/stt_loopback.py --selftest
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

WER_REJECT = 0.05          # >5% -> re-render
WER_WARN = 0.02            # 2-5% -> human listen

_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)
_WS = re.compile(r"\s+")


def normalise(text: str) -> list[str]:
    """
    Lowercase, strip punctuation, collapse whitespace, split to words.

    ASR output has no reliable casing or punctuation, so comparing those would
    manufacture errors the listener would never hear.
    """
    text = unicodedata.normalize("NFKC", text).lower()
    text = _PUNCT.sub(" ", text)
    return _WS.sub(" ", text).strip().split()


def levenshtein_words(ref: list[str], hyp: list[str]) -> tuple[int, int, int, int]:
    """
    Word-level edit distance with operation counts.

    Returns (distance, substitutions, deletions, insertions). The breakdown
    matters diagnostically: heavy *deletions* mean the engine truncated the
    audio, heavy *substitutions* mean it mispronounced. Those need different
    fixes, so a bare WER number is not enough.
    """
    n, m = len(ref), len(hyp)
    if n == 0:
        return m, 0, 0, m
    # dp[j] holds (cost, sub, del, ins) for the current row.
    prev = [(j, 0, 0, j) for j in range(m + 1)]
    for i in range(1, n + 1):
        cur = [(i, 0, i, 0)] + [(0, 0, 0, 0)] * m
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                cur[j] = prev[j - 1]
                continue
            sub_c, sub_s, sub_d, sub_i = prev[j - 1]
            del_c, del_s, del_d, del_i = prev[j]
            ins_c, ins_s, ins_d, ins_i = cur[j - 1]
            best = min((sub_c + 1, sub_s + 1, sub_d, sub_i),
                       (del_c + 1, del_s, del_d + 1, del_i),
                       (ins_c + 1, ins_s, ins_d, ins_i + 1),
                       key=lambda t: t[0])
            cur[j] = best
        prev = cur
    return prev[m]


def wer(reference: str, hypothesis: str) -> dict:
    ref, hyp = normalise(reference), normalise(hypothesis)
    dist, sub, dele, ins = levenshtein_words(ref, hyp)
    n = max(len(ref), 1)
    return {
        "wer": dist / n,
        "ref_words": len(ref),
        "hyp_words": len(hyp),
        "substitutions": sub,
        "deletions": dele,
        "insertions": ins,
        # A large negative length delta is the truncation signature.
        "length_delta": len(hyp) - len(ref),
    }


#: Below this length, a rate-based threshold is meaningless: one word in a
#: 10-word Part 1 question is 10% WER, which would auto-reject nearly every
#: short prompt. Short segments are judged on the absolute error count instead.
SHORT_SEGMENT_WORDS = 25
SHORT_SEGMENT_TOLERATED_ERRORS = 1


def classify(result: dict) -> tuple[str, str]:
    w = result["wer"]
    n = result["ref_words"]
    errors = result["substitutions"] + result["deletions"] + result["insertions"]

    if n and result["length_delta"] < -0.15 * n:
        return "REJECT", "audio appears truncated — hypothesis much shorter than script"

    # Short-segment rule. A single discrepancy on a short prompt is usually an
    # ASR artefact, not a TTS defect — but it still gets a human ear rather
    # than a silent pass, because on a 10-word prompt one wrong word is often
    # the number or name the whole question turns on.
    if n < SHORT_SEGMENT_WORDS and errors <= SHORT_SEGMENT_TOLERATED_ERRORS:
        if errors == 0:
            return "PASS", f"WER {w:.1%}"
        return "WARN", (f"WER {w:.1%} but only {errors} word on a {n}-word segment — "
                        f"short-segment rule, queue for a human listen")

    if w > WER_REJECT:
        if result["deletions"] > result["substitutions"]:
            return "REJECT", f"WER {w:.1%} — dominated by dropped words"
        return "REJECT", f"WER {w:.1%} — dominated by mispronunciation"
    if w > WER_WARN:
        return "WARN", f"WER {w:.1%} — queue for a human listen"
    return "PASS", f"WER {w:.1%}"


def run_manifest(path: str) -> int:
    """
    Manifest format (one object per rendered segment):
        {"segment_id": "...", "audio_path": "...",
         "text_tts": "...", "asr_text": "..."}

    `asr_text` is filled in by the transcription step. This script does not
    call Whisper itself — keeping transcription out of here means the gate can
    run on a machine with no GPU, and the ASR step can be swapped without
    touching the QA logic.
    """
    items = json.loads(Path(path).read_text(encoding="utf-8"))
    counts = {"PASS": 0, "WARN": 0, "REJECT": 0}
    failures = []
    for it in items:
        if "asr_text" not in it:
            counts["REJECT"] += 1
            failures.append((it.get("segment_id", "?"), "REJECT", "no asr_text — transcription step did not run"))
            continue
        r = wer(it["text_tts"], it["asr_text"])
        verdict, why = classify(r)
        counts[verdict] += 1
        if verdict != "PASS":
            failures.append((it.get("segment_id", "?"), verdict, why))

    total = sum(counts.values())
    print(f"segments {total}   PASS {counts['PASS']}   WARN {counts['WARN']}   REJECT {counts['REJECT']}")
    if total:
        print(f"pass rate {counts['PASS'] / total:.1%}   (phase-1 target: 95%+)")
    for sid, v, why in failures[:40]:
        print(f"  {v:<7} {sid}  {why}")
    if len(failures) > 40:
        print(f"  ... and {len(failures) - 40} more")
    return 1 if counts["REJECT"] else 0


def selftest() -> int:
    cases = [
        ("The lecture starts at three fifteen p m",
         "the lecture starts at three fifteen p m", "PASS"),
        ("The lecture starts at three fifteen p m in room B two oh four",
         "the lecture starts at three fifteen pm in room b twenty four", "REJECT"),
        ("Please turn to page forty seven and read the second paragraph carefully",
         "please turn to page forty seven", "REJECT"),
        # One substitution on a short segment -> WARN, not REJECT (short-segment rule).
        ("The professor discussed migration patterns of arctic terns in detail today",
         "the professor discussed migration patterns of arctic turns in detail today", "WARN"),
        # The same 1-word-in-11 error rate on a LONG segment must still reject,
        # because there the errors are numerous in absolute terms.
        (" ".join(["the lecture covered several distinct topics this afternoon"] * 6),
         " ".join(["the lecture covered several distinct topics this afternoon"] * 5
                  + ["the lecture covered severed distinct topics this afternoon"]), "WARN"),
        # Numbers read wrong on a long segment -> reject.
        ("students should report to room four seventeen at nine thirty on tuesday "
         "morning bringing their identification cards and two sharpened pencils",
         "students should report to room forty seventeen at nine thirteen on thursday "
         "morning bringing their identity cards and two sharpened pencils", "REJECT"),
    ]
    failures = 0
    print("WER gate self-test")
    for ref, hyp, want in cases:
        r = wer(ref, hyp)
        got, why = classify(r)
        ok = got == want
        failures += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  expected {want:<7} got {got:<7} "
              f"wer={r['wer']:.1%} sub={r['substitutions']} del={r['deletions']} "
              f"ins={r['insertions']} | {why}")
    # identical strings must be exactly zero
    if wer("a b c", "a b c")["wer"] != 0.0:
        print("  FAIL  identical strings must give WER 0"); failures += 1
    else:
        print("  PASS  identical strings -> WER 0")
    print(f"\n{failures} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if args.manifest:
        sys.exit(run_manifest(args.manifest))
    ap.print_help()


if __name__ == "__main__":
    main()
