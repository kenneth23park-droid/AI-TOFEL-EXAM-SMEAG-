#!/usr/bin/env python3
"""오디오 실측 공용 모듈 — F0(음높이) 추정, 파일 제원, set1.js 의 (오디오·삽화) 매핑.

여기 한 곳만 두는 이유: tests/test_speaker_images.py 와 tools/audit_audio.py 가 같은
판정 기준을 써야 한다. 임계값이 두 벌로 갈리면 테스트는 통과하는데 어드민 화면은
불일치라고 말하는 상황이 생긴다.

필요 도구: ffmpeg/ffprobe, numpy, node.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

SAMPLE_RATE = 16000
WIN = int(0.040 * SAMPLE_RATE)      # 40ms — 최저 70Hz 도 두 주기 이상 들어간다
HOP = int(0.010 * SAMPLE_RATE)
F0_MIN, F0_MAX = 70, 350
RMS_GATE = 0.02                     # 무음·숨소리 제거
NSDF_GATE = 0.35                    # 자기상관 정점이 이만큼은 살아 있어야 유성음
ANALYZE_SEC = 30                    # 긴 지문은 앞 30초면 화자 판정에 충분하다

# 성별 판정선. 실측(2026-08-07, SET 1 리스닝 19개 전수) 남성 p20 = 105~125Hz,
# 여성 p20 = 158~226Hz. 경계 사이는 자동 판정하지 않고 사람에게 넘긴다.
MALE_MAX_P20 = 140.0
FEMALE_MIN_P20 = 150.0


# ── 파일 제원 ────────────────────────────────────────────────────────────────
def probe(path: Path) -> dict:
    """ffprobe 로 재생시간·비트레이트·샘플레이트·채널. 실패하면 빈 dict."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-of", "json",
         "-show_entries", "format=duration,bit_rate,size:stream=sample_rate,channels,codec_name",
         str(path)],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return {}
    data = json.loads(out.stdout or "{}")
    fmt = data.get("format", {})
    stream = (data.get("streams") or [{}])[0]
    return {
        "durationSec": round(float(fmt.get("duration", 0) or 0), 2),
        "bitrateKbps": round(int(fmt.get("bit_rate", 0) or 0) / 1000),
        "bytes": int(fmt.get("size", 0) or 0),
        "sampleRate": int(stream.get("sample_rate", 0) or 0),
        "channels": int(stream.get("channels", 0) or 0),
        "codec": stream.get("codec_name", ""),
    }


# ── 음높이 ───────────────────────────────────────────────────────────────────
def decode(path: Path):
    import numpy as np
    out = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-t", str(ANALYZE_SEC), "-i", str(path),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).astype(np.float64)


def f0_stats(path: Path):
    """유성음 프레임 F0 의 20/50/80 백분위. 유성음이 모자라면 None."""
    import numpy as np
    x = decode(path)
    lag_min, lag_max = SAMPLE_RATE // F0_MAX, SAMPLE_RATE // F0_MIN
    picks = []
    for i in range(0, len(x) - WIN, HOP):
        frame = x[i:i + WIN]
        if np.sqrt((frame ** 2).mean()) < RMS_GATE:
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, "full")[WIN - 1:]
        if corr[0] <= 0:
            continue
        lag = int(np.argmax(corr[lag_min:lag_max])) + lag_min
        if corr[lag] / corr[0] < NSDF_GATE:
            continue
        picks.append(SAMPLE_RATE / lag)
    if len(picks) < 10:
        return None
    return {
        "p20": round(float(np.percentile(picks, 20)), 1),
        "median": round(float(np.percentile(picks, 50)), 1),
        "p80": round(float(np.percentile(picks, 80)), 1),
        "voicedFrames": len(picks),
    }


def gender_from_p20(p20: float):
    """'male' / 'female' / None(경계라 자동 판정 보류)."""
    if p20 < MALE_MAX_P20:
        return "male"
    if p20 > FEMALE_MIN_P20:
        return "female"
    return None


# ── set1.js 매핑 ─────────────────────────────────────────────────────────────
# 정규식으로 JS 를 긁지 않고 실제 데이터 파일을 node 로 실행해 얻는다.
# 데이터 구조가 바뀌어도 런타임이 보는 것과 같은 값을 본다.
_DUMP_JS = r"""
global.window = global;
require(process.argv[1]);
var out = [];
window.SMEAG_SET1.sections.forEach(function (sec) {
  (sec.modules || []).forEach(function (m) {
    (m.blocks || []).forEach(function (b) {
      if (b.audio) out.push({ section: sec.id, module: m.id, id: b.heading || m.id,
                              audio: b.audio, image: b.image || '' });
      if (b.introAudio) out.push({ section: sec.id, module: m.id, id: (b.heading || m.id) + ' · intro',
                                   audio: b.introAudio, image: b.image || '' });
      (b.questions || []).forEach(function (q) {
        if (q.audio) out.push({ section: sec.id, module: m.id, id: q.id,
                                audio: q.audio, image: q.image || '' });
      });
    });
  });
});
process.stdout.write(JSON.stringify(out));
"""

_PREFIX_MAP = [                      # assets/exam-media.js 의 표와 같아야 한다
    ("TOEFL MOCK TEST  SET 1/SET 1 AUDIO/", "media/audio/"),
    ("TOEFL LISTENING & WRITING PICTURES/", "media/pictures/"),
    ("app/assets/speaking/", "media/speaking/"),
]


def media_pairs(sg2: Path, section: str | None = None) -> list[dict]:
    """set1.js 가 정의한 (오디오, 삽화) 쌍. section 을 주면 그 섹션만."""
    proc = subprocess.run(
        ["node", "-e", _DUMP_JS, str(sg2 / "assets" / "set1.js")],
        capture_output=True, text=True, check=True,
    )
    pairs = json.loads(proc.stdout)
    return [p for p in pairs if section is None or p["section"] == section]


def rel_path(asset: str) -> str:
    """set1.js 의 원본 폴더 경로 → sg2 기준 상대 경로."""
    for src, dst in _PREFIX_MAP:
        if asset.startswith(src):
            return dst + asset[len(src):]
    return asset


def local_path(sg2: Path, asset: str) -> Path:
    return sg2 / rel_path(asset)


def image_gender(image: str):
    """삽화 파일명에서 성별. 2인 대화 삽화는 'duo', 알 수 없으면 None."""
    name = Path(image).name.lower()
    if "2 people" in name or "2 persons" in name:
        return "duo"
    if "female" in name:
        return "female"
    if "male" in name:
        return "male"
    return None
