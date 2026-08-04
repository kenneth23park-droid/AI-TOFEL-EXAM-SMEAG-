"""LangGraph scoring pipeline — only the feedback node differs between modes.

    ingest → analyze → route ─┬→ offline_feedback ─┐
                              └→ online_feedback  ─┴→ compose → END

If langgraph is not installed the very same node functions are executed in
sequence by `_SequentialGraph`, so LOCAL mode never has a hard dependency on it.
"""

from __future__ import annotations

import logging

from app.schemas import AttemptDetail, FeedbackBundle
from app.scoring import nodes
from app.scoring.nodes import ScoringState

log = logging.getLogger("studyground.scoring")

_compiled = None
_backend = "sequential"


class _SequentialGraph:
    """Fallback runner with identical semantics to the compiled StateGraph."""

    def invoke(self, state: ScoringState) -> ScoringState:
        merged: ScoringState = dict(state)  # type: ignore[assignment]
        merged.update(nodes.ingest(merged))
        merged.update(nodes.analyze(merged))
        branch = nodes.route(merged)
        merged.update(getattr(nodes, branch)(merged))
        merged.update(nodes.compose(merged))
        return merged


def _build():
    """Compile the real StateGraph; fall back to sequential execution if unavailable."""
    global _backend
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError:
        log.info("langgraph not installed — running scoring nodes sequentially")
        _backend = "sequential"
        return _SequentialGraph()

    try:
        builder = StateGraph(ScoringState)
        builder.add_node("ingest", nodes.ingest)
        builder.add_node("analyze", nodes.analyze)
        builder.add_node("offline_feedback", nodes.offline_feedback)
        builder.add_node("online_feedback", nodes.online_feedback)
        builder.add_node("compose", nodes.compose)

        builder.add_edge(START, "ingest")
        builder.add_edge("ingest", "analyze")
        builder.add_conditional_edges(
            "analyze",
            nodes.route,
            {"offline_feedback": "offline_feedback", "online_feedback": "online_feedback"},
        )
        builder.add_edge("offline_feedback", "compose")
        builder.add_edge("online_feedback", "compose")
        builder.add_edge("compose", END)

        graph = builder.compile()
        _backend = "langgraph"
        return graph
    except Exception as exc:  # noqa: BLE001 — a graph build error must not break scoring
        log.warning("langgraph build failed (%s) — running nodes sequentially", exc)
        _backend = "sequential"
        return _SequentialGraph()


def get_graph():
    global _compiled
    if _compiled is None:
        _compiled = _build()
    return _compiled


def backend() -> str:
    """'langgraph' once a CompiledStateGraph is in use, else 'sequential'."""
    get_graph()
    return _backend


def uses_langgraph() -> bool:
    return backend() == "langgraph"


def run(detail: AttemptDetail, *, lang: str = "en", mode: str = "auto") -> FeedbackBundle:
    """Score one attempt. `mode`: 'auto' | 'offline' | 'online'."""
    state: ScoringState = {"detail": detail, "lang": lang, "requested_mode": mode}
    result = get_graph().invoke(state)
    return nodes.to_bundle(result, detail.id)
