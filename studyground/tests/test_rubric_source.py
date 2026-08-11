"""상태를 셋으로 가른 뒤의 채점 배선 — 채점 불가 / 잠정 / 확정.

Run:  studyground/.venv/bin/python -m pytest studyground/tests/test_rubric_source.py -q

test_autoscore.py 와 같은 결로 쓴다: 순수 값 검사는 fixture 없이, 배선 검사만
in-memory SQLite 한 개를 세운다(파일도 서버도 건드리지 않는다).

여기서 고정하는 계약은 세 가지다.
  S1  모르는 exam code(EMPTY_PACK) → 섹션 점수를 한 줄도 쓰지 않고 status='scoring'.
      0점 확정(총점 0 · grade A1 · completed)이 아니다.
  S2  루브릭 행은 (attempt_id, skill, criterion) 으로 upsert 되고,
      source='teacher' 행은 AI 초안이 절대 덮지 않는다.
  S3  점수 산출 ≠ 완료. completed 는 산출형이 있는 섹션마다 교사 확정 루브릭이
      있을 때만이고, 그 전에는 점수가 나와도 provisional 이다.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import crud_write, migrations  # noqa: E402
from app.models import (  # noqa: E402
    RUBRIC_SOURCE_DRAFT,
    RUBRIC_SOURCE_TEACHER,
    Attempt,
    Base,
    Exam,
    QuestionResponse,
    RubricScore,
    normalize_rubric_source,
)
from app.scoring import rubric as rubric_mod  # noqa: E402
from app.scoring.answer_key import SET1_PACK, SET9_PACK  # noqa: E402

# SET 9 TOEFL 루브릭의 축 이름 — rubric.CRITERIA 의 값을 그대로 쓴다.
WRITING_CRITERIA = ("Task Fulfilment", "Organization & Development", "Language Use", "Vocabulary")
SPEAKING_CRITERIA = ("Delivery", "Language Use", "Topic Development")


# ── 상수의 정본 (순환 import 때문에 문자열을 두 번 적었다) ──────────────────


def test_models_and_rubric_agree_on_the_draft_source():
    """models.py 는 scoring 을 import 할 수 없다(rubric → scale → models 순환).

    그래서 'ai_draft' 문자열이 두 곳에 있다. 어긋나면 교사 확정본이 초안으로
    읽히거나 그 반대가 되므로, 여기서 두 값을 묶어 둔다.
    """
    assert RUBRIC_SOURCE_DRAFT == rubric_mod.DRAFT_SOURCE == "ai_draft"


@pytest.mark.parametrize("value", ["teacher", "manual", "human", "TEACHER", " Manual "])
def test_teacher_aliases_are_not_demoted_to_a_draft(value):
    """nodes._apply_teacher_rubrics 는 교사 행에 source='manual' 을 붙인다."""
    assert normalize_rubric_source(value) == RUBRIC_SOURCE_TEACHER


@pytest.mark.parametrize("value", ["", None, "ai_draft", "llm", "무엇인가"])
def test_an_unknown_source_is_a_draft(value):
    """확정은 명시적으로만 얻는다 — 모르는 값을 확정으로 승격시키지 않는다."""
    assert normalize_rubric_source(value) == RUBRIC_SOURCE_DRAFT


# ── 배선 (in-memory SQLite) ───────────────────────────────────────────────


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


def _rows(skill: str, criteria, score: float, source: str) -> list[dict]:
    return [
        {"skill": skill, "criterion": c, "score": score, "max_score": 5.0,
         "comment": "", "band": None, "source": source}
        for c in criteria
    ]


def _section(attempt: Attempt, skill: str):
    return next((s for s in attempt.section_scores if s.skill == skill), None)


# ── S1 — 채점 불가 ≠ 0점 ──────────────────────────────────────────────────


@pytest.mark.parametrize("code", ["SET 8", "SET 7", "무엇인가"])
def test_an_ungradable_attempt_is_not_a_zero(db, code):
    """app/seed.py 가 등록하는 SET 8 · SET 7 이 정확히 이 경로를 탄다."""
    attempt = _attempt(db, code)
    crud_write.upsert_answers(db, attempt, [
        {"question_key": "R1-1", "answer": "populations", "qtype": "CLOZE",
         "skill": "reading", "module": "R1", "no": 1},
    ])
    attempt.submitted_at = crud_write.utcnow()
    result = crud_write.grade_attempt(db, attempt)

    assert result["gradable"] is False
    assert result["reason"] == "pack_unknown"
    assert result["sections_written"] is False
    assert attempt.status == "scoring"          # completed 로 확정되지 않는다
    assert attempt.section_scores == []         # 0/0 짜리 섹션 행도 만들지 않는다
    assert attempt.grade == ""                  # A1 이라는 판정 자체가 없다
    assert attempt.question_responses[0].student_answer == "populations"


# ── S3 — 점수 산출 ≠ 완료 확정 ────────────────────────────────────────────


def test_no_rubric_yields_a_provisional_score_not_a_frozen_zero(db):
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    result = crud_write.grade_attempt(db, attempt)

    writing = _section(attempt, "writing")
    assert writing.provisional is True
    assert 0 < writing.scaled < 30              # 에세이를 0 으로 본 하한 — 확정이 아니다
    assert attempt.status == "scoring"
    assert result["awaiting_teacher"] == ["writing", "speaking"]


def test_an_ai_draft_scores_the_section_but_never_completes_the_attempt(db):
    """이게 이 스토리의 핵심이다 — 초안은 점수를 만들 뿐 시험을 끝내지 못한다."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_DRAFT)
    )
    result = crud_write.grade_attempt(db, attempt)

    writing = _section(attempt, "writing")
    assert writing.scaled == 30                 # 점수는 산출된다
    assert writing.provisional is True          # 그러나 잠정이다
    assert "writing" not in result["pending_sections"]
    assert "writing" in result["awaiting_teacher"]
    assert attempt.status == "scoring"


