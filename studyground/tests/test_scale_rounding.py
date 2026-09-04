"""Score scale rounding — architecture.md 9.4 table, exhaustively (Story 6.4 AC4).

Run:  .venv/bin/python -m pytest tests/test_scale_rounding.py -q
      .venv/bin/python tests/test_scale_rounding.py       (no pytest needed)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import cefr_for                                     # noqa: E402
from app.scoring.scale import (                                     # noqa: E402
    IELTS,
    TOEFL,
    Ielts9Scale,
    Toefl120Scale,
    get_scale,
    round_half_up,
    round_half_up_to_half,
)

# architecture.md 9.4 — the confirmed table, verbatim.
ARCH_TABLE = [
    (6.25, 6.5),      # hard rule: .25 rounds UP
    (6.75, 7.0),      # hard rule: .75 rounds UP
    (6.24, 6.0),      # 6.24 * 2 = 12.48 → 12 → 6.0
    (6.26, 6.5),
    (6.5, 6.5),       # identity
    (6.125, 6.0),     # 12.25 → 12  (⚠️assumed: 0.125 steps do not occur in practice)
]

# Boundaries either side of every .25/.75 hinge across the whole band range.
BOUNDARY_TABLE = [
    (0.0, 0.0), (0.24, 0.0), (0.25, 0.5), (0.26, 0.5),
    (0.74, 0.5), (0.75, 1.0), (0.76, 1.0),
    (1.25, 1.5), (1.75, 2.0), (2.25, 2.5), (2.75, 3.0),
    (3.25, 3.5), (3.75, 4.0), (4.25, 4.5), (4.75, 5.0),
    (5.25, 5.5), (5.75, 6.0), (7.25, 7.5), (7.75, 8.0),
    (8.25, 8.5), (8.75, 9.0), (9.0, 9.0),
    (5.0, 5.0), (5.49, 5.5), (5.51, 5.5), (5.49999, 5.5),
]


def test_architecture_rounding_table():
    for value, expected in ARCH_TABLE:
        assert round_half_up_to_half(value) == expected, f"{value} → {expected}"


def test_boundary_rounding_table():
    for value, expected in BOUNDARY_TABLE:
        assert round_half_up_to_half(value) == expected, f"{value} → {expected}"


def test_output_is_always_a_half_step_in_range():
    x = 0.0
    while x <= 9.0001:
        out = round_half_up_to_half(x)
        assert abs(out * 2 - round(out * 2)) < 1e-9, f"{x} produced {out}, not a 0.5 step"
        assert 0.0 <= out <= 9.0
        x += 0.01


def test_builtin_round_would_have_been_wrong():
    """The reason `Decimal` is mandatory: banker's rounding fails the hard rule."""
    assert round(6.25, 1) == 6.2          # what we must NOT do
    assert round_half_up_to_half(6.25) == 6.5


def test_round_half_up_whole_numbers():
    # ROUND_HALF_UP is "half away from zero", so -0.5 → -1. Scores are never
    # negative, but the behaviour is pinned so nobody "fixes" it into banker's.
    for value, expected in [(0.5, 1), (1.5, 2), (2.5, 3), (-0.5, -1), (23.49, 23), (23.5, 24)]:
        assert round_half_up(value) == expected, f"{value} → {expected}"


# ── IELTS mean-of-four, the case the hard rule was written for ────────────────
def test_four_criterion_means():
    scale = get_scale(IELTS)
    cases = [
        ([6, 6, 6, 7], 6.5),        # mean 6.25 → up
        ([6, 7, 7, 7], 7.0),        # mean 6.75 → up
        ([6, 6, 6, 6], 6.0),
        ([5, 6, 6, 7], 6.0),
        ([5.5, 6, 6.5, 7], 6.5),    # mean 6.25 → up
        ([7, 7, 8, 8], 7.5),
        ([4, 5, 5, 5], 5.0),        # mean 4.75 → up
    ]
    for bands, expected in cases:
        rows = [
            {"skill": "writing", "criterion": c, "score": b, "max_score": 9, "band": b}
            for c, b in zip(("TR", "CC", "LR", "GRA"), bands)
        ]
        assert scale.rubric_to_section(rows) == expected, f"{bands} → {expected}"


def test_ielts_combine_and_labels():
    scale = get_scale("ielts9")
    total = scale.combine({"listening": 7.0, "reading": 6.5, "writing": 6.0, "speaking": 6.0})
    assert total == 6.5                      # mean 6.375 → 6.5
    assert scale.grade(total) == "Band 6.5"
    assert scale.display(total) == "6.5"
    assert scale.band_score(total) == 6.5
    assert scale.storage_total(total) == 65  # architecture.md 9.5 — band × 10


def test_ielts_band_table_lookup():
    scale = get_scale(IELTS)
    assert scale.section_score(30, 40, skill="reading") == 7.0
    assert scale.section_score(30, 40, skill="listening") == 7.0
    assert scale.section_score(40, 40, skill="reading") == 9.0
    assert scale.section_score(0, 40, skill="listening") == 0.0
    # Bracket edges: 27 is the floor of Reading 6.5, 26 drops to 6.0.
    assert scale.section_score(27, 40, skill="reading") == 6.5
    assert scale.section_score(26, 40, skill="reading") == 6.0


