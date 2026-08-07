"""Both graph backends must agree — architecture.md 8.4, Story 5.1 AC2/AC7.

Run:  .venv/bin/python -m pytest tests/test_graph_fallback.py -q
      .venv/bin/python tests/test_graph_fallback.py        (no pytest needed)

The same attempt is scored twice: once with langgraph available, once with its
import blocked, and the two `FeedbackBundle`s must be byte-identical. No DB and no
network are touched — the attempt is built in memory.
"""

from __future__ import annotations

import builtins
import contextlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# LOCAL, key-less: the offline path everywhere, decided before anything imports config.
os.environ["APP_MODE"] = "local"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["SEED_ON_START"] = "0"

from app.config import get_settings                     # noqa: E402
from app.schemas import (                               # noqa: E402
    AttemptDetail,
    ExamOut,
    QuestionResponseOut,
    RubricScoreOut,
    SectionScoreOut,
    StudentOut,
)
from app.scoring import graph, graph_spec, nodes        # noqa: E402

get_settings.cache_clear()


# ── fixtures ──────────────────────────────────────────────────────────────────
def make_detail(*, with_productive: bool = True, with_teacher: bool = True) -> AttemptDetail:
    responses = [
        QuestionResponseOut(
            no=1, skill="reading", prompt="Main idea?", student_answer="2",
            correct_answer="2", is_correct=True, question_key="R1-1", qtype="MCQ",
            module="R1", max_score=1,
            feedback="Read the second paragraph again." if with_teacher else "",
        ),
        QuestionResponseOut(
            no=2, skill="reading", prompt="Vocabulary", student_answer="Abundant ",
            correct_answer="abundant", is_correct=False, question_key="R1-2",
            qtype="WORD_FILLING", module="R1", max_score=1,
        ),
        QuestionResponseOut(
            no=3, skill="listening", prompt="Order the words",
            student_answer="the cat sat down", correct_answer="the cat sat down",
            is_correct=True, question_key="L1-3", qtype="BUILD_SENTENCE",
            module="L1", max_score=1,
        ),
    ]
    if with_productive:
        responses += [
            QuestionResponseOut(
                no=4, skill="writing", prompt="Do you agree?",
                student_answer=(
                    "I strongly agree with the statement. However, there are two reasons "
                    "that support my position. Firstly, students who study abroad learn "
                    "independence because they must manage money, food and time alone. "
                    "Secondly, exposure to another culture broadens their perspective, "
                    "although it can be uncomfortable at first. Therefore I believe the "
                    "benefits outweigh the drawbacks."
                ),
                correct_answer="", is_correct=False, question_key="W1-1",
                qtype="WRITING", module="W1", max_score=5,
            ),
            QuestionResponseOut(
                no=5, skill="speaking", prompt="Describe a place",
                student_answer=(
                    "I would like to talk about the library near my house. It is quiet "
                    "and the staff are helpful. I usually go there on weekends because "
                    "my apartment is noisy. Studying there helps me concentrate."
                ),
                correct_answer="", is_correct=False, question_key="S-1",
                qtype="SPEAKING", module="S1", max_score=4,
                audio_ref="media/att1/S-1.webm",
                feedback="Slow down at the start." if with_teacher else "",
            ),
        ]

    return AttemptDetail(
        id=101,
        student=StudentOut(id=1, student_no="S001", name="Test Student", klass="A", campus="CPI"),
        exam=ExamOut(id=1, code="SET1", title="TOEFL Mock 1"),
        taken_at="2026-08-06T09:00:00",
        total_score=88,
        grade="B2",
        status="completed",
        scale="toefl120",
        profile="toefl",
        sections={"reading": 24, "listening": 22, "speaking": 20, "writing": 22},
        section_scores=[
            SectionScoreOut(skill="reading", raw_correct=28, raw_total=35, scaled=24),
            SectionScoreOut(skill="listening", raw_correct=25, raw_total=33, scaled=22),
            SectionScoreOut(skill="speaking", raw_correct=0, raw_total=0, scaled=20),
            SectionScoreOut(skill="writing", raw_correct=0, raw_total=0, scaled=22),
        ],
        question_responses=responses,
        rubric_scores=[
            RubricScoreOut(
                skill="writing", criterion="Task Fulfilment", score=4, max_score=5,
                comment="Teacher: position is clear and supported." if with_teacher else "",
            )
        ],
    )


@contextlib.contextmanager
def langgraph_blocked():
    """Make every `import langgraph…` raise, the way an uninstalled package would."""
    real_import = builtins.__import__
    cached = {name: mod for name, mod in sys.modules.items() if name.split(".")[0] == "langgraph"}

    def guard(name, globals=None, locals=None, fromlist=(), level=0):
        if name.split(".")[0] == "langgraph":
            raise ImportError("No module named 'langgraph' (blocked by the test)")
        return real_import(name, globals, locals, fromlist, level)

    for name in cached:
        del sys.modules[name]
    builtins.__import__ = guard
    try:
        yield
    finally:
        builtins.__import__ = real_import
        sys.modules.update(cached)


def _bundle(detail, *, mode="offline", blocked=False):
    graph.reset()
    if blocked:
        with langgraph_blocked():
            bundle = graph.run(detail, mode=mode)
            return bundle, graph.backend()
    bundle = graph.run(detail, mode=mode)
    return bundle, graph.backend()


