#!/usr/bin/env python3
"""SMEAG · StudyGround — /en/test-nt/{section} 라우트 페이지 생성기.

관찰된 원본 URL
    https://www.studyground.ai/en/test-nt/reading?testId=T-016&sessionId=...&mode=full&section=reading
을 정적 사이트에서 그대로 재현하기 위해, exam-runtime.html 의 셸 마크업을 단일 원본으로 삼아
en/test-nt/{reading,listening,writing,speaking}/index.html 을 찍어낸다.

각 페이지가 원본과 다른 점은 세 줄뿐이다:
  1) <base href="../../../">  — 3단계 깊이에서도 assets/·config/·media/ 가 그대로 풀린다.
  2) <title>                  — 섹션 이름이 들어간다.
  3) window.SG_ROUTE          — 이 페이지가 대표하는 섹션·루트 경로. assets/exam-shell.js 가 읽는다.

셸을 고칠 때는 exam-runtime.html 만 고치고 이 스크립트를 다시 돌리면 된다.

    python3 tools/build_routes.py        # sg2/ 에서 실행
"""

import io
import os
import re
import sys

SECTIONS = ['reading', 'listening', 'writing', 'speaking']
ROUTE_DIR = os.path.join('en', 'test-nt')
SOURCE = 'exam-runtime.html'

BASE_TAG = '<base href="../../../">'

BANNER = """<!--
  GENERATED FILE — 직접 고치지 마세요.
  원본: exam-runtime.html · 생성: tools/build_routes.py
  라우트: /en/test-nt/{section}?testId=..&sessionId=..&mode=full|section&section=..
-->"""


def build(section: str, source: str) -> str:
    out = source

    # 1) <base> — 상대 URL 이 sg2 루트 기준으로 풀리도록 head 최상단(스타일시트보다 위)에 넣는다.
    out = out.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + BASE_TAG,
        1,
    )

    # 2) 문서 제목 — 원본 탭 제목과 같은 결로.
    out = re.sub(
        r'<title>.*?</title>',
        '<title>%s · NT Mock Test · SMEAG StudyGround</title>' % section.capitalize(),
        out,
        count=1,
        flags=re.S,
    )

    # 3) 라우트 계약 — exam-shell.js 보다 먼저 실행되어야 한다.
    #    path 는 하드코딩하지 않는다: 이 페이지의 경로에서 마지막 구간(=섹션)을 떼어 쓰므로
    #    사이트를 하위 경로에 배포해도 주소 갱신이 어긋나지 않는다.
    route = (
        '<script>\n'
        'window.SG_ROUTE = {\n'
        "  section: '%s',\n"
        "  base: '../../../',\n"
        "  path: location.pathname.replace(/\\/+$/, '').replace(/[^\\/]*$/, '')\n"
        '};\n'
        '</script>\n'
        '<script src="assets/exam-shell.js"></script>'
    ) % section
    out = out.replace('<script src="assets/exam-shell.js"></script>', route, 1)

    # 4) 생성물 표시.
    out = out.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + BANNER, 1)
    return out


def main() -> int:
    if not os.path.exists(SOURCE):
        sys.stderr.write('run me from sg2/ — %s not found\n' % SOURCE)
        return 1

    source = io.open(SOURCE, encoding='utf-8').read()
    if 'assets/exam-shell.js' not in source:
        sys.stderr.write('%s no longer loads assets/exam-shell.js — generator is stale\n' % SOURCE)
        return 1

    for section in SECTIONS:
        d = os.path.join(ROUTE_DIR, section)
        if not os.path.isdir(d):
            os.makedirs(d)
        path = os.path.join(d, 'index.html')
        io.open(path, 'w', encoding='utf-8').write(build(section, source))
        print('wrote %s' % path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
