"""Deterministic per-question scoring — pure functions, no DB, no network.

architecture.md §8.3 (`autoscore` node) and epics-and-stories.md Story 3.4 AC2:

    MCQ / INSERT     integer choice index must match
    CLOZE / WORD_FILLING   `strip().lower()` string equality
    BUILD_SENTENCE   token list must match `answerTokens` in order (no partial credit)
    WRITING / SPEAKING     not machine-scorable → None (a teacher grades it)

Every function here is total: it never raises on odd client input, it returns 0.0
instead. A malformed answer is a wrong answer, never a 500 (B7 / F12 in spirit).
"""

from __future__ import annotations

from typing import Any

# Question kinds this module can decide on its own.
AUTO_QTYPES = ("MCQ", "INSERT", "CLOZE", "WORD_FILLING", "BUILD_SENTENCE")
# Question kinds that always wait for a human.
PRODUCTIVE_QTYPES = ("WRITING", "SPEAKING")


def normalize_text(value: Any) -> str:
    """Case- and surrounding-whitespace-insensitive form used for text answers.

    Inner runs of whitespace collapse too: the drag/tile widgets can emit
    'brain  ' or 'the\\ncat', and neither should count as a different word.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    return " ".join(str(value).split()).strip().lower()


def as_index(value: Any) -> int | None:
    """Choice index from whatever the client sent ('2', 2, 2.0) — else None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if float(value).is_integer() else None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def as_tokens(value: Any) -> list[str] | None:
    """Token list for BUILD_SENTENCE. A list wins; a string is split on spaces."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        # Unfilled blanks arrive as null/'' — keep them so a gap can never match.
        return [normalize_text(v) for v in value]
    text = normalize_text(value)
    return text.split(" ") if text else []


def is_blank(value: Any) -> bool:
    """True when the student left the question untouched."""
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict)):
        return len(value) == 0
    return False


# ── per-qtype scorers: (answer, key) -> 0.0 | 1.0 ──────────────────────────


def score_mcq(answer: Any, key: Any) -> float:
    a, k = as_index(answer), as_index(key)
    return 1.0 if (a is not None and k is not None and a == k) else 0.0


# INSERT is "which of the four {{A}}..{{D}} markers" — the same integer compare.
score_insert = score_mcq


def score_cloze(answer: Any, key: Any) -> float:
    a, k = normalize_text(answer), normalize_text(key)
    return 1.0 if (k != "" and a == k) else 0.0


# WORD_FILLING ('fill in the missing letters') uses the identical text rule.
score_word_filling = score_cloze


def joined(tokens: Any) -> str:
    """Token list → the sentence it spells, normalized.

    Tiles are not always single words ('to make', 'from scratch' in W1), so the
    stored `student_answer` cannot be split back into the original tiles. The
    sentence the tiles spell is the comparable, and it is still fully
    order-sensitive with no partial credit.
    """
    seq = as_tokens(tokens)
    return "" if seq is None else normalize_text(" ".join(t for t in seq if t))


def score_build_sentence(answer: Any, key: Any) -> float:
    expected = joined(key)
    if not expected:
        return 0.0
    # A gap left unfilled shortens the sentence, so it can never match.
    return 1.0 if joined(answer) == expected else 0.0


SCORERS = {
    "MCQ": score_mcq,
    "INSERT": score_insert,
    "CLOZE": score_cloze,
    "WORD_FILLING": score_word_filling,
    "BUILD_SENTENCE": score_build_sentence,
}


def score(qtype: str, answer: Any, key: Any) -> float | None:
    """One question → 0.0 / 1.0, or None when no machine can decide it.

    None means 'needs a human' (WRITING, SPEAKING, or an unknown qtype), which is
    exactly what `question_responses.auto_score IS NULL` encodes.
    An unanswered auto-scorable question is 0.0, not None — it was gradeable.
    """
    fn = SCORERS.get((qtype or "").strip().upper())
    if fn is None:
        return None
    if is_blank(answer):
        return 0.0
    try:
        return fn(answer, key)
    except Exception:  # noqa: BLE001 — a weird payload is a wrong answer, not a crash
        return 0.0


def display_answer(qtype: str, value: Any) -> str:
    """Human-readable form stored in `student_answer` / `correct_answer`."""
    if value is None:
        return ""
    kind = (qtype or "").strip().upper()
    if kind == "BUILD_SENTENCE":
        tokens = value if isinstance(value, (list, tuple)) else [value]
        return " ".join("" if t is None else str(t) for t in tokens).strip()
    if kind in ("MCQ", "INSERT"):
        idx = as_index(value)
        return "" if idx is None else str(idx)
    return str(value)


__all__ = [
    "AUTO_QTYPES",
    "PRODUCTIVE_QTYPES",
    "SCORERS",
    "as_index",
    "as_tokens",
    "display_answer",
    "is_blank",
    "joined",
    "normalize_text",
    "score",
    "score_build_sentence",
    "score_cloze",
    "score_insert",
    "score_mcq",
    "score_word_filling",
]
