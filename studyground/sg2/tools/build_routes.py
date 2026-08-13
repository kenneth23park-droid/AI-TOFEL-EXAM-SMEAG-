#!/usr/bin/env python3
"""SMEAG · MockTest — 시험 셸 파생 페이지 생성기.

exam-runtime.html 의 셸 마크업을 단일 원본으로 삼아 두 종류를 찍어낸다.

1) /en/test-nt/{section} 라우트 — 관찰된 원본 URL
       https://www.studyground.ai/en/test-nt/reading?testId=T-016&sessionId=...&mode=full&section=reading
   을 정적 사이트에서 그대로 재현한다. 원본과 다른 점은 세 줄뿐이다:
     1) <base href="../../../">  — 3단계 깊이에서도 assets/·config/·media/ 가 그대로 풀린다.
     2) <title>                  — 섹션 이름이 들어간다.
     3) window.SG_ROUTE          — 이 페이지가 대표하는 섹션·루트 경로. assets/exam-shell.js 가 읽는다.

2) 세트 전용 진입 페이지 — set9.html 처럼 "특정 세트의 특정 섹션"으로 바로 들어가는 주소.
   쿼리스트링 없이 열어도 제 콘텐츠 팩이 실리도록 SG_ROUTE.set 을 박아 둔다
   (exam-shell.js currentSetId 가 `?set=` 다음 순위로 읽는다).

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

# 세트 전용 진입 페이지: 출력파일 → (세트, 섹션, 탭 제목)
SET_PAGES = {
    'set9.html': ('set9', 'listening', 'SET 9 Listening · SMEAG MockTest'),
    'set9-reading.html': ('set9', 'reading', 'SET 9 Reading · SMEAG MockTest'),
}

BASE_TAG = '<base href="../../../">'

BANNER = """<!--
  GENERATED FILE — 직접 고치지 마세요.
  원본: exam-runtime.html · 생성: tools/build_routes.py
  라우트: /en/test-nt/{section}?testId=..&sessionId=..&mode=full|section&section=..
-->"""

SET_BANNER = """<!--
  GENERATED FILE — 직접 고치지 마세요.
  원본: exam-runtime.html · 생성: tools/build_routes.py
  %s 의 %s 섹션으로 바로 들어가는 진입 페이지. 쿼리스트링 없이 열어도 된다.
-->"""


AUTH_META = re.compile(
    r'\n<!-- 시험은 누가 쳤는지.*?-->\n<meta name="sg-auth" content="required">', re.S)


def soften_auth(out: str) -> str:
    """파생 페이지에서는 로그인 강제(<meta name="sg-auth" content="required">)를 뗀다.

    exam-runtime.html 은 관리자·재응시로 들어오는 문이라 로그인 없이는 열리지 않아도
    된다. 하지만 파생 페이지(set9-reading.html · /en/test-nt/*)는 학생이 처음 앉는
    자리이고, 오프라인 시험장(USB 사본·회선 없음)에서도 열려야 한다. 거기서 로그인을
    강제하면 네트워크가 없는 날 시험 자체가 시작되지 않는다 — 어떤 실패도 시험을
    멈추지 않는다는 계약(F12)에 어긋난다.

    대신 assets/sg-storage-guard.js 가 시작 전에 "로그인이 없으면 이 기기에만 남는다"를
    읽히고, 학생은 읽은 뒤 로그인하거나 그대로 시작한다. 막는 대신 알린다.
    """
    return AUTH_META.sub('', out, count=1)


def build(section: str, source: str) -> str:
    out = soften_auth(source)

    # 1) <base> — 상대 URL 이 sg2 루트 기준으로 풀리도록 head 최상단(스타일시트보다 위)에 넣는다.
    out = out.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + BASE_TAG,
        1,
    )

    # 2) 문서 제목 — 원본 탭 제목과 같은 결로.
    out = re.sub(
        r'<title>.*?</title>',
        '<title>%s · NT Mock Test · SMEAG MockTest</title>' % section.capitalize(),
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


def build_set_page(set_id: str, section: str, title: str, source: str) -> str:
    """세트 전용 진입 페이지. sg2 루트에 놓이므로 <base> 는 필요 없다."""
    out = soften_auth(source)

    out = re.sub(r'<title>.*?</title>', '<title>%s</title>' % title, out, count=1, flags=re.S)

    route = (
        '<script>\n'
        'window.SG_ROUTE = {\n'
        "  section: '%s',\n"
        "  set: '%s',\n"
        "  base: '',\n"
        # path 는 비운다 — 섹션이 바뀔 때 주소창을 갱신하는 기능(exam-shell.js 의
        # syncRoutePath)은 /en/test-nt/{section} 처럼 경로 마지막 구간이 섹션인
        # 라우트에만 뜻이 있다. 이 페이지는 파일 하나(set9-reading.html)라서 그 자리에
        # 섹션을 이어붙이면 'set9-reading.htmlreading' 같은 없는 주소가 만들어지고,
        # 학생이 새로고침하면 404 가 된다. 빈 값이면 syncRoutePath 가 그냥 물러난다.
        "  path: ''\n"
        '};\n'
        '</script>\n'
        '<script src="assets/exam-shell.js"></script>'
    ) % (section, set_id)
    out = out.replace('<script src="assets/exam-shell.js"></script>', route, 1)

    out = out.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + (SET_BANNER % (set_id.upper(), section)), 1)
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

    for path, (set_id, section, title) in sorted(SET_PAGES.items()):
        io.open(path, 'w', encoding='utf-8').write(build_set_page(set_id, section, title, source))
        print('wrote %s' % path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
