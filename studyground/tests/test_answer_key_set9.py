"""SET 9 정답키 · 팩 레지스트리 · 섹션 합산 — Story 3.4 의 SET 9 확장.

Run:  studyground/.venv/bin/python -m pytest studyground/tests/test_answer_key_set9.py -q

test_autoscore.py 와 같은 결로 쓴다: 순수 함수 검사는 fixture 없이, 채점 배선 검사만
in-memory SQLite 한 개를 세운다(파일도 서버도 건드리지 않는다).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import crud_write  # noqa: E402
from app.models import Attempt, Base, Exam, QuestionResponse, RubricScore, Student  # noqa: E402
from app.scoring import autoscore  # noqa: E402
from app.scoring.answer_key import (  # noqa: E402
    DEFAULT_PACK,
    EMPTY_PACK,
    SET1_PACK,
    SET9_PACK,
    normalize_code,
    pack_for,
)
from app.scoring.answer_key_set9 import (  # noqa: E402
    ANSWER_KEY,
    AUTO_TOTAL_BY_SKILL,
    PRODUCTIVE_KEYS,
    TOTAL_QUESTIONS,
)


# ── 생성물 자체 (실측값) ───────────────────────────────────────────────────


def test_set9_key_counts_match_the_measured_table():
    assert len(ANSWER_KEY) == 107
    assert len(PRODUCTIVE_KEYS) == 13
    assert TOTAL_QUESTIONS == 120
    assert AUTO_TOTAL_BY_SKILL == {"reading": 50, "listening": 47, "writing": 10, "speaking": 0}


def test_set9_productive_split_is_two_essays_and_eleven_speaking_tasks():
    assert SET9_PACK.productive_total_by_skill == {
        "reading": 0, "listening": 0, "writing": 2, "speaking": 11,
    }


def test_every_set9_auto_entry_is_machine_scorable():
    for key, entry in ANSWER_KEY.items():
        assert entry["qtype"] in autoscore.AUTO_QTYPES, key
        assert entry["answer"] is not None, key
        assert autoscore.score(entry["qtype"], entry["answer"], entry["answer"]) == 1.0, key


def test_every_set9_productive_entry_defers_to_a_human():
    for key, entry in PRODUCTIVE_KEYS.items():
        assert entry["qtype"] in autoscore.PRODUCTIVE_QTYPES, key
        assert autoscore.score(entry["qtype"], "anything", entry["answer"]) is None, key


def test_a_perfect_set9_paper_scores_every_auto_question():
    total = sum(autoscore.score(e["qtype"], e["answer"], e["answer"]) for e in ANSWER_KEY.values())
    assert total == 107.0


# ── 생성기가 최신인가 (--check) ────────────────────────────────────────────


def _node(script: str):
    return subprocess.run(
        ["node", str(ROOT / "tools" / script), "--check"],
        capture_output=True, text=True, cwd=str(ROOT),
    )


@pytest.mark.parametrize("script", ["gen_answer_key_set1.js", "gen_answer_key_set9.js"])
def test_generated_key_is_up_to_date(script):
    """set1 은 회귀 검사(무변경), set9 는 최신 여부 검사."""
    proc = _node(script)
    assert proc.returncode == 0, proc.stdout + proc.stderr


# ── 팩 레지스트리 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("code", ["SET9", "set9", "SET 9", " set-9 "])
def test_exam_code_variants_all_reach_the_set9_pack(code):
    assert pack_for(code) is SET9_PACK


@pytest.mark.parametrize("code", ["SET1", "set 1"])
def test_set1_codes_reach_the_set1_pack(code):
    assert pack_for(code) is SET1_PACK


@pytest.mark.parametrize("code", ["", None, "   "])
def test_a_missing_code_keeps_the_legacy_default(code):
    """팩이 하나뿐이던 시절의 응시·레거시 행은 SET 1 로 계속 채점된다."""
    assert pack_for(code) is DEFAULT_PACK is SET1_PACK


@pytest.mark.parametrize("code", ["SET8", "SET 7", "무엇인가"])
def test_an_unknown_code_degrades_to_an_empty_pack_not_to_set1(code):
    """question_key 는 팩끼리 겹친다 — 남의 정답표로 채점하면 점수가 조용히 틀린다."""
    pack = pack_for(code)
    assert pack is EMPTY_PACK
    assert pack.lookup("R1-1") is None
    assert pack.total_questions == 0


def test_normalize_code_strips_spacing_and_case():
    assert normalize_code(" set 9 ") == "SET9"
    assert normalize_code(None) == ""


def test_the_two_packs_disagree_on_a_shared_question_key():
    """이 테스트가 깨지면 '모르는 code → SET 1' 로 되돌려도 안전하다는 뜻이다."""
    assert SET1_PACK.lookup("R1-1") is not None
    assert SET9_PACK.lookup("R1-1") is not None
    assert SET1_PACK.lookup("R1-1")["answer"] != SET9_PACK.lookup("R1-1")["answer"]


# ── 채점 배선 (in-memory SQLite) ──────────────────────────────────────────


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _attempt(db: Session, exam_code: str) -> Attempt:
    student = crud_write.get_or_create_student(db, "T-0001", name="테스트")
    exam = Exam(code=exam_code, title=exam_code)
    db.add(exam)
    db.flush()
    attempt = crud_write.create_attempt(db, student=student, exam=exam)
    db.flush()
    return attempt


def _answer_all(db: Session, attempt: Attempt, pack, *, skills=("reading", "listening", "writing")):
    """해당 스킬의 자동채점 문항을 전부 정답으로 채운다."""
    items = [
        {
            "question_key": key,
            "answer": entry["answer"],
            "qtype": entry["qtype"],
            "skill": entry["skill"],
            "module": entry["module"],
            "no": entry["no"],
        }
        for key, entry in pack.answer_key.items()
        if entry["skill"] in skills
    ]
    crud_write.upsert_answers(db, attempt, items)


def _section(attempt: Attempt, skill: str):
    return next(s for s in attempt.section_scores if s.skill == skill)


def test_set9_attempt_is_graded_by_the_set9_pack(db):
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK)
    result = crud_write.grade_attempt(db, attempt)

    assert result["pack"] == "SET9"
    assert result["graded"] == 107          # writing build 10 포함, 무응답도 채점 대상
    assert _section(attempt, "reading").raw_correct == 50
    assert _section(attempt, "reading").scaled == 30
    assert _section(attempt, "listening").raw_correct == 47


def test_a_set9_attempt_used_to_be_graded_by_nobody(db):
    """SET 1 정답표로는 SET 9 응답이 거의 하나도 맞지 않는다 — 팩 선택이 필요한 이유."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("listening",))
    crud_write.grade_attempt(db, attempt)
    by_set1 = sum(
        1
        for row in attempt.question_responses
        if (SET1_PACK.lookup(row.question_key) or {}).get("answer") == row.student_answer
    )
    assert by_set1 < _section(attempt, "listening").raw_correct


