#!/bin/sh
# git 훅 설치 — 한 번만 돌리면 된다.
#
#   sh studyground/tools/hooks/install.sh
#
# .git/hooks 는 저장소에 커밋되지 않으므로 훅은 사람마다 따로 켜야 한다.
# 파일을 복사하지 않고 core.hooksPath 를 이 폴더로 돌린다 — 그래야 훅이 바뀌었을 때
# 다시 설치할 필요 없이 따라온다.
#
# 끄는 법:  git config --unset core.hooksPath

set -e
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

chmod +x studyground/tools/hooks/pre-commit
git config core.hooksPath studyground/tools/hooks

echo "설치했습니다 — core.hooksPath = $(git config core.hooksPath)"
echo ""
echo "이제 문항 팩·대본·검사기가 든 커밋에서 겹침 검사가 저절로 돌고,"
echo "갱신된 config/dup-report.* 가 그 커밋에 같이 담깁니다."
echo "겹침(high)이 있으면 커밋이 멈춥니다 — 급하면 git commit --no-verify."
