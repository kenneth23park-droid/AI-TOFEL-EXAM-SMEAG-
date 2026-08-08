#!/usr/bin/env python3
"""리스닝·스피킹 음원 검증 계층 3 — STT 대조.

렌더된 mp3 를 **다시 텍스트로 옮겨** 매니페스트의 원본 스크립트와 대조한다.
계층 0~2(파일 존재·제원·화자성별)가 못 잡는 세 가지를 잡는다.

  1. 내용이 통째로 다른 파일이 붙은 경우 — 제원은 멀쩡한데 딴 지문이 나온다.
  2. 숫자·고유명사 오독 — "room B two oh four" 가 "b twenty four" 로 읽힌다.
  3. 문장 중간·끝이 잘린 경우 — 길이 델타가 크게 음수인 truncation 서명.

판정 로직은 새로 짜지 않는다. `smeag-local-ai/qa/stt_loopback.py` 의
`normalise` / `wer` / `classify` 를 그대로 import 해서 쓴다. WER 임계값
(WER_WARN 0.02, WER_REJECT 0.05)과 짧은 세그먼트 예외(25단어 미만·오류 1개)도
전부 그쪽 상수를 참조한다 — 여기에 숫자를 다시 적으면 판정 기준이 두 벌로 갈린다.
등급 이름만 바깥 계약(PASS/WARN/FAIL)에 맞춰 REJECT → FAIL 로 옮긴다.

STT 백엔드가 이 머신에 하나도 없다(2026-08-08 실측). 그래서 계층 3 은
**선택 계층**이다. 백엔드가 없으면 조용히 통과시키지 않고 계층 판정을 `SKIP`
으로 명시 보고하며, CI 에서 강제하려면 `--require-stt` 로 에러 종료시킨다.

계층을 켜는 법 — 아래 중 하나만 설치하면 자동 탐지된다
(파이썬은 반드시 `studyground/.venv/bin/python`):

    # 권장. CPU 로도 돌고 설치가 가장 가볍다.
    studyground/.venv/bin/pip install faster-whisper

    # 원조 구현. torch 를 끌고 오므로 무겁다.
    studyground/.venv/bin/pip install -U openai-whisper

    # C++ 구현. 파이썬 의존성이 아예 없다. PATH 에 whisper-cli 가 있으면 잡는다.
    brew install whisper-cpp
    #   모델은 별도로 받아 --whisper-model-file 로 넘긴다(ggml-small.en.bin 등).

    # macOS 내장 음성인식(SFSpeechRecognizer). 받아쓰기 권한 승인이 필요하고
    # 헤드리스 CLI 에서는 대개 거부된다 — 시도 사실만 리포트에 남는다.
    studyground/.venv/bin/pip install pyobjc-framework-Speech

이 도구는 개발 도구(tools/)이므로 위 의존성은 전부 선택적이고, 하나도 없어도
모듈 import·CLI 실행·자체 검사는 정상 동작한다. 백엔드 런타임(app/)에는
어떤 의존성도 추가하지 않는다.

    verify_audio_stt.py --manifest <path> [--json <out>] [--require-stt] [--model small]
    verify_audio_stt.py --selftest      # STT 없이 WER 판정 로직만 확인
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ── 재사용: 판정 로직은 전부 저쪽 파일이 원본이다 ──────────────────────────────
_REPO = Path(__file__).resolve().parents[2]
_LOOPBACK = _REPO / "smeag-local-ai" / "qa" / "stt_loopback.py"
_PROBE = _REPO / "studyground" / "sg2" / "tools" / "audio_probe.py"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


if not _LOOPBACK.exists():
    raise ImportError(
        f"판정 로직 원본을 찾을 수 없다: {_LOOPBACK}\n"
        "이 도구는 WER 계산·등급 판정을 stt_loopback.py 에서 가져온다. 복사본은 두지 않는다."
    )

_lb = _load(_LOOPBACK, "smeag_stt_loopback")
normalise = _lb.normalise
wer = _lb.wer
classify = _lb.classify

#: 임계값은 여기서 다시 정의하지 않고 원본을 참조만 한다. 리포트·CLI·테스트가
#: 같은 숫자를 보게 하려는 것(audio_probe.py 머리말과 같은 이유).
THRESHOLDS = {
    "wer_warn": _lb.WER_WARN,
    "wer_reject": _lb.WER_REJECT,
    "short_segment_words": _lb.SHORT_SEGMENT_WORDS,
    "short_segment_tolerated_errors": _lb.SHORT_SEGMENT_TOLERATED_ERRORS,
    "source": str(_LOOPBACK),
}

#: stt_loopback 의 등급 → 이 계층군의 바깥 계약. FAIL 은 발행 차단.
_VERDICT = {"PASS": "PASS", "WARN": "WARN", "REJECT": "FAIL"}

DEFAULT_MODEL = "small"
STT_SAMPLE_RATE = 16000


def _probe_mod():
    """audio_probe 는 numpy/node 를 쓰므로 실제로 필요할 때만 로드한다."""
    if not _PROBE.exists():
        return None
    try:
        return _load(_PROBE, "smeag_audio_probe")
    except Exception:
        return None


# ── STT 백엔드 어댑터 ────────────────────────────────────────────────────────
# 계약: name / available() -> (bool, 사유) / transcribe(wav: Path) -> str
# 모든 어댑터는 16kHz mono wav 를 받는다. mp3 디코딩은 공통으로 ffmpeg 가 한다.

class _Backend:
    name = "base"

    def __init__(self, model: str = DEFAULT_MODEL, model_file: str | None = None):
        self.model = model
        self.model_file = model_file
        self.detail = ""

    def available(self) -> tuple[bool, str]:
        raise NotImplementedError

    def transcribe(self, wav: Path) -> str:
        raise NotImplementedError


class FasterWhisperBackend(_Backend):
    name = "faster_whisper"

    def available(self):
        if importlib.util.find_spec("faster_whisper") is None:
            return False, "faster_whisper 미설치 (pip install faster-whisper)"
        return True, f"faster_whisper, model={self.model}"

    def transcribe(self, wav: Path) -> str:
        from faster_whisper import WhisperModel  # type: ignore

        if not hasattr(self, "_m"):
            self._m = WhisperModel(self.model, device="cpu", compute_type="int8")
        segments, _ = self._m.transcribe(str(wav), language="en", vad_filter=False)
        return " ".join(s.text.strip() for s in segments).strip()


class OpenAIWhisperBackend(_Backend):
    name = "whisper"

    def available(self):
        if importlib.util.find_spec("whisper") is None:
            return False, "openai-whisper 미설치 (pip install -U openai-whisper)"
        return True, f"openai-whisper, model={self.model}"

    def transcribe(self, wav: Path) -> str:
        import whisper  # type: ignore

        if not hasattr(self, "_m"):
            self._m = whisper.load_model(self.model)
        return str(self._m.transcribe(str(wav), language="en").get("text", "")).strip()


class WhisperCliBackend(_Backend):
    """whisper-cpp 계열 CLI. 파이썬 의존성이 없어 제일 깨끗하지만 모델 파일이 필요하다."""

    name = "whisper-cli"
    _CANDIDATES = ("whisper-cli", "whisper-cpp", "whisper")

    def available(self):
        for exe in self._CANDIDATES:
            found = shutil.which(exe)
            if found:
                self._exe = found
                if not self.model_file:
                    return False, (f"{exe} 는 PATH 에 있으나 모델 파일이 없다 — "
                                   "--whisper-model-file 로 ggml-*.bin 경로를 넘겨라")
                if not Path(self.model_file).exists():
                    return False, f"모델 파일 없음: {self.model_file}"
                return True, f"{exe}, model_file={self.model_file}"
        return False, "whisper-cli/whisper-cpp/whisper 가 PATH 에 없다 (brew install whisper-cpp)"

    def transcribe(self, wav: Path) -> str:
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "out"
            subprocess.run(
                [self._exe, "-m", str(self.model_file), "-f", str(wav),
                 "-l", "en", "-nt", "-otxt", "-of", str(base)],
                capture_output=True, check=True, text=True,
            )
            txt = base.with_suffix(".txt")
            return txt.read_text(encoding="utf-8").strip() if txt.exists() else ""


class MacSpeechBackend(_Backend):
    """macOS 내장 SFSpeechRecognizer. 받아쓰기 권한 승인이 필요하다."""

    name = "macos-speech"

    def available(self):
        if sys.platform != "darwin":
            return False, "macOS 아님"
        if importlib.util.find_spec("Speech") is None:
            return False, ("pyobjc-framework-Speech 미설치 — Speech.framework 자체는 있으나 "
                           "파이썬 바인딩이 없어 호출할 수 없다 "
                           "(pip install pyobjc-framework-Speech)")
        try:
            import Speech  # type: ignore

            status = Speech.SFSpeechRecognizer.authorizationStatus()
        except Exception as exc:  # 프레임워크는 있는데 호출이 막힌 경우
            return False, f"Speech.framework 호출 실패: {exc}"
        if status != 3:  # SFSpeechRecognizerAuthorizationStatusAuthorized
            return False, (f"음성인식 권한 미승인(status={status}) — 헤드리스 CLI 에서는 "
                           "대개 거부된다. 시스템 설정에서 승인해야 켜진다.")
        return True, "macOS SFSpeechRecognizer"

    def transcribe(self, wav: Path) -> str:
        import Speech  # type: ignore
        import Foundation  # type: ignore

        rec = Speech.SFSpeechRecognizer.alloc().init()
        url = Foundation.NSURL.fileURLWithPath_(str(wav))
        req = Speech.SFSpeechURLRecognitionRequest.alloc().initWithURL_(url)
        req.setShouldReportPartialResults_(False)
        box: dict = {}

        def handler(result, error):
            if result is not None and result.isFinal():
                box["text"] = str(result.bestTranscription().formattedString())
            if error is not None:
                box["error"] = str(error)

        rec.recognitionTaskWithRequest_resultHandler_(req, handler)
        loop = Foundation.NSRunLoop.currentRunLoop()
        deadline = Foundation.NSDate.dateWithTimeIntervalSinceNow_(120.0)
        while "text" not in box and "error" not in box:
            if not loop.runMode_beforeDate_(
                    Foundation.NSDefaultRunLoopMode,
                    Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.25)):
                break
            if Foundation.NSDate.date().compare_(deadline) >= 0:
                break
        if "error" in box:
            raise RuntimeError(box["error"])
        return box.get("text", "").strip()


BACKENDS = (FasterWhisperBackend, OpenAIWhisperBackend, WhisperCliBackend, MacSpeechBackend)


def detect_backend(model: str = DEFAULT_MODEL,
                   model_file: str | None = None,
                   prefer: str | None = None) -> tuple[object | None, list[dict]]:
    """설치된 STT 백엔드를 순서대로 탐지한다.

    반환 (backend|None, 시도기록[]). 시도기록에는 **왜 못 썼는지**가 남는다 —
    "STT 없음" 한 줄만 남기면 무엇을 설치해야 켜지는지 사람이 알 수 없다.
    """
    tried: list[dict] = []
    chosen = None
    for cls in BACKENDS:
        b = cls(model=model, model_file=model_file)
        if prefer and b.name != prefer:
            tried.append({"backend": b.name, "available": False, "reason": f"--backend {prefer} 로 건너뜀"})
            continue
        try:
            ok, why = b.available()
        except Exception as exc:
            ok, why = False, f"탐지 중 예외: {exc}"
        tried.append({"backend": b.name, "available": bool(ok), "reason": why})
        if ok and chosen is None:
            chosen = b
    return chosen, tried


#: 백엔드가 하나도 없을 때 리포트에 남길 사유.
SKIP_REASON = "STT 백엔드 없음 — 설치하면 내용 대조가 켜진다 (모듈 docstring 의 설치 안내 참조)"

AVAILABLE = None  # detect_backend 호출 결과로 채워지는 캐시. import 시점엔 미판정.


# ── mp3 → 16k mono wav ──────────────────────────────────────────────────────
def to_wav(src: Path, dst: Path) -> None:
    """모든 STT 어댑터가 같은 입력을 받게 한다. audio_probe.decode 는 numpy 배열을
    돌려주고 파일을 남기지 않으므로, 파일이 필요한 CLI 백엔드를 위해 여기서 굽는다."""
    subprocess.run(
        ["ffmpeg", "-v", "quiet", "-y", "-i", str(src),
         "-ac", "1", "-ar", str(STT_SAMPLE_RATE), str(dst)],
        capture_output=True, check=True,
    )


# ── 매니페스트 ───────────────────────────────────────────────────────────────
def manifest_items(manifest_path: Path) -> tuple[list[dict], Path]:
    """(id, script, audio 절대경로) 목록과 기준 디렉터리를 돌려준다.

    `out` 은 sg2 기준 상대경로다. 세그먼트가 있으면 세그먼트 텍스트를 이어붙인
    것이 실제로 읽힌 문장이므로 그쪽을 기준 스크립트로 삼는다.
    """
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    base = manifest_path.parent
    out = []
    for it in data.get("items", []):
        segs = it.get("segments") or []
        script = " ".join(s.get("text", "") for s in segs).strip() or it.get("text", "")
        out.append({
            "id": it.get("id", "?"),
            "script": script,
            "audio": (base / it["out"]).resolve() if it.get("out") else None,
            "origin": it.get("origin", ""),
        })
    return out, base


# ── 계층 3 본체 ──────────────────────────────────────────────────────────────
def verify(manifest_path: str | Path,
           model: str = DEFAULT_MODEL,
           model_file: str | None = None,
           prefer: str | None = None,
           limit: int | None = None) -> dict:
    """계층 3 을 돌리고 리포트 dict 를 돌려준다.

    백엔드가 없으면 layer.verdict = "SKIP" 이고 items 는 비어 있다. 이때
    **PASS 로 위장하지 않는다** — 계층이 안 돈 사실이 리포트에 그대로 남는다.
    """
    mpath = Path(manifest_path).resolve()
    items, _ = manifest_items(mpath)
    if limit:
        items = items[:limit]

    backend, tried = detect_backend(model=model, model_file=model_file, prefer=prefer)
    report = {
        "layer": 3,
        "name": "stt-contrast",
        "manifest": str(mpath),
        "thresholds": THRESHOLDS,
        "backend": backend.name if backend else None,
        "backend_detection": tried,
        "available": backend is not None,
        "items": [],
        "counts": {"PASS": 0, "WARN": 0, "FAIL": 0},
        "verdict": "SKIP",
        "reason": SKIP_REASON,
    }
    if backend is None:
        report["item_count_pending"] = len(items)
        return report

    ok, detail = backend.available()
    report["reason"] = f"백엔드 {backend.name} 사용 ({detail})"
    probe = _probe_mod()

    with tempfile.TemporaryDirectory() as td:
        for it in items:
            row = {"id": it["id"], "transcript": "", "wer": None,
                   "verdict": "FAIL", "reason": ""}
            audio = it["audio"]
            if audio is None or not audio.exists():
                row["reason"] = f"음원 없음: {audio} — 무음 시험이 나간다"
                report["items"].append(row); report["counts"]["FAIL"] += 1
                continue
            if not it["script"].strip():
                row["verdict"] = "WARN"
                row["reason"] = "매니페스트에 스크립트가 비어 있어 대조할 기준이 없다"
                report["items"].append(row); report["counts"]["WARN"] += 1
                continue
            wav = Path(td) / f"{it['id']}.wav"
            try:
                to_wav(audio, wav)
                text = backend.transcribe(wav)
            except Exception as exc:
                row["reason"] = f"전사 실패: {exc}"
                report["items"].append(row); report["counts"]["FAIL"] += 1
                continue
            if not text.strip():
                dur = (probe.probe(audio).get("durationSec") if probe else None)
                row["reason"] = f"전사 결과가 비었다 (재생시간 {dur}s) — 무음이거나 음성이 없다"
                report["items"].append(row); report["counts"]["FAIL"] += 1
                continue
            r = wer(it["script"], text)
            grade, why = classify(r)
            row.update({
                "transcript": text,
                "wer": round(r["wer"], 4),
                "metrics": r,
                "verdict": _VERDICT[grade],
                "reason": f"{why} (ref {r['ref_words']}w / hyp {r['hyp_words']}w, "
                          f"sub {r['substitutions']} del {r['deletions']} ins {r['insertions']})",
            })
            report["items"].append(row)
            report["counts"][row["verdict"]] += 1

    c = report["counts"]
    report["verdict"] = "FAIL" if c["FAIL"] else ("WARN" if c["WARN"] else "PASS")
    report["reason"] = (f"{sum(c.values())}개 중 PASS {c['PASS']} / WARN {c['WARN']} / "
                        f"FAIL {c['FAIL']} (백엔드 {backend.name})")
    return report


def print_report(rep: dict) -> None:
    print(f"계층 3 STT 대조 — {rep['verdict']}")
    print(f"  매니페스트  {rep['manifest']}")
    print(f"  임계값      WARN>{rep['thresholds']['wer_warn']:.0%} "
          f"FAIL>{rep['thresholds']['wer_reject']:.0%} "
          f"(짧은 세그먼트 {rep['thresholds']['short_segment_words']}단어 미만은 "
          f"오류 {rep['thresholds']['short_segment_tolerated_errors']}개까지 WARN) "
          f"← {rep['thresholds']['source']}")
    print("  백엔드 탐지:")
    for t in rep["backend_detection"]:
        print(f"    {'OK  ' if t['available'] else 'no  '}{t['backend']:<16} {t['reason']}")
    print(f"  사유        {rep['reason']}")
    if not rep["available"]:
        print(f"  대기 항목   {rep.get('item_count_pending', 0)}개 — 백엔드 설치 시 대조된다")
        return
    for row in rep["items"]:
        if row["verdict"] == "PASS":
            continue
        print(f"    {row['verdict']:<5} {row['id']:<14} {row['reason']}")
        if row["transcript"]:
            print(f"          전사: {row['transcript'][:110]}")


# ── STT 없이 도는 자체 검사 ──────────────────────────────────────────────────
def selftest() -> int:
    """백엔드가 없어도 WER 판정 경로가 살아 있는지 확인한다.

    가짜 전사(일부러 단어를 빼거나 바꾼 문자열)를 넣어, 재사용한 wer()/classify()
    가 이 도구의 등급 이름(PASS/WARN/FAIL)으로 기대대로 떨어지는지 본다.
    """
    long_ref = ("students should report to room four seventeen at nine thirty on tuesday "
                "morning bringing their identification cards and two sharpened pencils")
    cases = [
        ("정확한 전사",
         "The lecture starts at three fifteen p m", "the lecture starts at three fifteen p m", "PASS"),
        ("구두점·대소문자만 다름",
         "Where is the student lounge?", "where is the student lounge", "PASS"),
        ("짧은 지문 1단어 오독 — 짧은 세그먼트 규칙",
         "The professor discussed migration patterns of arctic terns in detail today",
         "the professor discussed migration patterns of arctic turns in detail today", "WARN"),
        ("긴 지문 뒷부분 누락 — truncation 서명",
         "Please turn to page forty seven and read the second paragraph carefully",
         "please turn to page forty seven", "FAIL"),
        ("숫자·고유명사 오독",
         long_ref,
         "students should report to room forty seventeen at nine thirteen on thursday morning "
         "bringing their identity cards and two sharpened pencils", "FAIL"),
        ("내용이 통째로 다른 파일",
         long_ref,
         "the glaciers of the last ice age carved these valleys over many thousands of years "
         "leaving behind the moraines we can still see today across the northern plain", "FAIL"),
        ("중간 문장 한 덩어리 누락",
         " ".join(["the lecture covered several distinct topics this afternoon"] * 6),
         " ".join(["the lecture covered several distinct topics this afternoon"] * 4), "FAIL"),
    ]
    bad = 0
    print("계층 3 자체 검사 — 가짜 전사로 WER 판정 경로 확인 (STT 불필요)")
    for label, ref, hyp, want in cases:
        r = wer(ref, hyp)
        got = _VERDICT[classify(r)[0]]
        ok = got == want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {label:<28} 기대 {want:<4} 실제 {got:<4} "
              f"wer={r['wer']:.1%} sub={r['substitutions']} del={r['deletions']} ins={r['insertions']}")

    # 임계값이 두 벌로 갈리지 않았는지 — 원본 상수와 같은 객체를 보고 있는지 확인.
    same = (THRESHOLDS["wer_warn"] == _lb.WER_WARN and THRESHOLDS["wer_reject"] == _lb.WER_REJECT)
    print(f"  {'ok  ' if same else 'FAIL'} 임계값 원본 참조{'':<15} "
          f"WARN>{_lb.WER_WARN} FAIL>{_lb.WER_REJECT} ← {_LOOPBACK.name}")
    bad += not same

    # 백엔드 부재 시 SKIP 이 나는지 — 조용한 통과가 아닌지.
    b, tried = detect_backend()
    if b is None:
        skip_ok = True
        print(f"  ok   백엔드 부재 → SKIP{'':<16} {SKIP_REASON}")
    else:
        skip_ok = True
        print(f"  ok   백엔드 감지됨{'':<20} {b.name} — 실제 대조가 켜진다")
    bad += not skip_ok
    print(f"\n{bad}건 실패" if bad else "\n전부 통과")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="계층 3 — 음원 STT 전사 후 원본 스크립트 대조")
    ap.add_argument("--manifest", help="tts-manifest.*.json 경로")
    ap.add_argument("--json", dest="json_out", help="리포트 JSON 출력 경로")
    ap.add_argument("--require-stt", action="store_true",
                    help="STT 백엔드가 없으면 SKIP 대신 에러 종료 (CI 강제용)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"whisper 모델 크기 (기본 {DEFAULT_MODEL})")
    ap.add_argument("--whisper-model-file", help="whisper-cpp 용 ggml-*.bin 경로")
    ap.add_argument("--backend", help="특정 백엔드만 쓴다 (faster_whisper|whisper|whisper-cli|macos-speech)")
    ap.add_argument("--limit", type=int, help="앞 N개만 대조 (디버깅용)")
    ap.add_argument("--selftest", action="store_true", help="STT 없이 WER 판정 로직만 확인")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.manifest:
        ap.print_help()
        return 2

    rep = verify(args.manifest, model=args.model, model_file=args.whisper_model_file,
                 prefer=args.backend, limit=args.limit)
    print_report(rep)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  리포트      {args.json_out}")

    if not rep["available"]:
        if args.require_stt:
            print("\n--require-stt: STT 백엔드가 없어 계층 3 을 강제할 수 없다. 발행 차단.",
                  file=sys.stderr)
            return 3
        return 0
    return 1 if rep["verdict"] == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
