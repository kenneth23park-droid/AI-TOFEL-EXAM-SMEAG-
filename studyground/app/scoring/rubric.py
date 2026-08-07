"""Offline rubric heuristics — the draft a teacher starts from when no LLM is available.

Deterministic and dependency-free: word count, `minWords` compliance, sentence
count, sentence-length spread and type-token ratio move a **conservative median**
band up or down by a bounded amount. No network, no randomness, no exceptions —
the same text always yields the same rows, and a blank text yields the floor.

Scores are intentionally never at the top of the range: this is a draft, and every
row says so in `comment` (Story 5.1 AC4).
"""

from __future__ import annotations

import re

from app.scoring.scale import IELTS, TOEFL, round_half_up_to_half

DRAFT_SOURCE = "ai_draft"

# ── criterion sets ────────────────────────────────────────────────────────────
# (criterion label, weight of each metric family) — the label is what the teacher sees.
_TOEFL_WRITING = ("Task Fulfilment", "Organization & Development", "Language Use", "Vocabulary")
_TOEFL_SPEAKING = ("Delivery", "Language Use", "Topic Development")
_IELTS_WRITING = ("TR", "CC", "LR", "GRA")
_IELTS_SPEAKING = ("FC", "LR", "GRA", "PRO")

CRITERIA = {
    (TOEFL, "writing"): _TOEFL_WRITING,
    (TOEFL, "speaking"): _TOEFL_SPEAKING,
    (IELTS, "writing"): _IELTS_WRITING,
    (IELTS, "speaking"): _IELTS_SPEAKING,
}

# TOEFL public rubrics: Writing is 0–5, Speaking is 0–4.
MAX_SCORE = {
    (TOEFL, "writing"): 5.0,
    (TOEFL, "speaking"): 4.0,
    (IELTS, "writing"): 9.0,
    (IELTS, "speaking"): 9.0,
}

# Conservative middle of each range, and how far a heuristic may move it.
_CENTRE = {5.0: 3.0, 4.0: 2.0, 9.0: 5.5}
_FLOOR = {5.0: 1.0, 4.0: 1.0, 9.0: 4.0}
_CEILING = {5.0: 4.0, 4.0: 3.0, 9.0: 6.5}

# Default `minWords` when the content did not carry one.
DEFAULT_MIN_WORDS = {"writing": 150, "speaking": 60}

_CONNECTIVES = frozenset(
    """however therefore moreover furthermore although though because since whereas
    while nevertheless nonetheless consequently thus hence besides additionally
    instead otherwise meanwhile finally firstly secondly thirdly overall
    for and but so yet if when after before until unless despite""".split()
)

_WORD_RE = re.compile(r"[A-Za-z']+")
_SENT_RE = re.compile(r"[.!?]+(?:\s|$)")

_REVIEW_NOTE = {
    "en": "Rule-based draft — teacher review required.",
    "ko": "규칙 기반 초안 — 교사 검수 필요.",
}


# ── text metrics ──────────────────────────────────────────────────────────────
def measure(text: str) -> dict:
    """Every number the heuristics use. Safe on empty / None input."""
    body = (text or "").strip()
    words = [w.lower() for w in _WORD_RE.findall(body)]
    n = len(words)

    parts = [p.strip() for p in _SENT_RE.split(body) if p.strip()]
    sentences = len(parts)
    lengths = [len(_WORD_RE.findall(p)) for p in parts] or [0]
    mean_len = sum(lengths) / len(lengths)
    variance = sum((x - mean_len) ** 2 for x in lengths) / len(lengths)

    unique = len(set(words))
    connectives = sum(1 for w in words if w in _CONNECTIVES)

    return {
        "word_count": n,
        "sentence_count": sentences,
        "unique_words": unique,
        "type_token_ratio": round(unique / n, 4) if n else 0.0,
        "mean_sentence_words": round(mean_len, 2),
        "sentence_length_sd": round(variance ** 0.5, 2),
        "connective_count": connectives,
        "connective_density": round(connectives / n, 4) if n else 0.0,
        "is_blank": n == 0,
    }


# ── heuristic deltas ──────────────────────────────────────────────────────────
def _length_delta(m: dict, min_words: int) -> float:
    n = m["word_count"]
    if n == 0:
        return -99.0                       # blank → clamp to the floor
    if min_words and n < min_words * 0.6:
        return -1.0
    if min_words and n < min_words:
        return -0.5
    if min_words and n >= min_words * 1.4:
        return 0.5
    return 0.0


def _variety_delta(m: dict) -> float:
    """Type-token ratio, length-normalised — TTR falls naturally as texts grow."""
    if m["is_blank"]:
        return -99.0
    ttr = m["type_token_ratio"]
    floor = 0.38 if m["word_count"] > 200 else 0.45
    if ttr >= floor + 0.15:
        return 0.5
    if ttr < floor - 0.08:
        return -0.5
    return 0.0


