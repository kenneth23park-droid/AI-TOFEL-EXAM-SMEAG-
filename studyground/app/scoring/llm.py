"""Online feedback node — Claude(Anthropic) 와 GPT(OpenAI) 병행.

CLOUD 모드에서 키가 있는 프로바이더만 호출한다. LLM_PROVIDER=both(기본)면
settings.llm_providers 순서대로 시도해 앞이 죽으면 뒤가 같은 프롬프트를 이어받고,
전부 실패해야 예외가 올라가 그래프가 규칙 기반 노드로 내려간다 — 보고서가 비는 일은 없다.

프롬프트·스키마는 프로바이더와 무관하게 한 벌만 쓴다(smeag-local-ai/scoring/).
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from app.config import PROJECT_DIR, get_settings
from app.schemas import FeedbackItem
from app.scoring import usage

log = logging.getLogger(__name__)

_SYSTEM = (
    "You are an ESL assessment specialist writing score-report feedback for a "
    "TOEFL-style test at SMEAG. You receive a scored attempt as JSON. "
    "Be concrete and reference the numbers you are given. Never invent scores."
)

_INSTRUCTION = {
    "en": "Write the feedback in English.",
    "ko": "피드백은 한국어로 작성하세요.",
}

_SCHEMA_HINT = """Return ONLY a JSON object, no prose, in this exact shape:
{"items":[{"scope":"reading","summary":"...","strengths":["..."],"improvements":["..."]},
          {"scope":"listening", ...},{"scope":"speaking", ...},{"scope":"writing", ...},
          {"scope":"overall", ...}]}
Every scope must appear exactly once. 1-2 sentences per summary,
1-2 bullet strings each for strengths and improvements."""


# ── provider layer ────────────────────────────────────────────────────────────
# 두 SDK 의 차이는 여기서만 흡수한다. 위쪽 로직은 (system, prompt) → text 만 안다.
# import 는 함수 안에서 한다 — 한쪽 SDK 가 설치돼 있지 않아도 다른 쪽은 그대로 돈다.

def _int(value) -> int:
    """SDK 가 None 을 주거나 필드를 아예 안 실어 보내도 0 으로 접는다."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _call_anthropic(system: str, prompt: str, max_tokens: int) -> tuple[str, dict]:
    settings = get_settings()
    try:
        from anthropic import Anthropic
    except ImportError as exc:  # SDK not installed in this environment
        raise RuntimeError("anthropic SDK is not installed") from exc
    message = Anthropic(api_key=settings.anthropic_api_key).messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
    u = getattr(message, "usage", None)
    return text, {
        # 설정값이 아니라 **응답이 밝힌 모델**을 쓴다 — 별칭이나 스냅샷으로 해석됐을
        # 수 있고, 단가는 실제로 답한 모델을 따라야 한다.
        "model": getattr(message, "model", "") or settings.anthropic_model,
        "input_tokens": _int(getattr(u, "input_tokens", 0)),
        "output_tokens": _int(getattr(u, "output_tokens", 0)),
        "cache_read_tokens": _int(getattr(u, "cache_read_input_tokens", 0)),
        "cache_write_tokens": _int(getattr(u, "cache_creation_input_tokens", 0)),
    }


def _call_openai(system: str, prompt: str, max_tokens: int) -> tuple[str, dict]:
    settings = get_settings()
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("openai SDK is not installed") from exc
    completion = OpenAI(api_key=settings.openai_api_key).chat.completions.create(
        model=settings.openai_model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    u = getattr(completion, "usage", None)
    cached = _int(getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0))
    prompt_tokens = _int(getattr(u, "prompt_tokens", 0))
    return completion.choices[0].message.content or "", {
        "model": getattr(completion, "model", "") or settings.openai_model,
        # OpenAI 의 prompt_tokens 는 캐시분을 포함한 총량이다. Anthropic 은 캐시분을
        # input_tokens 밖에 따로 싣는다 — 두 프로바이더의 의미를 여기서 맞춰 둔다.
        "input_tokens": max(prompt_tokens - cached, 0),
        "output_tokens": _int(getattr(u, "completion_tokens", 0)),
        "cache_read_tokens": cached,
        "cache_write_tokens": 0,
    }


_CALLERS = {"anthropic": _call_anthropic, "openai": _call_openai}


