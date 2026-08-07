"""
Local Gemma 4 vs cloud API — cost model for the SMEAG AI scoring stack.

Answers three questions management will ask:
  1. What does each option cost per month as we roll out 3 campuses?
  2. When does the on-prem investment pay back?
  3. Which assumption, if wrong, flips the decision?

Run:
    python3 roi/roi_model.py
    python3 roi/roi_model.py --params roi/params.json --csv out.csv

Everything is driven by roi/params.json. No hidden constants.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent


# --------------------------------------------------------------------------
# demand
# --------------------------------------------------------------------------

def active_students(p, month):
    """Enrolled students at campuses live in this month, scaled by active ratio."""
    total = sum(c["students"] for c in p["campuses"] if month >= c["start_month"])
    return total * p["usage"]["active_student_ratio"]


def live_campuses(p, month):
    return [c for c in p["campuses"] if month >= c["start_month"]]


def monthly_volume(p, month):
    """Task counts and token totals for one month."""
    u, t = p["usage"], p["tokens"]
    n = active_students(p, month)
    d = u["study_days_per_month"]

    writing = n * u["writing_tasks_per_student_per_day"] * d
    speaking = n * u["speaking_answers_per_student_per_day"] * d
    coaching = n * u["coaching_turns_per_student_per_day"] * d

    tok_in = (writing * t["writing_in"] * t["writing_samples"]
              + speaking * t["speaking_in"] * t["speaking_samples"]
              + coaching * t["coaching_in"] * t["coaching_samples"])
    tok_out = (writing * t["writing_out"] * t["writing_samples"]
               + speaking * t["speaking_out"] * t["speaking_samples"]
               + coaching * t["coaching_out"] * t["coaching_samples"])

    return {
        "students": n,
        "writing": writing,
        "speaking": speaking,
        "coaching": coaching,
        "scored_tasks": writing + speaking,
        "tok_in": tok_in,
        "tok_out": tok_out,
        # Speaking answers average ~1.5 min of audio -> ASR hours.
        "audio_hours": speaking * 1.5 / 60.0,
        # Coaching replies get spoken back to the student.
        "tts_chars": coaching * t["coaching_out"] * 4.0,
    }


# --------------------------------------------------------------------------
# cost — cloud
# --------------------------------------------------------------------------

def voice_cost(p, month):
    """Hosted ASR + TTS. Charged only when the voice stack runs in the cloud."""
    v = monthly_volume(p, month)
    c = p["cloud"]
    return (v["audio_hours"] * c["asr_per_audio_hour"],
            v["tts_chars"] / 1e6 * c["tts_per_million_chars"])


def review_cost(p, month):
    """Human re-scoring. Identical in both scenarios — a shared cost, not a differentiator."""
    v = monthly_volume(p, month)
    return (v["scored_tasks"] * p["staff"]["human_review_rate"]
            * p["staff"]["examiner_cost_per_review"])


def cloud_month_cost(p, month, voice_cloud=True):
    """
    voice_cloud: whether ASR/TTS is billed to a hosted vendor in this scenario.

    This flag exists because the voice stack is a SEPARATE decision from the
    LLM. Charging hosted TTS to the cloud scenario while giving the on-prem
    scenario Kokoro for free does not compare Gemma-4-local against
    Gemma-4-hosted — it compares ElevenLabs against Kokoro, and at these
    volumes that difference is large enough to swamp the LLM entirely.
    Keep the voice stack identical on both sides to see the real LLM decision.
    """
    v = monthly_volume(p, month)
    c = p["cloud"]
    hit = c["cache_hit_ratio"]

    cached_in = v["tok_in"] * hit
    fresh_in = v["tok_in"] * (1 - hit)
    llm = (fresh_in / 1e6 * c["input_per_mtok"]
           + cached_in / 1e6 * c["cached_input_per_mtok"]
           + v["tok_out"] / 1e6 * c["output_per_mtok"])
    asr, tts = voice_cost(p, month) if voice_cloud else (0.0, 0.0)
    review = review_cost(p, month)
    return {"llm": llm, "asr": asr, "tts": tts, "review": review,
            "capex": 0.0, "total": llm + asr + tts + review}


# --------------------------------------------------------------------------
# cost — local
# --------------------------------------------------------------------------

def gpus_required(p, month):
    """
    How many GPU servers the load needs, from output-token throughput.

    Peak-hour bunching is handled by utilisation_ceiling: a box that can
    theoretically emit X tokens/month is only credited with 60% of X, because
    demand arrives in bursts at the end of each class block.
    """
    v = monthly_volume(p, month)
    th = p["local"]["throughput"]
    seconds_available = p["local"]["hours_powered_per_day"] * 3600 * p["usage"]["study_days_per_month"]
    capacity = th["tokens_per_second_output"] * seconds_available * th["utilisation_ceiling"]
    if capacity <= 0:
        raise ValueError("throughput capacity is zero — check params")
    by_load = math.ceil(v["tok_out"] / capacity) if v["tok_out"] > 0 else 0
    # Each live campus needs its own box: the whole point is that a campus keeps
    # working when the inter-campus link is down. So the floor is one per campus.
    by_site = len(live_campuses(p, month))
    return max(by_load, by_site)


def local_month_cost(p, month, gpu_history, voice_cloud=False):
    """
    gpu_history is a mutable dict {month: gpus_owned} carried across the loop,
    so capex is charged only when a NEW box is bought, and the fleet never
    shrinks (you don't sell a GPU back when demand dips).
    """
    lo = p["local"]
    need = gpus_required(p, month)
    owned_before = gpu_history.get(month - 1, 0)
    owned = max(owned_before, need)
    gpu_history[month] = owned
    bought = owned - owned_before

    unit_capex = (lo["gpu_server_capex"] + lo["ups_network_capex"]
                  + lo["cooling_capex"] + lo["install_capex"])
    capex = bought * unit_capex
    if month == 1:
        capex += p["staff"]["setup_one_off"]

    kwh = ((lo["gpu_watts_avg"] + lo["server_idle_watts"]) / 1000.0
           * lo["hours_powered_per_day"] * 30 * lo["pue"] * owned)
    power = kwh * lo["electricity_per_kwh"]
    maint = lo["maintenance_per_month"] * owned
    staff = p["staff"]["ml_engineer_monthly"]

    review = review_cost(p, month)
    asr, tts = voice_cost(p, month) if voice_cloud else (0.0, 0.0)

    return {"capex": capex, "power": power, "maint": maint, "staff": staff,
            "review": review, "asr": asr, "tts": tts,
            "gpus": owned, "bought": bought,
            "total": capex + power + maint + staff + review + asr + tts}


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------

#: How the ASR/TTS stack is treated on each side of the comparison.
#:   "isolate_llm" — both sides run Kokoro/Whisper on their own hardware.
#:                   This is the only framing that answers "should we buy GPUs
#:                   to run Gemma 4 instead of calling a hosted model?"
#:   "split"       — cloud side buys hosted ASR/TTS, local side self-hosts.
#:                   Realistic if you would genuinely never self-host voice,
#:                   but it bundles two decisions into one number.
#:   "voice_cloud" — both sides buy hosted ASR/TTS.
VOICE_MODES = {
    "isolate_llm": (False, False),   # (cloud_side_pays_hosted_voice, local_side_pays)
    "split":       (True,  False),
    "voice_cloud": (True,  True),
}


def simulate(p, voice_mode="isolate_llm"):
    cloud_voice, local_voice = VOICE_MODES[voice_mode]
    rows = []
    gpu_history = {}
    cum_cloud = cum_local = 0.0
    for m in range(1, p["horizon_months"] + 1):
        v = monthly_volume(p, m)
        cl = cloud_month_cost(p, m, voice_cloud=cloud_voice)
        lc = local_month_cost(p, m, gpu_history, voice_cloud=local_voice)
        cum_cloud += cl["total"]
        cum_local += lc["total"]
        rows.append({
            "month": m,
            "campuses": len(live_campuses(p, m)),
            "students": v["students"],
            "scored_tasks": v["scored_tasks"],
            "tok_out_m": v["tok_out"] / 1e6,
            "gpus": lc["gpus"],
            "cloud_month": cl["total"],
            "local_month": lc["total"],
            "local_capex": lc["capex"],
            "cum_cloud": cum_cloud,
            "cum_local": cum_local,
            "cum_delta": cum_cloud - cum_local,
        })
    return rows


def breakeven_month(rows):
    """First month where cumulative local cost drops below cumulative cloud AND stays there."""
    for i, r in enumerate(rows):
        if r["cum_delta"] > 0 and all(x["cum_delta"] > 0 for x in rows[i:]):
            return r["month"]
    return None


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------

def money(x):
    return f"${x:,.0f}"


def print_breakdown(p, voice_mode):
    """Steady-state monthly composition. Read this BEFORE the breakeven number."""
    cloud_voice, local_voice = VOICE_MODES[voice_mode]
    m = p["horizon_months"]
    cl = cloud_month_cost(p, m, voice_cloud=cloud_voice)
    gh = {}
    for mm in range(1, m + 1):
        lc = local_month_cost(p, mm, gh, voice_cloud=local_voice)

    print(f"\n  steady-state monthly composition (month {m}, voice_mode={voice_mode})")
    print(f"  {'component':<22}{'cloud':>12}{'local':>12}   note")
    print("  " + "-" * 66)
    rows = [
        ("LLM inference", cl["llm"], lc["power"] + lc["maint"] + lc["staff"],
         "local = power+maint+staff"),
        ("hosted ASR", cl["asr"], lc["asr"], ""),
        ("hosted TTS", cl["tts"], lc["tts"], ""),
        ("human review", cl["review"], lc["review"], "identical both sides"),
    ]
    for name, c, l, note in rows:
        print(f"  {name:<22}{money(c):>12}{money(l):>12}   {note}")
    print("  " + "-" * 66)
    print(f"  {'total (ex-capex)':<22}{money(cl['total']):>12}{money(lc['total']):>12}")

    shared = cl["review"]
    if cl["total"] > 0 and shared / cl["total"] > 0.25:
        print(f"\n  {shared / cl['total']:.0%} of the cloud total is human review, which both")
        print( "  scenarios pay. The LLM decision is smaller than the headline total.")


def print_report(p, rows, voice_mode="isolate_llm"):
    be = breakeven_month(rows)
    H = p["horizon_months"]
    last = rows[-1]

    print("=" * 78)
    print(f"  SMEAG AI scoring — local Gemma 4 vs cloud API   [voice_mode={voice_mode}]")
    print("=" * 78)
    print(f"  horizon {H} months   |   campuses: "
          + ", ".join(f"{c['name']}(m{c['start_month']})" for c in p["campuses"]))
    print(f"  peak load: {last['students']:.0f} active students, "
          f"{last['scored_tasks']:,.0f} scored tasks/mo, "
          f"{last['tok_out_m']:,.1f}M output tokens/mo")

    print(f"\n  {'mo':>3}{'camp':>6}{'stud':>7}{'tasks':>9}{'GPUs':>6}"
          f"{'cloud/mo':>11}{'local/mo':>11}{'cum cloud':>12}{'cum local':>12}{'delta':>11}")
    print("  " + "-" * 88)
    for r in rows:
        if r["month"] <= 3 or r["month"] % 3 == 0 or r["local_capex"] > 0 or r["month"] == be:
            mark = " <-BE" if r["month"] == be else ""
            print(f"  {r['month']:>3}{r['campuses']:>6}{r['students']:>7.0f}"
                  f"{r['scored_tasks']:>9,.0f}{r['gpus']:>6}"
                  f"{money(r['cloud_month']):>11}{money(r['local_month']):>11}"
                  f"{money(r['cum_cloud']):>12}{money(r['cum_local']):>12}"
                  f"{money(r['cum_delta']):>11}{mark}")

    print(f"\n  {'-' * 88}")
    print(f"  {H}-month total   cloud {money(last['cum_cloud'])}"
          f"   |   local {money(last['cum_local'])}"
          f"   |   saving {money(last['cum_delta'])}")
    if be:
        print(f"  breakeven: month {be}")
    else:
        print("  breakeven: NEVER within the horizon — cloud is cheaper at this volume")

    steady = rows[-1]
    print(f"  steady-state cost per scored task:  "
          f"cloud ${steady['cloud_month'] / steady['scored_tasks']:.4f}  |  "
          f"local ${steady['local_month'] / steady['scored_tasks']:.4f}")


def sensitivity(p, voice_mode="isolate_llm"):
    """
    One-at-a-time sweep. Reports breakeven month and 36-month delta, so it is
    visible which assumption actually decides the purchase.
    """
    print(f"\n{'=' * 78}")
    print("  Sensitivity — which assumption decides this?")
    print("=" * 78)

    def run(mutate, label):
        q = json.loads(json.dumps(p))
        mutate(q)
        rows = simulate(q, voice_mode)
        be = breakeven_month(rows)
        return label, be, rows[-1]["cum_delta"], rows[-1]["gpus"]

    cases = []
    for mult in (0.5, 1.0, 2.0):
        cases.append(run(
            lambda q, m=mult: q["local"]["throughput"].update(
                tokens_per_second_output=q["local"]["throughput"]["tokens_per_second_output"] * m),
            f"GPU throughput x{mult}"))
    for mult in (0.5, 1.0, 2.0):
        cases.append(run(
            lambda q, m=mult: q["cloud"].update(
                input_per_mtok=q["cloud"]["input_per_mtok"] * m,
                output_per_mtok=q["cloud"]["output_per_mtok"] * m,
                cached_input_per_mtok=q["cloud"]["cached_input_per_mtok"] * m),
            f"cloud token price x{mult}"))
    for mult in (0.5, 1.0, 2.0):
        cases.append(run(
            lambda q, m=mult: q["usage"].update(
                active_student_ratio=min(1.0, q["usage"]["active_student_ratio"] * m)),
            f"student adoption x{mult}"))
    for n in (1, 3):
        cases.append(run(
            lambda q, k=n: q["tokens"].update(writing_samples=k, speaking_samples=k),
            f"self-consistency n={n}"))
    for price in (5000, 12000):
        cases.append(run(
            lambda q, v=price: q["local"].update(gpu_server_capex=v),
            f"GPU capex {money(price)}"))
    cases.append(run(
        lambda q: q["cloud"].update(cache_hit_ratio=0.0),
        "cloud: no prompt caching"))
    cases.append(run(
        lambda q: q["staff"].update(ml_engineer_monthly=2500),
        "local: +1 FTE engineer"))
    # The site-redundancy floor (1 box per campus), not throughput, is what
    # actually sets the fleet size at this volume. Prove it by removing it.
    cases.append(run(
        lambda q: q["campuses"].__setitem__(
            slice(None), [{"name": "all", "students":
                           sum(c["students"] for c in q["campuses"]), "start_month": 1}]),
        "centralised (no per-site floor)"))

    print(f"  {'scenario':<28}{'breakeven':>12}{'36mo saving':>15}{'GPUs':>7}   decision")
    print("  " + "-" * 74)
    for label, be, delta, gpus in cases:
        be_s = f"month {be}" if be else "never"
        dec = "BUY" if (be and be <= 18) else ("MARGINAL" if be else "STAY CLOUD")
        print(f"  {label:<28}{be_s:>12}{money(delta):>15}{gpus:>7}   {dec}")


def monte_carlo(p, voice_mode="isolate_llm", n_runs=2000, seed=20260806):
    """
    Joint uncertainty. One-at-a-time sweeps understate risk because the bad
    cases correlate: low adoption and low throughput tend to show up together
    in a slow rollout. This samples the key unknowns jointly.
    """
    rng = np.random.default_rng(seed)
    bes, deltas = [], []
    for _ in range(n_runs):
        q = json.loads(json.dumps(p))
        # Lognormal-ish around the point estimate; throughput is the one most
        # likely to disappoint, so its downside tail is fatter.
        q["local"]["throughput"]["tokens_per_second_output"] *= float(
            np.clip(rng.lognormal(-0.12, 0.40), 0.25, 3.0))
        q["cloud"]["input_per_mtok"] *= float(np.clip(rng.lognormal(0, 0.30), 0.4, 3.0))
        q["cloud"]["output_per_mtok"] *= float(np.clip(rng.lognormal(0, 0.30), 0.4, 3.0))
        q["usage"]["active_student_ratio"] = float(
            np.clip(rng.normal(q["usage"]["active_student_ratio"], 0.18), 0.15, 1.0))
        q["local"]["gpu_server_capex"] *= float(np.clip(rng.normal(1.0, 0.18), 0.6, 2.0))
        q["local"]["electricity_per_kwh"] *= float(np.clip(rng.normal(1.0, 0.20), 0.5, 2.0))

        rows = simulate(q, voice_mode)
        be = breakeven_month(rows)
        bes.append(be if be else p["horizon_months"] + 1)
        deltas.append(rows[-1]["cum_delta"])

    bes = np.array(bes, dtype=float)
    deltas = np.array(deltas, dtype=float)
    never = float(np.mean(bes > p["horizon_months"]))

    print(f"\n{'=' * 78}")
    print(f"  Monte Carlo — {n_runs:,} runs, joint uncertainty on the 6 key inputs")
    print("=" * 78)
    print(f"  P(local wins within {p['horizon_months']} months)   {1 - never:.1%}")
    print(f"  P(local never pays back)          {never:.1%}")
    print(f"  breakeven month   p10 {np.quantile(bes, .10):.0f}"
          f"   p50 {np.quantile(bes, .50):.0f}"
          f"   p90 {np.quantile(bes, .90):.0f}"
          f"   (>{p['horizon_months']} = never)")
    print(f"  36-month saving   p10 {money(np.quantile(deltas, .10))}"
          f"   p50 {money(np.quantile(deltas, .50))}"
          f"   p90 {money(np.quantile(deltas, .90))}")
    print(f"  P(saving < 0)                     {float(np.mean(deltas < 0)):.1%}")
    print("\n  Distributions are assumed, not observed. This quantifies the spread")
    print("  implied by the stated uncertainty — it does not validate the point estimates.")


def solve_breakeven_price(p, voice_mode="isolate_llm", max_mult=200.0):
    """
    Invert the question: how expensive must hosted inference be before buying
    GPUs wins within the horizon?

    This is the number that actually drives the decision, because the token
    price in params.json is a placeholder for a cheap mid-tier model. If SMEAG
    would in practice call a frontier model for band scoring, the real price is
    a multiple of what is modelled here, and the answer can flip.

    Bisection on a monotone quantity (cloud cost rises with price, local is
    unaffected), so the first multiple that wins is the boundary.
    """
    def wins(mult):
        q = json.loads(json.dumps(p))
        for k in ("input_per_mtok", "output_per_mtok", "cached_input_per_mtok"):
            q["cloud"][k] *= mult
        return breakeven_month(simulate(q, voice_mode)) is not None

    if wins(1.0):
        return 1.0
    if not wins(max_mult):
        return None

    lo, hi = 1.0, max_mult
    for _ in range(40):
        mid = (lo + hi) / 2
        if wins(mid):
            hi = mid
        else:
            lo = mid
    return hi


def print_price_boundary(p, voice_mode="isolate_llm"):
    mult = solve_breakeven_price(p, voice_mode)
    c = p["cloud"]
    print(f"\n{'=' * 78}")
    print("  Price boundary — how expensive must hosted inference be to justify GPUs?")
    print("=" * 78)
    if mult is None:
        print("  No multiple within the search range flips the decision.")
        return
    print(f"  modelled now   in ${c['input_per_mtok']:.2f} / out ${c['output_per_mtok']:.2f} per Mtok")
    print(f"  boundary       x{mult:.1f}  ->  in ${c['input_per_mtok'] * mult:.2f} "
          f"/ out ${c['output_per_mtok'] * mult:.2f} per Mtok")
    print(f"\n  Above that price, on-prem pays back inside {p['horizon_months']} months.")
    print( "  Below it, the GPU case rests on data sovereignty and offline")
    print( "  resilience — not on cost. Say that plainly in the purchase request;")
    print( "  a cost case that inverts under a price check will not survive review.")


def write_csv(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\n  wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", default=str(HERE / "params.json"))
    ap.add_argument("--csv")
    ap.add_argument("--voice", choices=sorted(VOICE_MODES), default="isolate_llm")
    ap.add_argument("--no-mc", action="store_true")
    ap.add_argument("--compare-framings", action="store_true",
                    help="show breakeven under all three voice modes and stop")
    args = ap.parse_args()

    p = json.loads(Path(args.params).read_text(encoding="utf-8"))

    if args.compare_framings:
        print("=" * 78)
        print("  Framing check — how the voice stack is charged decides the answer")
        print("=" * 78)
        print(f"  {'voice_mode':<16}{'breakeven':>12}{'36mo saving':>15}   what it compares")
        print("  " + "-" * 74)
        what = {
            "isolate_llm": "Gemma-4 local vs hosted LLM (the actual question)",
            "split":       "bundles LLM + ElevenLabs-vs-Kokoro",
            "voice_cloud": "LLM only, both sides buying hosted voice",
        }
        for mode in ("isolate_llm", "split", "voice_cloud"):
            r = simulate(p, mode)
            be = breakeven_month(r)
            print(f"  {mode:<16}{('month ' + str(be)) if be else 'never':>12}"
                  f"{money(r[-1]['cum_delta']):>15}   {what[mode]}")
        print("\n  If these disagree, the headline number is being driven by the voice")
        print("  stack, not by the LLM. Decide the voice stack separately.")
        return

    rows = simulate(p, args.voice)
    print_report(p, rows, args.voice)
    print_breakdown(p, args.voice)
    print_price_boundary(p, args.voice)
    sensitivity(p, args.voice)
    if not args.no_mc:
        monte_carlo(p, args.voice)
    if args.csv:
        write_csv(rows, args.csv)


if __name__ == "__main__":
    main()