def _final_state(detail, *, mode="offline", blocked=False):
    graph.reset()
    state = {"detail": detail, "lang": "en", "requested_mode": mode}
    if blocked:
        with langgraph_blocked():
            return graph.get_graph().invoke(dict(state))
    return graph.get_graph().invoke(dict(state))


# ── tests ─────────────────────────────────────────────────────────────────────
def test_graph_spec_is_structurally_sound():
    assert graph_spec.validate() == []
    assert graph_spec.ENTRY == "ingest"
    assert set(graph_spec.NODES) == {
        "ingest", "autoscore", "analyze", "rubric_offline", "rubric_online",
        "scale", "offline_feedback", "online_feedback", "compose",
    }


def test_both_backends_are_reachable():
    _, live = _bundle(make_detail())
    _, fallback = _bundle(make_detail(), blocked=True)
    assert live == "langgraph", "langgraph is installed in this venv — the real builder must win"
    assert fallback == "sequential"


def test_bundles_are_identical_with_and_without_langgraph():
    detail = make_detail()
    live, live_backend = _bundle(detail, mode="offline")
    seq, seq_backend = _bundle(detail, mode="offline", blocked=True)
    assert (live_backend, seq_backend) == ("langgraph", "sequential")
    assert live.model_dump() == seq.model_dump()
    assert [i.scope for i in live.items] == [
        "reading", "listening", "speaking", "writing", "overall"
    ]


def test_full_state_is_identical_with_and_without_langgraph():
    detail = make_detail()
    live = _final_state(detail)
    seq = _final_state(detail, blocked=True)
    for key in ("responses", "rubrics", "scaled", "scale", "analysis", "mode", "note"):
        assert live.get(key) == seq.get(key), f"{key} differs between backends"


def test_bundles_match_for_every_mode():
    detail = make_detail()
    for mode in ("auto", "offline", "online"):
        live, _ = _bundle(detail, mode=mode)
        seq, _ = _bundle(detail, mode=mode, blocked=True)
        assert live.model_dump() == seq.model_dump(), f"mode={mode} differs"


def test_attempt_without_productive_items_skips_the_rubric_nodes():
    detail = make_detail(with_productive=False)
    state = _final_state(detail)
    assert nodes.need_rubric(state) == "scale"
    assert not state.get("rubrics")
    assert state["scaled"]["scale"] == "toefl120"
    live, _ = _bundle(detail)
    seq, _ = _bundle(detail, blocked=True)
    assert live.model_dump() == seq.model_dump()


def test_autoscore_is_deterministic_and_offline():
    state = _final_state(make_detail())
    scored = {r["question_key"]: r["auto_score"] for r in state["responses"]}
    assert scored["R1-1"] == 1.0            # MCQ, index match
    assert scored["R1-2"] == 1.0            # WORD_FILLING, strip().lower() match
    assert scored["L1-3"] == 1.0            # BUILD_SENTENCE, token order match
    assert scored["W1-1"] is None           # productive → a human decides
    assert scored["S-1"] is None


def test_offline_rubric_draft_is_produced_without_a_key():
    assert get_settings().anthropic_api_key == ""
    state = _final_state(make_detail())
    rubrics = state["rubrics"]
    assert {r["skill"] for r in rubrics} == {"writing", "speaking"}
    assert all(r["max_score"] in (4.0, 5.0) for r in rubrics)
    assert all(r["band"] is None for r in rubrics)     # TOEFL scale → no band


def test_teacher_feedback_outranks_the_ai_draft():
    detail = make_detail(with_teacher=True)
    state = _final_state(detail)

    reading = next(i for i in state["items"] if i.scope == "reading")
    assert any("Read the second paragraph again." in s for s in reading.improvements)

    tf = next(r for r in state["rubrics"] if r["criterion"] == "Task Fulfilment")
    assert tf["source"] == "manual" and tf["score"] == 4.0
    assert tf["comment"].startswith("Teacher:")

    plain = _final_state(make_detail(with_teacher=False))
    plain_tf = next(r for r in plain["rubrics"] if r["criterion"] == "Task Fulfilment")
    assert plain_tf["source"] == "ai_draft"


def test_sequential_runner_does_not_swallow_node_exceptions():
    """architecture.md 8.4 measured property: the fallback has no try/except."""
    original = graph_spec.NODES["analyze"]

    def boom(_state):
        raise ValueError("node exploded")

    graph_spec.NODES["analyze"] = boom
    try:
        graph.reset()
        with langgraph_blocked():
            try:
                graph.run(make_detail(), mode="offline")
            except ValueError as exc:
                assert str(exc) == "node exploded"
            else:
                raise AssertionError("the exception was swallowed")
    finally:
        graph_spec.NODES["analyze"] = original
        graph.reset()


def test_public_signatures_are_unchanged():
    import inspect

    assert str(inspect.signature(graph.run)) == (
        "(detail: 'AttemptDetail', *, lang: 'str' = 'en', mode: 'str' = 'auto') -> 'FeedbackBundle'"
    )
    assert str(inspect.signature(graph.backend)) == "() -> 'str'"
    assert str(inspect.signature(graph.uses_langgraph)) == "() -> 'bool'"
    for name in ("ingest", "analyze", "route", "offline_feedback", "online_feedback", "compose"):
        assert callable(getattr(nodes, name))


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
