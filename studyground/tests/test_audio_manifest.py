"""TTS 음원 발행 게이트를 테스트 스위트에 편입한다 (SET 9 매니페스트 대상).

왜 테스트에 넣는가. 이 프로젝트에서 실제로 난 사고는 전부 "조용히" 났다 —
스크립트를 고쳤는데 mp3 를 재생성하지 않았고, 문항은 있는데 음원이 없었고,
파일이 있으니 아무도 에러를 못 봤다. 사람이 40개를 들어보는 방식으로는 못 막는다.
그래서 pytest 가 매번 대신 듣는다.

판정 로직은 여기서 다시 짜지 않는다. 전부 tools/verify_audio.py 를 호출하고
그 리포트를 읽을 뿐이다 — 임계값이 두 벌로 갈리면 테스트는 통과하는데 발행 게이트는
막는(혹은 그 반대) 상황이 생긴다.

계층 배치
  계층 0  매핑·신선도    외부 도구 0. 항상 실행.
  계층 1  파일 무결성    ffprobe 40회 ≈ 6초. 항상 실행(기본 스위트에 포함).
  계층 2  신호 분석      ffmpeg 로 40개 전체 디코드 ≈ 13초. `slow` 마커로 분리.
  계층 3  텍스트 대조    로컬 STT 필요. `stt` 마커로 분리(수 분).
                         백엔드가 없으면 사유와 설치 방법을 남기고 skip.

실행
    studyground/.venv/bin/python -m pytest tests/ -q            # 계층 0~1
    studyground/.venv/bin/python -m pytest tests/ -q -m slow    # + 계층 2 (≈13초)
    studyground/.venv/bin/python -m pytest tests/ -q -m stt     # + 계층 3 (수 분)
계층 2 는 `-m slow` 를 **명시**해야 돈다. 이 저장소에는 pytest.ini 가 없어
addopts 로 기본 제외를 걸 수 없으므로, 마커 표현식을 직접 읽어 판단한다
(아래 _slow_requested). 마커만 달고 끝냈다면 기본 실행에 13초가 붙었을 것이다.

신선도 기준선(.audio-index.json)이 없으면 계층 0 은 전 항목 WARN 이고 stale 을
탐지할 수 없다. 그 상태를 통과로 위장하지 않고 아래 test_freshness_baseline_exists
가 명시적으로 실패시킨다 — 기준선을 세우는 명령까지 실패 메시지에 적어 둔다.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

STUDYGROUND = Path(__file__).resolve().parents[1]
SG2 = STUDYGROUND / "sg2"
MANIFEST = SG2 / "tts-manifest.set9.json"


def _load(name: str, path: Path):
    """경로 로드. tools/ 는 패키지가 아니고 저장소 경로에 공백이 있어 import 가 안 된다."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        return None
    return mod


va = _load("_verify_audio", STUDYGROUND / "tools" / "verify_audio.py")

pytestmark = pytest.mark.skipif(
    va is None or not MANIFEST.is_file(),
    reason="tools/verify_audio.py 또는 sg2/tts-manifest.set9.json 이 없다",
)


# ── 리포트 캐시 ──────────────────────────────────────────────────────────────
_CACHE: dict[str, dict] = {}


def _report(with_signal: bool) -> dict:
    """verify_audio.verify() 를 한 번만 돌려 재사용한다.

    with_signal=False 일 때 signal_scan 을 잠시 무력화한다. 계층 2 의 ffmpeg 디코드만
    빼고 계층 0~1 은 **진짜 코드 경로 그대로** 돌리기 위해서다. 여기서 계층 0/1 판정을
    직접 재구현하면 임계값이 두 벌이 되어 버린다.
    """
    key = "full" if with_signal else "fast"
    if key not in _CACHE:
        original = va.signal_scan
        if not with_signal:
            va.signal_scan = lambda path, duration: None
        try:
            _CACHE[key] = va.verify(MANIFEST, update_index=False, base=SG2)
        finally:
            va.signal_scan = original
    return _CACHE[key]


def _fails(rep: dict) -> list[str]:
    out = [g for g in rep["globalReasons"] if g.startswith("[FAIL]")]
    for it in rep["items"]:
        out += [f"{it['id']}  {why}" for why in it["reasons"] if why.startswith("[FAIL]")]
    return out


