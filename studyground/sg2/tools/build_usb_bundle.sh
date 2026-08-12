#!/bin/bash
# USB 예비 번들 — 와이파이도 없고 사전 다운로드도 못 돌린 시험장을 위한 마지막 수단.
#
# 평소 경로는 자동 다운로드(assets/offline-prep.js)다. 학생이 학원에서 주소를 한 번
# 열어 두면 끝난다. 이 스크립트는 그것마저 못 한 날을 위해 sg2 를 통째로 담되,
# 실제로 필요 없는 생성 중간물은 걷어낸다 — media/ 는 145 MB 지만 참조되는 것은 25 MB 다.
#
#   bash sg2/tools/build_usb_bundle.sh
#   → studyground/dist/smeag-studyground-offline.zip
#
# 대상 PC 에서는 압축을 풀고 start-mac.command / start-windows.bat 을 더블클릭한다.
set -euo pipefail

SG2="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$(cd "$SG2/.." && pwd)/dist"
OUT="$DIST/smeag-studyground-offline.zip"

mkdir -p "$DIST"
rm -f "$OUT"

cd "$SG2/.."

# 목록을 먼저 최신으로 맞춘다 — 문항이 바뀐 채로 USB 를 구우면 무음이 된다.
python3 "$SG2/tools/build_offline_manifest.py"

# 이 번들이 몇 판인지 새겨 넣는다. 이것이 없으면 받은 사본은 자기가 낡은 줄을
# 영영 모른다 — v25 번들이 v45 라이브와 함께 굴러다닌 것이 그래서였다.
# 굽고 나면 web 채널로 되돌린다. 작업 트리에 bundle 도장이 남으면, 그 다음 배포에서
# 웹 방문자에게까지 "새 버전이 있습니다"가 뜬다.
restore_stamp() { python3 "$SG2/tools/build_version.py" --channel web >/dev/null; }
trap restore_stamp EXIT
python3 "$SG2/tools/build_version.py" --channel bundle

zip -r -q "$OUT" "$(basename "$SG2")" \
  -x '*/media/tts/_backup_*/*' \
  -x '*/media/tts/_segments*/*' \
  -x '*/media/audio/_set9_backup_say/*' \
  -x '*/_screens/*' \
  -x '*/_compare/*' \
  -x '*_t_*.html' \
  -x '*_mprobe.html' -x '*_mshots.html' -x '*_verify_render_all.html' \
  -x '*.DS_Store' \
  -x '*/__pycache__/*'

SIZE=$(du -h "$OUT" | cut -f1)
echo "✓ $OUT  ($SIZE)"
echo "  대상 PC: 압축 해제 후 start-mac.command 또는 start-windows.bat 더블클릭"