def test_a_teacher_rubric_on_every_productive_section_completes_the_attempt(db):
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("reading", "listening", "writing"))
    crud_write.upsert_rubric_rows(
        db, attempt,
        _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_TEACHER)
        + _rows("speaking", SPEAKING_CRITERIA, 4.0, RUBRIC_SOURCE_TEACHER),
    )
    result = crud_write.grade_attempt(db, attempt)

    assert result["awaiting_teacher"] == []
    assert attempt.status == "completed"
    assert _section(attempt, "writing").provisional is False
    assert _section(attempt, "speaking").provisional is False


def test_one_confirmed_section_is_not_enough(db):
    """Writing 만 확정하고 Speaking 을 남겨 두면 아직 완료가 아니다."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_TEACHER)
    )
    result = crud_write.grade_attempt(db, attempt)

    assert result["awaiting_teacher"] == ["speaking"]
    assert attempt.status == "scoring"
    assert _section(attempt, "writing").provisional is False
    assert _section(attempt, "speaking").provisional is True


def test_a_productive_response_the_pack_does_not_know_still_needs_a_teacher(db):
    """팩에 산출형이 없어도 실제 산출형 응답이 있으면 사람이 확인해야 한다."""
    attempt = _attempt(db, "SET1")
    db.add(QuestionResponse(
        attempt_id=attempt.id, question_key="X-1", skill="speaking", no=1,
        qtype="SPEAKING", student_answer="", audio_ref="blob://x",
    ))
    db.flush()
    db.refresh(attempt)
    result = crud_write.grade_attempt(db, attempt)
    assert "speaking" in result["awaiting_teacher"]


# ── S2 — 루브릭 upsert 는 교사 확정본을 지킨다 ────────────────────────────


def test_upsert_is_keyed_by_skill_and_criterion(db):
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(db, attempt, _rows("writing", WRITING_CRITERIA, 2.0, RUBRIC_SOURCE_DRAFT))
    crud_write.upsert_rubric_rows(db, attempt, _rows("writing", WRITING_CRITERIA, 3.0, RUBRIC_SOURCE_DRAFT))

    assert len(attempt.rubric_scores) == len(WRITING_CRITERIA)   # 중복 행이 생기지 않는다
    assert {r.score for r in attempt.rubric_scores} == {3.0}     # 초안은 초안을 덮는다


def test_an_ai_draft_never_overwrites_a_teacher_row(db):
    """이 함수의 존재 이유 — 교사 확정본이 다음 리포트 요청에 지워지면 안 된다."""
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_TEACHER)
    )
    saved = crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 1.0, RUBRIC_SOURCE_DRAFT)
    )

    assert saved["written"] == 0
    assert saved["kept_teacher"] == len(WRITING_CRITERIA)
    for row in attempt.rubric_scores:
        assert row.score == 5.0
        assert row.source == RUBRIC_SOURCE_TEACHER


def test_a_teacher_row_may_replace_another_teacher_row(db):
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_TEACHER)
    )
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 3.5, RUBRIC_SOURCE_TEACHER)
    )
    assert {r.score for r in attempt.rubric_scores} == {3.5}


def test_a_teacher_row_upgrades_an_existing_draft(db):
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(db, attempt, _rows("writing", WRITING_CRITERIA, 2.0, RUBRIC_SOURCE_DRAFT))
    crud_write.upsert_rubric_rows(db, attempt, _rows("writing", WRITING_CRITERIA, 4.0, RUBRIC_SOURCE_TEACHER))

    assert len(attempt.rubric_scores) == len(WRITING_CRITERIA)
    assert crud_write.teacher_confirmed_skills(attempt) == {"writing"}


@pytest.mark.parametrize("row", [
    {"skill": "", "criterion": "Vocabulary"},
    {"skill": "writing", "criterion": ""},
    {},
])
def test_a_row_without_a_key_is_skipped_not_stored(db, row):
    attempt = _attempt(db, "SET 9")
    saved = crud_write.upsert_rubric_rows(db, attempt, [row])
    assert saved == {"written": 0, "kept_teacher": 0, "skipped": 1}
    assert attempt.rubric_scores == []


def test_a_stored_row_defaults_to_a_draft(db):
    """source 를 주지 않고 만든 행(seed.py 를 포함한 기존 코드)은 초안이다."""
    attempt = _attempt(db, "SET 9")
    db.add(RubricScore(attempt_id=attempt.id, skill="writing", criterion="Vocabulary", score=4.0))
    db.flush()
    db.refresh(attempt)
    assert attempt.rubric_scores[0].source == RUBRIC_SOURCE_DRAFT
    assert crud_write.teacher_confirmed_skills(attempt) == set()


# ── 마이그레이션 ──────────────────────────────────────────────────────────


def _columns(engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {c["name"] for c in inspect(conn).get_columns(table)}


def test_migrations_are_safe_to_run_twice():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    first = migrations.run_migrations(engine)
    second = migrations.run_migrations(engine)

    assert "0008_rubric_source_section_provisional" in first
    assert second == []                       # 두 번째 실행은 완전한 no-op
    assert "source" in _columns(engine, "rubric_scores")
    assert "provisional" in _columns(engine, "section_scores")
    engine.dispose()


@pytest.mark.skipif(
    sqlite3.sqlite_version_info < (3, 35, 0),
    reason="ALTER TABLE ... DROP COLUMN 은 SQLite 3.35+ 에서만 된다",
)
def test_the_new_columns_are_additive_over_an_existing_database():
    """컬럼이 없던 DB 에 얹어도 기존 행이 살아남고, 출처는 초안으로 채워진다."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE rubric_scores DROP COLUMN source"))
        conn.execute(text("ALTER TABLE section_scores DROP COLUMN provisional"))
        # attempts 행은 만들지 않는다 — SQLite 는 기본적으로 FK 를 강제하지 않고,
        # 여기서 보려는 것은 "옛 rubric_scores 행이 살아남는가" 하나다.
        conn.execute(text(
            "INSERT INTO rubric_scores (attempt_id, skill, criterion, score, max_score, comment) "
            "VALUES (1, 'writing', 'Vocabulary', 4.0, 5.0, '옛날 행')"
        ))

    migrations.run_migrations(engine)
    migrations.run_migrations(engine)         # 두 번 돌려도 안전하다

    with engine.connect() as conn:
        row = conn.execute(text("SELECT score, comment, source FROM rubric_scores")).one()
    assert row.score == 4.0 and row.comment == "옛날 행"   # 기존 값은 그대로
    assert row.source == RUBRIC_SOURCE_DRAFT              # 출처를 모르면 확정이 아니다
    engine.dispose()


