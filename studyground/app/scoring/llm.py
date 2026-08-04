"""Online feedback node — Claude via the Anthropic SDK.

Only reachable in CLOUD mode with ANTHROPIC_API_KEY set. Every failure path
(missing SDK, missing key, API error, malformed JSON) raises, and the graph
routes to the offline node instead — the report never comes back empty.
"""

from __future__ import annotations

import json

from app.config import get_settings
from app.schemas import FeedbackItem

_SYSTEM = (
    "You are an ESL assessment specialist writing score-report feedback for a "
    "TOEFL-style test at SMEAG. You receive a scored attempt as JSON. "
    "Be concrete and reference the numbers you are given. Never invent scores."
)

_INSTRUCTION = {
    "en": "Write the feedback in English.",
    "ko": "피드백은 한국어로 작성하세요.",
}

_SCHEMA_HINT = """Return ONLY a JSON object, no prose, in this exact shape:
{"items":[{"scope":"reading","summary":"...","strengths":["..."],"improvements":["..."]},
          {"scope":"listening", ...},{"scope":"speaking", ...},{"scope":"writing", ...},
          {"scope":"overall", ...}]}
Every scope must appear exactly once. 1-2 sentences per summary,
1-2 bullet strings each for strengths and improvements."""


def generate(analysis: dict, lang: str = "en") -> list[FeedbackItem]:
    """Raise on any problem — the caller falls back to the rule-based node."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    try:
        from anthropic import Anthropic
    except ImportError as exc:  # SDK not installed in this environment
        raise RuntimeError("anthropic SDK is not installed") from exc

    client = Anthropic(api_key=settings.anthropic_api_key)
    prompt = (
        f"{_INSTRUCTION.get(lang, _INSTRUCTION['en'])}\n\n"
        f"Scored attempt:\n{json.dumps(analysis, ensure_ascii=False, indent=2)}\n\n"
        f"{_SCHEMA_HINT}"
    )

    message = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1600,
        system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
    return _parse(text)


def _parse(text: str) -> list[FeedbackItem]:
    raw = text.strip()
    if raw.startswith("```"):  # strip a ```json fence if the model added one
        raw = raw.split("```")[1]
        raw = raw[4:] if raw.lower().startswith("json") else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model response")

    payload = json.loads(raw[start : end + 1])
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("model response has no items")

    out: list[FeedbackItem] = []
    for entry in items:
        if not isinstance(entry, dict) or not entry.get("scope"):
            continue
        out.append(
            FeedbackItem(
                scope=str(entry["scope"]),
                summary=str(entry.get("summary", "")),
                strengths=[str(s) for s in entry.get("strengths", []) if str(s).strip()],
                improvements=[str(s) for s in entry.get("improvements", []) if str(s).strip()],
            )
        )
    if not out:
        raise ValueError("model response had no usable items")
    return out
