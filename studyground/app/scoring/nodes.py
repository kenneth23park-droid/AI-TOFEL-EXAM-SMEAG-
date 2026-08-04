"""The five scoring nodes. Pure functions over the graph state — no I/O besides the LLM call.

    ingest → analyze → route ─┬→ offline_feedback (rules) ─┐
                              └→ online_feedback  (LLM)  ──┴→ compose → END
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from app.config import get_settings
from app.schemas import AttemptDetail, FeedbackBundle, FeedbackItem
from app.scoring import llm, rules

log = logging.getLogger("studyground.scoring")

SCOPE_ORDER = ("reading", "listening", "speaking", "writing", "overall")


class ScoringState(TypedDict, total=False):
    detail: AttemptDetail
    lang: str
    requested_mode: str      # 'auto' | 'offline' | 'online'
    mode: str                # the node that actually produced the items
    analysis: dict[str, Any]
    items: list[FeedbackItem]
    fell_back: bool
    note: str


# ── ingest ────────────────────────────────────────────────────────────────────
def ingest(state: ScoringState) -> ScoringState:
    """Normalise inputs so every downstream node can trust the state."""
    lang = state.get("lang") or get_settings().default_lang
    if lang not in ("en", "ko"):
        lang = "en"
    requested = state.get("requested_mode") or "auto"
    if requested not in ("auto", "offline", "online"):
        requested = "auto"
    return {"lang": lang, "requested_mode": requested, "fell_back": False, "note": ""}


# ── analyze ───────────────────────────────────────────────────────────────────
def analyze(state: ScoringState) -> ScoringState:
    """Scores → the numeric picture both feedback nodes reason over."""
    return {"analysis": rules.analyze(state["detail"])}


# ── route ─────────────────────────────────────────────────────────────────────
def route(state: ScoringState) -> str:
    """Conditional edge: which feedback node runs."""
    requested = state.get("requested_mode", "auto")
    if requested == "offline":
        return "offline_feedback"
    settings = get_settings()
    if requested == "online":
        return "online_feedback" if settings.anthropic_api_key else "offline_feedback"
    # auto → online only when cloud mode has a key
    return "online_feedback" if settings.llm_enabled else "offline_feedback"


# ── offline_feedback (rules) ──────────────────────────────────────────────────
def offline_feedback(state: ScoringState) -> ScoringState:
    items = rules.build_items(state["analysis"], state.get("lang", "en"))
    out: ScoringState = {"items": items, "mode": "offline"}
    if state.get("requested_mode") == "online" and not get_settings().anthropic_api_key:
        # The caller asked for the LLM explicitly — say why they got rules instead.
        out["fell_back"] = True
        out["note"] = "ANTHROPIC_API_KEY is not set — rule-based feedback was used."
    return out


# ── online_feedback (LLM) ─────────────────────────────────────────────────────
def online_feedback(state: ScoringState) -> ScoringState:
    """LLM feedback, with an automatic fall back to the rule-based node on any error."""
    lang = state.get("lang", "en")
    try:
        items = llm.generate(state["analysis"], lang)
        return {"items": items, "mode": "online"}
    except Exception as exc:  # noqa: BLE001 — every failure degrades to offline
        log.warning("online feedback failed, falling back to rules: %s", exc)
        return {
            "items": rules.build_items(state["analysis"], lang),
            "mode": "offline",
            "fell_back": True,
            "note": f"LLM unavailable ({exc}) — rule-based feedback was used.",
        }


# ── compose ───────────────────────────────────────────────────────────────────
def compose(state: ScoringState) -> ScoringState:
    """Order the blocks, drop unknown scopes, and guarantee one block per skill."""
    produced = {item.scope: item for item in state.get("items", [])}
    analysis = state.get("analysis", {})
    lang = state.get("lang", "en")

    # Anything the producer skipped (or hallucinated a scope for) is filled from the rules.
    fallback = {item.scope: item for item in rules.build_items(analysis, lang)} if analysis else {}

    ordered: list[FeedbackItem] = []
    for scope in SCOPE_ORDER:
        item = produced.get(scope) or fallback.get(scope)
        if item is not None:
            ordered.append(item)
    return {"items": ordered}


def to_bundle(state: ScoringState, attempt_id: int) -> FeedbackBundle:
    return FeedbackBundle(
        attempt_id=attempt_id,
        mode=state.get("mode", "offline"),
        lang=state.get("lang", "en"),
        items=state.get("items", []),
        fell_back=bool(state.get("fell_back")),
        note=state.get("note", ""),
    )