# ── SET 1 회귀 — 문항 채점은 한 톨도 바뀌지 않는다 ────────────────────────


def test_set1_question_grading_is_untouched(db):
    attempt = _attempt(db, "SET1")
    _answer_all(db, attempt, SET1_PACK)
    result = crud_write.grade_attempt(db, attempt)

    assert result["pack"] == "SET1"
    assert result["graded"] == 78
    assert attempt.total_questions == 91
    assert _section(attempt, "reading").raw_correct == 35
    assert _section(attempt, "reading").raw_total == 35
    assert _section(attempt, "reading").scaled == 30
    assert _section(attempt, "reading").provisional is False
    assert _section(attempt, "listening").raw_correct == 33
    assert _section(attempt, "listening").scaled == 30
    assert _section(attempt, "writing").raw_correct == 10
    assert _section(attempt, "writing").raw_total == 12
    # 바뀐 것은 섹션 합산·상태뿐이다: 교사 확정 전에는 완료가 아니고 Writing 은 잠정이다.
    assert attempt.status == "scoring"
    assert _section(attempt, "writing").provisional is True


# ── S4 — 공식 총체 밴드가 섹션 점수를 정한다 ──────────────────────────────
#
# ETS 가이드는 과제마다 총체 밴드 하나로 채점한다. 분석 축(TF/OD/LU/VO)은 교사가
# 학생에게 짚어 줄 거리일 뿐이라 섹션 점수에 섞이면 안 된다 — 섞이면 같은 답안이
# 축을 몇 개 매겼느냐에 따라 다른 점수를 받는다.

