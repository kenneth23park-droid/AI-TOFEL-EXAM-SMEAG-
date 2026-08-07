"""
Gemma 4 scoring client for the SMEAG private-network stack.

Talks to a local vLLM server over its OpenAI-compatible endpoint. Two things
this module enforces that a plain API call does not:

  1. Schema-constrained decoding (vLLM `guided_json`), so the model physically
     cannot emit a malformed band report.
  2. Self-consistency: N independent scorings per submission, aggregated by
     median, with a spread gate that routes unstable cases to a human.

No network egress: base_url defaults to the campus GPU box.
"""

from __future__ import annotations

import json
import os
import statistics
import urllib.error
import urllib.request
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

RUBRIC_DIR = Path(__file__).parent / "rubrics"
SCHEMA_DIR = Path(__file__).parent / "schemas"

# IELTS bands are half-steps. Everything internal works in half-band integer
# units (band * 2) so that rounding is exact and QWK gets integer categories.
HALF_BAND = 0.5
MIN_BAND, MAX_BAND = 1.0, 9.0


def snap_band(x: float) -> float:
    """Round to the nearest half band, clamped to the IELTS scale."""
    snapped = round(x / HALF_BAND) * HALF_BAND
    return float(min(MAX_BAND, max(MIN_BAND, snapped)))


def ielts_overall(criterion_bands: list[float]) -> float:
    """
    Official IELTS overall rounding: mean of criteria, then .25 rounds UP to the
    next half band and .75 rounds UP to the next whole band.

    Python's round() is banker's rounding (round-half-to-even), which would send
    6.25 -> 6.0. That is wrong here, so the arithmetic is done explicitly.
    """
    mean = sum(criterion_bands) / len(criterion_bands)
    halves = mean / HALF_BAND
    # +0.5 then floor == round-half-UP, which is what IELTS specifies.
    rounded_halves = int(halves + 0.5)
    return float(min(MAX_BAND, max(MIN_BAND, rounded_halves * HALF_BAND)))


@dataclass
class ScoringConfig:
    base_url: str = os.environ.get("SMEAG_LLM_URL", "http://10.0.0.20:8000/v1")
    model: str = os.environ.get("SMEAG_LLM_MODEL", "google/gemma-4-26b-a4b-it")
    api_key: str = os.environ.get("SMEAG_LLM_KEY", "local-no-auth")
    # Self-consistency. 3 samples at low temperature is the cost/stability knee.
    n_samples: int = 3
    temperature: float = 0.2
    top_p: float = 0.9
    max_tokens: int = 2048
    # If the spread across samples on ANY criterion exceeds this many bands,
    # the result is not trusted and is queued for a human scorer.
    max_spread_bands: float = 1.0
    timeout_s: int = 180


@dataclass
class ScoringResult:
    ok: bool
    overall_band: float | None
    criteria: dict[str, float] = field(default_factory=dict)
    report: dict[str, Any] | None = None        # the median-sample full report
    samples: list[dict[str, Any]] = field(default_factory=list)
    spread: dict[str, float] = field(default_factory=dict)
    needs_human: bool = False
    reason: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)


