"""TOEFL 1~6 밴드 스케일 — ETS 공식 대응표를 한 칸도 빠짐없이 검증한다.

이 파일이 지키는 것은 셋이다.

  1) 0~30 → 밴드 경계가 ETS 표와 **정확히** 같은가 (0..30 전 구간, 네 영역)
  2) 종합이 합이 아니라 평균이고, .25 는 올라가고 .125 는 내려가는가 (ETS 예시)
  3) 채점 대기(None) 영역이 0 으로 세어지지 않는가 — 이걸 놓치면 라이팅이
     늦게 채점되는 학생의 종합이 실제보다 한참 낮게 굳는다.

Run:  .venv/bin/python -m pytest tests/test_toefl6_band.py -q
      .venv/bin/python tests/test_toefl6_band.py       (pytest 없이도 돈다)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.scoring import rubric                                      # noqa: E402
from app.scoring.scale import (                                     # noqa: E402
    TOEFL,
    TOEFL6,
    TOEFL6_TABLE_PATH,
    Toefl6Scale,
    get_scale,
)

# ── ETS 공식 표, 그대로 옮겨 적은 정본 ────────────────────────────────────────
# https://www.ets.org/toefl/institutions/ibt/score-scale-update.html (2026-08-11 확인)
# 밴드 → (영역별 0~30 구간의 시작, 끝). 표를 코드에서 계산해 만들지 않는다 —
# JSON 을 그대로 다시 계산하면 두 벌이 같이 틀려도 테스트가 통과해 버린다.
ETS_TABLE = {
    "reading":   {1.0: (0, 1), 1.5: (2, 2), 2.0: (3, 3), 2.5: (4, 5), 3.0: (6, 11),
                  3.5: (12, 17), 4.0: (18, 21), 4.5: (22, 23), 5.0: (24, 26),
                  5.5: (27, 28), 6.0: (29, 30)},
    "listening": {1.0: (0, 1), 1.5: (2, 3), 2.0: (4, 5), 2.5: (6, 8), 3.0: (9, 12),
                  3.5: (13, 16), 4.0: (17, 19), 4.5: (20, 21), 5.0: (22, 25),
                  5.5: (26, 27), 6.0: (28, 30)},
    "writing":   {1.0: (0, 2), 1.5: (3, 6), 2.0: (7, 10), 2.5: (11, 12), 3.0: (13, 14),
                  3.5: (15, 16), 4.0: (17, 20), 4.5: (21, 23), 5.0: (24, 26),
                  5.5: (27, 28), 6.0: (29, 30)},
    "speaking":  {1.0: (0, 4), 1.5: (5, 9), 2.0: (10, 12), 2.5: (13, 15), 3.0: (16, 17),
                  3.5: (18, 19), 4.0: (20, 22), 4.5: (23, 24), 5.0: (25, 26),
                  5.5: (27, 27), 6.0: (28, 30)},
}


def test_every_scaled_point_matches_the_official_table():
    """0~30 서른한 칸 × 네 영역 = 124 칸을 전부 확인한다."""
    scale = Toefl6Scale()
    for skill, bands in ETS_TABLE.items():
        expected = {}
        for band, (lo, hi) in bands.items():
            for scaled in range(lo, hi + 1):
                expected[scaled] = band
        assert sorted(expected) == list(range(31)), f"{skill}: 표에 구멍이 있다"
        for scaled, band in expected.items():
            got = scale.band_for_scaled(scaled, skill)
            assert got == band, f"{skill} {scaled}/30 → {got}, 표는 {band}"


def test_json_table_and_test_table_agree():
    """JSON 이 손상되면 조용히 선형 추정으로 떨어진다 — 그 전에 여기서 걸린다."""
    raw = json.loads(TOEFL6_TABLE_PATH.read_text(encoding="utf-8"))
    assert raw["_provenance"]["level"] == "official"
    assert set(raw["sections"]) == set(ETS_TABLE)
    for skill, rows in raw["sections"].items():
        mins = {row["band"]: row["min"] for row in rows}
        for band, (lo, _hi) in ETS_TABLE[skill].items():
            assert mins[band] == lo, f"{skill} 밴드 {band} 의 하한이 {mins[band]}, 표는 {lo}"


def test_band_never_drops_below_one():
    """ETS 표에서 0점도 밴드 1 이다. 0.0 이라는 밴드는 존재하지 않는다."""
    scale = Toefl6Scale()
    for skill in ETS_TABLE:
        assert scale.band_for_scaled(0, skill) == 1.0
        assert scale.band_for_scaled(-5, skill) == 1.0      # 방어적: 음수도 바닥
        assert scale.band_for_scaled(99, skill) == 6.0      # 표 위쪽도 실링


def test_raw_to_scaled_is_proportional_and_clamped():
    """⚠️가설 단계. 정답률 비례이고, 0으로 나누지 않으며, 30 을 넘지 않는다."""
    scale = Toefl6Scale()
    assert scale.scaled_from_raw(50, 50) == 30.0
    assert scale.scaled_from_raw(0, 50) == 0.0
    assert scale.scaled_from_raw(0, 0) == 0.0               # 문항이 없어도 죽지 않는다
    assert scale.scaled_from_raw(99, 50) == 30.0            # 비율 1.0 로 clamp
    assert scale.scaled_from_raw(25, 50) == 15.0            # 0.5 * 30
    # 0.5 는 항상 올라간다(banker's rounding 이 아니다): 41/47 = .8723 → 26.17 → 26
    assert scale.scaled_from_raw(41, 47) == 26.0


def test_section_score_end_to_end():
    """SET 9 실제 문항 수(R 50 · L 47)로 원점수 → 밴드까지 한 번에."""
    scale = get_scale(TOEFL6)
    assert scale.key == TOEFL6
    assert scale.section_score(50, 50, skill="reading") == 6.0
    assert scale.section_score(0, 50, skill="reading") == 1.0
    # 40/50 = 80% → 24/30 → reading 밴드 5.0
    assert scale.section_score(40, 50, skill="reading") == 5.0
    # 40/47 = 85.1% → 25.53 → 26/30 → listening 밴드 5.5
    assert scale.section_score(40, 47, skill="listening") == 5.5


def test_overall_is_the_mean_not_the_sum():
    """ETS 규칙 — 평균이고, 0.5 단위로 반올림하며, .25 는 올라간다."""
    scale = get_scale(TOEFL6)
    # ETS 문서의 예시 두 개를 그대로.
    assert scale.combine({"a": 5.0, "b": 5.0, "c": 5.0, "d": 5.5}) == 5.0    # 5.125 → 5.0
    assert scale.combine({"a": 5.0, "b": 5.0, "c": 5.5, "d": 5.5}) == 5.5    # 5.25  → 5.5
    # 합이 아니라는 것 자체를 못 박는다(합이면 22.0 이 나온다).
    assert scale.combine({"a": 6.0, "b": 6.0, "c": 5.0, "d": 5.0}) == 5.5
    assert scale.combine({}) == 0.0


def test_pending_sections_are_skipped_not_zeroed():
    """채점 대기 영역을 0 으로 세면 종합이 실제보다 낮게 굳는다."""
    scale = get_scale(TOEFL6)
    graded_only = scale.combine({"reading": 5.0, "listening": 5.0})
    with_pending = scale.combine(
        {"reading": 5.0, "listening": 5.0, "writing": None, "speaking": None}
    )
    assert with_pending == graded_only == 5.0


def test_rubric_to_section_uses_the_official_band_row_only():
    """분석 축이 섞여도 섹션 밴드는 공식 총체 밴드 행만 먹는다."""
    scale = get_scale(TOEFL6)
    official = [
        {"skill": "writing", "criterion": "Official Band", "score": 4.0, "max_score": 5.0},
        {"skill": "writing", "criterion": "Official Band", "score": 4.0, "max_score": 5.0},
    ]
    noise = [
        {"skill": "writing", "criterion": "Vocabulary", "score": 1.0, "max_score": 5.0},
        {"skill": "writing", "criterion": "Language Use", "score": 1.0, "max_score": 5.0},
    ]
    # 8/10 = 80% → 24/30 → writing 밴드 5.0
    assert scale.rubric_to_section(official) == 5.0
    assert scale.rubric_to_section(official + noise) == 5.0     # 축을 섞어도 같다
    assert scale.rubric_to_section([]) == 0.0


def test_rubric_to_section_reads_the_skill_from_the_rows():
    """영역마다 산출이 다르다 — R·L 은 0~30 표를, W·S 는 선형식을 탄다.

    W·S 는 round½(1 + 비율 × 5) 하나를 함께 쓴다(2026-09-07 운영 결정).
    """
    scale = get_scale(TOEFL6)
    def row(skill, score):
        return [{"skill": skill, "criterion": "Official Band",
                 "score": score, "max_score": 5.0}]
    # 3.5/5 = 70% → 1 + 3.5 = 4.5. 두 영역이 같은 값을 낸다.
    assert scale.rubric_to_section(row("writing", 3.5)) == 4.5
    assert scale.rubric_to_section(row("speaking", 3.5)) == 4.5
    # .25 는 올라간다 — 선형식의 핵심.
    assert scale.rubric_to_section(row("speaking", 4.25)) == 5.5


def test_grade_and_cefr():
    scale = get_scale(TOEFL6)
    assert scale.grade(5.25) == "Band 5.5"
    assert scale.display(5.0) == "5.0"
    assert scale.cefr(6.0) == "C2"
    assert scale.cefr(5.0) == "C1"
    assert scale.cefr(4.0) == "B2"
    assert scale.cefr(1.0) == "A1"


def test_storage_total_keeps_integer_columns_sortable():
    """attempts.total_score 는 정수 칼럼이다 — 밴드 × 10 으로 눌러 담는다."""
    scale = get_scale(TOEFL6)
    assert scale.storage_total(5.5) == 55
    assert scale.storage_total(5.25) == 55          # 반올림 뒤에 곱한다
    assert scale.storage_total(1.0) == 10


def test_rubric_module_treats_toefl6_as_the_toefl_rubric():
    """1~6 은 보고 눈금일 뿐 — 채점 축과 만점(0~5)은 toefl120 과 같아야 한다."""
    assert rubric.normalize_scale(TOEFL6) == TOEFL
    assert rubric.criteria_for(TOEFL6, "writing") == rubric.criteria_for(TOEFL, "writing")
    assert rubric.max_score_for(TOEFL6, "speaking") == 5.0
    rows = rubric.draft("writing", "A short essay. It has two sentences.", scale_key=TOEFL6)
    assert rows and all(row["max_score"] == 5.0 for row in rows)
    # 밴드 칼럼은 IELTS 전용이다. toefl6 행에 밴드가 실리면 섹션 환산이 두 번 접힌다.
    assert all(row["band"] is None for row in rows)


def test_get_scale_knows_the_new_key_without_breaking_the_old_ones():
    assert get_scale("toefl6").key == TOEFL6
    assert get_scale("TOEFL6").key == TOEFL6
    assert get_scale("toefl").key == TOEFL          # 프로필 별칭은 여전히 0~120
    assert get_scale("toefl120").key == TOEFL
    assert get_scale(None).key == TOEFL


def test_missing_table_degrades_to_a_linear_estimate_and_never_raises():
    """표가 사라져도 채점은 멈추지 않는다(로그만 남고 근사치로 간다)."""
    scale = Toefl6Scale(Path("/nonexistent/toefl6_band_table.json"))
    assert scale.band_for_scaled(30, "reading") == 6.0
    assert scale.band_for_scaled(0, "reading") == 1.0
    assert 1.0 <= scale.band_for_scaled(15, "reading") <= 6.0


if __name__ == "__main__":  # pytest-free runner
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {exc!r}")
    print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILED'}")
    raise SystemExit(1 if failures else 0)