def _structure_delta(m: dict) -> float:
    if m["is_blank"]:
        return -99.0
    delta = 0.0
    if m["sentence_count"] >= 5 and m["sentence_length_sd"] >= 4.0:
        delta += 0.5                       # a real mix of simple and complex sentences
    elif m["sentence_count"] <= 2 or m["sentence_length_sd"] < 1.5:
        delta -= 0.5                       # one long run-on, or monotone clauses
    if m["mean_sentence_words"] > 40:
        delta -= 0.5                       # likely unpunctuated run-ons
    return delta


def _cohesion_delta(m: dict) -> float:
    if m["is_blank"]:
        return -99.0
    density = m["connective_density"]
    if 0.02 <= density <= 0.09:
        return 0.5
    if density < 0.01:
        return -0.5
    if density > 0.14:
        return -0.5                        # over-used connectives (a band-5 marker)
    return 0.0


# criterion label → which deltas apply to it
_DELTA_MAP = {
    "Task Fulfilment": ("length",),
    "Organization & Development": ("structure", "cohesion"),
    "Language Use": ("structure",),
    "Vocabulary": ("variety",),
    "Delivery": ("length", "structure"),
    "Topic Development": ("length", "cohesion"),
    "TR": ("length",),
    "CC": ("cohesion", "structure"),
    "LR": ("variety",),
    "GRA": ("structure",),
    "FC": ("length", "cohesion"),
    "PRO": ("length",),
}

_DELTA_FN = {
    "length": _length_delta,
    "variety": lambda m, _min: _variety_delta(m),
    "structure": lambda m, _min: _structure_delta(m),
    "cohesion": lambda m, _min: _cohesion_delta(m),
}


def _criterion_score(criterion: str, m: dict, min_words: int, max_score: float) -> float:
    centre = _CENTRE.get(max_score, max_score / 2)
    delta = 0.0
    for name in _DELTA_MAP.get(criterion, ("length",)):
        delta += _DELTA_FN[name](m, min_words)
    value = centre + max(delta, -2.0)
    value = min(max(value, _FLOOR.get(max_score, 0.0)), _CEILING.get(max_score, max_score))
    if m["is_blank"]:
        value = 0.0
    return round_half_up_to_half(value)


def criteria_for(scale_key: str, skill: str) -> tuple[str, ...]:
    return CRITERIA.get((scale_key, skill), CRITERIA[(TOEFL, "writing")])


def max_score_for(scale_key: str, skill: str) -> float:
    return MAX_SCORE.get((scale_key, skill), 5.0)


def _comment(criterion: str, m: dict, min_words: int, lang: str) -> str:
    note = _REVIEW_NOTE.get(lang, _REVIEW_NOTE["en"])
    if m["is_blank"]:
        return ("No response recorded. " if lang != "ko" else "제출된 답안이 없습니다. ") + note
    facts = (
        f"{m['word_count']} words"
        + (f" (min {min_words}{'' if m['word_count'] >= min_words else ' — short'})" if min_words else "")
        + f", {m['sentence_count']} sentences"
        + f", TTR {m['type_token_ratio']:.2f}"
        + f", sentence-length SD {m['sentence_length_sd']:.1f}"
        + f", {m['connective_count']} connectives"
    )
    return f"[{criterion}] {facts}. {note}"


# ── public entry point ────────────────────────────────────────────────────────
def draft(
    skill: str,
    text: str,
    *,
    scale_key: str = TOEFL,
    min_words: int = 0,
    lang: str = "en",
    response_count: int = 1,
) -> list[dict]:
    """Rule-based rubric rows for one skill. Never raises, never touches the network."""
    skill = (skill or "").strip().lower() or "writing"
    scale_key = scale_key if scale_key in (TOEFL, IELTS) else TOEFL
    if not min_words:
        min_words = DEFAULT_MIN_WORDS.get(skill, 0) * max(response_count, 1)

    m = measure(text)
    top = max_score_for(scale_key, skill)
    is_band = scale_key == IELTS

    rows: list[dict] = []
    for criterion in criteria_for(scale_key, skill):
        value = _criterion_score(criterion, m, min_words, top)
        rows.append(
            {
                "skill": skill,
                "criterion": criterion,
                "score": value,
                "max_score": top,
                "band": value if is_band else None,
                "comment": _comment(criterion, m, min_words, lang),
                "source": DRAFT_SOURCE,
                "origin": "offline",
                "metrics": m,
            }
        )
    return rows


__all__ = [
    "CRITERIA",
    "DEFAULT_MIN_WORDS",
    "DRAFT_SOURCE",
    "MAX_SCORE",
    "criteria_for",
    "draft",
    "max_score_for",
    "measure",
]