def test_out_of_range_raw_never_raises():
    scale = Ielts9Scale()
    assert scale.section_score(-5, 40, skill="reading") == 0.0     # below every bracket
    assert scale.section_score(99, 40, skill="reading") == 9.0     # above the top bracket
    # A zero denominator falls back to the table's own raw_total (40) rather than
    # dividing by zero: 10/40 sits in the Band 4.0 bracket.
    assert scale.section_score(10, 0, skill="reading") == 4.0
    # No table for this skill → linear estimate, still a valid half step.
    assert scale.section_score(20, 40, skill="writing") == 4.5


def test_band_table_file_is_well_formed():
    from app.scoring.scale import BAND_TABLE_PATH

    data = json.loads(BAND_TABLE_PATH.read_text(encoding="utf-8"))
    assert data["_provenance"]["level"] == "assumed"   # ⚠️가설(검증필요) must stay flagged
    assert data["raw_total"] == 40
    for skill in ("listening", "reading"):
        rows = data["tables"][skill]
        mins = [r["min"] for r in rows]
        assert mins == sorted(mins, reverse=True), f"{skill} table must be sorted high → low"
        assert min(mins) == 0, f"{skill} table must cover a raw score of 0"
        for row in rows:
            assert 0.0 <= row["band"] <= 9.0
            assert abs(row["band"] * 2 - round(row["band"] * 2)) < 1e-9


# ── TOEFL must not move by a single point ─────────────────────────────────────
def test_toefl_is_unchanged():
    scale = get_scale(TOEFL)
    assert isinstance(scale, Toefl120Scale)
    assert (scale.key, scale.section_max, scale.total_max) == (TOEFL, 30.0, 120.0)
    sections = {"reading": 24, "listening": 22, "speaking": 20, "writing": 22}
    total = scale.combine(sections)
    assert total == 88.0 == sum(sections.values())
    assert scale.grade(total) == cefr_for(88)
    assert scale.band_score(total) is None
    assert scale.storage_total(total) == 88
    assert scale.display(24, 30) == "24/30"
    assert scale.display(total, 120) == "88/120"


def test_toefl_section_score():
    scale = get_scale(TOEFL)
    assert scale.section_score(35, 35) == 30.0
    assert scale.section_score(0, 35) == 0.0
    assert scale.section_score(28, 35) == 24.0      # 0.8 * 30
    assert scale.section_score(0, 0) == 0.0         # no division by zero
    assert scale.section_score(99, 35) == 30.0      # clamped, never over the max


def test_get_scale_defaults_and_aliases():
    assert get_scale("ielts9").key == IELTS
    assert get_scale("ielts").key == IELTS          # profile alias
    assert get_scale("toefl").key == TOEFL
    assert get_scale("toefl120").key == TOEFL
    assert get_scale(None).key == TOEFL
    assert get_scale("").key == TOEFL
    assert get_scale("nonsense").key == TOEFL       # logs, never raises


# ── 스피킹: 표가 아니라 과제 평균을 0.5 로 올린다 (2026-09-04 운영 결정) ─────────
SPEAKING_TABLE = [
    ([3, 3, 3, 3], 3.0),
    ([3, 3, 4, 3], 3.5),        # 평균 3.25 → 올림
    ([3, 4, 4, 3], 3.5),
    ([4, 4, 4, 3], 4.0),        # 평균 3.75 → 올림
    ([4, 4, 4, 4], 4.0),
    ([4, 5, 4, 4], 4.5),        # 평균 4.25 → 올림
    ([5, 5, 4, 4], 4.5),
    ([5, 5, 5, 4], 5.0),        # 평균 4.75 → 올림
    ([5, 5, 5, 5], 5.0),        # 만점 평균은 5.0 이다 — 스피킹에 6.0 은 없다
    ([0, 0, 0, 0], 1.0),        # 바닥은 1.0 (0 이라는 밴드는 없다)
]


def _speaking_rubrics(scores, skill="speaking"):
    return [
        {"criterion": "Official Band", "score": s, "max_score": 5, "skill": skill}
        for s in scores
    ]


def test_speaking_band_is_the_rounded_task_mean():
    scale = get_scale("toefl6")
    for tasks, expected in SPEAKING_TABLE:
        got = scale.rubric_to_section(_speaking_rubrics(tasks))
        assert got == expected, f"{tasks} (평균 {sum(tasks) / len(tasks)}) → {got}, 기대 {expected}"


def test_writing_still_goes_through_the_ets_table():
    """규칙을 바꾼 것은 스피킹뿐이다. 라이팅은 0~30 공식 표를 그대로 탄다."""
    scale = get_scale("toefl6")
    assert scale.rubric_to_section(_speaking_rubrics([3.5], "writing")) == 4.5
    assert scale.rubric_to_section(_speaking_rubrics([5, 5], "writing")) == 6.0


def test_speaking_matches_the_js_copies():
    """sg-band.js · scores.html 의 speakingBand() 와 같은 값이라야 세 화면이 같다."""
    scale = get_scale("toefl6")
    for ratio, expected in [(0.0, 1.0), (0.65, 3.5), (0.75, 4.0), (0.85, 4.5), (0.95, 5.0), (1.0, 5.0)]:
        assert scale.speaking_band(ratio) == expected, f"{ratio} → {expected}"


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
