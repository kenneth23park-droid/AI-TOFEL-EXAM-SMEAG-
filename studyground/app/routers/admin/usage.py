"""AI 채점 사용량 — 어드민(금액)과 개발자(토큰·실패) 두 화면.

한 원장(llm_usage)을 두 가지로 자른다. 보는 사람이 다르고, 알아야 할 것이 다르다.

  /admin/usage        어드민 — 기간 총액, **응시 1건당 단가**, 모델·프로바이더별 비중,
                      일별 추이. 총액보다 응시당 단가가 중요하다: 학생 수를 곱하면
                      그대로 예산이 나오는 값이라서다.
  /admin/usage/calls  개발자 — 호출 원장, p95 지연, 폴백/실패 건수. 돈이 아니라
                      "왜 느린가 / 왜 폴백했나"를 본다.

집계 단위는 언제나 **호출**이다(models.LlmUsage 참고). 한 응시를 재채점하면 행이
여러 개 쌓이고 그게 맞다 — 재채점이 실제로 돈을 쓰기 때문이다.

단가를 모르는 호출(cost_micros IS NULL)은 금액 합계에서 빼고 'unpriced' 로 따로
센다. 0 원으로 섞으면 "싸게 썼다"는 착시가 생긴다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.models import LlmUsage
from app.routers.admin import admin_render, admin_t, parse_date
from app.scoring import pricing
from app.templating import resolve_lang

router = APIRouter()


def _window(date_from: str | None, date_to: str | None) -> dict:
    return {"date_from": parse_date(date_from), "date_to": parse_date(date_to)}


@router.get("/usage")
async def usage_costs(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    """어드민 화면 — 돈."""
    lang = resolve_lang(request, lang)
    window = _window(date_from, date_to)
    at = admin_t(lang)

    totals = crud.llm_usage_totals(db, **window)
    by_model = crud.llm_usage_by(db, LlmUsage.model, **window)
    by_provider = crud.llm_usage_by(db, LlmUsage.provider, **window)
    by_scope = crud.llm_usage_by(db, LlmUsage.scope, **window)
    daily = crud.llm_usage_daily(db, **window)
    # 예산을 짜는 세 가지 눈금 — 학생 한 명당 / 시험 일정당 / 월당.
    by_student = crud.llm_usage_by_student(db, **window)
    by_exam_date = crud.llm_usage_by_exam_date(db, **window)
    monthly = crud.llm_usage_monthly(db, **window)

    peak = max((d["cost_micros"] for d in daily), default=0) or 1

    return admin_render(request, "admin_usage.html", lang, "usage", {
        "page_title": at("usage.title"),
        "q": {"date_from": date_from or "", "date_to": date_to or ""},
        "totals": totals,
        "by_model": by_model,
        "by_provider": by_provider,
        "by_scope": by_scope,
        "daily": daily,
        "daily_peak": peak,
        "by_student": by_student,
        "by_exam_date": by_exam_date,
        "monthly": monthly,
        "usd": pricing.format_usd,
        "price_version": pricing.PRICE_VERSION,
    })


@router.get("/usage/calls")
async def usage_calls(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    only_failed: int = 0,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    """개발자 화면 — 토큰·지연·폴백."""
    lang = resolve_lang(request, lang)
    window = _window(date_from, date_to)
    at = admin_t(lang)

    totals = crud.llm_usage_totals(db, **window)
    rows = crud.llm_usage_calls(db, only_failed=bool(only_failed), limit=200, **window)
    p95 = crud.llm_latency_percentile(db, 0.95, **window)

    calls = totals["calls"] or 0
    fail_rate = round(totals["failed_calls"] * 100 / calls, 1) if calls else 0.0

    return admin_render(request, "admin_usage_calls.html", lang, "usage", {
        "page_title": at("usage.callsTitle"),
        "q": {"date_from": date_from or "", "date_to": date_to or "",
              "only_failed": bool(only_failed)},
        "totals": totals,
        "rows": rows,
        "p95_ms": p95,
        "fail_rate": fail_rate,
        "usd": pricing.format_usd,
    })
