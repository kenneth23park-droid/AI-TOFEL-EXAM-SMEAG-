"""Score scale adapters — architecture.md 9 (Story 6.4).

Two scales share one Protocol so the rest of the app never branches on the exam
profile:

    toefl120  → sections /30, total /120, CEFR grade, band_score = None
    ielts9    → sections and total are Bands 0..9 in 0.5 steps, grade "Band 6.5"

Everything here is pure and offline: no DB, no network, no new dependency.
The IELTS raw→band table lives in `ielts_band_table.json` next to this file so a
measured table replaces the ⚠️assumed one without a code change.
"""

from __future__ import annotations

import json
import logging
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.models import SECTION_MAX, TOTAL_MAX, cefr_for

log = logging.getLogger("studyground.scoring")

BAND_TABLE_PATH = Path(__file__).resolve().parent / "ielts_band_table.json"

TOEFL = "toefl120"
IELTS = "ielts9"
SCALE_KEYS = (TOEFL, IELTS)

# profile ('toefl'|'ielts') → scale key, for callers that only carry the profile.
PROFILE_TO_SCALE = {"toefl": TOEFL, "ielts": IELTS}


# ── rounding ──────────────────────────────────────────────────────────────────
def round_half_up(x: float) -> int:
    """Whole-number rounding that always sends .5 up.

    The built-in `round()` is banker's rounding (round(0.5) == 0), which is not
    what a score report is expected to do.
    """
    return int(Decimal(str(float(x))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def round_half_up_to_half(x: float) -> float:
    """Round to the nearest 0.5; .25 and .75 always go UP (architecture.md 9.4).

    IELTS hard rule from `rubrics/ielts_writing_task2.md`. `Decimal` is mandatory
    here — the built-in `round()` would send 6.25 to 6.2 (banker's rounding).
    """
    doubled = Decimal(str(float(x))) * 2
    return float(doubled.quantize(Decimal("1"), rounding=ROUND_HALF_UP) / 2)


def _mean(values: list[float]) -> float:
    return (sum(values) / len(values)) if values else 0.0


def _rubric_values(rubrics: list[dict], *, prefer_band: bool) -> list[float]:
    """Pull the usable number out of each rubric row, skipping unusable ones."""
    out: list[float] = []
    for row in rubrics or []:
        if not isinstance(row, dict):
            continue
        value = row.get("band") if prefer_band else row.get("score")
        if value is None:
            value = row.get("score") if prefer_band else row.get("band")
        try:
            out.append(float(value))
        except (TypeError, ValueError):
            continue
    return out


# ── Protocol ──────────────────────────────────────────────────────────────────
@runtime_checkable
class ScoreScale(Protocol):
    """architecture.md 9.1. Implementations are stateless and reusable."""

    key: str
    section_max: float
    total_max: float

    def section_score(self, raw_correct: float, raw_total: float) -> float: ...
    def combine(self, sections: dict[str, float]) -> float: ...
    def grade(self, total: float) -> str: ...
    def display(self, value: float) -> str: ...
    def rubric_to_section(self, rubrics: list[dict]) -> float: ...


# ── TOEFL ─────────────────────────────────────────────────────────────────────
class Toefl120Scale:
    """The existing behaviour, made explicit. No stored TOEFL value changes."""

    key = TOEFL
    section_max: float = float(SECTION_MAX)      # 30
    total_max: float = float(TOTAL_MAX)          # 120
    uses_band = False

    def section_score(self, raw_correct: float, raw_total: float, *, skill: str = "") -> float:
        if not raw_total:
            return 0.0
        ratio = float(raw_correct) / float(raw_total)
        ratio = min(max(ratio, 0.0), 1.0)
        return float(round_half_up(ratio * self.section_max))

    def combine(self, sections: dict[str, float]) -> float:
        """Sum of the scaled sections — identical to crud.recalc_totals."""
        return float(round_half_up(sum(float(v) for v in (sections or {}).values())))

    def grade(self, total: float) -> str:
        return cefr_for(int(round_half_up(total)))

    def display(self, value: float, maximum: float | None = None) -> str:
        top = self.section_max if maximum is None else float(maximum)
        return f"{round_half_up(value)}/{round_half_up(top)}"

    def rubric_to_section(self, rubrics: list[dict]) -> float:
        """⚠️ 가설(검증필요) — proportional, not the real TOEFL conversion table."""
        earned = _rubric_values(rubrics, prefer_band=False)
        if not earned:
            return 0.0
        maxes: list[float] = []
        for row in rubrics or []:
            try:
                maxes.append(float(row.get("max_score") or 0))
            except (TypeError, ValueError):
                maxes.append(0.0)
        total_max = sum(maxes)
        if total_max <= 0:
            return 0.0
        return self.section_score(sum(earned), total_max)

    def band_score(self, total: float) -> float | None:
        return None

    def storage_total(self, total: float) -> int:
        """architecture.md 9.5 — attempts.total_score is an integer column."""
        return int(round_half_up(total))


# ── IELTS ─────────────────────────────────────────────────────────────────────
class Ielts9Scale:
    """Bands everywhere. Raw→band comes from the JSON table, never from code."""

    key = IELTS
    section_max: float = 9.0
    total_max: float = 9.0
    uses_band = True

    def __init__(self, table_path: Path | None = None) -> None:
        self._path = Path(table_path) if table_path else BAND_TABLE_PATH
        self._table: dict | None = None

    # -- table -----------------------------------------------------------------
    def _load(self) -> dict:
        if self._table is None:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                tables = raw.get("tables") or {}
                self._table = {
                    "raw_total": float(raw.get("raw_total") or 40),
                    "tables": {
                        skill: sorted(
                            [
                                {"min": float(r["min"]), "band": float(r["band"])}
                                for r in rows
                                if isinstance(r, dict) and "min" in r and "band" in r
                            ],
                            key=lambda r: r["min"],
                            reverse=True,
                        )
                        for skill, rows in tables.items()
                    },
                }
            except Exception as exc:  # noqa: BLE001 — a missing table must not stop scoring
                log.warning("ielts band table unusable (%s) — falling back to linear", exc)
                self._table = {"raw_total": 40.0, "tables": {}}
        return self._table

    def band_for_raw(self, raw_correct: float, raw_total: float, skill: str = "") -> float:
        table = self._load()
        rows = table["tables"].get((skill or "").strip().lower())
        if not rows:
            # No table for this skill: proportional fallback, logged, never an error.
            log.info("no IELTS band table for skill %r — using a linear estimate", skill)
            ratio = (float(raw_correct) / float(raw_total)) if raw_total else 0.0
            return round_half_up_to_half(min(max(ratio, 0.0), 1.0) * self.section_max)

        # Normalise onto the table's own raw scale (papers are not always /40).
        scale_total = float(raw_total) if raw_total else table["raw_total"]
        normalised = float(raw_correct) * (table["raw_total"] / scale_total) if scale_total else 0.0

        for row in rows:                       # rows are sorted high → low
            if normalised >= row["min"]:
                return float(row["band"])

        lowest = rows[-1]
        log.info(
            "raw %.2f is below every band bracket for %r — applying the lowest bracket (band %.1f)",
            normalised, skill, lowest["band"],
        )
        return float(lowest["band"])

    # -- ScoreScale ------------------------------------------------------------
    def section_score(self, raw_correct: float, raw_total: float, *, skill: str = "") -> float:
        return round_half_up_to_half(self.band_for_raw(raw_correct, raw_total, skill))

    def combine(self, sections: dict[str, float]) -> float:
        values: list[float] = []
        for v in (sections or {}).values():
            try:
                values.append(float(v))
            except (TypeError, ValueError):
                continue
        return round_half_up_to_half(_mean(values))

    def grade(self, total: float) -> str:
        return f"Band {round_half_up_to_half(total):.1f}"

    def display(self, value: float, maximum: float | None = None) -> str:
        return f"{round_half_up_to_half(value):.1f}"

    def rubric_to_section(self, rubrics: list[dict]) -> float:
        """Arithmetic mean of the criterion bands (ielts_writing_task2.md hard rule)."""
        return round_half_up_to_half(_mean(_rubric_values(rubrics, prefer_band=True)))

    def band_score(self, total: float) -> float | None:
        return round_half_up_to_half(total)

    def storage_total(self, total: float) -> int:
        """architecture.md 9.5 — band × 10 so the integer column still sorts."""
        return int(round_half_up(round_half_up_to_half(total) * 10))


_TOEFL_SINGLETON = Toefl120Scale()
_IELTS_SINGLETON = Ielts9Scale()


def get_scale(key: str | None) -> ScoreScale:
    """`'ielts9'`/`'ielts'` → Band scale; anything else (incl. None) → TOEFL."""
    raw = (key or "").strip().lower()
    raw = PROFILE_TO_SCALE.get(raw, raw)
    if raw == IELTS:
        return _IELTS_SINGLETON
    if raw and raw != TOEFL:
        log.info("unknown scale key %r — defaulting to %s", key, TOEFL)
    return _TOEFL_SINGLETON


__all__ = [
    "BAND_TABLE_PATH",
    "IELTS",
    "Ielts9Scale",
    "SCALE_KEYS",
    "ScoreScale",
    "TOEFL",
    "Toefl120Scale",
    "get_scale",
    "round_half_up",
    "round_half_up_to_half",
]
