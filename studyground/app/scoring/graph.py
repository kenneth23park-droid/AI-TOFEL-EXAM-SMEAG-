"""LangGraph scoring pipeline — the shape lives in `graph_spec`, not in here.

    ingest → autoscore → analyze ─┬→ rubric_online  ─┐
                                  ├→ rubric_offline ─┼→ scale → route ─┬→ offline_feedback ─┐
                                  └────────────────→ ┘                 └→ online_feedback  ─┴→ compose → END

Both runners walk the same declaration (architecture.md 8.4), so adding a node
means editing `graph_spec.py` alone. If langgraph is not installed the very same
node functions are executed by `_SequentialGraph`, so LOCAL mode never has a hard
dependency on it — and, by construction, it produces the identical result.

`_SequentialGraph` deliberately has **no** try/except: node exceptions propagate
to the caller exactly as they did before this refactor. Exception isolation lives
inside the nodes (`online_feedback`, `rubric_online`, `autoscore`, `scale`).
"""

from __future__ import annotations

import logging

from app.schemas import AttemptDetail, FeedbackBundle
from app.scoring import graph_spec, nodes
from app.scoring.nodes import ScoringState

log = logging.getLogger("studyground.scoring")

_compiled = None
_backend = "sequential"


class _SequentialGraph:
    """Fallback runner with identical semantics to the compiled StateGraph."""

    def invoke(self, state: ScoringState) -> ScoringState:
        merged: ScoringState = dict(state)  # type: ignore[assignment]
        node = graph_spec.ENTRY

        for _ in range(graph_spec.MAX_STEPS):
            if node == graph_spec.END:
                return merged
            fn = graph_spec.NODES.get(node)
            if fn is None:
                raise KeyError(f"unknown scoring node {node!r}")

            merged.update(fn(merged) or {})

            branch = graph_spec.CONDITIONAL.get(node)
            if branch is not None:
                decide, mapping = branch
                key = decide(merged)
                if key not in mapping:
                    raise KeyError(f"{node!r} branched to unknown key {key!r}")
                node = mapping[key]
            else:
                if node not in graph_spec.NEXT:
                    raise KeyError(f"{node!r} has no outgoing edge")
                node = graph_spec.NEXT[node]

        raise RuntimeError(
            f"scoring graph did not reach END within {graph_spec.MAX_STEPS} steps"
        )


def _build():
    """Compile the real StateGraph; fall back to sequential execution if unavailable."""
    global _backend

    problems = graph_spec.validate()
    if problems:
        # A malformed declaration would break both runners — say so loudly, once.
        log.error("graph_spec is inconsistent: %s", "; ".join(problems))

    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError:
        log.info("langgraph not installed — running scoring nodes sequentially")
        _backend = "sequential"
        return _SequentialGraph()

    try:
        builder = StateGraph(ScoringState)
        for name, fn in graph_spec.NODES.items():
            builder.add_node(name, fn)

        builder.add_edge(START, graph_spec.ENTRY)
        for src, dst in graph_spec.EDGES:
            builder.add_edge(src, END if dst == graph_spec.END else dst)
        for src, (decide, mapping) in graph_spec.CONDITIONAL.items():
            builder.add_conditional_edges(
                src,
                decide,
                {k: (END if v == graph_spec.END else v) for k, v in mapping.items()},
            )

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


def reset() -> None:
    """Drop the cached graph — used by tests that toggle langgraph availability."""
    global _compiled, _backend
    _compiled = None
    _backend = "sequential"


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