def _warns(rep: dict) -> list[str]:
    out = [g for g in rep["globalReasons"] if g.startswith("[WARN]")]
    for it in rep["items"]:
        out += [f"{it['id']}  {why}" for why in it["reasons"] if why.startswith("[WARN]")]
    return out


def _slow_requested(config) -> bool:
    return "slow" in (config.getoption("-m") or "")


# ── 계층 0 — 매핑 ────────────────────────────────────────────────────────────
def test_every_manifest_item_declares_an_output():
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    items = man.get("items") or []
    assert items, "매니페스트에 items 가 없다"
    bad = [it.get("id", "?") for it in items if not it.get("out")]
    assert not bad, f"out 경로가 없는 항목: {bad}"


def test_every_declared_audio_file_exists():
    """무음 시험 방지 — 문항은 있는데 음원이 없는 상태를 잡는다."""
    rep = _report(with_signal=False)
    missing = [it["id"] for it in rep["items"]
               if not it["layers"]["layer0_mapping"]["exists"]]
    assert not missing, f"음원 파일이 없는 항목 {len(missing)}개: {missing}"


def test_content_pack_references_are_all_declared():
    """set9.js 가 참조하는 mp3 가 매니페스트에 전부 있는가 (팩 ↔ 매니페스트 교차)."""
    rep = _report(with_signal=False)
    misses = {p["pack"]: p["missingFromManifest"]
              for p in rep["packCrossCheck"]
              if p["status"] == "OK" and p["missingFromManifest"]}
    skipped = [p for p in rep["packCrossCheck"] if p["status"] == "SKIP"]
    if skipped and not misses:
        pytest.skip(f"콘텐츠 팩을 읽지 못해 교차확인 미수행: {skipped}")
    assert not misses, f"팩이 참조하는데 매니페스트에 없는 음원: {misses}"


# ── 계층 0 — 신선도 ──────────────────────────────────────────────────────────
def test_freshness_baseline_exists():
    """기준선이 없으면 stale 탐지가 아예 꺼져 있다. 통과로 위장하지 않는다."""
    rep = _report(with_signal=False)
    fresh = [it["layers"]["layer0_mapping"].get("freshness") for it in rep["items"]]
    if "SKIP" in fresh:
        pytest.skip("stt_loopback.normalise 부재로 신선도 해시를 계산할 수 없다")
    new = [it["id"] for it in rep["items"]
           if it["layers"]["layer0_mapping"].get("freshness") == "NEW"]
    assert not new, (
        f"신선도 기준 해시가 없는 항목 {len(new)}개: {new[:5]}...\n"
        "기준선을 세워라:  .venv/bin/python tools/verify_audio.py "
        "--manifest sg2/tts-manifest.set9.json --update-index"
    )


def test_no_stale_audio():
    """스크립트/음성정책을 고쳤는데 mp3 를 재생성하지 않은 항목 — 발행 차단 사유."""
    rep = _report(with_signal=False)
    stale = [it["id"] for it in rep["items"]
             if it["layers"]["layer0_mapping"].get("freshness") == "STALE"]
    assert not stale, (
        f"스크립트가 바뀌었는데 음원이 낡았다 {len(stale)}개: {stale}\n"
        "재생성:  .venv/bin/python tools/tts_set9.py --force --only " + ",".join(stale)
    )


# ── 계층 1 — 파일 무결성 ─────────────────────────────────────────────────────
def test_layers_0_and_1_have_no_failures():
    """계층 0~1 종합. 빈 파일·손상·코덱 이탈·이름 뒤바뀜·중복 사용까지 포함."""
    rep = _report(with_signal=False)
    assert _fails(rep) == [], "발행 차단 사유:\n  " + "\n  ".join(_fails(rep))


def test_layer1_specs_are_uniform():
    """한 세트 안에서 코덱/샘플레이트가 섞이면 볼륨·톤이 튄다(verify_audio 는 WARN)."""
    rep = _report(with_signal=False)
    specs = {(it["layers"]["layer1_integrity"].get("codec"),
              it["layers"]["layer1_integrity"].get("sampleRate"),
              it["layers"]["layer1_integrity"].get("channels"))
             for it in rep["items"]
             if it["layers"]["layer1_integrity"].get("status") == "OK"}
    if not specs:
        pytest.skip("audio_probe 부재 — 계층 1 미수행")
    assert len(specs) == 1, f"한 세트 안에 제원이 섞여 있다: {sorted(specs)}"


