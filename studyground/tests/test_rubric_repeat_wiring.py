"""복창 채점이 **런타임에 실제로 닿는지** 확인한다.

test_rubric_speaking.py 는 rubric.draft(task_kind='repeat', reference=...) 를 직접
불러 계산이 맞는지 본다. 여기서 보는 것은 그 앞단이다 — 아무도 그 인자를 넘겨 주지
않으면 계산이 아무리 옳아도 실제 응시는 옛 경로(길이 감점)로 채점된다. 그래서

  (1) 정답키에 task_kind / reference 가 실려 있는가 (생성물 검사)
  (2) nodes.rubric_offline / rubric_online 이 그 값을 꺼내 복창 경로로 보내는가
  (3) 원문을 못 찾은 복창은 degrade 하고 죽지 않는가

를 각각 못 박는다. DB 없이 돈다 — AttemptDetail 대신 필요한 속성만 가진 더미를 쓴다
(nodes 는 detail 에서 exam.code 와 question_responses 만 읽는다).

실행: studyground/.venv/bin/python -m pytest studyground/tests/test_rubric_repeat_wiring.py -q
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.scoring import answer_key_set1, answer_key_set9, nodes, rubric  # noqa: E402
from app.scoring.scale import TOEFL  # noqa: E402

# ETS 공식 가이드 기준 TOEFL speaking 은 0–5 다(구 iBT 의 0–4 아님).
FLOOR = 1.0    # rubric._FLOOR[5.0]  (TOEFL speaking)
CEILING = 4.0  # rubric._CEILING[5.0]
CENTRE = 3.0   # rubric._CENTRE[5.0]
OFFICIAL = rubric.OFFICIAL_CRITERION   # 공식 총체 밴드 행 — 섹션 점수는 이 행만 먹는다


# ── (1) 생성물: 정답키에 실린 값 ───────────────────────────────────────────────
def test_set9_repeat_rows_carry_the_script_line():
    repeats = {
        key: row for key, row in answer_key_set9.PRODUCTIVE_KEYS.items()
        if row["task_kind"] == "repeat"
    }
    assert len(repeats) == 7                      # S1 은 복창 7문항(실측)
    for key, row in repeats.items():
        assert row["reference"], f"{key}: 복창인데 원문이 없다"
        assert len(row["reference"].split()) >= 5  # 한 문장짜리 대본


def test_set9_non_repeat_rows_have_no_reference():
    """에세이·인터뷰에는 '정답 원문'이라는 것이 없다. None 이어야 한다."""
    for key, row in answer_key_set9.PRODUCTIVE_KEYS.items():
        if row["task_kind"] != "repeat":
            assert row["reference"] is None, key
    kinds = {row["task_kind"] for row in answer_key_set9.PRODUCTIVE_KEYS.values()}
    assert kinds == {"repeat", "interview", "email", "discussion"}


def test_set9_reference_matches_the_speaking_script_fragment():
    """원문의 출처는 오디오 대본 하나뿐 — 여기서 지어낸 값이 아님을 확인한다."""
    import json

    lines = json.loads(
        (ROOT / "sg2" / "config" / "_set9_fragments" / "speaking_script.json")
        .read_text(encoding="utf-8")
    )["lines"]
    script = {line["id"]: line["text"].strip() for line in lines}
    for key, row in answer_key_set9.PRODUCTIVE_KEYS.items():
        if row["task_kind"] == "repeat":
            assert row["reference"] == script[key]


def test_set1_carries_task_kind_but_no_invented_reference():
    """SET 1 에는 대본 파일이 없다 — reference 를 지어내지 말고 None 으로 둔다."""
    for key, row in answer_key_set1.PRODUCTIVE_KEYS.items():
        assert row["task_kind"], key
        assert row["reference"] is None, key
    repeats = [r for r in answer_key_set1.PRODUCTIVE_KEYS.values() if r["task_kind"] == "repeat"]
    assert len(repeats) == 7


@pytest.mark.parametrize("script", ["gen_answer_key_set9.js", "gen_answer_key_set1.js"])
def test_generator_output_is_up_to_date(script):
    """생성물은 손으로 고치지 않는다 — --check 가 그 규약의 감시자다."""
    proc = subprocess.run(
        ["node", str(ROOT / "tools" / script), "--check"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


# ── 더미 detail ───────────────────────────────────────────────────────────────
class _Exam:
    def __init__(self, code):
        self.code = code


class _QR(dict):
    """nodes.autoscore 는 속성으로, 이후 노드는 dict 로 읽는다 — 둘 다 되게 한다."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:  # pragma: no cover - 실수 방지용
            raise AttributeError(name) from exc


