"""LLM 단가표 — 토큰 수를 금액으로 바꾸는 유일한 지점.

돈이 걸린 모듈이라 세 가지를 지킨다.

1. **정수만 쓴다.** 금액 단위는 마이크로달러(1/1,000,000 USD)다. float 로 곱하면
   호출 수만 명 단위에서 반올림 오차가 쌓여 정산이 어긋난다. 단가도 "100만 토큰당
   마이크로달러"라는 정수로 적는다 — $3.00/MTok 은 3_000_000 이다.

2. **단가에 유효기간이 있다.** 상수 하나로 박아 두면 가격이 바뀐 날부터 조용히 틀린
   금액을 보여 준다. 실제로 `claude-sonnet-5` 는 도입가($2/$10)가 2026-08-31 에
   끝나고 그 다음 날 정가($3/$15)로 오른다 — 이 저장소의 기본 모델이 그것이다
   (config.py 의 ANTHROPIC_MODEL 기본값). 그래서 (시작일, 종료일, 입력가, 출력가)
   구간 목록으로 적고, 호출 시각이 속한 구간을 고른다.

3. **모르는 값은 비워 둔다.** 확인되지 않은 단가를 그럴듯하게 채우면 그 숫자가
   그대로 경영 판단에 쓰인다. 단가를 모르면 cost 는 None 이고, 호출 원장에는
   토큰 수만 남는다(`llm_usage.cost_micros IS NULL`). 관리 화면은 그 몫을
   "단가 미등록"으로 따로 세어 보여 준다.

## 출처
Anthropic 공개 단가(platform.claude.com/docs/en/pricing). 캐시 배수도 같은 문서다.
갱신할 때는 PRICE_VERSION 을 함께 올린다 — 원장 행이 그때의 버전을 들고 있어서,
표를 고쳐도 과거 기록이 소급 변조되지 않는다.

OpenAI 단가는 developers.openai.com/api/docs/pricing (Standard tier) 를 2026-08-10 에
확인해 넣었다. 두 프로바이더의 캐시 과금 방식이 다르다는 점이 이 표의 구조를 정했다:
Anthropic 은 모델과 무관하게 읽기 0.1× / 쓰기 1.25× 로 균일한데, OpenAI 는 읽기
할인율이 모델마다 다르고(0.5×~0.1×) 쓰기는 과금하지 않는다. 그래서 배수 상수 하나로
계산하지 않고 Rate 에 네 축을 모두 적는다.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import NamedTuple

# 표를 고칠 때마다 올린다. 원장 행에 그대로 저장된다.
PRICE_VERSION = "2026-08-10"

# 금액 단위. 1 USD = 1_000_000 마이크로달러.
MICROS_PER_USD = 1_000_000
TOKENS_PER_MTOK = 1_000_000


def _usd(amount: str) -> int:
    """'3.00' → 3_000_000. 문자열로 받는다 — float 리터럴을 아예 만들지 않기 위해서."""
    whole, _, frac = amount.partition(".")
    frac = (frac + "000000")[:6]
    return int(whole) * MICROS_PER_USD + int(frac)


class Rate(NamedTuple):
    """1M 토큰당 마이크로달러. 네 축을 모두 명시한다 — 캐시 배수가 프로바이더마다 다르다."""

    input: int
    output: int
    cache_read: int
    cache_write: int


def _anthropic(price_in: str, price_out: str) -> Rate:
    """Anthropic 은 캐시 배수가 모델과 무관하게 균일하다: 읽기 0.1×, 쓰기 1.25×(5분 TTL)."""
    base = _usd(price_in)
    return Rate(base, _usd(price_out), base // 10, base * 5 // 4)


def _openai(price_in: str, price_out: str, cache_read: str) -> Rate:
    """OpenAI 는 캐시 읽기 할인율이 **모델마다 다르다**(gpt-4o 0.5× · gpt-4.1 0.25× · gpt-5 0.1×).

    그래서 배수로 계산하지 않고 공식 표의 값을 그대로 적는다. 캐시 쓰기는 별도로
    과금하지 않으므로(자동 캐싱) 0 이다 — Anthropic 과 다른 지점이라 명시해 둔다.
    """
    return Rate(_usd(price_in), _usd(price_out), _usd(cache_read), 0)


# (모델) -> ((시작일, 종료일|None, Rate), ...)
# 종료일은 그 날까지 포함이다. None 은 "아직 다음 가격이 예고되지 않음".
ANTHROPIC_PRICES: dict[str, tuple[tuple[date, date | None, Rate], ...]] = {
    "claude-opus-5":     ((date(2026, 1, 1), None, _anthropic("5.00", "25.00")),),
    "claude-opus-4-8":   ((date(2026, 1, 1), None, _anthropic("5.00", "25.00")),),
    "claude-opus-4-7":   ((date(2026, 1, 1), None, _anthropic("5.00", "25.00")),),
    "claude-opus-4-6":   ((date(2026, 1, 1), None, _anthropic("5.00", "25.00")),),
    "claude-fable-5":    ((date(2026, 1, 1), None, _anthropic("10.00", "50.00")),),
    # 도입가 → 정가. 이 저장소의 기본 모델이라 구간이 실제로 넘어간다.
    "claude-sonnet-5":   ((date(2026, 1, 1), date(2026, 8, 31), _anthropic("2.00", "10.00")),
                          (date(2026, 9, 1), None, _anthropic("3.00", "15.00"))),
    "claude-sonnet-4-6": ((date(2026, 1, 1), None, _anthropic("3.00", "15.00")),),
    "claude-haiku-4-5":  ((date(2026, 1, 1), None, _anthropic("1.00", "5.00")),),
}

# 출처: developers.openai.com/api/docs/pricing (Standard tier, 2026-08-10 확인).
# config.py 의 OPENAI_MODEL 기본값이 gpt-4o 다.
OPENAI_PRICES: dict[str, tuple[tuple[date, date | None, Rate], ...]] = {
    "gpt-4o":       ((date(2026, 1, 1), None, _openai("2.50", "10.00", "1.25")),),
    "gpt-4o-mini":  ((date(2026, 1, 1), None, _openai("0.15", "0.60", "0.075")),),
    "gpt-4.1":      ((date(2026, 1, 1), None, _openai("2.00", "8.00", "0.50")),),
    "gpt-4.1-mini": ((date(2026, 1, 1), None, _openai("0.40", "1.60", "0.10")),),
    "gpt-5":        ((date(2026, 1, 1), None, _openai("1.25", "10.00", "0.125")),),
}

PRICES: dict[str, dict[str, tuple[tuple[date, date | None, Rate], ...]]] = {
    "anthropic": ANTHROPIC_PRICES,
    "openai": OPENAI_PRICES,
}

# 스킬별 라우트도 원장에는 프로바이더 이름으로 남는다(llm.py). 어느 단가표를 볼지
# 여기서 정한다 — 라우트 이름을 그대로 조회하면 전부 "단가 미등록"이 되어,
# 라우팅을 켠 순간 사용량 화면의 금액이 통째로 비어 버린다.
#
# gemma 는 일부러 비워 둔다. 자체 호스팅에는 토큰 단가가 없다 — 실제 비용은
# 전기요금과 장비 상각이고, 그건 호출 원장이 아니라 smeag-local-ai/roi 의
# 몫이다. cost_micros 는 NULL 로 남고, 그것이 "0원"이 아니라 "여기서 셀 수
# 없는 비용"이라는 뜻이다(models.py LlmUsage 문서 참조).
PROVIDER_ALIASES: dict[str, str] = {
    "codex": "openai",      # Codex 는 OpenAI 단가표를 따른다
    "gemma": "",            # 자체 호스팅 — 토큰 단가 없음
}


def pricing_provider(provider: str) -> str:
    """원장의 프로바이더 이름 → 단가표 이름. 자체 호스팅이면 빈 문자열."""
    raw = (provider or "").strip().lower()
    return PROVIDER_ALIASES.get(raw, raw)


def normalize_model(model: str | None) -> str:
    """단가표 조회용 키. 날짜 접미사가 붙은 스냅샷 ID 를 별칭으로 되돌린다."""
    raw = (model or "").strip()
    if not raw:
        return ""
    if raw in ANTHROPIC_PRICES or raw in OPENAI_PRICES:
        return raw
    # 'claude-haiku-4-5-20251001' → 'claude-haiku-4-5'
    parts = raw.split("-")
    while len(parts) > 1:
        parts.pop()
        candidate = "-".join(parts)
        if candidate in ANTHROPIC_PRICES or candidate in OPENAI_PRICES:
            return candidate
    return raw


def rate_for(provider: str, model: str, when: date | None = None) -> Rate | None:
    """그 날짜에 유효한 Rate. 단가를 모르면 None."""
    table = PRICES.get(pricing_provider(provider))
    if not table:
        return None
    tiers = table.get(normalize_model(model))
    if not tiers:
        return None
    day = when or datetime.now(timezone.utc).date()
    for start, until, rate in tiers:
        if day >= start and (until is None or day <= until):
            return rate
    return None


def _mtok_cost(tokens: int, per_mtok_micros: int) -> int:
    """토큰 × 단가. 정수 나눗셈이라 버림 — 마이크로달러 단위에서는 무시할 수 있다."""
    if tokens <= 0 or per_mtok_micros <= 0:
        return 0
    return tokens * per_mtok_micros // TOKENS_PER_MTOK


def cost_micros(
    provider: str,
    model: str,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    when: date | None = None,
) -> int | None:
    """이 호출의 금액(마이크로달러). 단가를 모르면 None — 0 이 아니다.

    0 을 돌려주면 "공짜로 썼다"가 되어 집계가 조용히 틀린다. None 은 "모른다"이고,
    관리 화면이 그 몫을 따로 세도록 하는 것이 이 구분의 목적이다.
    """
    rate = rate_for(provider, model, when)
    if rate is None:
        return None
    return (
        _mtok_cost(input_tokens, rate.input)
        + _mtok_cost(output_tokens, rate.output)
        + _mtok_cost(cache_read_tokens, rate.cache_read)
        + _mtok_cost(cache_write_tokens, rate.cache_write)
    )


def format_usd(micros: int | None, *, places: int = 2) -> str:
    """화면 표기용. None 은 '—' 로, 아주 작은 금액은 0 으로 접히지 않게 자릿수를 늘린다."""
    if micros is None:
        return "—"
    if micros and places == 2 and micros < MICROS_PER_USD // 100:
        places = 4
    scale = 10 ** places
    scaled = micros * scale // MICROS_PER_USD
    return f"${scaled // scale}.{scaled % scale:0{places}d}"


__all__ = [
    "ANTHROPIC_PRICES",
    "Rate",
    "OPENAI_PRICES",
    "PRICE_VERSION",
    "cost_micros",
    "format_usd",
    "normalize_model",
    "rate_for",
]