def test_writing_is_pending_not_thirty_when_the_essays_have_no_rubric(db):
    """문제 B — build 10문항 만점만으로 Writing 30/30 이 되면 안 된다."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    result = crud_write.grade_attempt(db, attempt)

    writing = _section(attempt, "writing")
    assert writing.raw_correct == 10        # build 10문항은 실제로 다 맞았고
    assert writing.raw_total == 12          # 분모에는 에세이 2편도 들어간다
    assert writing.scaled == 0              # 아직 산출된 /30 점수는 없다(0점 확정이 아님)
    assert "writing" in result["pending_sections"]
    assert "speaking" in result["pending_sections"]
    assert attempt.status == "scoring"      # AC8 — 루브릭 전에는 완료가 아니다


def test_writing_folds_the_rubric_in_by_question_count_once_it_lands(db):
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    crud_write.grade_attempt(db, attempt)

    for criterion in ("Task Fulfilment", "Organization & Development", "Language Use", "Vocabulary"):
        db.add(RubricScore(
            attempt_id=attempt.id, skill="writing", criterion=criterion, score=5.0, max_score=5.0,
        ))
    db.flush()
    db.refresh(attempt)
    result = crud_write.grade_attempt(db, attempt)

    writing = _section(attempt, "writing")
    assert writing.raw_correct == pytest.approx(12.0)   # 자동 10 + 에세이 환산 2
    assert writing.raw_total == 12
    assert writing.scaled == 30
    assert "writing" not in result["pending_sections"]


def test_a_half_rubric_lands_between_the_two_ends(db):
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    for criterion in ("Task Fulfilment", "Organization & Development", "Language Use", "Vocabulary"):
        db.add(RubricScore(
            attempt_id=attempt.id, skill="writing", criterion=criterion, score=2.5, max_score=5.0,
        ))
    db.flush()
    db.refresh(attempt)
    crud_write.grade_attempt(db, attempt)

    writing = _section(attempt, "writing")
    assert 10.0 < writing.raw_correct < 12.0
    assert 0 < writing.scaled < 30


def test_speaking_is_the_rubric_alone(db):
    attempt = _attempt(db, "SET 9")
    db.add(QuestionResponse(
        attempt_id=attempt.id, question_key="set9-S1-q01", skill="speaking", no=1,
        qtype="SPEAKING", student_answer="", audio_ref="blob://x",
    ))
    db.flush()
    db.refresh(attempt)
    result = crud_write.grade_attempt(db, attempt)
    speaking = _section(attempt, "speaking")
    assert speaking.raw_total == 11          # 자동채점 0, 산출형 11
    assert speaking.scaled == 0
    assert "speaking" in result["pending_sections"]

    for criterion in ("Delivery", "Language Use", "Topic Development"):
        db.add(RubricScore(
            attempt_id=attempt.id, skill="speaking", criterion=criterion, score=4.0, max_score=4.0,
        ))
    db.flush()
    db.refresh(attempt)
    crud_write.grade_attempt(db, attempt)
    assert _section(attempt, "speaking").scaled == 30


def test_an_unknown_exam_code_keeps_the_answers_and_scores_nothing(db):
    attempt = _attempt(db, "SET 8")
    crud_write.upsert_answers(db, attempt, [
        {"question_key": "R1-1", "answer": "populations", "qtype": "CLOZE", "skill": "reading",
         "module": "R1", "no": 1},
    ])
    result = crud_write.grade_attempt(db, attempt)

    assert result["pack"] == ""
    assert result["graded"] == 0
    assert len(attempt.question_responses) == 1          # 답안은 그대로 남는다
    assert attempt.question_responses[0].student_answer == "populations"
    assert attempt.question_responses[0].auto_score is None
    assert _section(attempt, "reading").scaled == 0


def test_set1_attempt_still_grades_exactly_as_before(db):
    """SET 1 의 문항 채점은 한 톨도 바뀌지 않는다(섹션 합산만 루브릭을 기다린다)."""
    attempt = _attempt(db, "SET1")
    _answer_all(db, attempt, SET1_PACK)          # reading + listening + writing build
    result = crud_write.grade_attempt(db, attempt)

    assert result["pack"] == "SET1"
    assert result["graded"] == 78
    assert _section(attempt, "reading").raw_correct == 35
    assert _section(attempt, "reading").raw_total == 35
    assert _section(attempt, "reading").scaled == 30
    assert _section(attempt, "listening").raw_correct == 33
    assert _section(attempt, "listening").scaled == 30
    assert attempt.total_questions == 91
    # 바뀌는 것은 섹션 합산뿐이다: SET 1 Writing 도 에세이 2편의 루브릭을 기다린다.
    assert _section(attempt, "writing").raw_correct == 10
    assert _section(attempt, "writing").raw_total == 12
    assert result["pending_sections"] == ["writing", "speaking"]
