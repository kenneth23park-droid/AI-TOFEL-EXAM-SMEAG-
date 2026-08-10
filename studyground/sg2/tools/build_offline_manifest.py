#!/usr/bin/env python3
"""오프라인 사전 다운로드 목록을 만든다 — config/offline.<set>.json.

왜 별도 목록인가. 브라우저는 "이 SET 이 쓰는 미디어"를 알 방법이 없다. 문항 데이터를
파싱해 알아낼 수도 있지만, 그러려면 응시 페이지가 아닌 곳(index·tests)에서도 무거운
set9.js 를 전부 읽어야 한다. 대신 여기서 한 번 훑어 목록과 바이트 수를 굳혀 두면,
클라이언트는 20 KB 짜리 JSON 하나만 읽고 곧바로 내려받기를 시작할 수 있다.

바이트 수를 함께 담는 이유는 진행률 때문이다. 파일 개수로만 세면 30 초짜리 강의와
2 초짜리 단답이 같은 한 칸을 차지해 막대가 튄다.

    python3 tools/build_offline_manifest.py            # config/offline.set9.json 갱신
    python3 tools/build_offline_manifest.py --check    # 갱신 없이 차이만 보고(CI용)

media/ 밑의 _backup_* · _segments_* 는 생성 중간물이라 목록에 들어가지 않는다 —
실제 참조되는 파일만 모은다. (전체 145 MB 중 실제 필요분은 25 MB 남짓이다.)
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SET 하나가 쓰는 미디어는 두 군데에 흩어져 있다 — 리스닝 스크립트 음성(tts)과
# 문항 데이터에 박힌 오디오·화자 이미지.
SETS = {
    'set9': {
        'label': 'NEW TOEFL SET 9',
        'sources': ['assets/set9-audio.js', 'assets/set9.js'],
    },
}

MEDIA_REF = re.compile(r'["\'](media/[^"\'\s]+)["\']')


def collect(source_paths):
    """문항 데이터에서 media/ 참조를 모아 (경로, 바이트) 목록으로 돌려준다."""
    urls = set()
    for rel in source_paths:
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            for ref in MEDIA_REF.findall(fh.read()):
                if ref.endswith('/'):
                    continue        # 'media/audio/set9/' 같은 디렉터리 접두사
                urls.add(ref)

    files, missing = [], []
    for url in sorted(urls):
        abs_path = os.path.join(ROOT, url)
        if os.path.isfile(abs_path):
            files.append({'u': url, 'b': os.path.getsize(abs_path)})
        else:
            missing.append(url)
    return files, missing


def build(code, spec):
    files, missing = collect(spec['sources'])
    return {
        'set': code.upper(),
        'label': spec['label'],
        'count': len(files),
        'bytes': sum(f['b'] for f in files),
        'files': files,
    }, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='파일을 쓰지 않고 현재 목록과 다른지만 확인한다')
    args = ap.parse_args()

    stale = False
    for code, spec in SETS.items():
        manifest, missing = build(code, spec)
        out = os.path.join(ROOT, 'config', f'offline.{code}.json')
        text = json.dumps(manifest, indent=1, ensure_ascii=False) + '\n'

        mb = manifest['bytes'] / 1e6
        print(f"{manifest['set']}: {manifest['count']} files · {mb:.1f} MB → config/offline.{code}.json")
        for m in missing:
            # 참조는 있는데 파일이 없다 — 오프라인에서 무음이 될 자리다.
            print(f'  ⚠ 참조된 파일 없음: {m}', file=sys.stderr)

        previous = None
        if os.path.isfile(out):
            with open(out, encoding='utf-8') as fh:
                previous = fh.read()
        if previous == text:
            continue

        stale = True
        if args.check:
            print(f'  ✗ config/offline.{code}.json 이 문항 데이터와 어긋나 있다', file=sys.stderr)
        else:
            with open(out, 'w', encoding='utf-8') as fh:
                fh.write(text)
            print('  ✓ 갱신됨')

    if args.check and stale:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
