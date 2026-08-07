"""
Agreement metrics for AI-vs-human band scoring.

Pure numpy, no sklearn — the campus GPU boxes run a minimal image and every
extra dependency is one more thing to patch on an air-gapped network.

The unit of analysis is the HALF BAND. IELTS bands are 1.0..9.0 in 0.5 steps,
so we map band -> int(band * 2), giving 17 ordered categories (2..18). QWK is
defined on integer categories and this mapping keeps the quadratic penalty
proportional to the real band distance.
"""

from __future__ import annotations

import numpy as np

BAND_MIN, BAND_MAX = 1.0, 9.0


def to_half_band_ints(bands):
    """Map float bands to integer half-band categories. Validates the scale."""
    a = np.asarray(bands, dtype=float)
    if a.size == 0:
        raise ValueError("empty band array")
    if np.any(a < BAND_MIN) or np.any(a > BAND_MAX):
        bad = a[(a < BAND_MIN) | (a > BAND_MAX)]
        raise ValueError(f"bands outside {BAND_MIN}..{BAND_MAX}: {bad[:5]}")
    doubled = a * 2.0
    if not np.allclose(doubled, np.round(doubled)):
        bad = a[~np.isclose(doubled, np.round(doubled))]
        raise ValueError(f"bands not on the 0.5 grid: {bad[:5]}")
    return np.round(doubled).astype(int)


def quadratic_weighted_kappa(human, ai, band_min=BAND_MIN, band_max=BAND_MAX):
    """
    Cohen's kappa with quadratic weights.

      kappa = 1 - sum(W * O) / sum(W * E)

    W[i,j] = (i-j)^2 / (N-1)^2, O = joint observed counts, E = outer product of
    the marginals scaled to the same total.

    The category grid is fixed to the full band scale, NOT to the categories
    that happen to appear in this sample. That matters: if a goldset contains
    only bands 5.0-7.0, deriving the grid from the data would inflate the
    quadratic penalty and understate kappa relative to another goldset with a
    wider spread. Fixing the grid makes runs comparable across datasets.
    """
    h = to_half_band_ints(human)
    a = to_half_band_ints(ai)
    if h.shape != a.shape:
        raise ValueError(f"length mismatch: human={h.shape} ai={a.shape}")

    lo, hi = int(band_min * 2), int(band_max * 2)
    n_cat = hi - lo + 1
    h_idx, a_idx = h - lo, a - lo

    O = np.zeros((n_cat, n_cat), dtype=float)
    np.add.at(O, (h_idx, a_idx), 1.0)

    hist_h = O.sum(axis=1)
    hist_a = O.sum(axis=0)
    E = np.outer(hist_h, hist_a) / max(O.sum(), 1.0)

    i, j = np.mgrid[0:n_cat, 0:n_cat]
    W = ((i - j) ** 2) / float((n_cat - 1) ** 2)

    denom = float((W * E).sum())
    if denom == 0.0:
        # Both raters put everything in one identical category. Perfect
        # agreement, but kappa is undefined (no chance variance to correct for).
        return 1.0 if np.array_equal(h, a) else 0.0
    return float(1.0 - (W * O).sum() / denom)


def agreement_report(human, ai):
    """Everything a calibration decision needs, in one dict."""
    h = np.asarray(human, dtype=float)
    a = np.asarray(ai, dtype=float)
    diff = a - h
    return {
        "n": int(h.size),
        "qwk": quadratic_weighted_kappa(h, a),
        "exact_agreement": float(np.mean(np.isclose(diff, 0.0))),
        "within_0_5": float(np.mean(np.abs(diff) <= 0.5 + 1e-9)),
        "within_1_0": float(np.mean(np.abs(diff) <= 1.0 + 1e-9)),
        "mae_bands": float(np.mean(np.abs(diff))),
        "bias_bands": float(np.mean(diff)),   # >0 = AI is generous
        "sd_diff": float(np.std(diff, ddof=1)) if h.size > 1 else 0.0,
        "human_mean": float(np.mean(h)),
        "ai_mean": float(np.mean(a)),
    }


def bootstrap_ci(human, ai, stat="qwk", n_boot=2000, alpha=0.05, seed=20260806):
    """
    Percentile bootstrap CI. Report this, not the point estimate alone —
    on n=300 the QWK confidence interval is roughly +/-0.06, which is wide
    enough that a point estimate of 0.72 does not reliably clear a 0.70 gate.
    """
    h = np.asarray(human, dtype=float)
    a = np.asarray(ai, dtype=float)
    n = h.size
    rng = np.random.default_rng(seed)
    vals = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        idx = rng.integers(0, n, size=n)
        rep = agreement_report(h[idx], a[idx])
        vals[b] = rep[stat]
    lo = float(np.quantile(vals, alpha / 2))
    hi = float(np.quantile(vals, 1 - alpha / 2))
    return lo, hi


def min_n_for_gate(gate=0.70, target_halfwidth=0.05):
    """
    Rough sample-size guide. The bootstrap halfwidth of QWK shrinks ~1/sqrt(n);
    empirically on band data the halfwidth is ~1.05/sqrt(n). To resolve whether
    the true QWK clears `gate` with a halfwidth of `target_halfwidth`:
    """
    return int(np.ceil((1.05 / target_halfwidth) ** 2))
