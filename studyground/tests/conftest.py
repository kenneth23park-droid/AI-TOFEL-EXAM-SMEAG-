"""pytest 설정 — 커스텀 마커 등록만 한다.

이 저장소에는 pytest.ini / pyproject.toml 이 없다. 마커를 등록할 곳이 여기밖에
없어서 만든 파일이다. 등록하지 않으면 test_audio_manifest.py 를 수집할 때마다
PytestUnknownMarkWarning 이 3줄씩 찍혀 진짜 경고를 덮는다.

마커의 기본 제외는 여기서 하지 않는다(addopts 는 ini 전용). 각 테스트가 `-m` 표현식을
직접 읽어 skip 하며, 그 이유는 test_audio_manifest.py 머리말에 적혀 있다.
"""


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "slow: ffmpeg 로 오디오 전수 디코드(≈13초). `-m slow` 로만 실행된다.")
    config.addinivalue_line(
        "markers", "stt: 로컬 STT 로 음원 전사 대조(수 분). `-m stt` 로만 실행된다.")
