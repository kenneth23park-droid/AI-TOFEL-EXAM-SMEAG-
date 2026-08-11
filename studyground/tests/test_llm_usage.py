"""LLM 사용량 계측·단가 — 돈이 걸린 경로라 경계를 전부 못 박는다.

실행: studyground/.venv/bin/python -m pytest studyground/tests/test_llm_usage.py -q

여기서 지키려는 계약은 넷이다.
  1. 금액은 정수(마이크로달러)다. 어디에도 float 이 끼지 않는다.
  2. 단가에는 유효기간이 있다 — 같은 모델도 날짜가 넘어가면 단가가 바뀐다.
  3. 단가를 모르면 None 이지 0 이 아니다. "공짜"와 "모름"은 다른 사실이다.
  4. 계측은 절대 본 기능을 깨뜨리지 않는다 — 수집기가 없어도, 인자가 이상해도.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.scoring import pricing, usage  # noqa: E402


# ── 1. 정수 단가 ──────────────────────────────────────────────────────────────


def test_usd_helper_never_produces_a_float():
    assert pricing._usd("3.00") == 3_000_000
    assert pricing._usd("0.10") == 100_000
    assert isinstance(pricing._usd("2.50"), int)


def test_cost_is_an_int_not_a_float():
    cost = pricing.cost_micros(
        "anthropic", "claude-opus-5", input_tokens=1000, output_tokens=500,
        when=date(2026, 8, 10),
    )
    assert isinstance(cost, int)


def test_opus_cost_matches_the_published_rate():
    """1M 입력 + 1M 출력 = $5 + $25 = $30."""
    cost = pricing.cost_micros(
        "anthropic", "claude-opus-5",
        input_tokens=1_000_000, output_tokens=1_000_000, when=date(2026, 8, 10),
    )
    assert cost == 30 * pricing.MICROS_PER_USD


# ── 2. 유효기간 ───────────────────────────────────────────────────────────────
# 이 저장소의 기본 모델(claude-sonnet-5)은 도입가가 2026-08-31 에 끝난다.
# 상수 하나로 박아 두었다면 9월 1일부터 조용히 33% 싸게 집계됐을 자리다.


@pytest.mark.parametrize(
    ("day", "expect_in", "expect_out"),
    [
        (date(2026, 8, 10), 2_000_000, 10_000_000),   # 도입가 기간
        (date(2026, 8, 31), 2_000_000, 10_000_000),   # 마지막 날 — 포함이다
        (date(2026, 9, 1), 3_000_000, 15_000_000),    # 바로 다음 날 정가
        (date(2027, 1, 1), 3_000_000, 15_000_000),
    ],
)
def test_sonnet5_price_switches_on_the_documented_date(day, expect_in, expect_out):
    rate = pricing.rate_for("anthropic", "claude-sonnet-5", day)
    assert (rate.input, rate.output) == (expect_in, expect_out)


def test_the_same_call_costs_more_after_the_intro_period_ends():
    args = dict(input_tokens=1_000_000, output_tokens=1_000_000)
    before = pricing.cost_micros("anthropic", "claude-sonnet-5", when=date(2026, 8, 31), **args)
    after = pricing.cost_micros("anthropic", "claude-sonnet-5", when=date(2026, 9, 1), **args)
    assert before == 12 * pricing.MICROS_PER_USD
    assert after == 18 * pricing.MICROS_PER_USD


# ── 3. 모르는 단가는 None ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("provider", "model"),
    [
        ("openai", "gpt-9-unreleased"),
        ("anthropic", "not-a-model"),
        ("anthropic", ""),
        ("nobody", "claude-opus-5"),
    ],
)
def test_unknown_rate_is_none_not_zero(provider, model):
    """0 은 '공짜로 썼다'가 되어 집계를 조용히 망친다. 모르면 모른다고 해야 한다."""
    assert pricing.cost_micros(provider, model, input_tokens=1_000_000) is None


def test_snapshot_model_ids_fold_back_to_the_priced_alias():
    assert pricing.normalize_model("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    rate = pricing.rate_for("anthropic", "claude-haiku-4-5-20251001", date(2026, 8, 10))
    assert (rate.input, rate.output) == (1_000_000, 5_000_000)


# ── 캐시 토큰 ─────────────────────────────────────────────────────────────────


def test_cache_read_is_a_tenth_of_input_and_write_is_more_than_input():
    day = date(2026, 8, 10)
    plain = pricing.cost_micros("anthropic", "claude-opus-5", input_tokens=1_000_000, when=day)
    read = pricing.cost_micros("anthropic", "claude-opus-5", cache_read_tokens=1_000_000, when=day)
    write = pricing.cost_micros("anthropic", "claude-opus-5", cache_write_tokens=1_000_000, when=day)
    assert read == plain // 10
    assert write > plain


# ── 표기 ──────────────────────────────────────────────────────────────────────


def test_format_usd_shows_none_as_a_dash_not_zero():
    assert pricing.format_usd(None) == "—"
    assert pricing.format_usd(0) == "$0.00"


def test_tiny_amounts_do_not_collapse_to_zero_on_screen():
    """한 호출은 몇 센트다. 2자리로 자르면 전부 $0.00 으로 보여 무의미해진다."""
    assert pricing.format_usd(1_500) != "$0.00"


# ── 4. 계측은 본 기능을 깨뜨리지 않는다 ───────────────────────────────────────


def test_record_without_a_collector_is_dropped_silently():
    assert usage.record(scope="feedback", provider="anthropic", model="claude-opus-5") is None


def test_record_survives_a_bad_argument():
    with usage.collecting() as collected:
        assert usage.record(nonsense_field=1) is None
        assert collected.records == []


def test_collector_captures_and_prices_a_call():
    with usage.collecting() as collected:
        usage.record(
            scope="rubric", provider="anthropic", model="claude-opus-5",
            input_tokens=1_000_000, output_tokens=1_000_000, latency_ms=800,
        )
    assert len(collected.records) == 1
    row = collected.records[0]
    assert row.cost_micros == 30 * pricing.MICROS_PER_USD
    assert row.price_version == pricing.PRICE_VERSION


def test_collectors_do_not_leak_into_each_other():
    with usage.collecting() as first:
        usage.record(scope="a", provider="anthropic", model="claude-opus-5")
        with usage.collecting() as second:
            usage.record(scope="b", provider="anthropic", model="claude-opus-5")
        usage.record(scope="c", provider="anthropic", model="claude-opus-5")
    assert [r.scope for r in first.records] == ["a", "c"]
    assert [r.scope for r in second.records] == ["b"]


def test_a_failed_call_is_still_recorded():
    """폴백률을 세려면 실패도 원장에 있어야 한다."""
    with usage.collecting() as collected:
        usage.record(scope="feedback", provider="anthropic", model="claude-opus-5",
                     ok=False, error="RuntimeError: boom")
    assert collected.records[0].ok is False
    assert collected.records[0].error.startswith("RuntimeError")


def test_totals_count_unpriced_calls_separately():
    with usage.collecting() as collected:
        usage.record(scope="x", provider="anthropic", model="claude-opus-5",
                     input_tokens=1_000_000)
        usage.record(scope="y", provider="openai", model="gpt-9-unreleased",
                     input_tokens=1_000_000)
    summary = usage.totals(collected.records)
    assert summary["calls"] == 2
    assert summary["unpriced_calls"] == 1
    # 단가를 아는 호출의 금액만 더한다 — 모르는 호출을 0 으로 섞지 않는다.
    assert summary["cost_micros"] == 5 * pricing.MICROS_PER_USD


def test_totals_of_nothing_is_all_zero():
    assert usage.totals([])["calls"] == 0
    assert usage.totals([])["cost_micros"] == 0


# ── OpenAI 단가 (출처: developers.openai.com/api/docs/pricing, Standard tier) ──
# Anthropic 처럼 "입력가 × 0.1" 로 계산하면 안 된다. 모델마다 다르고, 쓰기는 무료다.


@pytest.mark.parametrize(
    ("model", "price_in", "price_out", "cache_read"),
    [
        ("gpt-4o", 2_500_000, 10_000_000, 1_250_000),        # 캐시 읽기 0.5×
        ("gpt-4o-mini", 150_000, 600_000, 75_000),           # 0.5×
        ("gpt-4.1", 2_000_000, 8_000_000, 500_000),          # 0.25×
        ("gpt-4.1-mini", 400_000, 1_600_000, 100_000),       # 0.25×
        ("gpt-5", 1_250_000, 10_000_000, 125_000),           # 0.1×
    ],
)
def test_openai_rates_match_the_published_table(model, price_in, price_out, cache_read):
    rate = pricing.rate_for("openai", model, date(2026, 8, 10))
    assert rate.input == price_in
    assert rate.output == price_out
    assert rate.cache_read == cache_read


def test_openai_cache_discount_is_not_a_flat_tenth_like_anthropic():
    """이 차이를 놓치면 gpt-4o 캐시 비용을 5분의 1로 과소 집계한다."""
    day = date(2026, 8, 10)
    gpt4o = pricing.rate_for("openai", "gpt-4o", day)
    gpt5 = pricing.rate_for("openai", "gpt-5", day)
    assert gpt4o.cache_read * 10 != gpt4o.input      # 0.1× 가 아니다
    assert gpt4o.cache_read * 2 == gpt4o.input       # 0.5× 다
    assert gpt5.cache_read * 10 == gpt5.input        # 같은 프로바이더인데 0.1× 다


def test_openai_does_not_bill_for_cache_writes():
    """Anthropic 은 캐시 쓰기에 1.25× 를 매기지만 OpenAI 는 자동 캐싱이라 0 이다."""
    day = date(2026, 8, 10)
    assert pricing.rate_for("openai", "gpt-4o", day).cache_write == 0
    assert pricing.rate_for("anthropic", "claude-opus-5", day).cache_write > 0
    assert pricing.cost_micros("openai", "gpt-4o", cache_write_tokens=1_000_000, when=day) == 0


def test_gpt4o_cost_matches_the_published_rate():
    """1M 입력 + 1M 출력 = $2.50 + $10.00 = $12.50."""
    cost = pricing.cost_micros(
        "openai", "gpt-4o",
        input_tokens=1_000_000, output_tokens=1_000_000, when=date(2026, 8, 10),
    )
    assert cost == 12_500_000
    assert pricing.format_usd(cost) == "$12.50"


def test_both_providers_are_priced_so_a_fallback_is_still_counted():
    """llm_provider='both' 는 폴백 구조다 — 넘어간 쪽도 금액이 잡혀야 한다."""
    with usage.collecting() as collected:
        usage.record(scope="rubric", provider="anthropic", model="claude-sonnet-5",
                     ok=False, error="RuntimeError: overloaded")
        usage.record(scope="rubric", provider="openai", model="gpt-4o",
                     input_tokens=30_000, output_tokens=2_000)
    summary = usage.totals(collected.records)
    assert summary["failed"] == 1
    assert summary["unpriced_calls"] == 0
    assert summary["cost_micros"] > 0
