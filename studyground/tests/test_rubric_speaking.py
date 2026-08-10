"""SET 9 Speaking — 복창(S1) 과 자유 발화(S2) 는 다른 축으로 재야 한다.

왜 이 테스트가 있는가. S1 "Listen and Repeat" 의 정답은 8~14 단어짜리 한 문장이다
(sg2/config/_set9_fragments/speaking_script.json 의 lines[], 예: set9-S1-q01
"Is this your first time in our cafeteria?" = 8단어). 그런데 rubric.draft 의
DEFAULT_MIN_WORDS['speaking'] 은 60 이라, 완벽하게 따라 말해도 길이 감점이 두 번
걸려 세 축 모두 플로어가 나왔다. 점수가 낮은 게 아니라 재는 자가 틀린 것이다.

여기서 지키는 계약(기존 모듈 계약 그대로):
  · 절대 raise 하지 않는다      · 같은 입력 → 같은 출력   · 네트워크 없음
  · 완벽한 복창이라도 _CEILING(TOEFL speaking 3.0/4.0) 을 넘지 않는다 — 초안이므로.

모듈은 순수 함수라 DB/앱/픽스처가 없다 (tests/test_autoscore.py 와 같은 방식).
실행: studyground/.venv/bin/python -m pytest studyground/tests/test_rubric_speaking.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.scoring import rubric  # noqa: E402
from app.scoring.scale import IELTS, TOEFL  # noqa: E402

# speaking_script.json 에서 그대로 가져온 S1 원문 (set9-S1-q01 / q05 / q07).
REF_Q01 = "Is this your first time in our cafeteria?"
REF_Q05 = "You can pay with cash or your student ID card."
REF_Q07 = "If you have any food allergies, please let the staff know before ordering."

TOEFL_SPEAKING_MAX = 4.0
FLOOR = 1.0    # rubric._FLOOR[4.0]
CEILING = 3.0  # rubric._CEILING[4.0]


def _scores(rows: list[dict]) -> list[float]:
    return [r["score"] for r in rows]


def _repeat(text: str, reference: str = REF_Q01, **kw) -> list[dict]:
    return rubric.draft("speaking", text, task_kind="repeat", reference=reference, **kw)


# ── 원래 버그: 길이 축으로 재면 완벽한 복창이 플로어를 받는다 ──────────────────


def test_the_bug_perfect_repetition_hits_the_floor_on_the_length_path():
    """근거 기록용. task_kind 없이 재면 8단어 정답이 min 60 에 걸려 바닥을 친다."""
    rows = rubric.draft("speaking", REF_Q01)
    assert max(_scores(rows)) <= 1.5


def test_perfect_repetition_is_well_above_the_length_path_score():
    old = max(_scores(rubric.draft("speaking", REF_Q01)))
    new = min(_scores(_repeat(REF_Q01)))
    assert new > old
    assert new > FLOOR


@pytest.mark.parametrize("reference", [REF_Q01, REF_Q05, REF_Q07])
def test_perfect_repetition_scores_at_the_ceiling_but_never_full_marks(reference):
    rows = _repeat(reference, reference=reference)
    assert _scores(rows) == [CEILING, CEILING]
    assert all(r["max_score"] == TOEFL_SPEAKING_MAX for r in rows)
    assert all(r["score"] < r["max_score"] for r in rows)  # 초안은 만점 근처로 가지 않는다


@pytest.mark.parametrize(
    "said",
    [
        "is this your first time in our cafeteria",   # 구두점 없음(전사기 출력)
        "IS THIS YOUR FIRST TIME IN OUR CAFETERIA?",  # 대문자
        "  Is  this your   first time in our cafeteria? ",  # 공백 난입
    ],
)
def test_normalisation_matches_autoscore_philosophy(said):
    """대소문자·공백은 무시한다(autoscore.normalize_text 와 같은 철학).

    구두점은 원문·전사 양쪽에서 똑같이 떨어뜨린다 — 전사기는 물음표를 거의 찍지 않으므로
    한쪽만 떨어뜨리면 잘 따라 말한 답이 구두점 때문에 깎인다.
    """
    assert _scores(_repeat(said)) == [CEILING, CEILING]


# ── 부분 복창 / 무관한 발화 ────────────────────────────────────────────────────


def test_partial_repetition_lands_between_the_floor_and_the_ceiling():
    """앞 5단어만 맞고 뒤가 통째로 빠짐 → 중간대."""
    rows = _repeat("Is this your first time here")
    for value in _scores(rows):
        assert FLOOR < value < CEILING


def test_a_couple_of_wrong_words_costs_something_but_not_everything():
    said = "Is that your first time in the cafeteria?"  # this→that, our→the
    rows = _repeat(said)
    assert FLOOR < min(_scores(rows)) < CEILING
    assert min(_scores(rows)) >= 2.0  # 대부분 맞았으므로 중간 이상


def test_more_errors_never_score_higher_than_fewer_errors():
    good = min(_scores(_repeat("Is this your first time in our cafeteria?")))
    ok = min(_scores(_repeat("Is this your first time in the cafeteria?")))
    poor = min(_scores(_repeat("Is this the first?")))
    assert good >= ok >= poor


def test_an_unrelated_utterance_scores_low():
    rows = _repeat("I usually go swimming on weekends because it helps me relax")
    assert _scores(rows) == [FLOOR, FLOOR]


def test_word_order_matters():
    """정렬 기반 일치율이므로 같은 단어를 뒤섞으면 떨어진다."""
    shuffled = "cafeteria our in time first your this is"
    assert min(_scores(_repeat(shuffled))) < CEILING


# ── 빈 답안 / 원문 없음 ────────────────────────────────────────────────────────


@pytest.mark.parametrize("blank", [None, "", "   ", "\n\t"])
def test_blank_is_the_floor_and_never_raises(blank):
    rows = _repeat(blank)
    assert _scores(rows) == [0.0, 0.0]
    assert all("No response recorded" in r["comment"] for r in rows)


@pytest.mark.parametrize("missing", [None, "", "   "])
def test_missing_reference_degrades_to_the_neutral_centre(missing):
    """원문을 모르면 대조 근거가 없다 → 감점도 가점도 없이 중앙값, comment 로 신호."""
    rows = _repeat(REF_Q01, reference=missing)
    assert _scores(rows) == [2.0, 2.0]  # rubric._CENTRE[4.0]
    assert all("Reference sentence unavailable" in r["comment"] for r in rows)


def test_missing_reference_still_floors_a_blank_answer():
    """답이 없는 것과 근거가 없는 것은 다르다."""
    assert _scores(_repeat("", reference="")) == [0.0, 0.0]


# ── 축 이름 / 행 모양 ──────────────────────────────────────────────────────────


def test_repeat_uses_its_own_criteria_not_the_free_speech_axes():
    names = [r["criterion"] for r in _repeat(REF_Q01)]
    assert names == ["Repetition Accuracy", "Completeness"]
    assert "Delivery" not in names and "Topic Development" not in names


def test_row_shape_is_unchanged_so_downstream_keeps_working():
    row = _repeat(REF_Q01)[0]
    assert set(row) == {
        "skill", "criterion", "score", "max_score", "band", "comment", "source", "origin", "metrics",
    }
    assert row["skill"] == "speaking"
    assert row["source"] == rubric.DRAFT_SOURCE
    assert row["origin"] == "offline"
    assert row["band"] is None  # TOEFL 은 밴드가 없다


def test_ielts_repeat_rows_carry_a_band_and_stay_under_its_ceiling():
    rows = _repeat(REF_Q01, scale_key=IELTS)
    for row in rows:
        assert row["max_score"] == 9.0
        assert row["band"] == row["score"]
        assert row["score"] <= 6.5  # rubric._CEILING[9.0]


def test_comment_always_says_a_teacher_must_review():
    for lang, needle in (("en", "teacher review required"), ("ko", "교사 검수 필요")):
        for row in _repeat("Is this your first time here", lang=lang):
            assert needle in row["comment"]


def test_metrics_expose_the_comparison_numbers():
    m = _repeat("Is this your first time here")[0]["metrics"]
    assert m["task_kind"] == "repeat"
    assert m["reference_available"] is True
    assert m["reference_word_count"] == 8
    # "is this your first time" 5개가 살고 "here" 는 원문에 없다.
    assert m["matched_words"] == 5
    assert 0.0 < m["coverage"] < 1.0
    assert 0.0 < m["similarity"] < 1.0


# ── 결정성 ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("said", [REF_Q01, "Is this your first time here", "", "totally unrelated"])
def test_same_input_gives_a_byte_identical_result_twice(said):
    assert _repeat(said) == _repeat(said)


# ── 하위호환 회귀: task_kind 미지정이면 아무것도 달라지지 않는다 ────────────────


LEGACY_TEXTS = [
    "",
    "I think exercise is important.",
    " ".join(["Running keeps me healthy because it clears my head."] * 12),
    REF_Q07,
]


@pytest.mark.parametrize("text", LEGACY_TEXTS)
@pytest.mark.parametrize("skill", ["speaking", "writing"])
@pytest.mark.parametrize("scale_key", [TOEFL, IELTS])
def test_default_call_is_unchanged_by_the_new_parameters(text, skill, scale_key):
    baseline = rubric.draft(skill, text, scale_key=scale_key)
    assert rubric.draft(skill, text, scale_key=scale_key, task_kind="", reference="") == baseline
    # reference 를 줘도 task_kind 가 없으면 길이 경로 그대로다.
    assert rubric.draft(skill, text, scale_key=scale_key, reference=REF_Q01) == baseline


def test_free_speech_interview_still_uses_the_length_axes():
    """S2 Interview(kind:"interview", 45초 자유 발화)는 기존 루브릭이 맞다."""
    text = " ".join(["I usually go running in the morning because it wakes me up."] * 8)
    rows = rubric.draft("speaking", text, task_kind="interview")
    assert [r["criterion"] for r in rows] == ["Delivery", "Language Use", "Topic Development"]
    assert rows == rubric.draft("speaking", text)


@pytest.mark.parametrize("skill", ["writing", "listening", ""])
def test_repeat_kind_only_applies_to_speaking(skill):
    """task_kind 는 speaking 에서만 의미가 있다 — 오배선돼도 축이 바뀌지 않는다."""
    rows = rubric.draft(skill, REF_Q01, task_kind="repeat", reference=REF_Q01)
    assert "Repetition Accuracy" not in [r["criterion"] for r in rows]


@pytest.mark.parametrize("kind", ["repeat", "REPEAT", " Listen and Repeat ", "listen_and_repeat"])
def test_repeat_kind_spelling_is_forgiving(kind):
    assert rubric.is_repeat_task(kind) is True


@pytest.mark.parametrize("kind", ["", None, "interview", "monologue"])
def test_non_repeat_kinds_are_not_mistaken_for_repeat(kind):
    assert rubric.is_repeat_task(kind) is False


# ── 절대 raise 하지 않는다 ─────────────────────────────────────────────────────


@pytest.mark.parametrize("text", [None, 0, 3.5, [], {}, True])
@pytest.mark.parametrize("reference", [None, REF_Q01, 0, []])
def test_junk_input_never_raises(text, reference):
    rows = rubric.draft("speaking", text, task_kind="repeat", reference=reference)
    assert len(rows) == 2
    for row in rows:
        assert 0.0 <= row["score"] <= CEILING