def _model_for(provider: str) -> str:
    """설정상의 모델 이름. 응답을 못 받은 실패 행에 쓴다."""
    settings = get_settings()
    return settings.openai_model if provider == "openai" else settings.anthropic_model


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def complete(system: str, prompt: str, *, max_tokens: int, scope: str = "") -> tuple[str, str]:
    """(응답 텍스트, 실제로 답한 프로바이더). 전부 실패하면 마지막 예외를 올린다.

    빈 응답은 실패로 친다 — 다음 프로바이더에게 기회를 준다.

    반환 계약은 그대로다(호출부 무변경). 사용량은 반환값이 아니라 usage 수집기로
    나간다 — 시도한 프로바이더마다 한 행씩, 성공이든 실패든. 폴백이 일어나면
    두 행이 남고, 그것이 개발자 화면의 폴백률이 된다.
    """
    providers = get_settings().llm_providers
    if not providers:
        raise RuntimeError("no LLM provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY)")

    last: Exception | None = None
    for name in providers:
        started = time.perf_counter()
        try:
            text, meta = _CALLERS[name](system, prompt, max_tokens)
            if not (text or "").strip():
                raise ValueError(f"{name} returned an empty response")
        except Exception as exc:  # noqa: BLE001 — 다음 프로바이더로 넘긴다
            log.warning("LLM provider %s failed: %s", name, exc)
            # 실패도 원장에 남긴다. 응답을 받다 끊겼다면 토큰은 이미 태워졌고,
            # 그렇지 않더라도 폴백이 얼마나 잦은지는 그 자체로 알아야 할 값이다.
            usage.record(
                scope=scope, provider=name, model=_model_for(name),
                latency_ms=_elapsed_ms(started), ok=False, error=f"{type(exc).__name__}: {exc}",
            )
            last = exc
            continue
        usage.record(
            scope=scope, provider=name, model=meta.get("model", ""),
            input_tokens=meta.get("input_tokens", 0),
            output_tokens=meta.get("output_tokens", 0),
            cache_read_tokens=meta.get("cache_read_tokens", 0),
            cache_write_tokens=meta.get("cache_write_tokens", 0),
            latency_ms=_elapsed_ms(started), ok=True,
        )
        return text, name
    raise RuntimeError(f"all LLM providers failed ({', '.join(providers)}): {last}") from last


def generate(analysis: dict, lang: str = "en") -> list[FeedbackItem]:
    """Raise on any problem — the caller falls back to the rule-based node."""
    prompt = (
        f"{_INSTRUCTION.get(lang, _INSTRUCTION['en'])}\n\n"
        f"Scored attempt:\n{json.dumps(analysis, ensure_ascii=False, indent=2)}\n\n"
        f"{_SCHEMA_HINT}"
    )
    text, _provider = complete(_SYSTEM, prompt, max_tokens=1600, scope="feedback")
    return _parse(text)


def _parse(text: str) -> list[FeedbackItem]:
    raw = text.strip()
    if raw.startswith("```"):  # strip a ```json fence if the model added one
        raw = raw.split("```")[1]
        raw = raw[4:] if raw.lower().startswith("json") else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model response")

    payload = json.loads(raw[start : end + 1])
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("model response has no items")

    out: list[FeedbackItem] = []
    for entry in items:
        if not isinstance(entry, dict) or not entry.get("scope"):
            continue
        out.append(
            FeedbackItem(
                scope=str(entry["scope"]),
                summary=str(entry.get("summary", "")),
                strengths=[str(s) for s in entry.get("strengths", []) if str(s).strip()],
                improvements=[str(s) for s in entry.get("improvements", []) if str(s).strip()],
            )
        )
    if not out:
        raise ValueError("model response had no usable items")
    return out


# ── rubric drafting (Story 5.1) ───────────────────────────────────────────────
# The examiner prompts and their output contracts already live outside the app so
# a teacher can edit them without a deploy. Overridable for tests / relocation.
RUBRIC_ROOT = Path(
    os.getenv("SMEAG_RUBRIC_ROOT") or (PROJECT_DIR.parent / "smeag-local-ai" / "scoring")
)

# (scale_key, skill) → basename shared by rubrics/*.md and schemas/*.schema.json
RUBRIC_FILES = {
    ("toefl120", "writing"): "toefl_writing",
    ("toefl120", "speaking"): "toefl_speaking",
    ("ielts9", "writing"): "ielts_writing_task2",
    ("ielts9", "speaking"): "ielts_speaking",
}

# 스키마(smeag-local-ai/scoring/schemas/*.json)는 criteria 키를 약어로 쓰는데
# rubric.CRITERIA 는 교사가 화면에서 보는 풀네임이다. 둘을 여기서 이어준다 —
# 이 매핑이 없으면 TOEFL 루브릭은 allowed 필터에 전부 걸려 "no usable criteria" 로
# 죽고 온라인 채점이 통째로 규칙 기반 초안으로 떨어진다.
# IELTS(TR/CC/LR/GRA · FC/LR/GRA/PRO)는 약어가 곧 표시 이름이라 매핑이 필요 없다.
_CRITERION_ALIASES = {
    "TF": "Task Fulfilment",
    "OD": "Organization & Development",
    "LU": "Language Use",
    "VO": "Vocabulary",
    "DEL": "Delivery",
    "TD": "Topic Development",
}