OFFICIAL = rubric_mod.OFFICIAL_CRITERION


def _official(skill: str, score: float, *, question_key: str = "", source=RUBRIC_SOURCE_DRAFT):
    return {
        "skill": skill, "question_key": question_key, "criterion": OFFICIAL,
        "score": score, "max_score": 5.0, "comment": "", "band": None, "source": source,
    }


def test_the_official_band_alone_decides_the_section_score(db):
    """축은 1.0(바닥)인데 공식 밴드가 5.0 이면 섹션은 만점이어야 한다."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    crud_write.upsert_rubric_rows(
        db, attempt,
        _rows("writing", WRITING_CRITERIA, 1.0, RUBRIC_SOURCE_DRAFT) + [_official("writing", 5.0)],
    )
    crud_write.grade_attempt(db, attempt)
    assert _section(attempt, "writing").scaled == 30


def test_without_an_official_band_the_old_axis_folding_still_works(db):
    """옛 응시(밴드 행이 없는 데이터)는 재채점 없이도 그대로 열려야 한다."""
    attempt = _attempt(db, "SET 9")
    _answer_all(db, attempt, SET9_PACK, skills=("writing",))
    crud_write.upsert_rubric_rows(
        db, attempt, _rows("writing", WRITING_CRITERIA, 5.0, RUBRIC_SOURCE_DRAFT)
    )
    crud_write.grade_attempt(db, attempt)
    assert _section(attempt, "writing").scaled == 30


def test_axis_count_no_longer_moves_the_section_score():
    """축을 몇 개 매겼든 공식 밴드가 같으면 섹션 점수도 같다.

    DB 없이 환산 함수만 본다 — 여기서 갈리면 위의 배선 테스트도 함께 무너진다.
    """
    from app.scoring.scale import get_scale

    adapter = get_scale("toefl120")
    four = _rows("writing", WRITING_CRITERIA, 1.0, RUBRIC_SOURCE_DRAFT) + [_official("writing", 4.0)]
    two = _rows("writing", WRITING_CRITERIA[:2], 1.0, RUBRIC_SOURCE_DRAFT) + [_official("writing", 4.0)]
    assert adapter.rubric_to_section(four) == adapter.rubric_to_section(two)
    assert adapter.rubric_to_section(four) == 24.0     # 4.0/5.0 × 30

    # 밴드 행이 없으면 옛 방식(축 합산)이라 축 개수가 결과를 바꾼다 — 그래서 갈아탄 것이다.
    axes_only_four = _rows("writing", WRITING_CRITERIA, 1.0, RUBRIC_SOURCE_DRAFT)
    assert adapter.rubric_to_section(axes_only_four) == 6.0


# ── S5 — question_key 가 키에 들어가야 복창 7문항이 살아남는다 ─────────────


def test_per_question_rubric_rows_do_not_overwrite_each_other(db):
    """복창은 문항마다 원문이 달라 문항 단위로 채점한다.

    키가 (attempt, skill, criterion) 뿐이던 시절에는 7문항이 한 자리를 두고 다퉈
    마지막 문항만 남았다. question_key 가 키에 들어가야 7행이 각자 산다.
    """
    attempt = _attempt(db, "SET 9")
    rows = [_official("speaking", float(i % 5), question_key=f"set9-S1-q0{i}") for i in range(1, 8)]
    crud_write.upsert_rubric_rows(db, attempt, rows)

    saved = [r for r in attempt.rubric_scores if r.criterion == OFFICIAL]
    assert len(saved) == 7
    assert {r.question_key for r in saved} == {f"set9-S1-q0{i}" for i in range(1, 8)}


def test_the_same_question_key_still_upserts_in_place(db):
    """같은 문항을 다시 채점하면 행이 늘지 않고 갱신된다."""
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(db, attempt, [_official("speaking", 2.0, question_key="q1")])
    crud_write.upsert_rubric_rows(db, attempt, [_official("speaking", 4.0, question_key="q1")])

    saved = [r for r in attempt.rubric_scores if r.criterion == OFFICIAL]
    assert len(saved) == 1
    assert saved[0].score == 4.0


def test_a_teacher_row_is_still_protected_per_question(db):
    """교사 확정본을 지키는 규칙이 문항 단위에서도 그대로여야 한다."""
    attempt = _attempt(db, "SET 9")
    crud_write.upsert_rubric_rows(
        db, attempt, [_official("speaking", 5.0, question_key="q1", source=RUBRIC_SOURCE_TEACHER)]
    )
    crud_write.upsert_rubric_rows(db, attempt, [_official("speaking", 1.0, question_key="q1")])

    saved = [r for r in attempt.rubric_scores if r.question_key == "q1"]
    assert len(saved) == 1
    assert saved[0].score == 5.0                      # 초안이 확정본을 덮지 않았다
    # 다른 문항은 초안이 그대로 들어간다 — 보호는 그 문항에만 걸린다.
    crud_write.upsert_rubric_rows(db, attempt, [_official("speaking", 1.0, question_key="q2")])
    assert next(r for r in attempt.rubric_scores if r.question_key == "q2").score == 1.0
