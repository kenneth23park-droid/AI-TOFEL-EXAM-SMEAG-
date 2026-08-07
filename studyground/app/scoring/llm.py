"""Online feedback node — Claude via the Anthropic SDK.

Only reachable in CLOUD mode with ANTHROPIC_API_KEY set. Every failure path
(missing SDK, missing key, API error, malformed JSON) raises, and the graph
routes to the offline node instead — the report never comes back empty.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.config import PROJECT_DIR, get_settings
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


# ── rubric drafting (Story 5.1) ───────────────────────────────────────────────
# The examiner prompts and their output contracts already live outside the app so
# a teacher can edit them without a deploy. Overridable for tests / relocation.
RUBRIC_ROOT = Path(
    os.getenv("SMEAG_RUBRIC_ROOT") or (PROJECT_DIR.parent / "smeag-local-ai" / "scoring")
)

# (scale_key, skill) → basename shared by rubrics/*.md and schemas/*.schema.json
RUBRIC_FILES = {
    ("toefl120", "writing"): "toefl_writing",
    ("toefl120", "speaking"): "toefl_speaking",
    ("ielts9", "writing"): "ielts_writing_task2",
    ("ielts9", "speaking"): "ielts_speaking",
}

_RUBRIC_LANG = {
    "en": "Write every rationale, comment and summary in English.",
    "ko": "rationale·comment·summary 는 한국어로 작성하세요.",
}


def rubric_assets(scale_key: str, skill: str) -> tuple[str, str]:
    """(examiner prompt markdown, JSON schema text). Raises when either is missing."""
    base = RUBRIC_FILES.get((scale_key, skill))
    if base is None:
        raise RuntimeError(f"no rubric registered for scale={scale_key!r} skill={skill!r}")
    prompt_path = RUBRIC_ROOT / "rubrics" / f"{base}.md"
    schema_path = RUBRIC_ROOT / "schemas" / f"{base}.schema.json"
    if not prompt_path.is_file():
        raise RuntimeError(f"rubric prompt missing: {prompt_path}")
    if not schema_path.is_file():
        raise RuntimeError(f"rubric schema missing: {schema_path}")
    return prompt_path.read_text(encoding="utf-8"), schema_path.read_text(encoding="utf-8")


def generate_rubric(
    skill: str,
    text: str,
    *,
    scale_key: str = "toefl120",
    lang: str = "en",
    min_words: int = 0,
    metrics: dict | None = None,
    max_score: float = 5.0,
    criteria: tuple[str, ...] | None = None,
) -> list[dict]:
    """One rubric draft as `{skill, criterion, score, max_score, band, comment}` rows.

    Raises on **every** problem (no key, no SDK, no rubric file, API error, bad
    JSON) — `nodes.rubric_online` catches and falls back to `rubric.draft()`.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    try:
        from anthropic import Anthropic
    except ImportError as exc:
        raise RuntimeError("anthropic SDK is not installed") from exc

    system, schema = rubric_assets(scale_key, skill)
    is_band = scale_key == "ielts9"

    body = (text or "").strip()
    if not body:
        raise ValueError("no response text to rate")

    payload = {
        "skill": skill,
        "scale": scale_key,
        "min_words": min_words,
        "measured_metrics": metrics or {},
        "response_text": body,
    }
    prompt = (
        f"{_RUBRIC_LANG.get(lang, _RUBRIC_LANG['en'])}\n\n"
        f"Student submission and measured metrics:\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n\n"
        f"Return ONLY a JSON object valid against this schema:\n{schema}"
    )

    client = Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2400,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
    return _parse_rubric(
        raw, skill=skill, is_band=is_band, max_score=max_score, allowed=criteria
    )


def _json_object(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        raw = raw[4:] if raw.lower().startswith("json") else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model response")
    obj = json.loads(raw[start : end + 1])
    if not isinstance(obj, dict):
        raise ValueError("model response is not a JSON object")
    return obj


def _parse_rubric(
    text: str,
    *,
    skill: str,
    is_band: bool,
    max_score: float,
    allowed: tuple[str, ...] | None = None,
) -> list[dict]:
    payload = _json_object(text)
    criteria = payload.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        raise ValueError("model response has no criteria object")

    summary = str(payload.get("summary_en") or payload.get("summary_ko") or "").strip()
    rows: list[dict] = []
    for name, entry in criteria.items():
        if not isinstance(entry, dict):
            continue
        if allowed and name not in allowed:
            continue
        value = entry.get("band") if is_band else entry.get("score")
        if value is None:
            value = entry.get("score") if is_band else entry.get("band")
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        rationale = str(entry.get("rationale") or "").strip()
        evidence = [str(q) for q in (entry.get("evidence") or []) if str(q).strip()]
        comment = " ".join(part for part in (rationale, summary) if part).strip()
        if evidence:
            comment = (comment + " Evidence: " + " / ".join(f'"{q}"' for q in evidence[:3])).strip()
        rows.append(
            {
                "skill": skill,
                "criterion": str(name),
                "score": score,
                "max_score": float(max_score),
                "band": score if is_band else None,
                "comment": comment,
                "source": "ai_draft",
                "origin": "online",
            }
        )
    if not rows:
        raise ValueError("model response had no usable criteria")
    return rows
