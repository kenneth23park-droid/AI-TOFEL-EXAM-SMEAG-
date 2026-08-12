#!/usr/bin/env python3
"""판 번호를 sw.js 한 곳에서 꺼내 두 자리에 새긴다.

왜 필요한가. 웹(sg2)은 서비스워커가 VERSION 을 올릴 때마다 셸 캐시를 버리고 새 판을
가져온다 — 학생은 아무것도 하지 않아도 최신을 본다. 그런데 USB 번들(dist/*.zip)과
데스크톱 앱(desktop/site)은 받은 그날의 사본에 갇힌다. 새 판이 나온 줄을 알 방법이
없어서, v25 번들을 쓰는 시험장은 v45 에서 고친 것들을 영영 못 본다.

그래서 두 파일을 만든다.

  version.json            서버가 "지금 라이브는 몇 판인가"를 답하는 쪽지.
                          배포 때마다 CI 가 다시 만든다(.github/workflows/deploy-sg2.yml).
                          손으로 갱신하는 파일이면 반드시 낡고, 낡은 쪽지는
                          "최신입니다"라고 거짓말을 한다.

  assets/build-version.js 사본이 자기 판 번호를 가지고 다니는 표. <script> 로 읽으므로
                          file:// (일렉트론)에서도 fetch 없이 읽힌다.
                          channel 이 web 이면 검사기는 아무 일도 하지 않는다 —
                          웹에서는 서비스워커가 이미 그 일을 한다.

쓰는 법
  python3 sg2/tools/build_version.py                        # web (기본)
  python3 sg2/tools/build_version.py --channel bundle       # USB zip 굽기 직전
  python3 sg2/tools/build_version.py --channel desktop --site ../desktop/site
"""
import argparse
import datetime
import json
import pathlib
import re
import sys

SG2 = pathlib.Path(__file__).resolve().parent.parent

# 판올림을 알리는 주소. 번들은 localhost 에서 돌기 때문에 교차 출처 요청이 되고,
# 그래서 sg2/vercel.json 이 /version.json 에만 CORS 헤더를 붙인다.
ORIGIN = 'https://smeag-studyground.vercel.app'


def read_version(sw: pathlib.Path) -> str:
    m = re.search(r"^const VERSION = '([^']+)'", sw.read_text(encoding='utf-8'), re.M)
    if not m:
        sys.exit(f'build_version: {sw} 에서 VERSION 을 찾지 못했습니다.')
    return m.group(1)


def number(version: str) -> int:
    """'sg-v45' → 45. 비교는 문자열이 아니라 숫자로 한다 — 'sg-v9' > 'sg-v45' 가 되면
    판올림 알림이 거꾸로 뜬다."""
    m = re.search(r'(\d+)$', version)
    return int(m.group(1)) if m else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--channel', choices=['web', 'bundle', 'desktop'], default='web')
    ap.add_argument('--site', default=str(SG2),
                    help='표를 새길 사본의 경로 (기본: sg2 자신)')
    args = ap.parse_args()

    site = pathlib.Path(args.site).resolve()
    version = read_version(SG2 / 'sw.js')
    n = number(version)
    built = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # 사본이 지니고 다니는 표 — 판 번호와 어느 경로로 받은 사본인지.
    (site / 'assets').mkdir(parents=True, exist_ok=True)
    (site / 'assets' / 'build-version.js').write_text(
        '/* 자동 생성 — sg2/tools/build_version.py. 손으로 고치지 않는다. */\n'
        'window.SG_BUILD = ' + json.dumps({
            'version': version,
            'n': n,
            'channel': args.channel,
            'built': built,
            'origin': ORIGIN,
        }, ensure_ascii=False) + ';\n',
        encoding='utf-8')

    # 라이브가 몇 판인지 답하는 쪽지는 웹에만 둔다. 번들 안의 version.json 은
    # 자기 자신을 가리켜서 언제나 "최신"이라 답하는 거울이 될 뿐이다.
    if args.channel == 'web':
        (site / 'version.json').write_text(
            json.dumps({
                'version': version,
                'n': n,
                'built': built,
                # 새 판을 어디서 받는지. 번들은 아직 사람 손으로 전달하므로 안내 화면을
                # 가리킨다. 배포 위치가 생기면 이 주소만 바꾸면 된다.
                'download': ORIGIN + '/tools.html',
            }, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8')

    print(f'✓ {version} → {site.name}/assets/build-version.js  (channel={args.channel})')


if __name__ == '__main__':
    main()
