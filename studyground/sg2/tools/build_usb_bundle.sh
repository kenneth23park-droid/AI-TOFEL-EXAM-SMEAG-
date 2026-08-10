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