_RUBRIC_LANG = {
    "en": "Write every rationale, comment and summary in English.",
    "ko": "rationale·comment·summary 는 한국어로 작성하세요.",
}


def rubric_assets(scale_key: str, skill: str) -> tuple[str, str]:
    """(examiner prompt markdown, JSON schema text). Raises when either is missing."""
    base = RUBRIC_FILES.get((scale_key, skill))
    if base is None:
        raise RuntimeError(f"no rubric registered for scale={scale_key!r} skill={skill!r}")
    prompt_path = RUBRIC_ROOT / "rubrics" / f"{base}.md"
    schema_path = RUBRIC_ROOT / "schemas" / f"{base}.schema.json"
    if not prompt_path.is_file():
        raise RuntimeError(f"rubric prompt missing: {prompt_path}")
    if not schema_path.is_file():
        raise RuntimeError(f"rubric schema missing: {schema_path}")
    return prompt_path.read_text(encoding="utf-8"), schema_path.read_text(encoding="utf-8")


def generate_rubric(
    skill: str,
    text: str,
    *,
    scale_key: str = "toefl120",
    lang: str = "en",
    min_words: int = 0,
    metrics: dict | None = None,
    max_score: float = 5.0,
    criteria: tuple[str, ...] | None = None,
) -> list[dict]:
    """One rubric draft as `{skill, criterion, score, max_score, band, comment}` rows.

    Raises on **every** problem (no key, no SDK, no rubric file, API error, bad
    JSON) — `nodes.rubric_online` catches and falls back to `rubric.draft()`.
    """
    system, schema = rubric_assets(scale_key, skill)
    is_band = scale_key == "ielts9"

    body = (text or "").strip()
    if not body:
        raise ValueError("no response text to rate")

    payload = {
        "skill": skill,
        "scale": scale_key,
        "min_words": min_words,
        "measured_metrics": metrics or {},
        "response_text": body,
    }
    prompt = (
        f"{_RUBRIC_LANG.get(lang, _RUBRIC_LANG['en'])}\n\n"
        f"Student submission and measured metrics:\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n\n"
        f"Return ONLY a JSON object valid against this schema:\n{schema}"
    )

    raw, provider = complete(system, prompt, max_tokens=2400, scope="rubric")
    return _parse_rubric(
        raw, skill=skill, is_band=is_band, max_score=max_score, allowed=criteria,
        provider=provider,
    )


def _json_object(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        raw = raw[4:] if raw.lower().startswith("json") else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in model response")
    obj = json.loads(raw[start : end + 1])
    if not isinstance(obj, dict):
        raise ValueError("model response is not a JSON object")
    return obj


def _parse_rubric(
    text: str,
    *,
    skill: str,
    is_band: bool,
    max_score: float,
    allowed: tuple[str, ...] | None = None,
    provider: str = "",
) -> list[dict]:
    payload = _json_object(text)
    criteria = payload.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        raise ValueError("model response has no criteria object")

    summary = str(payload.get("summary_en") or payload.get("summary_ko") or "").strip()
    rows: list[dict] = []
    for raw_name, entry in criteria.items():
        if not isinstance(entry, dict):
            continue
        # 모델이 약어로 답해도(스키마가 그렇게 요구한다) 표시 이름으로 되돌린다.
        name = raw_name if (allowed and raw_name in allowed) else _CRITERION_ALIASES.get(
            raw_name, raw_name
        )
        if allowed and name not in allowed:
            continue
        value = entry.get("band") if is_band else entry.get("score")
        if value is None:
            value = entry.get("score") if is_band else entry.get("band")
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        rationale = str(entry.get("rationale") or "").strip()
        evidence = [str(q) for q in (entry.get("evidence") or []) if str(q).strip()]
        comment = " ".join(part for part in (rationale, summary) if part).strip()
        if evidence:
            comment = (comment + " Evidence: " + " / ".join(f'"{q}"' for q in evidence[:3])).strip()
        rows.append(
            {
                "skill": skill,
                "criterion": str(name),
                "score": score,
                "max_score": float(max_score),
                "band": score if is_band else None,
                "comment": comment,
                "source": "ai_draft",
                "origin": "online",
                # 어느 모델이 매긴 초안인지 — 교사 화면에서 판단 근거로 쓰라고 남긴다.
                "provider": provider,
            }
        )
    if not rows:
        raise ValueError("model response had no usable criteria")
    return rows
