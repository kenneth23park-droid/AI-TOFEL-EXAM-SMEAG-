#!/bin/bash
# 데스크톱 앱이 품고 다니는 사이트(desktop/site)를 지금 sg2 로 맞춘다.
#
# 왜 스크립트인가. desktop/site 는 손으로 복사한 사본이었고, 그래서 sw.js 가 v1 에
# 멈춰 있었다 — 라이브가 v45 일 때다. 앱을 받은 기기만 44 판 전의 화면을 보고 있었고,
# 손으로 하는 복사는 반드시 그렇게 된다.
#
#   bash sg2/tools/build_desktop_site.sh
#   → studyground/desktop/site 가 sg2 와 같아지고, desktop 판 도장이 찍힌다
#   → 그 다음  cd desktop && npm run dmg
set -euo pipefail

SG2="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$(cd "$SG2/.." && pwd)/desktop/site"

mkdir -p "$SITE"

# 지운 파일이 사본에 남지 않도록 --delete 로 맞춘다. 다만 .vercel/ 같은 배포 흔적과
# 생성 중간물은 앱에 들어갈 이유가 없다.
rsync -a --delete \
  --exclude '.vercel/' --exclude '.vercelignore' --exclude 'vercel.json' \
  --exclude '_screens/' --exclude '_compare/' --exclude '__pycache__/' \
  --exclude '.DS_Store' --exclude 'REPORT.md' \
  --exclude '_t_*.html' --exclude '_verify_*.html' --exclude '_mprobe.html' \
  --exclude '_mshots.html' --exclude 'media/tts/_backup_*/' \
  --exclude 'media/tts/_segments*/' --exclude 'media/audio/_set9_backup_say/' \
  "$SG2/" "$SITE/"

# 판 도장은 사본 쪽에만 desktop 으로 찍는다 — sg2 자신은 web 채널 그대로 둔다.
python3 "$SG2/tools/build_version.py" --channel desktop --site "$SITE"

# 판 번호는 const 줄에서만 읽는다 — 주석에 'sg-media-sg-v3' 같은 옛 이름이 섞여 있다.
echo "✓ desktop/site ← sg2  ($(sed -n "s/^const VERSION = '\(.*\)';/\1/p" "$SITE/sw.js"))"
echo "  다음: cd studyground/desktop && npm run dmg"
