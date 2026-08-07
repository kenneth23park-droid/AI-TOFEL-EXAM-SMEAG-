"""The graph, declared once — architecture.md 8.4.

Both runners read this module: the langgraph builder in `graph.py` turns it into a
`CompiledStateGraph`, and `_SequentialGraph` walks it with a plain worklist loop.
Add a node here and both backends follow; there is nowhere else to update.

No imports beyond `nodes` — this file must stay dependency-free so the fallback
path never needs langgraph to know what the graph looks like.

    ingest → autoscore → analyze ─┬→ rubric_online  ─┐
                                  ├→ rubric_offline ─┼→ scale → route ─┬→ offline_feedback ─┐
                                  └────────────────→ ┘                 └→ online_feedback  ─┴→ compose → END
"""

from __future__ import annotations

from app.scoring import nodes

END = "__end__"
ENTRY = "ingest"
MAX_STEPS = 32          # cycle guard for the sequential runner

NODES = {
    "ingest": nodes.ingest,
    "autoscore": nodes.autoscore,
    "analyze": nodes.analyze,
    "rubric_offline": nodes.rubric_offline,
    "rubric_online": nodes.rubric_online,
    "scale": nodes.scale,
    "offline_feedback": nodes.offline_feedback,
    "online_feedback": nodes.online_feedback,
    "compose": nodes.compose,
}

# Unconditional (from, to) edges. A node appears here XOR in CONDITIONAL.
EDGES = [
    ("ingest", "autoscore"),
    ("autoscore", "analyze"),
    ("rubric_offline", "scale"),
    ("rubric_online", "scale"),
    ("offline_feedback", "compose"),
    ("online_feedback", "compose"),
    ("compose", END),
]

# from → (branch function, {returned key: destination node})
CONDITIONAL = {
    "analyze": (
        nodes.need_rubric,
        {
            "rubric_online": "rubric_online",
            "rubric_offline": "rubric_offline",
            "scale": "scale",
        },
    ),
    "scale": (
        nodes.route,
        {
            "offline_feedback": "offline_feedback",
            "online_feedback": "online_feedback",
        },
    ),
}

# Derived lookup for the sequential runner — kept here so the two stay in sync.
NEXT = dict(EDGES)


def validate() -> list[str]:
    """Structural problems in the declaration above. Empty list == a sound graph."""
    problems: list[str] = []
    if ENTRY not in NODES:
        problems.append(f"ENTRY {ENTRY!r} is not a node")
    for src, dst in EDGES:
        if src not in NODES:
            problems.append(f"edge source {src!r} is not a node")
        if dst != END and dst not in NODES:
            problems.append(f"edge target {dst!r} is not a node")
        if src in CONDITIONAL:
            problems.append(f"{src!r} has both a fixed edge and a conditional edge")
    if len(NEXT) != len(EDGES):
        problems.append("a node has more than one fixed outgoing edge")
    for src, (_fn, mapping) in CONDITIONAL.items():
        if src not in NODES:
            problems.append(f"conditional source {src!r} is not a node")
        for key, dst in mapping.items():
            if dst != END and dst not in NODES:
                problems.append(f"conditional target {dst!r} (key {key!r}) is not a node")
    for name in NODES:
        if name not in NEXT and name not in CONDITIONAL:
            problems.append(f"{name!r} has no outgoing edge")
    return problems


__all__ = ["CONDITIONAL", "EDGES", "END", "ENTRY", "MAX_STEPS", "NEXT", "NODES", "validate"]
