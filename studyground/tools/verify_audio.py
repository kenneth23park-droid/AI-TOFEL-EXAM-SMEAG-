#!/usr/bin/env python3
"""TTS 음원 발행 게이트 — 매니페스트 대비 mp3 를 계층 검증한다.

왜 있는가. 이 프로젝트에서 실제로 난 사고 셋을 기계가 잡게 하려고 만들었다.
  1) 지문을 고쳤는데 mp3 를 같은 경로에 덮어쓰지 않아(혹은 아예 재생성하지 않아)
     옛 음원이 계속 나갔다  → 계층 0 의 신선도(stale) 해시가 잡는다.
  2) 문항은 있는데 음원이 없어 무음 시험이 나갈 뻔했다 → 계층 0 의 매핑 검사.
  3) 지문 대신 문항 질문문이 녹음됐다 → 계층 3(ASR 대조)이 잡는다. tools/verify_audio_stt.py
     의 백엔드 탐지와 stt_loopback.py 의 WER 판정을 그대로 빌려 쓴다.

계층
  0  매핑·신선도   외부 도구 불필요. 가장 값싸고 가장 중요하다.
  1  파일 무결성   ffprobe
  2  신호 분석     ffmpeg (silencedetect / volumedetect)
  3  텍스트 대조   ASR — 음원을 다시 받아쓴 뒤 대본과 WER 대조.

계층 3 은 항목당 2~3초가 든다. 그래서 기본 스코프는 `changed`:
**새로 만들었거나 교체된 음원**(사이드카 인덱스의 audioSha256/scriptHash 와 다른 것)만
전사한다. 이것이 이 게이트가 실제로 막고 싶은 순간 — 음원이 바뀌는 순간 — 과 정확히
겹친다. 안 바뀐 파일은 지난 판정을 인덱스에서 꺼내 CACHED 로 보고한다(조용한 통과가 아니다).

없는 계층은 조용히 통과시키지 않고 SKIP 사유와 함께 보고한다.

    .venv/bin/python tools/verify_audio.py --manifest sg2/tts-manifest.set9.json
    .venv/bin/python tools/verify_audio.py --manifest ... --json /tmp/r.json --update-index
    .venv/bin/python tools/verify_audio.py --manifest ... --changed-only   # 교체분만
    .venv/bin/python tools/verify_audio.py --manifest ... --stt-scope all --require-stt
    .venv/bin/python tools/verify_audio.py --selftest
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ── 경로 ─────────────────────────────────────────────────────────────────────
TOOLS = Path(__file__).resolve().parent
STUDYGROUND = TOOLS.parent
SG2 = STUDYGROUND / "sg2"
REPO = STUDYGROUND.parent
_AUDIO_PROBE = SG2 / "tools" / "audio_probe.py"
_STT_LOOPBACK = REPO / "smeag-local-ai" / "qa" / "stt_loopback.py"
_VERIFY_STT = TOOLS / "verify_audio_stt.py"


def _load(name: str, path: Path):
    """파일 경로로 모듈 적재. 두 모듈 다 패키지가 아니고 경로에 공백이 있어서."""
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        return None
    return mod


# 파일 제원 조회는 새로 짜지 않고 audio_probe.probe() 를 그대로 쓴다.
audio_probe = _load("_audio_probe", _AUDIO_PROBE)
# 텍스트 정규화는 stt_loopback.normalise() 를 그대로 쓴다 — 신선도 해시가 WER 게이트와
# 같은 문자열을 봐야 "지문이 바뀌었다"의 정의가 두 벌로 갈리지 않는다.
stt_loopback = _load("_stt_loopback", _STT_LOOPBACK)
# 계층 3 은 여기서 다시 구현하지 않는다. 백엔드 탐지(detect_backend)·mp3→wav(to_wav)·
# WER 판정(wer/classify)·등급 이름(_VERDICT)을 전부 저쪽에서 가져온다. 임계값이 두 벌로
# 갈리면 CLI 두 개가 같은 파일에 다른 판정을 낸다.
verify_stt = _load("_verify_audio_stt", _VERIFY_STT)


# ── 임계값 ───────────────────────────────────────────────────────────────────
# 전부 여기 한 곳에만 둔다. audio_probe.py 주석의 교훈: 임계값이 두 벌로 갈리면
# 테스트는 통과하는데 화면은 불일치라고 말한다.
THRESHOLDS = {
    # 계층 1 — 파일 무결성
    # tools/tts_set9.py 는 macOS `say` → wav → lame/ffmpeg mp3 로 굽는다.
    # 실측(SET9 40개 전수) codec=mp3, sample_rate=22050, channels=1.
    # 다른 엔진(ElevenLabs mp3_44100_128, Kokoro 24k)으로 갈아탈 여지를 두고
    # "허용 목록"으로 두되, 한 세트 안에서 섞이면 볼륨·톤이 튀므로 WARN 한다.
    "codec_allowed": ("mp3",),
    "sample_rate_allowed": (22050, 24000, 44100, 48000),
    "channels_allowed": (1, 2),
    "min_bytes": 1024,          # 헤더만 남은 파일. 1KB 면 어떤 인코더로도 0.1초 미만이다.

    # 계층 2 — 예상 길이 모델
    # tools/tts_set9.py 의 RATE_WPM = 165 (자연스러운 TOEFL 리스닝 속도). 생성기에서
    # 읽어오되 못 읽으면 이 값을 쓴다.
    "wpm_default": 165,
    # 실측 비율(actual/expected, SET9 40개): 25단어 이상 항목 0.816~1.172(중앙 1.047),
    # 25단어 미만 항목 0.827~1.448. 짧은 항목은 문미 한 번의 쉼이 비율을 흔들어서
    # 밴드를 따로 둔다. WARN 밴드는 실측 최대·최소 바깥으로 살짝, FAIL 밴드는
    # "앞 30%만 남긴 잘림"(비율 0.3)을 확실히 잡을 만큼 낮게 잡는다.
    "short_words": 25,
    "dur_ratio_warn_long": (0.80, 1.30),
    "dur_ratio_fail_long": (0.60, 1.70),
    "dur_ratio_warn_short": (0.70, 1.60),
    "dur_ratio_fail_short": (0.45, 2.50),

    # 계층 2 — 무음
    # -40dBFS: `say` 산출물의 무음 구간 바닥은 -60dB 이하, 발화는 -20dB 내외라
    # 중간에서 넉넉히 떨어진 값. 0.25초: 문장 사이 쉼(0.3~0.6초)은 잡고
    # 단어 사이 파열음 정지(<0.15초)는 안 잡는 경계.
    "silence_noise_db": -40,
    "silence_min_sec": 0.25,
    "speech_ratio_dead": 0.02,   # 사실상 전부 무음 — 치명
    "speech_ratio_warn": 0.55,   # 실측 최저가 0.6대. 이 아래면 공백이 비정상적으로 많다
    "lead_silence_warn": 1.5,    # 시험은 재생 버튼 직후 말이 시작돼야 한다
    "tail_silence_warn": 2.5,    # 꼬리 무음은 다음 문항 타이밍을 밀어낸다
    "internal_gap_warn": 4.0,    # 문장 사이 쉼이 4초면 턴 하나가 빠졌다는 뜻일 수 있다

    # 계층 2 — 턴 수(대화에서 화자 턴 통째 결손 검출)
    # gap_ms 의 60% 이상 벌어진 무음만 "턴 경계"로 센다. 문장 내 쉼도 무음이라
    # 그대로 세면 과검출된다. 검출 턴이 대본 턴보다 적으면 결손 의심.
    "turn_gap_ratio": 0.6,
    "turn_gap_min_sec": 0.3,
    "turn_deficit_fail": 0.5,    # 대본 턴의 절반 이하만 검출 → FAIL

    # 계층 2 — 라우드니스 (volumedetect, dBFS)
    # 실측 SET9: mean -25~-19dB, max -1.4~0dB. `say` 는 정규화하지 않으므로
    # 편차가 있다. -35dB 아래면 교실 스피커에서 안 들린다. max 0.0dB 는
    # 풀스케일 도달 = 클리핑 의심.
    "mean_volume_low": -35.0,
    "mean_volume_high": -10.0,
    "peak_clip_db": -0.1,
}

VERDICTS = ("PASS", "WARN", "FAIL")

#: 계층 3 의존성(faster-whisper)은 이 가상환경에만 있다.
_VENV_PY = STUDYGROUND / ".venv" / "bin" / "python"


def reexec_under_venv(script: Path) -> None:
    """ASR 백엔드가 있는 인터프리터로 한 번 갈아탄다.

    생성기들이 `sys.executable` 로 이 도구를 부른다. 시스템 python 으로 생성기를 돌리면
    faster_whisper 를 못 찾아 계층 3 이 조용히 SKIP 된다 — 게이트가 있는데 안 도는,
    가장 나쁜 형태다. 갈아탄 뒤에도 백엔드가 없으면 인터프리터가 같아져 되풀이하지 않는다.
    """
    if verify_stt is None or not _VENV_PY.exists():
        return
    if Path(sys.executable).resolve() == _VENV_PY.resolve():
        return
    try:
        backend, _ = verify_stt.detect_backend()
    except Exception:                                    # noqa: BLE001
        return
    if backend is not None:
        return
    print(f"[audio gate] ASR 백엔드가 없는 인터프리터({sys.executable})라 "
          f"{_VENV_PY} 로 갈아탄다", flush=True)
    os.execv(str(_VENV_PY), [str(_VENV_PY), str(script), *sys.argv[1:]])


def worse(a: str, b: str) -> str:
    return a if VERDICTS.index(a) >= VERDICTS.index(b) else b


# ── 텍스트 정규화 / 신선도 해시 ───────────────────────────────────────────────
_FALLBACK_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)


def normalise_words(text: str):
    """stt_loopback.normalise() 재사용. 모듈이 없으면 None (계층 0 신선도는 SKIP)."""
    if stt_loopback is None:
        return None
    return stt_loopback.normalise(text)


#: 신선도 해시의 정의 버전. 정의가 바뀌면 옛 기준과 새 해시는 당연히 다르다. 그것을
#: STALE(=FAIL) 로 읽으면 정의를 고친 날 전 항목이 발행 차단된다 — 실제로 그렇게 됐다.
#: 버전이 다르면 STALE 이 아니라 "기준 재수립"(WARN)으로 다루고 한 번에 자가 복구한다.
#: v3 — stt_loopback.normalise 가 곱슬 아포스트로피(’)와 %/& 를 접기 시작했다. 정규화가
#: 바뀌면 같은 대본이라도 해시가 달라진다.
SIGNATURE_VERSION = 3


def script_signature(item: dict, manifest: dict) -> str | None:
    """정규화 스크립트 + 음성정책의 sha256.

    음성정책(say_voice/gap_ms)까지 넣는 이유: 텍스트가 그대로여도 화자를 바꿨으면 그
    mp3 는 낡은 것이다. 텍스트만 해시하면 그 사고를 놓친다.

    매니페스트 수준의 voice/voices/model/output 은 **세그먼트에 say_voice 가 없을 때만**
    넣는다. 같은 mp3 를 두 매니페스트가 선언하는 일이 실제로 있고(tts-manifest.set9.json
    과 파생 매니페스트가 media/audio/set9/ 을 공유한다), 항목 내용이 글자까지 같은데도
    매니페스트 머리말이 달라 해시가 갈렸다. 그러면 두 도구가 같은 사이드카 인덱스를
    번갈아 덮어쓰며 서로의 기준을 STALE 로 몰아 늑대소년이 된다. say_voice 는
    "model|output|voice_id" 를 이미 담고 있으므로 그 경우 머리말은 중복이다.
    """
    words = normalise_words(item.get("text") or "")
    if words is None:
        return None
    segments = item.get("segments") or []
    payload = {
        "text": " ".join(words),
        "segments": [
            {
                "speaker": s.get("speaker", ""),
                "say_voice": s.get("say_voice", ""),
                "text": " ".join(normalise_words(s.get("text") or "")),
            }
            for s in segments
        ],
        "gap_ms": item.get("gap_ms", 0),
    }
    if not any((s.get("say_voice") or "").strip() for s in segments):
        payload.update({
            "voice": manifest.get("voice", ""),
            "voices": manifest.get("voices", {}),
            "model": manifest.get("model", ""),
            "output": manifest.get("output", ""),
        })
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def word_count(item: dict) -> int:
    text = " ".join(s.get("text") or "" for s in item.get("segments") or []) or (item.get("text") or "")
    words = normalise_words(text)
    if words is None:                       # stt_loopback 부재 시에도 길이 모델은 돌려야 한다
        words = _FALLBACK_PUNCT.sub(" ", text).split()
    return len(words)


def generator_wpm() -> tuple[int, str]:
    """생성기(tools/tts_set9.py)의 RATE_WPM 을 읽는다. 못 읽으면 상수."""
    src = TOOLS / "tts_set9.py"
    if src.exists():
        m = re.search(r"^RATE_WPM\s*=\s*(\d+)", src.read_text(encoding="utf-8"), re.M)
        if m:
            return int(m.group(1)), f"{src.name}:RATE_WPM"
    return THRESHOLDS["wpm_default"], "THRESHOLDS.wpm_default"


# ── ffmpeg 신호 분석 ─────────────────────────────────────────────────────────
_SIL_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SIL_END = re.compile(r"silence_end:\s*(-?[\d.]+)")
_MEAN_VOL = re.compile(r"mean_volume:\s*(-?[\d.]+) dB")
_MAX_VOL = re.compile(r"max_volume:\s*(-?[\d.]+) dB")


def signal_scan(path: Path, duration: float) -> dict | None:
    """silencedetect + volumedetect 를 한 번의 디코드로 뽑는다."""
    proc = subprocess.run(
        ["ffmpeg", "-nostats", "-hide_banner", "-i", str(path),
         "-af", (f"silencedetect=noise={THRESHOLDS['silence_noise_db']}dB:"
                 f"d={THRESHOLDS['silence_min_sec']},volumedetect"),
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    log = proc.stderr
    starts = [float(x) for x in _SIL_START.findall(log)]
    ends = [float(x) for x in _SIL_END.findall(log)]
    silences = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else duration      # 끝까지 무음이면 end 가 안 찍힌다
        silences.append((max(0.0, s), min(duration, e)))
    # 무음의 여집합 = 발화 구간
    speech, cursor = [], 0.0
    for s, e in silences:
        if s - cursor > 0.01:
            speech.append((cursor, s))
        cursor = max(cursor, e)
    if duration - cursor > 0.01:
        speech.append((cursor, duration))
    mean_v = _MEAN_VOL.search(log)
    max_v = _MAX_VOL.search(log)
    return {
        "silences": silences,
        "speech": speech,
        "meanVolumeDb": float(mean_v.group(1)) if mean_v else None,
        "maxVolumeDb": float(max_v.group(1)) if max_v else None,
    }


# ── 계층 3 — ASR 대조 ────────────────────────────────────────────────────────
def item_script(item: dict) -> str:
    """실제로 읽힌 문장. 세그먼트가 있으면 그것을 이어붙인 것이 기준 대본이다."""
    segs = item.get("segments") or []
    return " ".join(s.get("text", "") for s in segs).strip() or (item.get("text") or "")


def stt_unavailable_reason() -> str:
    if verify_stt is None:
        return f"verify_audio_stt.py 를 못 읽음 ({_VERIFY_STT}) — 계층 3 을 켤 수 없다"
    return verify_stt.SKIP_REASON


def stt_run(queue: list[dict], model: str, model_file: str | None = None,
            prefer: str | None = None) -> dict:
    """queue = [{"result", "path", "script"}] 를 전사해 각 항목의 계층 3 을 채운다.

    백엔드가 없으면 아무 항목도 전사하지 않고 계층 3 을 SKIP 으로 남긴다 — 안 돈 계층이
    PASS 로 위장하지 않게 한다. 전사 자체가 실패한 항목은 FAIL 로 올린다(파일은 있는데
    소리가 없다는 뜻이므로 발행하면 안 된다).
    """
    info = {"backend": None, "detection": [], "transcribed": 0}
    if verify_stt is None:
        info["reason"] = stt_unavailable_reason()
        return info

    backend, tried = verify_stt.detect_backend(model=model, model_file=model_file, prefer=prefer)
    info["detection"] = tried
    if backend is None:
        info["reason"] = verify_stt.SKIP_REASON
        return info

    info["backend"] = backend.name
    ok, detail = backend.available()
    info["reason"] = f"백엔드 {backend.name} ({detail})"

    with tempfile.TemporaryDirectory() as td:
        for q in queue:
            r, path, script = q["result"], q["path"], q["script"]
            l3 = {"status": "OK", "backend": backend.name, "verdict": "PASS"}
            if not script.strip():
                l3.update({"status": "SKIP",
                           "reason": "매니페스트에 대본이 비어 있어 대조할 기준이 없다"})
                r["layers"]["layer3_transcript"] = l3
                r["verdict"] = worse(r["verdict"], "WARN")
                r["reasons"].append("[WARN] 계층3: 대본이 비어 대조 불가")
                continue
            wav = Path(td) / f"{r['id']}.wav"
            try:
                verify_stt.to_wav(path, wav)
                text = backend.transcribe(wav)
            except Exception as exc:                      # noqa: BLE001
                l3.update({"status": "ERROR", "verdict": "FAIL", "reason": f"전사 실패: {exc}"})
                r["layers"]["layer3_transcript"] = l3
                r["verdict"] = worse(r["verdict"], "FAIL")
                r["reasons"].append(f"[FAIL] 계층3 전사 실패: {exc}")
                continue
            info["transcribed"] += 1
            if not text.strip():
                l3.update({"verdict": "FAIL", "transcript": "",
                           "reason": "전사 결과가 비었다 — 무음이거나 사람 목소리가 없다"})
                r["layers"]["layer3_transcript"] = l3
                r["verdict"] = worse(r["verdict"], "FAIL")
                r["reasons"].append("[FAIL] 계층3: 전사 결과가 비었다 — 무음 의심")
                continue
            m = verify_stt.wer(script, text)
            grade, why = verify_stt.classify(m)
            verdict = verify_stt._VERDICT[grade]
            l3.update({"verdict": verdict, "transcript": text, "wer": round(m["wer"], 4),
                       "metrics": m, "reason": why})
            r["layers"]["layer3_transcript"] = l3
            if verdict != "PASS":
                r["verdict"] = worse(r["verdict"], verdict)
                r["reasons"].append(
                    f"[{verdict}] 계층3 대본 불일치 WER {m['wer']:.1%} — {why} "
                    f"(sub {m['substitutions']} del {m['deletions']} ins {m['insertions']}) "
                    f"전사: {text[:90]}")
    return info


# ── 콘텐츠 팩 (node) ─────────────────────────────────────────────────────────
# 정규식으로 JS 를 긁지 않고 node 로 실행해 런타임이 보는 값을 얻는다
# (audio_probe.media_pairs 와 같은 방식).
_DUMP_JS = r"""
global.window = global;
require(process.argv[1]);
var out = [];
function walk(node, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { node.forEach(function (v) { walk(v, seen); }); return; }
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (typeof v === 'string' && /audio/i.test(k) && /\.(mp3|wav|m4a|ogg)$/i.test(v)) out.push(v);
    else walk(v, seen);
  });
}
Object.keys(global).forEach(function (k) {
  if (/^SMEAG_/.test(k)) walk(global[k], new Set());
});
process.stdout.write(JSON.stringify(out));
"""


def pack_audio_refs(pack: Path) -> list[str] | None:
    """콘텐츠 팩이 참조하는 오디오 경로(sg2 기준 상대). node 없거나 실패하면 None."""
    try:
        proc = subprocess.run(["node", "-e", _DUMP_JS, str(pack)],
                              capture_output=True, text=True, timeout=60)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    refs = json.loads(proc.stdout or "[]")
    # set1.js 는 원본 폴더 경로를 쓴다 — audio_probe.rel_path 로 sg2 상대경로화.
    if audio_probe is not None:
        refs = [audio_probe.rel_path(r) for r in refs]
    return sorted(set(refs))


# ── 검증 본체 ────────────────────────────────────────────────────────────────
_LEGACY_INDEX = ".audio-index.json"


def index_path(out_dir: Path, manifest_key: str | None = None) -> Path:
    """신선도 사이드카의 경로. 매니페스트마다 따로 둔다.

    한 폴더를 두 매니페스트가 선언하는 일이 실제로 있다(tts-manifest.set9.json 과
    파생 매니페스트가 media/audio/set9/ 을 공유한다). 사이드카가 한 벌이면 두 도구가
    번갈아 덮어쓰며 서로의 기준을 STALE 로 몬다 — 게이트가 늑대소년이 된다. 매니페스트별
    파일이면 각자의 기준을 각자 들고 있다.

    manifest_key 가 없으면 옛 단일 파일 경로. 새 파일이 없을 때만 읽기용으로 쓴다.
    """
    if not manifest_key:
        return out_dir / _LEGACY_INDEX
    return out_dir / f".audio-index.{manifest_key}.json"


def manifest_key_for(manifest_path: Path) -> str:
    """파일명에서 사이드카 이름에 쓸 키. '.verify-manifest.tts' → 'verify-manifest.tts'."""
    return manifest_path.name.removesuffix(".json").lstrip(".") or "manifest"


def load_index(out_dir: Path, manifest_key: str | None = None) -> dict:
    """매니페스트별 사이드카를 읽고, 없으면 옛 단일 파일에서 한 번 물려받는다."""
    for p in (index_path(out_dir, manifest_key), index_path(out_dir)):
        if not p.exists():
            continue
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("items", {})
        except Exception:
            return {}
    return {}


def audio_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def change_reason(item: dict, manifest: dict, base: Path, indexes: dict,
                  need_stt: bool = True) -> str | None:
    """이 항목을 다시 검사해야 하는 이유. 없으면 None.

    --changed-only 와 계층 3 스코프가 이 한 함수를 같이 본다.

    'ASR 미대조'를 이유에 넣는 이유: 계층 3 이 붙기 전에 만들어진 음원은 인덱스에 stt
    기록이 없다. 그것을 '안 바뀐 것'으로 넘기면 ASR 을 켜 놓고도 기존 음원은 영영
    대조하지 않는다 — 게이트가 있다고 믿는데 실제로는 안 도는 상태가 된다. 첫 실행 한
    번만 전수 전사하고, 그 뒤로는 바뀐 것만 돈다.
    """
    p = base / (item.get("out") or "")
    prev = indexes.get(p.parent, {}).get(item.get("id"))
    if not p.exists():
        return "음원 파일 없음"
    if prev is None:
        return "인덱스에 기준이 없음(신규)"
    if prev.get("sigVersion", 1) != SIGNATURE_VERSION:
        return f"해시 정의 변경(v{prev.get('sigVersion', 1)}→v{SIGNATURE_VERSION})"
    sha = audio_sha(p)
    if prev.get("audioSha256") != sha:
        return "음원 교체됨"
    if prev.get("scriptHash") != script_signature(item, manifest):
        return "대본·음성정책 변경"
    if need_stt:
        # 전사문이 저장돼 있어야 '대조를 마쳤다'고 볼 수 있다. 판정만 있고 전사문이 없으면
        # 대본이 바뀌었을 때 재계산할 근거가 없어 결국 다시 전사해야 한다.
        stt = prev.get("stt") or {}
        if stt.get("audioSha256") != sha or not (stt.get("transcript") or "").strip():
            return "ASR 미대조"
    return None


def is_changed(item: dict, manifest: dict, base: Path, indexes: dict,
               need_stt: bool = True) -> bool:
    return change_reason(item, manifest, base, indexes, need_stt) is not None


def verify(manifest_path: Path, set_id: str | None = None,
           update_index: bool = False, base: Path = SG2,
           stt_scope: str = "changed", stt_model: str | None = None,
           stt_model_file: str | None = None, stt_backend: str | None = None,
           changed_only: bool = False, stamp_on_pass: bool = False) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    all_items = manifest.get("items") or []
    items = all_items
    wpm, wpm_src = generator_wpm()

    skips: list[str] = []
    if stt_loopback is None:
        skips.append(f"layer0.freshness — stt_loopback.normalise 를 못 읽음 ({_STT_LOOPBACK})")
    if audio_probe is None:
        skips.append(f"layer1 — audio_probe.probe 를 못 읽음 ({_AUDIO_PROBE})")

    out_dirs = sorted({(base / it["out"]).parent for it in all_items if it.get("out")})
    mkey = manifest_key_for(manifest_path)
    indexes = {d: load_index(d, mkey) for d in out_dirs}
    # --changed-only 는 안 바뀐 항목을 아예 건드리지 않는다. 그러면 --update-index 가
    # 인덱스를 통째로 새로 쓸 때 손대지 않은 항목의 기준이 날아간다. 기존 인덱스를
    # 씨앗으로 깔고 위에 덮어쓴다.
    new_index: dict[Path, dict] = {d: (dict(indexes[d]) if changed_only else {}) for d in out_dirs}

    if changed_only:
        reasons_by_id = {}
        for it in all_items:
            why = change_reason(it, manifest, base, indexes, need_stt=stt_scope != "none")
            if why:
                reasons_by_id[it.get("id", "?")] = why
        items = [it for it in all_items if it.get("id", "?") in reasons_by_id]
        tally = {}
        for why in reasons_by_id.values():
            tally[why] = tally.get(why, 0) + 1
        skips.append(f"--changed-only — 전체 {len(all_items)}개 중 {len(items)}개만 계층 0~3 을 "
                     "돌렸다 ("
                     + ", ".join(f"{k} {v}" for k, v in sorted(tally.items()))
                     + "). 나머지는 지난 검사 이후 바이트도 대본도 그대로다.")

    manifest_mtime = manifest_path.stat().st_mtime
    results = []
    stt_queue: list[dict] = []
    rescored: list[dict] = []

    for it in items:
        rel = it.get("out") or ""
        path = base / rel
        r = {"id": it.get("id", "?"), "path": rel, "verdict": "PASS",
             "layers": {}, "reasons": []}

        def note(verdict: str, reason: str):
            r["verdict"] = worse(r["verdict"], verdict)
            if verdict != "PASS":
                r["reasons"].append(f"[{verdict}] {reason}")

        # ── 계층 0 ──────────────────────────────────────────────────────────
        sig = script_signature(it, manifest)
        l0 = {"exists": path.exists(), "scriptHash": sig}
        if not l0["exists"]:
            l0["status"] = "FAIL"
            note("FAIL", f"매니페스트 항목의 음원 파일이 없다: {rel}")
            r["layers"]["layer0_mapping"] = l0
            r["layers"]["layer1_integrity"] = {"status": "SKIP", "reason": "파일 없음"}
            r["layers"]["layer2_signal"] = {"status": "SKIP", "reason": "파일 없음"}
            results.append(r)
            continue

        d = path.parent
        prev = indexes.get(d, {}).get(r["id"])
        if sig is None:
            l0["freshness"] = "SKIP"
            l0["freshnessReason"] = "stt_loopback.normalise 부재로 해시 계산 불가"
        elif prev is None:
            l0["freshness"] = "NEW"
            note("WARN", "사이드카 인덱스에 기준 해시가 없다 — 최초 등록이거나 "
                         "인덱스가 유실됐다. --update-index 로 기준을 세워라")
        elif prev.get("sigVersion", 1) != SIGNATURE_VERSION:
            l0["freshness"] = "REBASE"
            l0["previousSigVersion"] = prev.get("sigVersion", 1)
            note("WARN", f"신선도 해시의 정의가 바뀌었다 "
                         f"(v{prev.get('sigVersion', 1)} → v{SIGNATURE_VERSION}) — 옛 기준과는 "
                         "비교할 수 없다. 이번 실행이 기준을 다시 세운다")
        elif prev.get("scriptHash") != sig:
            l0["freshness"] = "STALE"
            l0["previousHash"] = prev.get("scriptHash")
            note("FAIL", "스크립트/음성정책이 바뀌었는데 음원이 재생성되지 않았다 "
                         f"(index {str(prev.get('scriptHash'))[:12]} != now {sig[:12]}) — "
                         "재생성 후 다시 검사하라")
        else:
            l0["freshness"] = "FRESH"

        # mtime 은 기록만 하고 판정에 쓰지 않는다. "mp3 가 매니페스트보다 오래됐다"를
        # WARN 으로 걸어봤더니, 한 항목만 고쳐도 매니페스트 파일 mtime 이 갱신돼
        # 40개 전부가 WARN 이 됐다(실측). 진짜 신호(해시 불일치 1건)가 오검출에
        # 묻힌다. 신선도의 권위는 항목별 해시 하나로 충분하다.
        l0["mp3Mtime"] = round(path.stat().st_mtime, 1)
        l0["manifestMtime"] = round(manifest_mtime, 1)
        # mp3 바이트 해시. 파일 이름이 뒤바뀐 사고를 길이에 기대지 않고 잡는다.
        # (길이가 비슷한 두 파일을 맞바꾸면 계층 2 의 길이 모델은 못 잡는다.)
        l0["audioSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        if prev and prev.get("audioSha256") == l0["audioSha256"]:
            l0["audioChanged"] = False
        elif prev:
            l0["audioChanged"] = True
        l0["status"] = "OK"
        r["layers"]["layer0_mapping"] = l0

        # ── 계층 1 ──────────────────────────────────────────────────────────
        if audio_probe is None:
            r["layers"]["layer1_integrity"] = {"status": "SKIP", "reason": "audio_probe 부재"}
            spec = {}
        else:
            on_disk = path.stat().st_size
            spec = audio_probe.probe(path)
            l1 = dict(spec)
            l1["diskBytes"] = on_disk
            if not spec:
                l1["status"] = "FAIL"
                # 0바이트는 ffprobe 도 실패하지만, 사유를 "손상"이 아니라 정확히
                # 말해줘야 사람이 재생성 대상인지 바로 안다.
                note("FAIL", f"파일 크기 {on_disk}B — 빈 파일(생성이 중간에 끊겼다)"
                     if on_disk < THRESHOLDS["min_bytes"]
                     else "ffprobe 가 디코드하지 못했다 — 손상된 파일")
            else:
                if spec["bytes"] < THRESHOLDS["min_bytes"]:
                    note("FAIL", f"파일 크기 {spec['bytes']}B < {THRESHOLDS['min_bytes']}B")
                if spec["durationSec"] <= 0:
                    note("FAIL", f"재생시간 {spec['durationSec']}s")
                if spec["codec"] not in THRESHOLDS["codec_allowed"]:
                    note("FAIL", f"코덱 {spec['codec']!r} 이 허용 목록 "
                                 f"{THRESHOLDS['codec_allowed']} 밖")
                if spec["sampleRate"] not in THRESHOLDS["sample_rate_allowed"]:
                    note("WARN", f"샘플레이트 {spec['sampleRate']}Hz 가 허용 목록 밖")
                if spec["channels"] not in THRESHOLDS["channels_allowed"]:
                    note("WARN", f"채널 {spec['channels']} 가 허용 목록 밖")
                l1["status"] = "OK"
            r["layers"]["layer1_integrity"] = l1

        duration = float(spec.get("durationSec") or 0)
        if duration <= 0:
            r["layers"]["layer2_signal"] = {"status": "SKIP", "reason": "재생시간 0 — 분석 불가"}
            results.append(r)
            if sig:
                new_index[d][r["id"]] = {"scriptHash": sig, "sigVersion": SIGNATURE_VERSION,
                                         "bytes": spec.get("bytes", 0), "durationSec": duration}
            continue

        # ── 계층 2 ──────────────────────────────────────────────────────────
        segs = it.get("segments") or []
        gap_s = (it.get("gap_ms") or 0) / 1000.0
        words = word_count(it)
        expected = words / wpm * 60.0 + max(0, len(segs) - 1) * gap_s
        ratio = duration / expected if expected > 0 else 0.0
        short = words < THRESHOLDS["short_words"]
        warn_lo, warn_hi = THRESHOLDS["dur_ratio_warn_short" if short else "dur_ratio_warn_long"]
        fail_lo, fail_hi = THRESHOLDS["dur_ratio_fail_short" if short else "dur_ratio_fail_long"]

        l2 = {"words": words, "wpm": wpm, "wpmSource": wpm_src,
              "expectedSec": round(expected, 2), "actualSec": round(duration, 2),
              "durationRatio": round(ratio, 3), "segments": len(segs)}
        if ratio < fail_lo:
            note("FAIL", f"음원이 대본보다 너무 짧다 — 잘림 의심: {duration:.2f}s "
                         f"vs 예상 {expected:.2f}s ({words}단어/{wpm}wpm), 비율 {ratio:.2f} "
                         f"< {fail_lo}")
        elif ratio > fail_hi:
            note("FAIL", f"음원이 대본보다 너무 길다: {duration:.2f}s vs 예상 {expected:.2f}s, "
                         f"비율 {ratio:.2f} > {fail_hi}")
        elif ratio < warn_lo or ratio > warn_hi:
            note("WARN", f"길이 비율 {ratio:.2f} 이 정상대역 [{warn_lo}, {warn_hi}] 밖 "
                         f"({duration:.2f}s vs 예상 {expected:.2f}s)")

        sig_scan = signal_scan(path, duration)
        if sig_scan is None:
            l2["silence"] = {"status": "SKIP", "reason": "ffmpeg 실행 실패"}
        else:
            speech = sig_scan["speech"]
            speech_sec = sum(e - s for s, e in speech)
            ratio_speech = speech_sec / duration
            lead = speech[0][0] if speech else duration
            tail = duration - speech[-1][1] if speech else duration
            internal = [speech[i + 1][0] - speech[i][1] for i in range(len(speech) - 1)]
            turn_gap = max(THRESHOLDS["turn_gap_min_sec"], gap_s * THRESHOLDS["turn_gap_ratio"])
            turns = 1 + sum(1 for g in internal if g >= turn_gap) if speech else 0
            l2.update({
                "speechRatio": round(ratio_speech, 3),
                "speechRuns": len(speech),
                "leadSilenceSec": round(lead, 2),
                "tailSilenceSec": round(tail, 2),
                "longestInternalGapSec": round(max(internal), 2) if internal else 0.0,
                "detectedTurns": turns,
                "turnGapThresholdSec": round(turn_gap, 2),
                "meanVolumeDb": sig_scan["meanVolumeDb"],
                "maxVolumeDb": sig_scan["maxVolumeDb"],
            })
            if ratio_speech < THRESHOLDS["speech_ratio_dead"]:
                note("FAIL", f"사실상 전부 무음 — 발화 비율 {ratio_speech:.1%} "
                             f"< {THRESHOLDS['speech_ratio_dead']:.0%}")
            elif ratio_speech < THRESHOLDS["speech_ratio_warn"]:
                note("WARN", f"발화 비율 {ratio_speech:.1%} 이 낮다 "
                             f"(< {THRESHOLDS['speech_ratio_warn']:.0%}) — 공백 과다")
            if lead > THRESHOLDS["lead_silence_warn"]:
                note("WARN", f"선행 무음 {lead:.2f}s > {THRESHOLDS['lead_silence_warn']}s")
            if tail > THRESHOLDS["tail_silence_warn"]:
                note("WARN", f"후행 무음 {tail:.2f}s > {THRESHOLDS['tail_silence_warn']}s")
            if internal and max(internal) > THRESHOLDS["internal_gap_warn"]:
                note("WARN", f"내부 최장 공백 {max(internal):.2f}s > "
                             f"{THRESHOLDS['internal_gap_warn']}s — 턴 결손 의심")
            if len(segs) > 1 and turns < len(segs):
                deficit = turns / len(segs)
                msg = (f"검출 턴 {turns} < 대본 세그먼트 {len(segs)} "
                       f"(무음 {turn_gap:.2f}s 기준) — 화자 턴 결손 의심")
                note("FAIL" if deficit <= THRESHOLDS["turn_deficit_fail"] else "WARN", msg)
            mv, xv = sig_scan["meanVolumeDb"], sig_scan["maxVolumeDb"]
            if mv is not None and mv < THRESHOLDS["mean_volume_low"]:
                note("WARN", f"평균 라우드니스 {mv}dBFS 가 너무 작다 "
                             f"(< {THRESHOLDS['mean_volume_low']})")
            if mv is not None and mv > THRESHOLDS["mean_volume_high"]:
                note("WARN", f"평균 라우드니스 {mv}dBFS 가 너무 크다 "
                             f"(> {THRESHOLDS['mean_volume_high']})")
            if xv is not None and xv >= THRESHOLDS["peak_clip_db"]:
                note("WARN", f"피크 {xv}dBFS — 클리핑 의심 (>= {THRESHOLDS['peak_clip_db']})")
        l2["status"] = "OK"
        r["layers"]["layer2_signal"] = l2

        # ── 계층 3 대기열 ───────────────────────────────────────────────────
        # 전사는 항목당 2~3초라 전부 돌리면 게이트가 분 단위가 된다. 기본은 '바뀐 것만'.
        #
        # 전사문은 **음원 바이트만의 함수**다. 대본이 바뀌어도 그 mp3 가 뭐라고 읽혔는지는
        # 그대로다. 그래서 캐시 열쇠는 audioSha256 하나로 두고, 대본이 바뀌었으면 저장된
        # 전사문에 대고 WER 만 다시 센다 — 대본 교정 때문에 40개를 다시 전사할 이유가 없다.
        cached = (prev or {}).get("stt")
        cached_hit = bool(cached
                          and cached.get("audioSha256") == l0["audioSha256"]
                          and (cached.get("transcript") or "").strip())
        if stt_scope == "none":
            r["layers"]["layer3_transcript"] = {
                "status": "SKIP", "reason": "--stt-scope none — 대본 대조를 끄고 돌렸다"}
        elif stt_scope == "changed" and cached_hit:
            text = cached["transcript"]
            if cached.get("scriptHash") == sig:
                l3 = dict(cached, status="CACHED",
                          reason=f"음원·대본이 그대로라 지난 판정 재사용 ({cached.get('reason', '')})")
            elif verify_stt is None:
                l3 = dict(cached, status="CACHED",
                          reason="대본이 바뀌었으나 WER 재계산 모듈이 없어 지난 판정을 그대로 쓴다")
            else:
                m = verify_stt.wer(item_script(it), text)
                grade, why = verify_stt.classify(m)
                l3 = {"status": "RESCORED", "backend": cached.get("backend"),
                      "verdict": verify_stt._VERDICT[grade], "transcript": text,
                      "wer": round(m["wer"], 4), "metrics": m,
                      "reason": f"저장된 전사문으로 재계산(전사 생략) — {why}"}
            r["layers"]["layer3_transcript"] = l3
            if l3.get("verdict") in ("WARN", "FAIL"):
                r["verdict"] = worse(r["verdict"], l3["verdict"])
                r["reasons"].append(
                    f"[{l3['verdict']}] 계층3 대본 불일치 WER {l3.get('wer')} — "
                    f"{l3.get('reason', '')} 전사: {text[:90]}")
            # 재계산 결과를 인덱스에 되돌려 놓기 위해 대기열과 같은 정보를 남긴다
            rescored.append({"result": r, "dir": d, "scriptHash": sig,
                             "audioSha256": l0["audioSha256"]})
        else:
            r["layers"]["layer3_transcript"] = {"status": "PENDING"}
            stt_queue.append({"result": r, "path": path, "script": item_script(it),
                              "dir": d, "scriptHash": sig,
                              "audioSha256": l0["audioSha256"]})

        if sig:
            entry = {"scriptHash": sig, "sigVersion": SIGNATURE_VERSION,
                     "bytes": spec.get("bytes", 0), "durationSec": duration,
                     "audioSha256": r["layers"]["layer0_mapping"]["audioSha256"]}
            if cached_hit:
                entry["stt"] = cached          # 재사용한 판정을 인덱스에서 떨어뜨리지 않는다
            new_index[d][r["id"]] = entry
        results.append(r)

    # ── 계층 3: 신규·교체된 음원만 전사해 대본과 대조 ─────────────────────────
    stt_info = {"scope": stt_scope, "queued": len(stt_queue), "backend": None,
                "detection": [], "transcribed": 0,
                "reason": "대기열이 비었다 — 전사할 신규·교체 음원이 없다"}
    if stt_queue:
        stt_info = dict(stt_run(stt_queue, model=stt_model or (
            verify_stt.DEFAULT_MODEL if verify_stt else "small"),
            model_file=stt_model_file, prefer=stt_backend),
            scope=stt_scope, queued=len(stt_queue))
        if stt_info.get("backend") is None:
            for q in stt_queue:
                q["result"]["layers"]["layer3_transcript"] = {
                    "status": "SKIP", "reason": stt_info.get("reason", stt_unavailable_reason())}
            skips.append(f"layer3.transcript — {stt_info.get('reason')} "
                         f"({len(stt_queue)}개 대기). 음원이 '지문 대신 문항 질문문'인 경우를 "
                         "이 실행은 잡지 못했다.")
        else:
            # PASS/WARN 만 인덱스에 굳힌다. FAIL 을 기준으로 삼으면 다음 실행이 그 파일을
            # '이미 검사함'으로 넘겨 나쁜 음원이 조용히 통과한다.
            for q in stt_queue:
                l3 = q["result"]["layers"].get("layer3_transcript") or {}
                if l3.get("verdict") not in ("PASS", "WARN"):
                    continue
                e = new_index.get(q["dir"], {}).get(q["result"]["id"])
                if e is None:
                    continue
                e["stt"] = {"verdict": l3["verdict"], "wer": l3.get("wer"),
                            "backend": l3.get("backend"), "reason": l3.get("reason", ""),
                            # 전사문까지 남긴다. 대조 화면(admin-audio-sync.html)이 읽는
                            # 값이라, 안 남기면 화면을 맞추려고 같은 mp3 를 또 전사해야 한다.
                            "transcript": l3.get("transcript", ""),
                            "audioSha256": q["audioSha256"], "scriptHash": q["scriptHash"]}
    elif stt_scope == "none":
        stt_info["reason"] = "--stt-scope none — 대본 대조를 끄고 돌렸다"
        skips.append("layer3.transcript — --stt-scope none 으로 껐다")

    # 저장된 전사문으로 다시 센 판정도 인덱스에 돌려놓는다. 안 그러면 대본을 고칠 때마다
    # 같은 재계산을 되풀이하고, 캐시의 scriptHash 가 영영 옛것으로 남는다.
    stt_info["rescored"] = len(rescored)
    for q in rescored:
        l3 = q["result"]["layers"].get("layer3_transcript") or {}
        if l3.get("status") != "RESCORED" or l3.get("verdict") not in ("PASS", "WARN"):
            continue
        e = new_index.get(q["dir"], {}).get(q["result"]["id"])
        if e is None:
            continue
        e["stt"] = {"verdict": l3["verdict"], "wer": l3.get("wer"),
                    "backend": l3.get("backend"), "reason": l3.get("reason", ""),
                    "transcript": l3.get("transcript", ""),
                    "audioSha256": q["audioSha256"], "scriptHash": q["scriptHash"]}

    # ── 계층 0 전역: 파일 뒤바뀜 / 중복 ──────────────────────────────────────
    # 인덱스에 기록된 "다른 항목의 음원"이 지금 이 항목 자리에 있으면 이름이 뒤바뀐 것이다.
    owner_by_audio = {}
    for d, entries in indexes.items():
        for iid, e in entries.items():
            if e.get("audioSha256"):
                owner_by_audio.setdefault(e["audioSha256"], set()).add(iid)
    by_audio_now: dict[str, list[str]] = {}
    for r in results:
        h = r["layers"].get("layer0_mapping", {}).get("audioSha256")
        if not h:
            continue
        by_audio_now.setdefault(h, []).append(r["id"])
        owners = owner_by_audio.get(h, set())
        if owners and r["id"] not in owners:
            r["verdict"] = worse(r["verdict"], "FAIL")
            r["reasons"].append(f"[FAIL] 이 자리의 음원이 인덱스상 {sorted(owners)} 의 "
                                f"음원과 동일하다 — 파일 이름이 뒤바뀌었다")
    for h, ids in by_audio_now.items():
        if len(ids) > 1:
            for r in results:
                if r["id"] in ids:
                    r["verdict"] = worse(r["verdict"], "FAIL")
                    r["reasons"].append(f"[FAIL] 여러 항목이 완전히 같은 음원 파일을 쓴다: "
                                        f"{ids} — 한 쪽이 잘못 복사됐다")

    # ── 계층 0 전역: 고아 파일 / 콘텐츠 팩 교차 확인 ─────────────────────────
    # 고아·팩 대조는 언제나 매니페스트 전체를 본다. --changed-only 로 걸러진 목록을 쓰면
    # 손대지 않은 39개가 전부 '매니페스트에 없는 고아'로 보고된다.
    declared = {(base / it["out"]).resolve() for it in all_items if it.get("out")}
    orphans = []
    for d in out_dirs:
        for f in sorted(d.glob("*.mp3")):
            if f.resolve() not in declared:
                orphans.append(str(f.relative_to(base)))

    declared_rel = {it["out"] for it in all_items if it.get("out")}
    pack_report = []
    for pack in sorted(SG2.glob("assets/set*.js")):
        refs = pack_audio_refs(pack)
        if refs is None:
            pack_report.append({"pack": pack.name, "status": "SKIP",
                                "reason": "node 로 팩을 읽지 못함"})
            continue
        # 이 매니페스트가 담당하는 출력 폴더 아래 참조만 대조한다. 다른 세트의
        # 음원까지 여기서 결손 처리하면 게이트가 서로 남의 일로 실패한다.
        owned_prefixes = tuple(str((base / it["out"]).parent.relative_to(base)) + "/"
                               for it in all_items if it.get("out"))
        owned_prefixes = tuple(sorted(set(owned_prefixes)))
        scoped = [x for x in refs if x.startswith(owned_prefixes)]
        missing = [x for x in scoped if x not in declared_rel]
        pack_report.append({"pack": pack.name, "status": "OK", "refs": len(refs),
                            "scoped": len(scoped), "missingFromManifest": missing})

    counts = {"PASS": 0, "WARN": 0, "FAIL": 0}
    for r in results:
        counts[r["verdict"]] += 1

    global_reasons = []
    if orphans:
        global_reasons.append(f"[WARN] 매니페스트에 없는 고아 mp3 {len(orphans)}개: "
                              + ", ".join(orphans[:8]) + ("..." if len(orphans) > 8 else ""))
    for pr in pack_report:
        if pr["status"] == "SKIP":
            skips.append(f"layer0.pack[{pr['pack']}] — {pr['reason']}")
        elif pr["missingFromManifest"]:
            global_reasons.append(
                f"[FAIL] 콘텐츠 팩 {pr['pack']} 이 참조하는데 매니페스트에 없는 음원 "
                f"{len(pr['missingFromManifest'])}개: " + ", ".join(pr["missingFromManifest"][:8]))

    report = {
        "manifest": str(manifest_path),
        "set": set_id or manifest.get("set"),
        "wpm": wpm, "wpmSource": wpm_src,
        "thresholds": THRESHOLDS,
        "sttThresholds": (verify_stt.THRESHOLDS if verify_stt else None),
        "stt": stt_info,
        "itemsChecked": len(items), "itemsDeclared": len(all_items),
        "changedOnly": bool(changed_only),
        "counts": counts,
        "skipped": skips,
        "orphanFiles": orphans,
        "packCrossCheck": pack_report,
        "globalReasons": global_reasons,
        "items": results,
    }

    # FAIL 난 항목의 기준을 굳히면, 다음 실행은 그 나쁜 음원을 '검사 끝난 것'으로 넘긴다.
    # 신선도 기준은 음원이 대본과 맞는 순간에만 찍혀야 한다. 다만 한 건의 FAIL 로 인덱스
    # 전체를 막으면 멀쩡한 나머지가 매번 다시 전사된다 — 그래서 항목 단위로 뺀다.
    dropped = []
    if stamp_on_pass:
        failed_ids = {r["id"] for r in results if r["verdict"] == "FAIL"}
        for d, entries in new_index.items():
            for iid in failed_ids & set(entries):
                entries.pop(iid, None)
                dropped.append(iid)
    report["indexUpdated"] = bool(update_index)
    if dropped:
        report["indexSkippedItems"] = sorted(dropped)

    if update_index:
        for d, entries in new_index.items():
            # stamp_on_pass 로 전부 떨어져 비었으면 그 사실을 파일에 반영해야 한다.
            # 옛 파일을 그대로 두면 FAIL 난 음원이 다음 실행에서 '기준과 같다'로 통과한다.
            if not entries and not stamp_on_pass:
                continue
            index_path(d, mkey).write_text(json.dumps(
                {"note": "verify_audio.py 신선도 기준. 스크립트/음성정책 해시 + 계층3 판정. "
                         "매니페스트별로 따로 둔다(한 폴더를 두 매니페스트가 선언할 수 있다). "
                         "손으로 고치지 말고 tools/audio_gate.py 로 다시 세워라.",
                 "manifest": manifest_path.name,
                 "sigVersion": SIGNATURE_VERSION,
                 "items": entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return report


# ── 출력 ─────────────────────────────────────────────────────────────────────
def print_report(rep: dict) -> None:
    c = rep["counts"]
    total = sum(c.values())
    print(f"manifest {rep['manifest']}")
    print(f"set {rep['set']}   items {total}"
          + (f"/{rep['itemsDeclared']} (신규·교체분만)" if rep.get("changedOnly") else "")
          + f"   PASS {c['PASS']}   WARN {c['WARN']}   FAIL {c['FAIL']}")
    print(f"길이 모델 {rep['wpm']}wpm (출처 {rep['wpmSource']})")
    s = rep.get("stt") or {}
    if s.get("backend"):
        t = rep.get("sttThresholds") or {}
        print(f"계층3 ASR  {s['backend']} — 전사 {s.get('transcribed', 0)}건 "
              f"(스코프 {s.get('scope')}, 대기열 {s.get('queued', 0)}) "
              f"WARN>{t.get('wer_warn')} FAIL>{t.get('wer_reject')}")
    else:
        print(f"계층3 ASR  미실행 — {s.get('reason', '사유 불명')}")
    for s in rep["skipped"]:
        print(f"  SKIP  {s}")
    for g in rep["globalReasons"]:
        print(f"  {g}")
    # FAIL 을 먼저 찍는다. WARN 이 수십 개일 때 발행을 막는 한 건이 아래로 밀리면
    # 사람이 못 본다.
    for r in sorted(rep["items"], key=lambda x: VERDICTS.index(x["verdict"]), reverse=True):
        if r["verdict"] == "PASS":
            continue
        print(f"  {r['verdict']:<4} {r['id']:<18} {r['path']}")
        for why in r["reasons"]:
            print(f"        {why}")
    if rep["indexUpdated"]:
        print("사이드카 인덱스를 갱신했다 (.audio-index.json)")
        if rep.get("indexSkippedItems"):
            print(f"  기준 미기록 {len(rep['indexSkippedItems'])}개 (FAIL) — "
                  f"고칠 때까지 매 실행 다시 잡힌다: "
                  + ", ".join(rep["indexSkippedItems"][:8]))


def selftest() -> int:
    """의존성 없이 도는 순수 로직 확인."""
    fails = 0

    def check(ok, label):
        nonlocal fails
        fails += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")

    print("verify_audio self-test")
    check(worse("PASS", "WARN") == "WARN", "worse(PASS,WARN)=WARN")
    check(worse("FAIL", "WARN") == "FAIL", "worse(FAIL,WARN)=FAIL")
    check(worse("PASS", "PASS") == "PASS", "worse(PASS,PASS)=PASS")
    man = {"voice": "v", "voices": {}, "model": "m", "output": "o"}
    a = {"id": "x", "text": "Hello world.", "gap_ms": 400,
         "segments": [{"speaker": "W", "say_voice": "Samantha", "text": "Hello world."}]}
    b = json.loads(json.dumps(a)); b["segments"][0]["text"] = "hello   WORLD!!"
    c = json.loads(json.dumps(a)); c["segments"][0]["say_voice"] = "Alex"
    d = json.loads(json.dumps(a)); d["segments"][0]["text"] = "Hello there."
    if stt_loopback is None:
        print("  SKIP  해시 검사 — stt_loopback 부재")
    else:
        check(script_signature(a, man) == script_signature(b, man),
              "구두점·대소문자만 다르면 같은 해시(정규화 재사용)")
        check(script_signature(a, man) != script_signature(c, man),
              "화자 목소리를 바꾸면 해시가 달라진다")
        check(script_signature(a, man) != script_signature(d, man),
              "본문을 바꾸면 해시가 달라진다")
        # 같은 항목을 두 매니페스트가 선언할 때 머리말 차이로 해시가 갈리면, 두 도구가
        # 같은 사이드카를 번갈아 덮어쓰며 서로를 STALE 로 몬다(실제로 그랬다).
        man2 = {"voice": "", "voices": {}, "model": "", "output": ""}
        check(script_signature(a, man) == script_signature(a, man2),
              "say_voice 가 있으면 매니페스트 머리말이 달라도 같은 해시")
        bare = {"id": "y", "text": "Hello world.", "gap_ms": 400,
                "segments": [{"speaker": "W", "text": "Hello world."}]}
        check(script_signature(bare, man) != script_signature(bare, man2),
              "say_voice 가 없으면 머리말의 음성정책이 해시에 든다")
    check(word_count(a) == 2, "word_count = 2")
    check(item_script(a) == "Hello world.", "item_script = 세그먼트 텍스트 이어붙임")

    # 계층3 배선 — 임계값이 저쪽 원본과 같은 값을 보는지, 백엔드가 있으면 실제로 도는지.
    if verify_stt is None:
        check(False, f"계층3 모듈 적재 ({_VERIFY_STT})")
    else:
        check(verify_stt.THRESHOLDS["wer_reject"] == stt_loopback.WER_REJECT
              if stt_loopback else True,
              "계층3 임계값이 stt_loopback 원본과 한 벌")
        b, tried = verify_stt.detect_backend()
        print(f"  {'PASS' if b else 'SKIP'}  계층3 백엔드 "
              f"{b.name if b else '없음 — 설치하면 켜진다'}")
        if not b:
            for t in tried:
                print(f"          no  {t['backend']:<16} {t['reason']}")
    print(f"\n{fails} failure(s)" if fails else "\nall checks passed")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest")
    ap.add_argument("--set")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--strict", action="store_true", help="WARN 도 non-zero 로 취급")
    ap.add_argument("--update-index", action="store_true",
                    help="신선도 사이드카 인덱스를 갱신(없으면 검사 전용)")
    ap.add_argument("--stamp-on-pass", action="store_true",
                    help="--update-index 와 함께: FAIL 이 하나라도 있으면 기준을 굳히지 않는다")
    ap.add_argument("--base", default=str(SG2), help="매니페스트 out 경로의 기준 폴더")
    ap.add_argument("--changed-only", action="store_true",
                    help="인덱스 기준과 바이트·대본이 다른 항목만 계층 0~3 검사 "
                         "(음원 교체 직후 게이트용)")
    ap.add_argument("--stt-scope", choices=("changed", "all", "none"), default="changed",
                    help="계층3 ASR 대조 범위. changed=신규·교체분만(기본), all=전부, none=끔")
    ap.add_argument("--stt-model", help="whisper 모델 크기 (기본 verify_audio_stt.DEFAULT_MODEL)")
    ap.add_argument("--stt-model-file", help="whisper-cpp 용 ggml-*.bin 경로")
    ap.add_argument("--stt-backend", help="특정 STT 백엔드 강제 "
                                          "(faster_whisper|whisper|whisper-cli|macos-speech)")
    ap.add_argument("--require-stt", action="store_true",
                    help="계층3 이 안 돌면(백엔드 없음) 통과시키지 않고 에러 종료")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.manifest:
        ap.print_help()
        return 2
    if args.stt_scope != "none":
        reexec_under_venv(Path(__file__).resolve())

    rep = verify(Path(args.manifest).resolve(), args.set, args.update_index, Path(args.base),
                 stt_scope=args.stt_scope, stt_model=args.stt_model,
                 stt_model_file=args.stt_model_file, stt_backend=args.stt_backend,
                 changed_only=args.changed_only, stamp_on_pass=args.stamp_on_pass)
    print_report(rep)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n",
                                       encoding="utf-8")

    has_fail = rep["counts"]["FAIL"] > 0 or any(g.startswith("[FAIL]") for g in rep["globalReasons"])
    has_warn = rep["counts"]["WARN"] > 0 or any(g.startswith("[WARN]") for g in rep["globalReasons"])
    if has_fail:
        return 1
    # 계층3 이 안 돌았는데 통과로 보고하면, 잡으라고 만든 사고(딴 지문이 붙은 파일)를
    # 통과시키는 것과 같다. --require-stt 는 그 침묵을 실패로 바꾼다.
    if args.require_stt and args.stt_scope != "none" and not (rep.get("stt") or {}).get("backend"):
        if (rep.get("stt") or {}).get("queued"):
            print("\n--require-stt: STT 백엔드가 없어 계층3 을 강제할 수 없다. 발행 차단.",
                  file=sys.stderr)
            return 3
    if args.strict and has_warn:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
