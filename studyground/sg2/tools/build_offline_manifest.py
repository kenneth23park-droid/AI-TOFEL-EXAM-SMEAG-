#!/usr/bin/env python3
"""오프라인 사전 다운로드 목록을 만든다 — config/offline.<set>.json.

왜 별도 목록인가. 브라우저는 "이 SET 이 쓰는 미디어"를 알 방법이 없다. 문항 데이터를
파싱해 알아낼 수도 있지만, 그러려면 응시 페이지가 아닌 곳(index·tests)에서도 무거운
set9.js 를 전부 읽어야 한다. 대신 여기서 한 번 훑어 목록과 바이트 수를 굳혀 두면,
클라이언트는 20 KB 짜리 JSON 하나만 읽고 곧바로 내려받기를 시작할 수 있다.

바이트 수를 함께 담는 이유는 진행률 때문이다. 파일 개수로만 세면 30 초짜리 강의와
2 초짜리 단답이 같은 한 칸을 차지해 막대가 튄다.

내용 해시(`h`)도 함께 담는다. 오디오는 같은 주소에 새 파일로 덮이는 일이 잦은데
(음성을 다시 생성하면 url 은 그대로다), 서비스워커의 미디어 캐시는 cache-first 라
주소만 봐서는 바뀐 줄을 모른다. 해시가 다르면 그 파일만 다시 받는다 — 전체 25 MB 를
다시 받지 않는다. 목록 전체의 지문인 `rev` 는 "받을 것이 있는지" 한 번에 가른다.

    python3 tools/build_offline_manifest.py                     # config/offline.set9.json 갱신
    python3 tools/build_offline_manifest.py --check             # 갱신 없이 차이만 보고(CI용)
    python3 tools/build_offline_manifest.py --export ../dist/offline-media
                                                # 실제 필요분만 폴더로 떠내기(USB·백업용)

media/ 밑의 _backup_* · _segments_* 는 생성 중간물이라 목록에 들어가지 않는다 —
실제 참조되는 파일만 모은다. (전체 145 MB 중 실제 필요분은 25 MB 남짓이다.)
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# SET 하나가 쓰는 미디어는 두 군데에 흩어져 있다 — 리스닝 스크립트 음성(tts)과
# 문항 데이터에 박힌 오디오·화자 이미지.
SETS = {
    'set9': {
        'label': 'NEW TOEFL SET 9',
        'sources': ['assets/set9-audio.js', 'assets/set9.js'],
    },
    'set10': {
        'label': 'NEW TOEFL SET 10',
        'sources': ['assets/set10.js'],
    },
    'set11': {
        'label': 'NEW TOEFL SET 11',
        'sources': ['assets/set11.js'],
    },
    'set12': {
        'label': 'NEW TOEFL SET 12',
        'sources': ['assets/set12.js'],
    },
    'set2': {
        'label': 'NEW TOEFL SET 2',
        'sources': ['assets/set2.js'],
    },
    'set3': {
        'label': 'NEW TOEFL SET 3',
        'sources': ['assets/set3.js'],
    },
}

# 파일 이름에 공백이 들어간 참조가 있다("TOEFL Listening Image (Single female).webp").
# 공백을 끊는 옛 패턴은 그것들을 통째로 놓쳤고, 놓친 파일은 시험장에서 회선에 기댄다.
MEDIA_REF = re.compile(r'["\'](media/[^"\']+)["\']')


def digest(path):
    """파일 내용의 짧은 지문. 같은 주소에 다른 파일이 놓였는지 가리는 데만 쓴다."""
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def collect(source_paths):
    """문항 데이터에서 media/ 참조를 모아 (경로, 바이트, 해시) 목록으로 돌려준다."""
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
            files.append({'u': url, 'b': os.path.getsize(abs_path), 'h': digest(abs_path)})
        else:
            missing.append(url)
    return files, missing


def build(code, spec):
    files, missing = collect(spec['sources'])
    # 목록 전체의 지문 — 기기가 가진 rev 와 다르면 그때만 파일별 비교로 내려간다.
    rev = hashlib.sha256(
        ''.join(f['u'] + ':' + f['h'] for f in files).encode('utf-8')
    ).hexdigest()[:12]
    return {
        'set': code.upper(),
        'label': spec['label'],
        'rev': rev,
        'count': len(files),
        'bytes': sum(f['b'] for f in files),
        'files': files,
    }, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='파일을 쓰지 않고 현재 목록과 다른지만 확인한다')
    ap.add_argument('--export', metavar='DIR',
                    help='실제 필요분만 이 폴더로 복사한다 (media/ 구조 그대로)')
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

        if args.export:
            # media/ 안에는 음성을 만들며 남은 중간물이 120 MB 쯤 섞여 있다. 실제로
            # 시험에 쓰이는 것만 같은 경로 구조로 떠낸다 — 그대로 sg2/ 위에 덮으면 된다.
            dest_root = os.path.abspath(os.path.join(args.export, code))
            copied = 0
            for f in manifest['files']:
                src = os.path.join(ROOT, f['u'])
                dst = os.path.join(dest_root, f['u'])
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                copied += 1
            with open(os.path.join(dest_root, f'offline.{code}.json'), 'w', encoding='utf-8') as fh:
                fh.write(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
            print(f'  ✓ {copied}개를 {dest_root} 로 떠냈다 ({mb:.1f} MB)')

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