class _Detail:
    def __init__(self, code, responses):
        self.exam = _Exam(code)
        self.question_responses = responses
        self.section_scores = []
        self.rubric_scores = []


def _speaking(key, answer, no=1):
    return _QR(
        no=no, question_key=key, skill="speaking", module="S1", qtype="SPEAKING",
        prompt="", student_answer=answer, correct_answer="", max_score=1,
        feedback="", audio_ref="", auto_score=None,
    )


def _state(code, responses):
    detail = _Detail(code, responses)
    state = {"detail": detail, "lang": "en", "scale": TOEFL}
    state.update(nodes.autoscore(state))
    return state


REF_Q01 = answer_key_set9.PRODUCTIVE_KEYS["set9-S1-q01"]["reference"]
REF_Q05 = answer_key_set9.PRODUCTIVE_KEYS["set9-S1-q05"]["reference"]


def _rows_for(state, key):
    return [r for r in nodes.rubric_offline(state)["rubrics"] if r.get("question_key") == key]


# ── (2) 배선: rubric_offline 이 복창 경로를 타는가 ─────────────────────────────
def test_offline_scores_a_perfect_repetition_high_not_at_the_floor():
    state = _state("SET 9", [_speaking("set9-S1-q01", REF_Q01)])
    rows = _rows_for(state, "set9-S1-q01")
    assert [r["criterion"] for r in rows] == ["Repetition Accuracy", "Completeness", OFFICIAL]
    assert min(r["score"] for r in rows) == CEILING   # 완벽 복창 → 초안 실링
    assert max(r["score"] for r in rows) <= CEILING   # 초안은 만점을 주지 않는다


def test_offline_beats_the_old_length_path_for_the_same_answer():
    """회귀 방지 — 배선이 끊기면 이 값이 다시 플로어로 내려앉는다."""
    old = max(r["score"] for r in rubric.draft("speaking", REF_Q01))
    state = _state("SET 9", [_speaking("set9-S1-q01", REF_Q01)])
    new = min(r["score"] for r in _rows_for(state, "set9-S1-q01"))
    assert old <= 2.5 < new


def test_offline_grades_each_repeat_against_its_own_reference():
    """q01 자리에 q05 원문을 말하면 낮게 나와야 한다 — 문항별 대조라는 증거."""
    state = _state("SET 9", [
        _speaking("set9-S1-q01", REF_Q01, no=1),
        _speaking("set9-S1-q05", REF_Q01, no=5),   # 엉뚱한 문장을 말했다
    ])
    right = min(r["score"] for r in _rows_for(state, "set9-S1-q01"))
    wrong = max(r["score"] for r in _rows_for(state, "set9-S1-q05"))
    assert wrong < right


def test_offline_leaves_interviews_on_the_free_speech_path():
    """복창만 떼어 낸다 — S2 인터뷰는 예전처럼 skill 단위 합본으로 채점된다."""
    state = _state("SET 9", [
        _speaking("set9-S1-q01", REF_Q01, no=1),
        _QR(no=8, question_key="set9-S2-q01", skill="speaking", module="S2",
            qtype="SPEAKING", prompt="", student_answer="I exercise every morning.",
            correct_answer="", max_score=1, feedback="", audio_ref="", auto_score=None),
    ])
    rows = nodes.rubric_offline(state)["rubrics"]
    free = [r for r in rows if not r.get("question_key")]
    assert [r["criterion"] for r in free] == [*rubric.CRITERIA[(TOEFL, "speaking")], OFFICIAL]


def test_offline_blank_repeat_is_zero_not_a_crash():
    state = _state("SET 9", [_speaking("set9-S1-q01", "")])
    assert [r["score"] for r in _rows_for(state, "set9-S1-q01")] == [0.0, 0.0, 0.0]


