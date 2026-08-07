"""
Phase-1 gate: does Gemma 4 agree with SMEAG's human examiners well enough to
put in front of a student?

Usage
-----
    # self-test the metric implementation (no data, no GPU needed)
    python3 qa/calibrate.py --selftest

    # simulate a goldset to size the study before collecting real data
    python3 qa/calibrate.py --simulate --n 300 --ai-bias 0.3 --ai-noise 0.55

    # run against a real goldset
    python3 qa/calibrate.py --goldset data/goldset.csv

Goldset CSV columns
-------------------
    submission_id, human_overall, human_TR, human_CC, human_LR, human_GRA,
    ai_overall,    ai_TR,    ai_CC,    ai_LR,    ai_GRA

Decision rule (from the phase plan)
-----------------------------------
    QWK >= 0.70 on overall band, AND the 95% CI lower bound >= 0.65
        -> PASS, proceed to the Capital pilot class
    0.60 <= QWK < 0.70
        -> TUNE: prompt work first, then SFT on Vertex if prompts plateau
    QWK < 0.60
        -> STOP. Do not proceed to phase 2.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from qa.metrics import (  # noqa: E402
    agreement_report,
    bootstrap_ci,
    min_n_for_gate,
    quadratic_weighted_kappa,
)

CRITERIA = ("TR", "CC", "LR", "GRA")
GATE_PASS = 0.70
GATE_CI_FLOOR = 0.65
GATE_STOP = 0.60


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------

def selftest() -> int:
    rng = np.random.default_rng(7)
    grid = np.arange(4.0, 9.0 + 0.01, 0.5)
    h = rng.choice(grid, size=500)
    failures = []

    def check(name, cond, detail=""):
        print(f"  {'PASS' if cond else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
        if not cond:
            failures.append(name)

    print("QWK self-test")
    k_identical = quadratic_weighted_kappa(h, h)
    check("identical raters -> 1.0", abs(k_identical - 1.0) < 1e-9, f"got {k_identical:.6f}")

    rand = rng.choice(grid, size=500)
    k_rand = quadratic_weighted_kappa(h, rand)
    check("independent raters -> ~0", abs(k_rand) < 0.12, f"got {k_rand:.4f}")

    # A constant off-by-half-band rater should score high but not 1.0.
    k_shift = quadratic_weighted_kappa(h, np.clip(h + 0.5, 1.0, 9.0))
    check("uniform +0.5 shift -> high, <1", 0.80 < k_shift < 1.0, f"got {k_shift:.4f}")

    # Quadratic weighting must punish a 2-band error far harder than a 0.5-band one.
    small = quadratic_weighted_kappa(h, np.clip(h + 0.5, 1, 9))
    large = quadratic_weighted_kappa(h, np.clip(h + 2.0, 1, 9))
    check("2.0 shift penalised more than 0.5", large < small, f"{large:.4f} < {small:.4f}")

    # Symmetry: kappa(a,b) == kappa(b,a)
    b = rng.choice(grid, size=500)
    check("symmetric", abs(quadratic_weighted_kappa(h, b) - quadratic_weighted_kappa(b, h)) < 1e-12)

    # Invalid input must raise, not silently mis-score.
    for bad, why in [([6.3, 7.0], "off-grid band"), ([0.5, 7.0], "below scale")]:
        try:
            quadratic_weighted_kappa(bad, [6.0, 7.0])
            check(f"rejects {why}", False)
        except ValueError:
            check(f"rejects {why}", True)

    # Fixed grid: restricting the sample's range must not change how a given
    # pair of ratings is scored relative to the full scale.
    narrow_h, narrow_a = [6.0, 6.5, 7.0], [6.5, 6.5, 7.0]
    k_narrow = quadratic_weighted_kappa(narrow_h, narrow_a)
    check("narrow-range sample scores finitely", np.isfinite(k_narrow), f"got {k_narrow:.4f}")

    print(f"\n  suggested goldset size for a +/-0.05 halfwidth: n = {min_n_for_gate()}")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


# --------------------------------------------------------------------------
# simulation — size the study before spending examiner hours
# --------------------------------------------------------------------------

def simulate(n=300, ai_bias=0.3, ai_noise=0.55, seed=20260806):
    """
    Generate a plausible goldset. `ai_bias` is systematic generosity in bands,
    `ai_noise` is the SD of random disagreement. Defaults are set to what an
    untuned instruction-following model typically shows on band scoring:
    generous by a third of a band, noisy by about half a band.
    """
    rng = np.random.default_rng(seed)
    # Real cohort band distribution is roughly normal around 5.8, clipped.
    true = np.clip(rng.normal(5.8, 0.9, size=n), 3.0, 8.5)

    def to_grid(x):
        return np.clip(np.round(x * 2) / 2, 1.0, 9.0)

    # Human examiners are not ground truth either — they carry ~0.35 band of
    # their own noise. Ignoring this makes the AI look worse than it is.
    human = to_grid(true + rng.normal(0, 0.35, size=n))
    ai = to_grid(true + ai_bias + rng.normal(0, ai_noise, size=n))
    return human, ai


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def verdict(qwk, ci_lo):
    if qwk >= GATE_PASS and ci_lo >= GATE_CI_FLOOR:
        return "PASS", "proceed to the Capital pilot class"
    if qwk >= GATE_PASS:
        return "PASS (weak)", (
            f"point estimate clears {GATE_PASS:.2f} but the CI floor is {ci_lo:.3f} "
            f"< {GATE_CI_FLOOR:.2f} — enlarge the goldset before committing")
    if qwk >= GATE_STOP:
        return "TUNE", "prompt iteration first; SFT on Vertex only if prompts plateau"
    return "STOP", "do not proceed to phase 2 — scores are not defensible"


def report(human, ai, per_criterion=None, label="overall"):
    rep = agreement_report(human, ai)
    lo, hi = bootstrap_ci(human, ai, "qwk")
    v, advice = verdict(rep["qwk"], lo)

    print(f"\n{'=' * 66}")
    print(f"  AI vs human agreement — {label}   (n={rep['n']})")
    print(f"{'=' * 66}")
    print(f"  QWK                    {rep['qwk']:.3f}   95% CI [{lo:.3f}, {hi:.3f}]")
    print(f"  exact agreement        {rep['exact_agreement'] * 100:5.1f}%")
    print(f"  within 0.5 band        {rep['within_0_5'] * 100:5.1f}%")
    print(f"  within 1.0 band        {rep['within_1_0'] * 100:5.1f}%")
    print(f"  MAE                    {rep['mae_bands']:.3f} bands")
    print(f"  bias (AI - human)      {rep['bias_bands']:+.3f} bands"
          f"   {'(AI generous)' if rep['bias_bands'] > 0.05 else ''}"
          f"{'(AI harsh)' if rep['bias_bands'] < -0.05 else ''}")
    print(f"  SD of difference       {rep['sd_diff']:.3f} bands")
    print(f"  mean band              human {rep['human_mean']:.2f}  |  AI {rep['ai_mean']:.2f}")
    print(f"\n  VERDICT: {v} — {advice}")

    if rep["bias_bands"] > 0.15:
        print(f"\n  NOTE: a systematic {rep['bias_bands']:+.2f} band bias is the cheapest thing")
        print( "  to fix. Tighten the rubric's tie-breaking rule toward the lower band")
        print( "  and re-run before considering fine-tuning.")

    if per_criterion:
        print(f"\n  {'criterion':<12}{'QWK':>8}{'MAE':>8}{'bias':>9}")
        print(f"  {'-' * 37}")
        for name, (h, a) in per_criterion.items():
            r = agreement_report(h, a)
            print(f"  {name:<12}{r['qwk']:>8.3f}{r['mae_bands']:>8.3f}{r['bias_bands']:>+9.3f}")
        worst = min(per_criterion, key=lambda k: agreement_report(*per_criterion[k])["qwk"])
        print(f"\n  weakest criterion: {worst} — target rubric work here first")
    return rep


def load_goldset(path):
    rows = list(csv.DictReader(Path(path).open(encoding="utf-8-sig")))
    if not rows:
        raise SystemExit(f"{path} is empty")
    human = [float(r["human_overall"]) for r in rows]
    ai = [float(r["ai_overall"]) for r in rows]
    per = {}
    for c in CRITERIA:
        hk, ak = f"human_{c}", f"ai_{c}"
        if hk in rows[0] and ak in rows[0]:
            per[c] = ([float(r[hk]) for r in rows], [float(r[ak]) for r in rows])
    return human, ai, per


def main():
    ap = argparse.ArgumentParser(description="AI vs human band-score calibration")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--goldset")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--ai-bias", type=float, default=0.3)
    ap.add_argument("--ai-noise", type=float, default=0.55)
    args = ap.parse_args()

    if args.selftest:
        raise SystemExit(selftest())

    if args.goldset:
        h, a, per = load_goldset(args.goldset)
        report(h, a, per, label=Path(args.goldset).name)
        return

    if args.simulate:
        print(f"SIMULATED goldset — n={args.n}, injected AI bias {args.ai_bias:+.2f} bands, "
              f"noise SD {args.ai_noise:.2f}")
        print("These are not measurements. Replace with a real goldset before deciding anything.")
        h, a = simulate(args.n, args.ai_bias, args.ai_noise)
        report(h, a, label=f"simulated n={args.n}")

        print(f"\n\n{'=' * 66}")
        print("  Sensitivity: what would it take to clear the gate?")
        print(f"{'=' * 66}")
        print(f"  {'bias':>6}{'noise':>8}{'QWK':>9}{'CI low':>9}   verdict")
        print(f"  {'-' * 50}")
        for bias in (0.0, 0.15, 0.30, 0.50):
            for noise in (0.35, 0.55, 0.75):
                hh, aa = simulate(args.n, bias, noise, seed=20260806)
                k = quadratic_weighted_kappa(hh, aa)
                lo, _ = bootstrap_ci(hh, aa, "qwk", n_boot=600)
                v, _ = verdict(k, lo)
                print(f"  {bias:>+6.2f}{noise:>8.2f}{k:>9.3f}{lo:>9.3f}   {v}")
        print("\n  Read this as: noise dominates. Halving the AI's random disagreement")
        print("  buys more kappa than removing its bias entirely — but bias is far")
        print("  cheaper to fix, so fix bias first and measure again.")
        return

    ap.print_help()


if __name__ == "__main__":
    main()