def test_thresholds_are_single_sourced():
    """임계값이 코드에 흩뿌려지지 않았는지. 계층 3 은 stt_loopback 상수를 참조만 한다."""
    stt = _load("_verify_audio_stt", STUDYGROUND / "tools" / "verify_audio_stt.py")
    if stt is None:
        pytest.skip("tools/verify_audio_stt.py 를 로드하지 못했다")
    lb = _load("_stt_loopback", STUDYGROUND.parent / "smeag-local-ai" / "qa" / "stt_loopback.py")
    if lb is None:
        pytest.skip("smeag-local-ai/qa/stt_loopback.py 부재")
    assert stt.THRESHOLDS["wer_warn"] == lb.WER_WARN
    assert stt.THRESHOLDS["wer_reject"] == lb.WER_REJECT
    assert stt.THRESHOLDS["short_segment_words"] == lb.SHORT_SEGMENT_WORDS


def test_verify_audio_selftest_passes():
    """도구 자체의 순수 로직(해시 정규화·등급 병합)이 살아 있는지."""
    assert va.selftest() == 0


# ── 계층 2 — 신호 분석 (느림, -m slow) ───────────────────────────────────────
@pytest.mark.slow
def test_layer2_signal_has_no_failures(request):
    """잘림·전구간 무음·화자 턴 결손. ffmpeg 로 40개를 전부 디코드하므로 ≈13초.

    실행:  studyground/.venv/bin/python -m pytest tests/ -q -m slow
    """
    if not _slow_requested(request.config):
        pytest.skip("느린 계층 — `-m slow` 로 명시해야 실행된다 (ffmpeg 40회 ≈ 13초)")
    rep = _report(with_signal=True)
    assert _fails(rep) == [], "발행 차단 사유:\n  " + "\n  ".join(_fails(rep))


@pytest.mark.slow
def test_layer2_warnings_are_reported(request):
    """WARN 은 실패시키지 않는다(사람이 봐야 하는 것일 뿐). 다만 조용히 묻지도 않는다."""
    if not _slow_requested(request.config):
        pytest.skip("느린 계층 — `-m slow` 로 명시해야 실행된다")
    rep = _report(with_signal=True)
    for w in _warns(rep):
        print("WARN:", w)


# ── 계층 3 — 텍스트 대조 (STT 있을 때만) ─────────────────────────────────────
@pytest.mark.stt
def test_layer3_stt_contrast(request):
    """음원이 '지문 대신 문항 질문문'인 사고는 이 계층만 잡는다.

    백엔드가 없으면 skip 하되 **왜** 못 돌았는지와 무엇을 설치하면 켜지는지를 남긴다.
    조용한 통과는 이 사고를 놓친 채 PASS 를 찍는 것과 같다.

    실행:  studyground/.venv/bin/python -m pytest tests/ -q -m stt
    별도 마커인 이유: 이 환경에는 faster-whisper 가 실제로 설치돼 있고, small 모델로
    SET 9 40개를 전사하면 수 분이 걸린다(실측: 2분 30초 지점에서도 미완). 계층 2 의
    13초와는 비용 등급이 달라 slow 에 섞으면 `-m slow` 가 못 쓰게 느려진다.
    """
    if "stt" not in (request.config.getoption("-m") or ""):
        pytest.skip("STT 계층 — `-m stt` 로 명시해야 실행된다 (40개 전사, 수 분)")
    stt = _load("_verify_audio_stt", STUDYGROUND / "tools" / "verify_audio_stt.py")
    if stt is None:
        pytest.skip("tools/verify_audio_stt.py 를 로드하지 못했다")
    backend, tried = stt.detect_backend()
    if backend is None:
        why = "; ".join(f"{t['backend']}: {t['reason']}" for t in tried)
        pytest.skip(f"{stt.SKIP_REASON} — 탐지 기록: {why}")
    rep = stt.verify(MANIFEST)
    bad = [f"{i['id']} WER={i['wer']:.1%} {i['reason']}"
           for i in rep["items"] if i["verdict"] == "FAIL"]
    assert not bad, "음원 내용이 대본과 다르다:\n  " + "\n  ".join(bad)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