# ── (3) degrade: 원문을 모를 때 ────────────────────────────────────────────────
def test_repeat_without_a_reference_degrades_to_the_centre():
    """SET 1 은 대본이 없다 — 그래도 죽지 않고, 플로어도 아니다(교사에게 넘기는 신호)."""
    row = _QR(no=1, question_key="S-1", skill="speaking", module="S1", qtype="SPEAKING",
              prompt="", student_answer="The library closes at nine tonight.",
              correct_answer="", max_score=1, feedback="", audio_ref="", auto_score=None)
    state = _state("SET 1", [row])
    rows = _rows_for(state, "S-1")
    assert [r["score"] for r in rows] == [CENTRE, CENTRE, CENTRE]
    assert all("Reference sentence unavailable" in r["comment"] for r in rows)


def test_unknown_exam_code_does_not_raise():
    """모르는 팩이면 복창인지 알 길이 없다 — 옛 경로로 조용히 되돌아간다."""
    state = _state("SET 42", [_speaking("set9-S1-q01", REF_Q01)])
    rows = nodes.rubric_offline(state)["rubrics"]
    assert rows and all(not r.get("question_key") for r in rows)


def test_online_sends_repeat_to_the_deterministic_path(monkeypatch):
    """LLM 경로에서도 복창은 offline 대조로 간다 — llm 은 인터뷰만 받는다."""
    seen = []

    def fake_generate_rubric(skill, text, **kw):
        seen.append(text)
        return [{"skill": skill, "criterion": "Delivery", "score": 3.0,
                 "max_score": 5.0, "band": None, "comment": "llm"}]

    monkeypatch.setattr(nodes.llm, "generate_rubric", fake_generate_rubric)
    state = _state("SET 9", [
        _speaking("set9-S1-q01", REF_Q01, no=1),
        _QR(no=8, question_key="set9-S2-q01", skill="speaking", module="S2",
            qtype="SPEAKING", prompt="", student_answer="I exercise every morning.",
            correct_answer="", max_score=1, feedback="", audio_ref="", auto_score=None),
    ])
    rows = nodes.rubric_online(state)["rubrics"]
    assert seen == ["I exercise every morning."]          # 복창은 LLM 에 가지 않았다
    repeat_rows = [r for r in rows if r.get("question_key") == "set9-S1-q01"]
    assert [r["criterion"] for r in repeat_rows] == ["Repetition Accuracy", "Completeness", OFFICIAL]


def test_online_repeat_survives_an_llm_failure():
    """LLM 이 터져도 복창 행은 이미 결정적으로 나와 있다."""
    def boom(*a, **kw):
        raise RuntimeError("no key")

    original = nodes.llm.generate_rubric
    nodes.llm.generate_rubric = boom
    try:
        state = _state("SET 9", [
            _speaking("set9-S1-q01", REF_Q01, no=1),
            _QR(no=8, question_key="set9-S2-q01", skill="speaking", module="S2",
                qtype="SPEAKING", prompt="", student_answer="I exercise every morning.",
                correct_answer="", max_score=1, feedback="", audio_ref="", auto_score=None),
        ])
        out = nodes.rubric_online(state)
    finally:
        nodes.llm.generate_rubric = original
    assert out["fell_back"] is True
    repeat_rows = [r for r in out["rubrics"] if r.get("question_key") == "set9-S1-q01"]
    assert min(r["score"] for r in repeat_rows) == CEILING


# ── 계약: 여러 벌의 루브릭 행이 섹션 점수로 잘 접히는가 ────────────────────────
def test_many_repeat_rows_fold_into_one_section_score():
    """scale.rubric_to_section 은 sum(score)/sum(max) 라 문항 수가 늘어도 비율이 유지된다."""
    responses = [
        _speaking(f"set9-S1-q0{i}", answer_key_set9.PRODUCTIVE_KEYS[f"set9-S1-q0{i}"]["reference"], no=i)
        for i in range(1, 8)
    ]
    state = _state("SET 9", responses)
    state.update(nodes.rubric_offline(state))
    out = nodes.scale(state)["scaled"]
    # 완벽 복창 14행(7문항 × 2축)이 모두 4.0/5.0 → 0.8 × 30 = 24.0.
    assert out["sections"]["speaking"] == 24.0
