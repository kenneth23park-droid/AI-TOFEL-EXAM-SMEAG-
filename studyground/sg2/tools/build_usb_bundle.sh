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

# 이 번들이 몇 판인지 새겨 넣는다. 이것이 없으면 받은 사본은 자기가 낡은 줄을 영영
# 모른다 — v25 번들이 v45 라이브와 함께 굴러다닌 것이 그래서였다.
#
# 도장은 작업 트리가 아니라 zip 안의 그 한 칸에만 찍는다. 트리에 찍었다가 되돌리는
# 방법도 되지만, 그 짧은 사이에 누가 커밋하면 bundle 도장이 웹으로 나가고, 그러면
# 웹 방문자 전원에게 "새 버전이 있습니다"가 뜬다. 다른 사람이 같은 저장소에서
# 동시에 일하는 것을 전제로 두는 편이 안전하다.
STAMP=$(mktemp -d)
mkdir -p "$STAMP/$(basename "$SG2")"
python3 "$SG2/tools/build_version.py" --channel bundle --site "$STAMP/$(basename "$SG2")"
# -u 가 아니라 그냥 넣는다 — -u 는 파일이 더 새로울 때만 갈아 끼우고, 같은 초 안에
# 만들어진 파일은 "할 일 없음"으로 지나간다(그러면 web 도장이 그대로 남는다).
( cd "$STAMP" && zip -q "$OUT" "$(basename "$SG2")/assets/build-version.js" )
rm -rf "$STAMP"

SIZE=$(du -h "$OUT" | cut -f1)
echo "✓ $OUT  ($SIZE)"
echo "  대상 PC: 압축 해제 후 start-mac.command 또는 start-windows.bat 더블클릭"
