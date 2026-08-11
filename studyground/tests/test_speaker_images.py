"""리스닝 화자 삽화 ↔ 오디오 음성 정합 검증.

실행:  python3 studyground/tests/test_speaker_images.py

set1.js·set9.js 는 문항마다 화자 삽화(image)를 손으로 지정한다
(set1: SPEAKER_BY_ITEM 및 블록별 image · set9: tools/build_set9.py 의 L1_Q1_12_IMAGES 표).
mp3 를 교체하면 경로는 그대로라 아무 오류 없이 로드되고 사진만 조용히 틀려지므로,
여기서 오디오를 직접 측정해 삽화의 성별과 대조한다.

측정 방법
  ffmpeg 로 16kHz 모노 디코딩 → 40ms 창 자기상관으로 프레임별 기본주파수(F0) 추정
  → 유성음 프레임 F0 의 20 백분위로 성별 판정.
  실측(2026-08-07, 오디오 19개 전수): 남성 p20 = 105~125Hz, 여성 p20 = 158~226Hz.
  경계에 여유를 두고 <140 남성 / >150 여성, 그 사이는 "판정 불가"로 실패시켜 사람이 보게 한다.

전제
  numpy 와 ffmpeg 가 필요하다. 없으면 SKIP 하고 종료코드 0 (검증을 못 했다고 크게 출력).
  SET 1 은 삽화 파일명이 판정 기준이다 — 'Single male*' / 'Single female*' / 'Academic, Single female'.
  SET 9 는 파일명이 speaker-a..f 라 이름만으로는 알 수 없어 아래 SET9_FACE_GENDER 표로 판정한다.
  2인 삽화('2 People' / '2 Persons')와 SET 9 의 장면 삽화(대화·강의)는 성별 단정이
  무의미해 건너뛴다.
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
window[process.argv[2]].sections.find(function (s) { return s.id === 'listening'; })
  .modules.forEach(function (m) {
    m.blocks.forEach(function (b) {
      if (b.audio) out.push({ id: b.heading || m.id, audio: b.audio, image: b.image || '', level: 'block' });
      (b.questions || []).forEach(function (q) {
        if (q.audio) out.push({ id: q.id, audio: q.audio, image: q.image || '', level: 'question' });
      });
    });
  });
process.stdout.write(JSON.stringify(out));
"""


def listening_pairs(asset: str, global_name: str):
    proc = subprocess.run(
        ["node", "-e", DUMP_JS, str(SG2 / "assets" / asset), global_name],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)


# SET 9 는 삽화 파일명(speaker-a..f)이 성별을 말해 주지 않는다. 사진 실물을 보고 적은 표이며,
# tools/build_set9.py 의 배정 주석과 짝을 이룬다. 사진을 갈아 끼우면 여기도 고칠 것.
SET9_FACE_GENDER = {
    "l1-q1-12-speaker-a.webp": "male",     # 20대 아시아계
    "l1-q1-12-speaker-b.webp": "female",   # 20대 아시아계
    "l1-q1-12-speaker-c.webp": "male",     # 30~40대 백인(민머리)
    "l1-q1-12-speaker-d.webp": "female",   # 40대 백인
    "l1-q1-12-speaker-e.webp": "male",     # 30대 흑인(안경)
    "l1-q1-12-speaker-f.webp": "female",   # 40대 흑인
}


def local_path(asset: str) -> Path:
    """set1.js 의 원본 폴더 경로를 sg2 에 번들된 경로로. exam.html 의 규칙과 같다."""
    return SG2 / (asset
                  .replace("TOEFL MOCK TEST  SET 1/SET 1 AUDIO/", "media/audio/")
                  .replace("TOEFL LISTENING & WRITING PICTURES/", "media/pictures/")
                  .replace("app/assets/speaking/", "media/speaking/"))


def image_gender(image: str):
    name = Path(image).name.lower()
    if name in SET9_FACE_GENDER:
        return SET9_FACE_GENDER[name]
    if "/set9/" in image.replace("\\", "/"):
        return "duo"      # 대화·강의 장면 삽화 — 인물이 여럿이라 판정 대상이 아니다
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
def check_set(set_name: str, asset: str, global_name: str):
    """한 세트를 검증하고 (대상 수, 실패 id 들, 건너뛴 수) 를 돌려준다."""
    pairs = listening_pairs(asset, global_name)
    print("\n[%s 화자 삽화 ↔ 오디오 음성] 대상 %d개" % (set_name, len(pairs)))

    fails, skipped = [], 0
    for pair in pairs:
        audio, image = local_path(pair["audio"]), local_path(pair["image"])
        label = "%-14s %s" % (pair["id"], Path(pair["audio"]).name)

        if not audio.exists():
            print("  FAIL " + label + " — 오디오 파일 없음: " + str(audio))
            fails.append(pair["id"])
            continue
        if not pair["image"]:
            # 문항 단위 오디오는 사진 한 장이 곧 화자다 — 빠지면 화면이 비므로 실패로 본다.
            # 블록(대화·공지·강의)은 원본 문항지에 삽화가 없는 자리가 있어 건너뛴다.
            if pair.get("level") == "block":
                print("  skip " + label + " — 삽화 없는 블록(원본에 삽화 없음)")
                skipped += 1
                continue
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
            print("  skip " + label + " — 여러 인물이 나오는 장면 삽화")
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
            print("  FAIL " + label + " — " + detail + " → 음성=" + got +
                  " · 삽화를 바꾸거나 배정표(set1: SPEAKER_BY_ITEM · set9: build_set9.py 의 "
                  "L1_Q1_12_IMAGES/L2_Q1_3_IMAGES)를 갱신할 것")
            fails.append(pair["id"])
        else:
            print("  ok   " + label + " — " + detail)

    print("  → %d 통과 · %d 건너뜀 · %d 실패" % (len(pairs) - len(fails) - skipped, skipped, len(fails)))
    return len(pairs), fails, skipped


def main() -> int:
    if shutil.which("ffmpeg") is None:
        print("SKIP: ffmpeg 이 없어 화자 정합을 검증하지 못했습니다 (brew install ffmpeg).")
        return 0
    try:
        import numpy  # noqa: F401
    except ImportError:
        print("SKIP: numpy 가 없어 화자 정합을 검증하지 못했습니다 (pip install numpy).")
        return 0

    total, all_fails, total_skipped = 0, [], 0
    for set_name, asset, global_name in (("SET 1", "set1.js", "SMEAG_SET1"),
                                         ("SET 9", "set9.js", "SMEAG_SET9")):
        n, fails, skipped = check_set(set_name, asset, global_name)
        total += n
        all_fails += ["%s %s" % (set_name, f) for f in fails]
        total_skipped += skipped

    print("\n합계 %d 통과 · %d 건너뜀 · %d 실패"
          % (total - len(all_fails) - total_skipped, total_skipped, len(all_fails)))
    if all_fails:
        print("불일치: " + ", ".join(all_fails))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
