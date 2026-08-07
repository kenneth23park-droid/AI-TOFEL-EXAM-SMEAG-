"""Story 3.4 — the auto-scoring rules, one case per (qtype × correct/wrong/blank).

Run:  studyground/.venv/bin/python -m pytest studyground/tests/test_autoscore.py -q
The module under test is pure, so no DB, no app, no fixtures.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.scoring import autoscore  # noqa: E402
from app.scoring.answer_key_set1 import (  # noqa: E402
    ANSWER_KEY,
    AUTO_TOTAL_BY_SKILL,
    PRODUCTIVE_KEYS,
    TOTAL_QUESTIONS,
)

# (qtype, key, correct answer, wrong answer)
CASES = [
    ("MCQ", 2, 2, 0),
    ("INSERT", 1, 1, 3),
    ("CLOZE", "brain", "brain", "heart"),
    ("WORD_FILLING", "system", "system", "systems"),
    ("BUILD_SENTENCE", ["around", "noon"], ["around", "noon"], ["noon", "around"]),
]

BLANKS = [None, "", [], "   "]


@pytest.mark.parametrize(("qtype", "key", "right", "wrong"), CASES)
def test_correct_scores_one(qtype, key, right, wrong):
    assert autoscore.score(qtype, right, key) == 1.0


@pytest.mark.parametrize(("qtype", "key", "right", "wrong"), CASES)
def test_wrong_scores_zero(qtype, key, right, wrong):
    assert autoscore.score(qtype, wrong, key) == 0.0


@pytest.mark.parametrize(("qtype", "key", "right", "wrong"), CASES)
@pytest.mark.parametrize("blank", BLANKS)
def test_unanswered_scores_zero_not_none(qtype, key, right, wrong, blank):
    """Unanswered is gradeable — 0.0. None would mean 'a human must look'."""
    assert autoscore.score(qtype, blank, key) == 0.0


@pytest.mark.parametrize("qtype", ["WRITING", "SPEAKING"])
@pytest.mark.parametrize("answer", ["an essay", None, ""])
def test_productive_is_never_auto_scored(qtype, answer):
    assert autoscore.score(qtype, answer, None) is None


def test_unknown_qtype_defers_to_a_human():
    assert autoscore.score("NOT_A_TYPE", "x", "x") is None


# ── normalisation rules (Story 3.4 AC2 / Verification 3) ──────────────────


@pytest.mark.parametrize("answer", ["brain", "Brain", "  Brain ", "BRAIN", "\tbrain\n"])
def test_cloze_ignores_case_and_surrounding_space(answer):
    assert autoscore.score("CLOZE", answer, "brain") == 1.0


def test_cloze_does_not_ignore_a_different_word():
    assert autoscore.score("CLOZE", "brains", "brain") == 0.0


@pytest.mark.parametrize("answer", [2, "2", 2.0])
def test_mcq_accepts_index_as_int_or_string(answer):
    assert autoscore.score("MCQ", answer, 2) == 1.0


@pytest.mark.parametrize("answer", ["two", {"pick": 2}, True])
def test_mcq_rejects_junk_without_raising(answer):
    assert autoscore.score("MCQ", answer, 2) == 0.0


def test_build_sentence_is_order_sensitive_and_has_no_partial_credit():
    key = ["the", "meeting", "was", "postponed"]
    assert autoscore.score("BUILD_SENTENCE", key, key) == 1.0
    assert autoscore.score("BUILD_SENTENCE", ["the", "meeting", "postponed", "was"], key) == 0.0
    assert autoscore.score("BUILD_SENTENCE", ["the", "meeting", "was"], key) == 0.0
    assert autoscore.score("BUILD_SENTENCE", ["the", "meeting", None, "postponed"], key) == 0.0


def test_build_sentence_accepts_a_joined_string_from_the_wire():
    assert autoscore.score("BUILD_SENTENCE", "around noon", ["around", "noon"]) == 1.0


def test_build_sentence_handles_multi_word_tiles():
    """SET 1 W1 tiles are phrases ('to make', 'from scratch'), not single words."""
    key = ["learned", "how", "to make", "fresh", "pasta", "from scratch"]
    assert autoscore.score("BUILD_SENTENCE", key, key) == 1.0
    assert autoscore.score("BUILD_SENTENCE", "learned how to make fresh pasta from scratch", key) == 1.0
    assert autoscore.score("BUILD_SENTENCE", "learned how to make fresh pasta", key) == 0.0
    assert autoscore.score("BUILD_SENTENCE", ["how", "learned", "to make", "fresh", "pasta", "from scratch"], key) == 0.0


def test_display_answer_round_trip():
    assert autoscore.display_answer("BUILD_SENTENCE", ["around", "noon"]) == "around noon"
    assert autoscore.display_answer("MCQ", 2) == "2"
    assert autoscore.display_answer("CLOZE", "brain") == "brain"
    assert autoscore.display_answer("MCQ", None) == ""


# ── the key itself (Story 3.4 AC6/AC7) ────────────────────────────────────


def test_answer_key_counts_match_the_checksum_table():
    assert len(ANSWER_KEY) == 78
    assert len(PRODUCTIVE_KEYS) == 13
    assert TOTAL_QUESTIONS == 91
    assert AUTO_TOTAL_BY_SKILL == {"reading": 35, "listening": 33, "writing": 10, "speaking": 0}


def test_every_auto_key_entry_is_machine_scorable():
    for key, entry in ANSWER_KEY.items():
        assert entry["qtype"] in autoscore.AUTO_QTYPES, key
        assert entry["answer"] is not None, key
        assert autoscore.score(entry["qtype"], entry["answer"], entry["answer"]) == 1.0, key


def test_every_productive_entry_defers_to_a_human():
    for key, entry in PRODUCTIVE_KEYS.items():
        assert entry["qtype"] in autoscore.PRODUCTIVE_QTYPES, key
        assert autoscore.score(entry["qtype"], "anything", entry["answer"]) is None, key


def test_a_perfect_paper_scores_every_auto_question():
    total = sum(autoscore.score(e["qtype"], e["answer"], e["answer"]) for e in ANSWER_KEY.values())
    assert total == 78.0


def test_an_empty_paper_scores_nothing():
    total = sum(autoscore.score(e["qtype"], None, e["answer"]) for e in ANSWER_KEY.values())
    assert total == 0.0
