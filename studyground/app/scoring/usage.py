"""LLM 호출 사용량 수집 — 계측과 저장 사이의 얇은 층.

## 왜 반환값이 아니라 수집기인가
채점 그래프(nodes.py / graph.py)는 DB 를 모르는 순수 함수 묶음이다. 사용량을
반환값에 실어 올리려면 ScoringState → FeedbackBundle → 라우터까지 계약을 전부
넓혀야 하고, 그러면 "그래프는 순수하다"는 설계가 깨진다. 대신 호출 지점(llm.py)이
contextvar 수집기에 한 줄씩 적고, 요청을 여는 쪽(routers/scores.py)이 그것을
비워서 저장한다. 그래프 코드는 한 줄도 바뀌지 않는다.

contextvar 라서 요청마다 격리된다 — FastAPI 가 동시에 여러 요청을 처리해도
서로의 호출이 섞이지 않는다. 수집기가 열려 있지 않으면(로컬 모드, 테스트,
단독 호출) record() 는 조용히 버린다: 계측이 본래 기능을 깨뜨리면 안 된다.

## 실패한 호출도 적는다
llm_provider='both' 는 폴백 구조라 앞 프로바이더가 죽으면 뒤가 이어받는다. 그
실패도 한 행으로 남긴다(ok=False) — 폴백률은 개발자 화면의 핵심 지표이고,
응답을 받다가 끊긴 경우엔 토큰을 이미 태웠을 수도 있어서다.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator

from app.scoring import pricing

log = logging.getLogger("studyground.scoring")


@dataclass
class UsageRecord:
    """LLM API 호출 한 번. 그대로 llm_usage 한 행이 된다."""

    scope: str = ""
    provider: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    latency_ms: int = 0
    ok: bool = True
    error: str = ""
    cost_micros: int | None = None
    price_version: str = ""

    def priced(self) -> "UsageRecord":
        """단가표를 적용한다. 단가를 모르면 cost_micros 는 None 으로 남는다(0 이 아니다)."""
        self.price_version = pricing.PRICE_VERSION
        self.cost_micros = pricing.cost_micros(
            self.provider,
            self.model,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_read_tokens=self.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens,
        )
        return self


@dataclass
class Collector:
    records: list[UsageRecord] = field(default_factory=list)

    def add(self, record: UsageRecord) -> None:
        self.records.append(record)


_COLLECTOR: ContextVar[Collector | None] = ContextVar("llm_usage_collector", default=None)


@contextmanager
def collecting() -> Iterator[Collector]:
    """이 블록 안에서 일어난 LLM 호출을 모은다. 중첩되면 안쪽이 이긴다."""
    collector = Collector()
    token = _COLLECTOR.set(collector)
    try:
        yield collector
    finally:
        _COLLECTOR.reset(token)


def record(**fields) -> UsageRecord | None:
    """호출 한 건을 적는다. 수집기가 없으면 버린다(반환값 None).

    절대 예외를 올리지 않는다 — 계측 실패가 채점을 깨뜨리면 본말이 전도된다.
    """
    try:
        entry = UsageRecord(**fields).priced()
    except Exception as exc:  # noqa: BLE001 — 계측은 절대 본 기능을 막지 않는다
        log.warning("usage.record failed to build a record: %s", exc)
        return None
    collector = _COLLECTOR.get()
    if collector is None:
        return None
    collector.add(entry)
    return entry


def totals(records: list[UsageRecord]) -> dict:
    """합계. 단가를 모르는 호출은 unpriced_calls 로 따로 센다 — 0원과 구별해야 한다."""
    priced = [r for r in records if r.cost_micros is not None]
    return {
        "calls": len(records),
        "ok": sum(1 for r in records if r.ok),
        "failed": sum(1 for r in records if not r.ok),
        "input_tokens": sum(r.input_tokens for r in records),
        "output_tokens": sum(r.output_tokens for r in records),
        "cache_read_tokens": sum(r.cache_read_tokens for r in records),
        "cache_write_tokens": sum(r.cache_write_tokens for r in records),
        "cost_micros": sum(r.cost_micros or 0 for r in priced),
        "unpriced_calls": len(records) - len(priced),
    }


__all__ = ["Collector", "UsageRecord", "collecting", "record", "totals"]
