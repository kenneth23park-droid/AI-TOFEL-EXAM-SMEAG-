"""오프라인 사전 다운로드 목록이 문항 데이터와 어긋나지 않았는지 본다.

목록(config/offline.<set>.json)은 tools/build_offline_manifest.py 가 문항 데이터에서
뽑아 굳혀 둔 것이다. 오디오를 갈아 끼우거나 문항을 늘리고 목록을 다시 만들지 않으면,
학생 기기는 "다 받았다"고 표시한 채로 새 파일 없이 시험장에 간다. 무음이 되는 자리다.

세트마다 본다. 종전에는 set9 하나만 봤고, 그동안 SET 10·11 은 목록조차 없이 나갔다 —
시험장에서 클립마다 회선을 탔고, 한 번 끊기면 그 블록 문항이 통째로 날아갔다.

    pytest studyground/tests/test_offline_manifest.py
"""
import json
import pathlib
import subprocess
import sys

import pytest

SG2 = pathlib.Path(__file__).resolve().parent.parent / 'sg2'
BUILDER = SG2 / 'tools' / 'build_offline_manifest.py'
SET_LIST = SG2 / 'config' / 'offline.sets.json'

SETS = json.loads(SET_LIST.read_text(encoding='utf-8'))['sets']
MANIFESTS = [SG2 / 'config' / f'offline.{code}.json' for code in SETS]


def load(manifest):
    return json.loads(manifest.read_text(encoding='utf-8'))


pytestmark_manifest = pytest.mark.parametrize(
    'manifest', MANIFESTS, ids=[m.stem for m in MANIFESTS])


def test_manifest_matches_question_data():
    """--check 는 목록이 문항 데이터와 어긋나면 0이 아닌 코드로 끝난다."""
    proc = subprocess.run(
        [sys.executable, str(BUILDER), '--check'],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        '목록이 문항 데이터와 어긋났다. '
        'python3 sg2/tools/build_offline_manifest.py 로 다시 만들어라.\n'
        + proc.stdout + proc.stderr
    )


@pytestmark_manifest
def test_every_listed_file_exists(manifest):
    data = load(manifest)
    missing = [f['u'] for f in data['files'] if not (SG2 / f['u']).is_file()]
    assert not missing, f'목록에 있으나 실제로 없는 파일: {missing}'


@pytestmark_manifest
def test_every_file_carries_a_content_hash(manifest):
    """해시가 없으면 같은 주소에 덮인 새 오디오를 기기가 알아채지 못한다."""
    data = load(manifest)
    assert len(data['rev']) >= 8
    for f in data['files']:
        assert len(f.get('h', '')) >= 8, f'해시 없음: {f["u"]}'


@pytestmark_manifest
def test_hashes_match_the_files_on_disk(manifest):
    import hashlib
    data = load(manifest)
    for f in data['files']:
        h = hashlib.sha256((SG2 / f['u']).read_bytes()).hexdigest()[:12]
        assert h == f['h'], f'해시 불일치: {f["u"]} — 목록을 다시 만들어라'


@pytestmark_manifest
def test_rev_changes_when_a_file_changes(manifest):
    """rev 하나로 '받을 것이 있는가'를 가르므로, 내용이 바뀌면 반드시 달라져야 한다."""
    import hashlib
    data = load(manifest)

    def rev_of(files):
        return hashlib.sha256(
            ''.join(f['u'] + ':' + f['h'] for f in files).encode('utf-8')
        ).hexdigest()[:12]

    assert rev_of(data['files']) == data['rev']
    tweaked = load(manifest)['files']
    tweaked[0]['h'] = 'ffffffffffff'
    assert rev_of(tweaked) != data['rev']


@pytestmark_manifest
def test_totals_are_consistent(manifest):
    data = load(manifest)
    assert data['count'] == len(data['files'])
    assert data['bytes'] == sum(f['b'] for f in data['files'])
    # 크기가 실제 파일과도 맞아야 진행률이 100%에서 멎지 않는다.
    for f in data['files']:
        assert (SG2 / f['u']).stat().st_size == f['b'], f'크기 불일치: {f["u"]}'


@pytestmark_manifest
def test_no_intermediate_artifacts(manifest):
    """_backup_* · _segments_* 는 생성 중간물이다 — 학생 기기로 보내지 않는다."""
    data = load(manifest)
    junk = [f['u'] for f in data['files'] if '_backup' in f['u'] or '_segments' in f['u']]
    assert not junk, f'생성 중간물이 목록에 섞였다: {junk}'


def test_precached_by_service_worker():
    """목록 자체가 셸 프리캐시에 있어야 오프라인에서도 '무엇이 빠졌는지'를 판단한다."""
    sw = (SG2 / 'sw.js').read_text(encoding='utf-8')
    assert "'config/offline.sets.json'" in sw
    for code in SETS:
        assert f"'config/offline.{code}.json'" in sw, f'{code} 목록이 프리캐시에 없다'
    assert "'assets/offline-prep.js'" in sw


def test_every_set_has_a_manifest():
    """offline.sets.json 에 이름만 올리고 목록을 짓지 않으면 그 세트는 회선에 기댄다."""
    for manifest in MANIFESTS:
        assert manifest.is_file(), f'{manifest.name} 이 없다 — 빌더를 돌려라'


def test_builder_knows_every_listed_set():
    """빌더의 SETS 와 offline.sets.json 이 어긋나면 한쪽이 조용히 낡는다."""
    src = BUILDER.read_text(encoding='utf-8')
    for code in SETS:
        assert f"'{code}'" in src, f'빌더에 {code} 가 없다'


def test_exam_page_manifest_follows_the_set():
    """응시 화면이 다른 세트의 목록을 보면 '준비 완료'라 해 놓고 무음이 된다."""
    import re
    prep = (SG2 / 'assets' / 'offline-prep.js').read_text(encoding='utf-8')
    code_only = re.sub(r'/\*.*?\*/', '', prep, flags=re.S)
    assert not re.search(r"MANIFEST\s*=\s*'config/offline\.set", code_only), \
        '목록 주소가 한 세트에 박혀 있다'
    assert 'urlSetId' in code_only
