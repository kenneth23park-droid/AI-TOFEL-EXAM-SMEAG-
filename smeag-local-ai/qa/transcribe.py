"""
TTS QA gate 1, step 1 — transcription (CrisperWhisper).

Fills `asr_text` into a render manifest so `qa/stt_loopback.py` can score it.
That split is deliberate and predates this script: the WER gate stays
stdlib-only and runs anywhere, while everything that needs a GPU and a 3 GB
model lives here and can be swapped without touching the gate logic.

WHY CrisperWhisper RATHER THAN large-v3
---------------------------------------
The gate exists to catch truncated audio, dropped words and misread numbers.
Standard Whisper is trained toward *fluent* transcripts: when the audio cuts
off mid-clause or the engine swallows a word, it will often emit the sentence
a listener "should" have heard, and the WER gate then passes a defective clip.
CrisperWhisper is trained for verbatim output — disfluencies, repetitions and
truncations survive into the transcript — so a defect stays visible as edit
distance. For a gate whose whole job is detecting omission, that is the
difference between working and not.

It does NOT verify speaker identity. A clip rendered in the wrong voice
transcribes perfectly and scores WER 0%. Voice-casting regressions need a
separate check; do not read a green run here as "the audio is correct".

LICENSING
---------
CrisperWhisper's weights are published under CC BY-NC 4.0 (non-commercial).
That is fine for internal QA of rendered audio, which is what this script does.
It is NOT a clearance to serve the model to students or to put it in the
commercial scoring path — for that, use an appropriately licensed model via
`--backend http`. Verify current terms on the model card before shipping.

BACKENDS
--------
    --backend hf     load the model locally via transformers (default). Falls
                     back to faster-whisper on any clip whose decode collapses;
                     pass --no-fallback to keep the failure instead.
    --backend fw     faster-whisper (CTranslate2) directly — a second opinion
                     with a different runtime and different weights
    --backend http   POST to an OpenAI-compatible /v1/audio/transcriptions
                     endpoint (the campus `whisper` service in
                     serving/docker-compose.yml, or any drop-in replacement)

The http backend is stdlib-only, so an air-gapped campus box can drive the GPU
node without installing torch on every machine.

    python3 qa/transcribe.py --manifest data/render_manifest.set9.json
    python3 qa/transcribe.py --manifest data/render_manifest.set9.json \
        --backend http --url http://127.0.0.1:8001/v1
    python3 qa/transcribe.py --selftest
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import shutil
import subprocess
import sys
import urllib.request
import uuid
from pathlib import Path

MODEL_ID = "nyrahealth/CrisperWhisper"
SAMPLE_RATE = 16000


# ------------------------------------------------------------------ audio ---
def decode_pcm(path: Path) -> "list[float]":
    """
    Decode any container to 16 kHz mono float32 via ffmpeg.

    Going through ffmpeg rather than a Python audio library keeps the
    dependency list short and, more to the point, makes decoding identical to
    what the rest of the pipeline already uses to probe these files. A decoder
    disagreement between QA and rendering would produce phantom failures.
    """
    if not path.is_file():
        raise FileNotFoundError(path)
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH — required to decode exam audio")
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path),
         "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on {path}: {proc.stderr.decode(errors='replace')[:400]}")
    import numpy as np
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    if audio.size == 0:
        raise RuntimeError(f"{path}: decoded to zero samples")
    return audio


# --------------------------------------------------------- plausibility ---
class Plausible:
    """Shared "did this decode actually cover the audio?" floor.

    Lives on a mixin because every local backend needs the identical rule and a
    second copy of the threshold is a second thing to forget to update.
    """

    #: Continuous read-aloud speech runs roughly 2.0-2.8 words/sec. Anything
    #: under this is not slow narration, it is a decode that gave up early.
    #: Set well below the plausible floor so a genuinely sparse clip (long
    #: pauses, a short prompt padded with silence) is not flagged.
    MIN_WORDS_PER_SEC = 0.8
    #: Below this, words/sec is dominated by lead-in and trailing silence.
    MIN_DURATION_FOR_RATE_CHECK = 20.0


# ------------------------------------------------------------- hf backend ---
class HFBackend(Plausible):
    """Local CrisperWhisper via transformers."""

    def __init__(self, model_id: str = MODEL_ID, device: str | None = None):
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        if device is None:
            if torch.cuda.is_available():
                device = "cuda:0"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        # fp16 on MPS produces NaNs in Whisper's attention often enough to be
        # untrustworthy for a correctness gate; pay the memory for fp32 there.
        dtype = torch.float16 if device.startswith("cuda") else torch.float32

        print(f"loading {model_id} on {device} ({dtype})…", file=sys.stderr, flush=True)

        # transformers renamed `torch_dtype` to `dtype` in v5. Campus nodes are
        # patched by hand and will not all be on the same minor version, so
        # accept either rather than pinning the fleet to one.
        def with_dtype(fn, *a, **kw):
            try:
                return fn(*a, dtype=dtype, **kw)
            except TypeError:
                return fn(*a, torch_dtype=dtype, **kw)

        model = with_dtype(
            AutoModelForSpeechSeq2Seq.from_pretrained, model_id, low_cpu_mem_usage=True,
        ).to(device)
        processor = AutoProcessor.from_pretrained(model_id)
        self.pipe = with_dtype(
            pipeline,
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            device=device,
        )
        self.device = device

    def transcribe(self, path: Path) -> str:
        audio = decode_pcm(path)
        out = self.pipe(
            {"raw": audio, "sampling_rate": SAMPLE_RATE},
            # Exam clips run well past Whisper's 30 s window — the lecture
            # blocks are minutes long. Deliberately NOT using `chunk_length_s`:
            # transformers warns that striding is experimental for seq2seq and
            # recommends the model's own sequential long-form algorithm, which
            # `return_timestamps=True` selects. Chunk boundaries land mid-word
            # and manufacture substitutions, and a QA gate that invents errors
            # is worse than no gate — every false reject costs a re-render and
            # erodes trust in the real rejects.
            return_timestamps=True,
            generate_kwargs={
                "language": "en",
                "task": "transcribe",
                # Greedy first pass, then Whisper's documented temperature
                # fallback. Observed on this corpus: on two 100 s clips the
                # greedy decode collapsed into a repetition loop and stopped a
                # third of the way in, emitting a transcript that *looked*
                # fine. The gate then reported "audio appears truncated" and
                # rejected two perfectly good files. Sampling only engages when
                # a pass trips the thresholds below, so clean clips stay
                # deterministic and reproducible; the alternative is a gate
                # that blames the audio for the transcriber's failure.
                "num_beams": 1,
                "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
                "compression_ratio_threshold": 2.4,   # repetition-loop detector
                "logprob_threshold": -1.0,
                "no_speech_threshold": 0.6,
                # Long-form collapse usually starts with the decoder attending
                # to its own looping output rather than the audio.
                "condition_on_prev_tokens": False,
            },
        )
        text = (out.get("text") or "").strip()
        self._assert_plausible(path, text, len(audio) / SAMPLE_RATE)
        return text

    def _assert_plausible(self, path: Path, text: str, seconds: float) -> None:
        """
        Refuse to return a transcript that cannot cover its own audio.

        Raising here is deliberate. A silently short transcript is the one
        failure mode this whole pipeline cannot tolerate: it does not look like
        an error, it looks like evidence, and it indicts the audio for a defect
        the transcriber invented. Failing loudly puts an `asr_error` on the
        segment, and the gate reports "transcription step did not run" — which
        is the truth.
        """
        if seconds < self.MIN_DURATION_FOR_RATE_CHECK:
            return
        rate = len(text.split()) / seconds
        if rate < self.MIN_WORDS_PER_SEC:
            raise RuntimeError(
                f"decode looks collapsed: {len(text.split())} words for "
                f"{seconds:.0f}s of audio ({rate:.2f} words/sec, floor "
                f"{self.MIN_WORDS_PER_SEC}). Re-run, or transcribe {path.name} "
                f"in segments; do NOT treat this as a truncated recording."
            )


# --------------------------------------------------- faster-whisper backend ---
class FasterWhisperBackend(Plausible):
    """CTranslate2 Whisper — the second opinion when the primary decode collapses.

    Kept deliberately independent of HFBackend: a fallback that shares the
    primary's decoder shares its failure mode too, and then a "second opinion"
    is just the same wrong answer twice. Different runtime, different beam
    search, separate model weights.
    """

    DEFAULT_MODEL = "Systran/faster-whisper-medium.en"

    def __init__(self, model_id: str | None = None, device: str = "cpu",
                 compute_type: str = "int8"):
        from faster_whisper import WhisperModel

        self.model_id = model_id or self.DEFAULT_MODEL
        print(f"loading faster-whisper {self.model_id} on {device} ({compute_type})…",
              file=sys.stderr, flush=True)
        self.model = WhisperModel(self.model_id, device=device, compute_type=compute_type)

    def transcribe(self, path: Path) -> str:
        segments, info = self.model.transcribe(
            str(path),
            language="en",
            beam_size=5,
            # Same reasoning as the primary: a decoder attending to its own
            # output is how long-form collapse starts.
            condition_on_previous_text=False,
            # No VAD. Trimming silence here would hide the very defect this
            # pipeline exists to catch — a clip that really is short.
            vad_filter=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        self._assert_plausible(path, text, float(info.duration))
        return text


class FallbackBackend:
    """Try the primary; on an implausible decode, ask the secondary.

    This exists because of a specific, repeated incident: CrisperWhisper's greedy
    decode collapsed on the long lecture blocks and returned a transcript that
    covered a third of the audio — or nothing at all. The gate then reported the
    *audio* as truncated and demanded a re-render of files that were fine. On
    SET 9 that was 9 of 40 clips; a second engine cleared all 9 at 0.97-1.00.

    Only `RuntimeError` triggers the fallback — that is what `_assert_plausible`
    raises. A missing file or a decode crash is a real error and still surfaces.
    """

    def __init__(self, primary, make_secondary):
        self.primary = primary
        self._make_secondary = make_secondary
        self.secondary = None
        self.fallbacks: list[str] = []

    def transcribe(self, path: Path) -> str:
        try:
            return self.primary.transcribe(path)
        except RuntimeError as exc:
            if self.secondary is None:
                print(f"  primary decode collapsed on {path.name} ({exc}); "
                      f"loading fallback engine", file=sys.stderr, flush=True)
                self.secondary = self._make_secondary()
            text = self.secondary.transcribe(path)
            self.fallbacks.append(path.name)
            print(f"  fallback recovered {path.name}: {len(text.split())} words",
                  file=sys.stderr, flush=True)
            return text


# ----------------------------------------------------------- http backend ---
class HTTPBackend:
    """OpenAI-compatible /v1/audio/transcriptions. Stdlib only."""

    def __init__(self, base_url: str, model: str, api_key: str = "local-no-auth",
                 timeout: int = 600):
        self.url = base_url.rstrip("/") + "/audio/transcriptions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def transcribe(self, path: Path) -> str:
        boundary = uuid.uuid4().hex
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        parts: list[bytes] = []

        def field(name: str, value: str) -> None:
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n"
                f"{value}\r\n".encode()
            )

        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{path.name}\"\r\nContent-Type: {ctype}\r\n\r\n".encode()
        )
        parts.append(path.read_bytes())
        parts.append(b"\r\n")
        field("model", self.model)
        field("language", "en")
        field("response_format", "json")
        field("temperature", "0")
        parts.append(f"--{boundary}--\r\n".encode())

        body = b"".join(parts)
        req = urllib.request.Request(
            self.url, data=body, method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return (json.loads(resp.read().decode("utf-8")).get("text") or "").strip()


# ------------------------------------------------------------------- run ---
def run(manifest_path: Path, backend, force: bool, limit: int | None) -> int:
    items = json.loads(manifest_path.read_text(encoding="utf-8"))
    todo = [i for i in items if force or not i.get("asr_text")]
    if limit:
        todo = todo[:limit]
    print(f"{len(todo)} of {len(items)} segment(s) to transcribe", file=sys.stderr)

    done = failed = 0
    for n, it in enumerate(todo, 1):
        sid = it.get("segment_id", "?")
        try:
            it["asr_text"] = backend.transcribe(Path(it["audio_path"]))
            it.pop("asr_error", None)
            done += 1
            print(f"  [{n}/{len(todo)}] {sid}  {it['asr_text'][:70]}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 — one bad clip must not lose the rest
            failed += 1
            it.pop("asr_text", None)
            it["asr_error"] = f"{type(exc).__name__}: {exc}"
            print(f"  [{n}/{len(todo)}] {sid}  FAILED {it['asr_error'][:120]}", file=sys.stderr)
        # Written every iteration: the large blocks take minutes each on CPU,
        # and losing an hour of transcription to a Ctrl-C is not acceptable.
        manifest_path.write_text(json.dumps(items, ensure_ascii=False, indent=2),
                                 encoding="utf-8")

    print(f"transcribed {done}, failed {failed} -> {manifest_path}", file=sys.stderr)
    return 1 if failed else 0


def selftest() -> int:
    """Checks everything except the model: decode path, manifest round-trip."""
    import tempfile
    failures = 0
    print("transcribe selftest")

    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "tone.wav"
            subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
                 "-i", "sine=frequency=440:duration=1", str(wav)],
                check=True,
            )
            n = len(decode_pcm(wav))
            ok = abs(n - SAMPLE_RATE) <= SAMPLE_RATE // 20
            failures += not ok
            print(f"  {'PASS' if ok else 'FAIL'}  decode 1 s tone -> {n} samples "
                  f"(expected ~{SAMPLE_RATE})")
    else:
        print("  SKIP  ffmpeg not on PATH")

    class Fake:
        def transcribe(self, path):
            if "boom" in path.name:
                raise RuntimeError("synthetic failure")
            return "hello world"

    with tempfile.TemporaryDirectory() as td:
        mf = Path(td) / "m.json"
        mf.write_text(json.dumps([
            {"segment_id": "a", "audio_path": str(Path(td) / "a.mp3"), "text_tts": "hello world"},
            {"segment_id": "b", "audio_path": str(Path(td) / "boom.mp3"), "text_tts": "x"},
            {"segment_id": "c", "audio_path": str(Path(td) / "c.mp3"), "text_tts": "y",
             "asr_text": "already done"},
        ]), encoding="utf-8")
        rc = run(mf, Fake(), force=False, limit=None)
        got = json.loads(mf.read_text(encoding="utf-8"))
        checks = [
            ("failure exits non-zero", rc == 1),
            ("success writes asr_text", got[0].get("asr_text") == "hello world"),
            ("failure records asr_error and no asr_text",
             "asr_error" in got[1] and "asr_text" not in got[1]),
            ("existing asr_text not re-transcribed", got[2].get("asr_text") == "already done"),
        ]
        for name, ok in checks:
            failures += not ok
            print(f"  {'PASS' if ok else 'FAIL'}  {name}")

    print(f"\n{failures} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest")
    ap.add_argument("--backend", choices=["hf", "fw", "http"], default="hf")
    ap.add_argument("--no-fallback", action="store_true",
                    help="hf 백엔드가 붕괴해도 faster-whisper 로 재시도하지 않는다")
    ap.add_argument("--fallback-model", default=FasterWhisperBackend.DEFAULT_MODEL)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--device", default=None, help="cuda:0 | mps | cpu (default: autodetect)")
    ap.add_argument("--url", default="http://127.0.0.1:8001/v1", help="http backend base URL")
    ap.add_argument("--api-key", default="local-no-auth")
    ap.add_argument("--force", action="store_true", help="re-transcribe segments that already have asr_text")
    ap.add_argument("--limit", type=int, help="stop after N segments (smoke test)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(selftest())
    if not args.manifest:
        ap.print_help()
        sys.exit(2)

    if args.backend == "fw":
        backend = FasterWhisperBackend(args.fallback_model)
    elif args.backend == "http":
        backend = HTTPBackend(args.url, args.model, args.api_key)
    else:
        backend = HFBackend(args.model, args.device)
        # Loaded lazily: the fallback weights are only fetched if a clip actually
        # collapses, so a clean run costs nothing.
        if not args.no_fallback:
            backend = FallbackBackend(
                backend, lambda: FasterWhisperBackend(args.fallback_model))

    rc = run(Path(args.manifest), backend, args.force, args.limit)
    used = getattr(backend, "fallbacks", [])
    if used:
        print(f"fallback engine transcribed {len(used)} clip(s): "
              + ", ".join(used[:8]), file=sys.stderr)
    sys.exit(rc)


if __name__ == "__main__":
    main()