class GemmaScorer:
    def __init__(self, cfg: ScoringConfig | None = None):
        self.cfg = cfg or ScoringConfig()

    # ---------- transport -------------------------------------------------

    def _post(self, path: str, payload: dict) -> dict:
        req = urllib.request.Request(
            f"{self.cfg.base_url.rstrip('/')}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.cfg.api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.cfg.timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _complete(self, system: str, user: str, schema: dict) -> dict:
        """One schema-constrained completion. Returns the parsed object."""
        payload = {
            "model": self.cfg.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.cfg.temperature,
            "top_p": self.cfg.top_p,
            "max_tokens": self.cfg.max_tokens,
            # vLLM structured output. Both spellings are accepted across
            # versions; sending the modern one plus the legacy extra_body key
            # keeps this working on 0.6.x and 0.9.x servers alike.
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "band_report", "schema": schema, "strict": True},
            },
            "guided_json": schema,
            "guided_decoding_backend": "xgrammar",
        }
        data = self._post("/chat/completions", payload)
        return json.loads(data["choices"][0]["message"]["content"])

    # ---------- scoring ---------------------------------------------------

    def score_writing_task2(self, prompt: str, response_text: str) -> ScoringResult:
        system = (RUBRIC_DIR / "ielts_writing_task2.md").read_text(encoding="utf-8")
        schema = json.loads(
            (SCHEMA_DIR / "ielts_writing_task2.schema.json").read_text(encoding="utf-8")
        )
        user = (
            "## Task 2 prompt\n"
            f"{prompt.strip()}\n\n"
            "## Student response\n"
            f"{response_text.strip()}\n\n"
            "Assess this response. Output only the JSON band report."
        )
        return self._score_with_consistency(
            system, user, schema, criterion_keys=("TR", "CC", "LR", "GRA")
        )

    def score_speaking(self, part_no: int, question: str, transcript: str,
                       fluency_metrics: dict | None = None) -> ScoringResult:
        system = (RUBRIC_DIR / "ielts_speaking.md").read_text(encoding="utf-8")
        schema = json.loads(
            (SCHEMA_DIR / "ielts_speaking.schema.json").read_text(encoding="utf-8")
        )
        metrics_block = ""
        if fluency_metrics:
            # Timing facts come from ASR word timestamps, never from the LLM's
            # guess. Handing them over as ground truth stops it hallucinating
            # a speech rate it cannot actually measure from text.
            metrics_block = (
                "\n## Measured fluency metrics (authoritative, computed from audio)\n"
                + json.dumps(fluency_metrics, indent=2)
            )
        user = (
            f"## Part {part_no} question\n{question.strip()}\n\n"
            f"## ASR transcript of the student's answer\n{transcript.strip()}"
            f"{metrics_block}\n\n"
            "Assess this answer. Output only the JSON band report."
        )
        return self._score_with_consistency(
            system, user, schema, criterion_keys=("FC", "LR", "GRA", "PRO")
        )

    def _score_with_consistency(self, system: str, user: str, schema: dict,
                                criterion_keys: tuple[str, ...]) -> ScoringResult:
        samples: list[dict] = []
        errors: list[str] = []
        for _ in range(self.cfg.n_samples):
            try:
                samples.append(self._complete(system, user, schema))
            except (urllib.error.URLError, json.JSONDecodeError, KeyError) as exc:
                errors.append(f"{type(exc).__name__}: {exc}")

        if not samples:
            return ScoringResult(
                ok=False, overall_band=None, needs_human=True,
                reason="all samples failed: " + "; ".join(errors),
            )

        per_criterion: dict[str, list[float]] = {k: [] for k in criterion_keys}
        for s in samples:
            for k in criterion_keys:
                per_criterion[k].append(float(s["criteria"][k]["band"]))

        medians = {k: snap_band(statistics.median(v)) for k, v in per_criterion.items()}
        spread = {k: max(v) - min(v) for k, v in per_criterion.items()}
        overall = ielts_overall([medians[k] for k in criterion_keys])

        worst = max(spread.values())
        needs_human = worst > self.cfg.max_spread_bands
        reason = ""
        if needs_human:
            unstable = [k for k, v in spread.items() if v > self.cfg.max_spread_bands]
            reason = (f"unstable criteria {unstable}: spread {worst:.1f} bands "
                      f"> gate {self.cfg.max_spread_bands:.1f}")
        if errors:
            reason = (reason + " | " if reason else "") + f"{len(errors)} sample(s) failed"

        # Return the sample whose overall is closest to the aggregated overall,
        # so the prose feedback the student reads matches the score they get.
        best = min(samples, key=lambda s: abs(float(s["overall_band"]) - overall))
        best = dict(best)
        best["overall_band"] = overall
        for k in criterion_keys:
            best["criteria"][k]["band"] = medians[k]

        return ScoringResult(
            ok=True, overall_band=overall, criteria=medians, report=best,
            samples=samples, spread=spread, needs_human=needs_human, reason=reason,
        )


def verify_evidence(report: dict, submission: str, criterion_keys) -> list[str]:
    """
    Anti-hallucination check. Every `evidence` span must appear verbatim in the
    student's submission. Returns the list of spans that do not.

    This is the cheapest guard in the whole stack and it catches the failure
    mode that destroys trust fastest: a quote the student never wrote.
    """
    haystack = " ".join(submission.split())
    missing = []
    for k in criterion_keys:
        for span in report.get("criteria", {}).get(k, {}).get("evidence", []):
            if " ".join(span.split()) not in haystack:
                missing.append(f"{k}: {span!r}")
    return missing
