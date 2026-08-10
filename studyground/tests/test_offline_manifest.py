"""오프라인 사전 다운로드 목록이 문항 데이터와 어긋나지 않았는지 본다.

목록(config/offline.set9.json)은 tools/build_offline_manifest.py 가 문항 데이터에서
뽑아 굳혀 둔 것이다. 오디오를 갈아 끼우거나 문항을 늘리고 목록을 다시 만들지 않으면,
학생 기기는 "다 받았다"고 표시한 채로 새 파일 없이 시험장에 간다. 무음이 되는 자리다.

    pytest studyground/tests/test_offline_manifest.py
"""
import json
import pathlib
import subprocess
import sys

SG2 = pathlib.Path(__file__).resolve().parent.parent / 'sg2'
MANIFEST = SG2 / 'config' / 'offline.set9.json'
BUILDER = SG2 / 'tools' / 'build_offline_manifest.py'


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


def test_every_listed_file_exists():
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    missing = [f['u'] for f in data['files'] if not (SG2 / f['u']).is_file()]
    assert not missing, f'목록에 있으나 실제로 없는 파일: {missing}'


def test_totals_are_consistent():
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    assert data['count'] == len(data['files'])
    assert data['bytes'] == sum(f['b'] for f in data['files'])
    # 크기가 실제 파일과도 맞아야 진행률이 100%에서 멎지 않는다.
    for f in data['files']:
        assert (SG2 / f['u']).stat().st_size == f['b'], f'크기 불일치: {f["u"]}'


def test_no_intermediate_artifacts():
    """_backup_* · _segments_* 는 생성 중간물이다 — 학생 기기로 보내지 않는다."""
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    junk = [f['u'] for f in data['files'] if '_backup' in f['u'] or '_segments' in f['u']]
    assert not junk, f'생성 중간물이 목록에 섞였다: {junk}'


def test_precached_by_service_worker():
    """목록 자체가 셸 프리캐시에 있어야 오프라인에서도 '무엇이 빠졌는지'를 판단한다."""
    sw = (SG2 / 'sw.js').read_text(encoding='utf-8')
    assert "'config/offline.set9.json'" in sw
    assert "'assets/offline-prep.js'" in sw
