"""리스닝 화자 삽화 ↔ 오디오 음성 정합 검증.

실행:  python3 studyground/tests/test_speaker_images.py

set1.js 는 문항마다 화자 삽화(image)를 손으로 지정한다(SPEAKER_BY_ITEM 및 블록별 image).
mp3 를 교체하면 경로는 그대로라 아무 오류 없이 로드되고 사진만 조용히 틀려지므로,
여기서 오디오를 직접 측정해 삽화의 성별과 대조한다.

측정 방법
  ffmpeg 로 16kHz 모노 디코딩 → 40ms 창 자기상관으로 프레임별 기본주파수(F0) 추정
  → 유성음 프레임 F0 의 20 백분위로 성별 판정.
  실측(2026-08-07, 오디오 19개 전수): 남성 p20 = 105~125Hz, 여성 p20 = 158~226Hz.
  경계에 여유를 두고 <140 남성 / >150 여성, 그 사이는 "판정 불가"로 실패시켜 사람이 보게 한다.

전제
  numpy 와 ffmpeg 가 필요하다. 없으면 SKIP 하고 종료코드 0 (검증을 못 했다고 크게 출력).
  삽화 파일명이 판정 기준이다 — 'Single male*' / 'Single female*' / 'Academic, Single female'.
  2인 삽화('2 People' / '2 Persons')는 대화문이라 성별 단정이 무의미해 건너뛴다.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

SG2 = Path(__file__).resolve().parents[1] / "sg2"

SAMPLE_RATE = 16000
WIN = int(0.040 * SAMPLE_RATE)      # 40ms — 최저 70Hz 도 두 주기 이상 들어간다
HOP = int(0.010 * SAMPLE_RATE)
F0_MIN, F0_MAX = 70, 350
RMS_GATE = 0.02                     # 무음·숨소리 제거
NSDF_GATE = 0.35                    # 자기상관 정점이 이만큼은 살아 있어야 유성음
MALE_MAX_P20 = 140.0
FEMALE_MIN_P20 = 150.0
ANALYZE_SEC = 30                    # 긴 지문은 앞 30초면 화자 판정에 충분하다


# ── set1.js 에서 (오디오, 삽화) 쌍 뽑기 ────────────────────────────────────────
# 정규식으로 JS 를 긁지 않고 실제 데이터 파일을 node 로 실행해 얻는다. 데이터 구조가
# 바뀌어도 런타임이 보는 것과 같은 값을 본다.
DUMP_JS = r"""
global.window = global;
require(process.argv[1]);
var out = [];
window.SMEAG_SET1.sections.find(function (s) { return s.id === 'listening'; })
  .modules.forEach(function (m) {
    m.blocks.forEach(function (b) {
      if (b.audio) out.push({ id: b.heading || m.id, audio: b.audio, image: b.image || '' });
      (b.questions || []).forEach(function (q) {
        if (q.audio) out.push({ id: q.id, audio: q.audio, image: q.image || '' });
      });
    });
  });
process.stdout.write(JSON.stringify(out));
"""


def listening_pairs():
    proc = subprocess.run(
        ["node", "-e", DUMP_JS, str(SG2 / "assets" / "set1.js")],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


def local_path(asset: str) -> Path:
    """set1.js 의 원본 폴더 경로를 sg2 에 번들된 경로로. exam.html 의 규칙과 같다."""
    return SG2 / (asset
                  .replace("TOEFL MOCK TEST  SET 1/SET 1 AUDIO/", "media/audio/")
                  .replace("TOEFL LISTENING & WRITING PICTURES/", "media/pictures/")
                  .replace("app/assets/speaking/", "media/speaking/"))


def image_gender(image: str):
    name = Path(image).name.lower()
    if "2 people" in name or "2 persons" in name:
        return "duo"
    if "female" in name:
        return "female"
    if "male" in name:
        return "male"
    return None


# ── 오디오 측정 ────────────────────────────────────────────────────────────────
def decode(path: Path):
    import numpy as np
    proc = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-t", str(ANALYZE_SEC), "-i", str(path),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)


def f0_p20(path: Path):
    """유성음 프레임 F0 의 20 백분위. 유성음이 없으면 None."""
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
    return float(np.percentile(picks, 20))


def audio_gender(p20: float):
    if p20 < MALE_MAX_P20:
        return "male"
    if p20 > FEMALE_MIN_P20:
        return "female"
    return None  # 경계 구간 — 자동 판정하지 않는다


# ── 검증 ──────────────────────────────────────────────────────────────────────
def main() -> int:
    if shutil.which("ffmpeg") is None:
        print("SKIP: ffmpeg 이 없어 화자 정합을 검증하지 못했습니다 (brew install ffmpeg).")
        return 0
    try:
        import numpy  # noqa: F401
    except ImportError:
        print("SKIP: numpy 가 없어 화자 정합을 검증하지 못했습니다 (pip install numpy).")
        return 0

    pairs = listening_pairs()
    print("\n[화자 삽화 ↔ 오디오 음성] 대상 %d개" % len(pairs))

    fails, skipped = [], 0
    for pair in pairs:
        audio, image = local_path(pair["audio"]), local_path(pair["image"])
        label = "%-14s %s" % (pair["id"], Path(pair["audio"]).name)

        if not audio.exists():
            print("  FAIL " + label + " — 오디오 파일 없음: " + str(audio))
            fails.append(pair["id"])
            continue
        if not pair["image"]:
            print("  FAIL " + label + " — 삽화 미지정")
            fails.append(pair["id"])
            continue
        if not image.exists():
            print("  FAIL " + label + " — 삽화 파일 없음: " + str(image))
            fails.append(pair["id"])
            continue

        want = image_gender(pair["image"])
        if want is None:
            print("  FAIL " + label + " — 성별을 알 수 없는 삽화명: " + Path(pair["image"]).name)
            fails.append(pair["id"])
            continue
        if want == "duo":
            print("  skip " + label + " — 2인 대화 삽화")
            skipped += 1
            continue

        p20 = f0_p20(audio)
        if p20 is None:
            print("  FAIL " + label + " — 유성음을 찾지 못함 (무음/손상 파일?)")
            fails.append(pair["id"])
            continue

        got = audio_gender(p20)
        detail = "p20=%5.1fHz 삽화=%s" % (p20, want)
        if got is None:
            print("  FAIL " + label + " — " + detail + " · 음높이가 경계(%g~%gHz)라 자동 판정 불가, 직접 들어볼 것"
                  % (MALE_MAX_P20, FEMALE_MIN_P20))
            fails.append(pair["id"])
        elif got != want:
            print("  FAIL " + label + " — " + detail + " → 음성=" + got + " · 삽화를 바꾸거나 SPEAKER_BY_ITEM 을 갱신할 것")
            fails.append(pair["id"])
        else:
            print("  ok   " + label + " — " + detail)

    print("\n%d 통과 · %d 건너뜀 · %d 실패" % (len(pairs) - len(fails) - skipped, skipped, len(fails)))
    if fails:
        print("불일치: " + ", ".join(fails))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
