#!/usr/bin/env python3
"""TTS 음원 발행 게이트 — 매니페스트 대비 mp3 를 계층 검증한다.

왜 있는가. 이 프로젝트에서 실제로 난 사고 셋을 기계가 잡게 하려고 만들었다.
  1) 지문을 고쳤는데 mp3 를 같은 경로에 덮어쓰지 않아(혹은 아예 재생성하지 않아)
     옛 음원이 계속 나갔다  → 계층 0 의 신선도(stale) 해시가 잡는다.
  2) 문항은 있는데 음원이 없어 무음 시험이 나갈 뻔했다 → 계층 0 의 매핑 검사.
  3) 지문 대신 문항 질문문이 녹음됐다 → 텍스트 대조는 STT 가 필요하므로 여기서는
     잡지 못한다. 그 계층은 SKIP 으로 명시 보고하고, smeag-local-ai/qa/stt_loopback.py
     가 담당한다(로컬 STT 미설치라 현재 환경에서는 돌릴 수 없다).

계층
  0  매핑·신선도   외부 도구 불필요. 가장 값싸고 가장 중요하다.
  1  파일 무결성   ffprobe
  2  신호 분석     ffmpeg (silencedetect / volumedetect)
  3  텍스트 대조   STT 필요 — 이 도구는 항상 SKIP 으로 보고만 한다.

없는 계층은 조용히 통과시키지 않고 SKIP 사유와 함께 보고한다.

    .venv/bin/python tools/verify_audio.py --manifest sg2/tts-manifest.set9.json
    .venv/bin/python tools/verify_audio.py --manifest ... --json /tmp/r.json --update-index
    .venv/bin/python tools/verify_audio.py --selftest
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

# ── 경로 ─────────────────────────────────────────────────────────────────────
TOOLS = Path(__file__).resolve().parent
STUDYGROUND = TOOLS.parent
SG2 = STUDYGROUND / "sg2"
REPO = STUDYGROUND.parent
_AUDIO_PROBE = SG2 / "tools" / "audio_probe.py"
_STT_LOOPBACK = REPO / "smeag-local-ai" / "qa" / "stt_loopback.py"


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


def worse(a: str, b: str) -> str:
    return a if VERDICTS.index(a) >= VERDICTS.index(b) else b


# ── 텍스트 정규화 / 신선도 해시 ───────────────────────────────────────────────
_FALLBACK_PUNCT = re.compile(r"[^\w\s']", re.UNICODE)


def normalise_words(text: str):
    """stt_loopback.normalise() 재사용. 모듈이 없으면 None (계층 0 신선도는 SKIP)."""
    if stt_loopback is None:
        return None
    return stt_loopback.normalise(text)


def script_signature(item: dict, manifest: dict) -> str | None:
    """정규화 스크립트 + 음성정책의 sha256.

    음성정책(voices/model/output/gap_ms/say_voice)까지 넣는 이유: 텍스트가 그대로여도
    화자를 바꿨으면 그 mp3 는 낡은 것이다. 텍스트만 해시하면 그 사고를 놓친다.
    """
    words = normalise_words(item.get("text") or "")
    if words is None:
        return None
    payload = {
        "text": " ".join(words),
        "segments": [
            {
                "speaker": s.get("speaker", ""),
                "say_voice": s.get("say_voice", ""),
                "text": " ".join(normalise_words(s.get("text") or "")),
            }
            for s in item.get("segments") or []
        ],
        "gap_ms": item.get("gap_ms", 0),
        "voice": manifest.get("voice", ""),
        "voices": manifest.get("voices", {}),
        "model": manifest.get("model", ""),
        "output": manifest.get("output", ""),
    }
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
def index_path(out_dir: Path) -> Path:
    return out_dir / ".audio-index.json"


def load_index(out_dir: Path) -> dict:
    p = index_path(out_dir)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("items", {})
    except Exception:
        return {}


def verify(manifest_path: Path, set_id: str | None = None,
           update_index: bool = False, base: Path = SG2) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = manifest.get("items") or []
    wpm, wpm_src = generator_wpm()

    skips: list[str] = []
    if stt_loopback is None:
        skips.append(f"layer0.freshness — stt_loopback.normalise 를 못 읽음 ({_STT_LOOPBACK})")
    if audio_probe is None:
        skips.append(f"layer1 — audio_probe.probe 를 못 읽음 ({_AUDIO_PROBE})")
    # 계층 3 은 이 환경에 로컬 STT 가 없어 언제나 SKIP. 조용히 통과시키지 않는다.
    skips.append("layer3.transcript — 로컬 STT 미설치(whisper/faster-whisper 없음). "
                 "음원이 '지문 대신 문항 질문문'인 경우는 이 도구가 잡지 못한다. "
                 "smeag-local-ai/qa/stt_loopback.py 로 별도 게이트 필요.")

    out_dirs = sorted({(base / it["out"]).parent for it in items if it.get("out")})
    indexes = {d: load_index(d) for d in out_dirs}
    new_index: dict[Path, dict] = {d: {} for d in out_dirs}

    manifest_mtime = manifest_path.stat().st_mtime
    results = []

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
        elif prev.get("scriptHash") != sig:
            l0["freshness"] = "STALE"
            l0["previousHash"] = prev.get("scriptHash")
            note("FAIL", "스크립트/음성정책이 바뀌었는데 음원이 재생성되지 않았다 "
                         f"(index {str(prev.get('scriptHash'))[:12]} != now {sig[:12]}) — "
                         "재생성 후 다시 검사하라")
        else:
            l0["freshness"] = "FRESH"

        mp3_mtime = path.stat().st_mtime
        l0["mp3Mtime"] = round(mp3_mtime, 1)
        if mp3_mtime + 1 < manifest_mtime and l0.get("freshness") == "FRESH":
            # 해시는 같은데 매니페스트가 더 최근 — 음성정책 밖의 변경일 수 있다.
            note("WARN", f"mp3 가 매니페스트보다 오래됐다 "
                         f"({round(manifest_mtime - mp3_mtime)}초 차) — 해시는 동일")
        l0["status"] = "OK"
        r["layers"]["layer0_mapping"] = l0

        # ── 계층 1 ──────────────────────────────────────────────────────────
        if audio_probe is None:
            r["layers"]["layer1_integrity"] = {"status": "SKIP", "reason": "audio_probe 부재"}
            spec = {}
        else:
            spec = audio_probe.probe(path)
            l1 = dict(spec)
            if not spec:
                l1["status"] = "FAIL"
                note("FAIL", "ffprobe 가 디코드하지 못했다 — 손상된 파일")
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
                new_index[d][r["id"]] = {"scriptHash": sig, "bytes": spec.get("bytes", 0),
                                         "durationSec": duration}
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
        r["layers"]["layer3_transcript"] = {
            "status": "SKIP",
            "reason": "로컬 STT 미설치 — 대본 대조 미수행",
        }

        if sig:
            new_index[d][r["id"]] = {"scriptHash": sig, "bytes": spec.get("bytes", 0),
                                     "durationSec": duration}
        results.append(r)

    # ── 계층 0 전역: 고아 파일 / 콘텐츠 팩 교차 확인 ─────────────────────────
    declared = {(base / it["out"]).resolve() for it in items if it.get("out")}
    orphans = []
    for d in out_dirs:
        for f in sorted(d.glob("*.mp3")):
            if f.resolve() not in declared:
                orphans.append(str(f.relative_to(base)))

    declared_rel = {it["out"] for it in items if it.get("out")}
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
                               for it in items if it.get("out"))
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
        "counts": counts,
        "skipped": skips,
        "orphanFiles": orphans,
        "packCrossCheck": pack_report,
        "globalReasons": global_reasons,
        "items": results,
        "indexUpdated": bool(update_index),
    }

    if update_index:
        for d, entries in new_index.items():
            if not entries:
                continue
            index_path(d).write_text(json.dumps(
                {"note": "verify_audio.py 신선도 기준. 스크립트/음성정책 해시.",
                 "items": entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return report


# ── 출력 ─────────────────────────────────────────────────────────────────────
def print_report(rep: dict) -> None:
    c = rep["counts"]
    total = sum(c.values())
    print(f"manifest {rep['manifest']}")
    print(f"set {rep['set']}   items {total}   "
          f"PASS {c['PASS']}   WARN {c['WARN']}   FAIL {c['FAIL']}")
    print(f"길이 모델 {rep['wpm']}wpm (출처 {rep['wpmSource']})")
    for s in rep["skipped"]:
        print(f"  SKIP  {s}")
    for g in rep["globalReasons"]:
        print(f"  {g}")
    for r in rep["items"]:
        if r["verdict"] == "PASS":
            continue
        print(f"  {r['verdict']:<4} {r['id']:<18} {r['path']}")
        for why in r["reasons"]:
            print(f"        {why}")
    if rep["indexUpdated"]:
        print("사이드카 인덱스를 갱신했다 (.audio-index.json)")


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
    check(word_count(a) == 2, "word_count = 2")
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
    ap.add_argument("--base", default=str(SG2), help="매니페스트 out 경로의 기준 폴더")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.manifest:
        ap.print_help()
        return 2

    rep = verify(Path(args.manifest).resolve(), args.set, args.update_index, Path(args.base))
    print_report(rep)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n",
                                       encoding="utf-8")

    has_fail = rep["counts"]["FAIL"] > 0 or any(g.startswith("[FAIL]") for g in rep["globalReasons"])
    has_warn = rep["counts"]["WARN"] > 0 or any(g.startswith("[WARN]") for g in rep["globalReasons"])
    if has_fail:
        return 1
    if args.strict and has_warn:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
