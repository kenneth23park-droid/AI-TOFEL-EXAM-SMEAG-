"""Deterministic, rule-based feedback — the offline node.

No network, no randomness: the same attempt always yields the same words. This
is what LOCAL mode runs, and what CLOUD mode falls back to when the LLM errors.
"""

from __future__ import annotations

from app.models import PRODUCTIVE, RECEPTIVE, SECTION_MAX, TOTAL_MAX
from app.schemas import AttemptDetail, FeedbackItem

# percent floor → band key
_BANDS = ((85, "strong"), (70, "solid"), (55, "developing"), (0, "weak"))

SKILL_LABEL = {
    "en": {"reading": "Reading", "listening": "Listening",
           "speaking": "Speaking", "writing": "Writing", "overall": "Overall"},
    "ko": {"reading": "리딩", "listening": "리스닝",
           "speaking": "스피킹", "writing": "라이팅", "overall": "종합"},
}

_BAND_WORD = {
    "en": {"strong": "a strong", "solid": "a solid", "developing": "a developing", "weak": "an early"},
    "ko": {"strong": "우수", "solid": "안정", "developing": "발전 중", "weak": "기초"},
}

_SUMMARY = {
    "en": "{skill}: {scaled}/{max} ({percent}%) — {band} level.",
    "ko": "{skill}: {scaled}/{max}점 ({percent}%) — {band} 수준입니다.",
}

_OVERALL = {
    "en": "Total {total}/{tmax} ({percent}%) · CEFR {grade}. "
          "Strongest section: {best}. Needs the most work: {worst}.",
    "ko": "총점 {total}/{tmax} ({percent}%) · CEFR {grade}. "
          "가장 강한 영역: {best} / 가장 보완이 필요한 영역: {worst}.",
}

# Per-band strengths and improvements, by skill family.
_RECEPTIVE_STRENGTH = {
    "en": {
        "strong": "Answers the detail and inference questions consistently.",
        "solid": "Handles main-idea questions reliably.",
        "developing": "Gets the literal, stated-fact questions right.",
        "weak": "Follows the general topic of each passage.",
    },
    "ko": {
        "strong": "세부 정보와 추론 문항을 일관되게 맞힙니다.",
        "solid": "주제 파악 문항을 안정적으로 처리합니다.",
        "developing": "지문에 직접 언급된 사실 문항은 잘 맞힙니다.",
        "weak": "지문의 전반적인 주제는 따라갑니다.",
    },
}
_RECEPTIVE_IMPROVE = {
    "en": {
        "strong": "Push into the hardest inference items — accuracy is already high.",
        "solid": "Slow down on inference and author/speaker-purpose items.",
        "developing": "Practise elimination: rule out two options before choosing.",
        "weak": "Work on vocabulary range first — unknown words are costing whole items.",
    },
    "ko": {
        "strong": "정확도가 이미 높습니다 — 최고난도 추론 문항에 집중하세요.",
        "solid": "추론·화자 의도 문항에서 속도를 늦추고 근거를 확인하세요.",
        "developing": "소거법을 연습하세요 — 두 개를 먼저 지우고 고르는 습관.",
        "weak": "먼저 어휘 폭을 넓히세요 — 모르는 단어가 문항 전체를 놓치게 합니다.",
    },
}
_PRODUCTIVE_STRENGTH = {
    "en": {
        "strong": "Ideas are developed and well organised.",
        "solid": "The response is on task and easy to follow.",
        "developing": "The main point comes across, with simple structure.",
        "weak": "Communicates a basic answer to the prompt.",
    },
    "ko": {
        "strong": "아이디어 전개와 구성이 뛰어납니다.",
        "solid": "과제에 맞고 흐름을 따라가기 쉽습니다.",
        "developing": "요지는 전달되며 기본 구조를 갖췄습니다.",
        "weak": "질문에 대한 기본적인 답변은 전달됩니다.",
    },
}
_PRODUCTIVE_IMPROVE = {
    "en": {
        "strong": "Vary sentence openings and add precise, topic-specific vocabulary.",
        "solid": "Add a concrete example to each main point.",
        "developing": "Use linking words (however, as a result) to connect ideas.",
        "weak": "Write/say complete sentences first; extend length before polish.",
    },
    "ko": {
        "strong": "문장 시작을 다양화하고 주제 특화 어휘를 더하세요.",
        "solid": "각 요지마다 구체적인 예시를 하나씩 추가하세요.",
        "developing": "연결어(however, as a result)로 아이디어를 이으세요.",
        "weak": "먼저 완전한 문장으로 답하고, 분량을 늘린 뒤 다듬으세요.",
    },
}

_MISSED = {
    "en": "Missed items: {items}.",
    "ko": "틀린 문항: {items}.",
}
_RUBRIC_LOW = {
    "en": "Lowest rubric criterion: {crit} ({score}/{max}).",
    "ko": "가장 낮은 루브릭 항목: {crit} ({score}/{max}점).",
}
_NO_DATA = {
    "en": "No scored responses recorded for this section yet.",
    "ko": "이 영역에 채점된 응답이 아직 없습니다.",
}


def band_of(percent: int) -> str:
    for floor, key in _BANDS:
        if percent >= floor:
            return key
    return "weak"


def _pct(scaled: int, maximum: int) -> int:
    return round(scaled / maximum * 100) if maximum else 0


def analyze(detail: AttemptDetail) -> dict:
    """Turn an attempt into the numbers every feedback node reasons over."""
    by_skill: dict[str, dict] = {}

    for section in detail.section_scores:
        percent = _pct(section.scaled, section.max_score)
        entry = {
            "skill": section.skill,
            "scaled": section.scaled,
            "max": section.max_score,
            "percent": percent,
            "band": band_of(percent),
            "missed": [],
            "answered": 0,
            "rubrics": [],
        }
        if section.skill in RECEPTIVE:
            rows = [q for q in detail.question_responses if q.skill == section.skill]
            entry["answered"] = len(rows)
            entry["missed"] = [q.no for q in rows if not q.is_correct]
        if section.skill in PRODUCTIVE:
            entry["rubrics"] = [
                {"criterion": r.criterion, "score": r.score, "max": r.max_score}
                for r in detail.rubric_scores
                if r.skill == section.skill
            ]
        by_skill[section.skill] = entry

    ranked = sorted(by_skill.values(), key=lambda e: (e["percent"], e["skill"]))
    total_pct = _pct(detail.total_score, detail.total_max or TOTAL_MAX)
    return {
        "by_skill": by_skill,
        "weakest": ranked[0]["skill"] if ranked else "",
        "strongest": ranked[-1]["skill"] if ranked else "",
        "total": detail.total_score,
        "total_max": detail.total_max or TOTAL_MAX,
        "total_percent": total_pct,
        "total_band": band_of(total_pct),
        "grade": detail.grade,
    }


def _skill_item(entry: dict, lang: str) -> FeedbackItem:
    skill, band = entry["skill"], entry["band"]
    label = SKILL_LABEL[lang][skill]
    summary = _SUMMARY[lang].format(
        skill=label, scaled=entry["scaled"], max=entry["max"],
        percent=entry["percent"], band=_BAND_WORD[lang][band],
    )

    strengths, improvements = [], []
    if skill in RECEPTIVE:
        strengths.append(_RECEPTIVE_STRENGTH[lang][band])
        improvements.append(_RECEPTIVE_IMPROVE[lang][band])
        if entry["missed"]:
            improvements.append(
                _MISSED[lang].format(items=", ".join(f"#{n}" for n in entry["missed"]))
            )
        elif not entry["answered"]:
            improvements.append(_NO_DATA[lang])
    else:
        strengths.append(_PRODUCTIVE_STRENGTH[lang][band])
        improvements.append(_PRODUCTIVE_IMPROVE[lang][band])
        if entry["rubrics"]:
            low = min(entry["rubrics"], key=lambda r: (r["score"] / r["max"] if r["max"] else 0))
            improvements.append(
                _RUBRIC_LOW[lang].format(
                    crit=low["criterion"], score=_fmt(low["score"]), max=_fmt(low["max"])
                )
            )
        else:
            improvements.append(_NO_DATA[lang])

    return FeedbackItem(scope=skill, summary=summary, strengths=strengths, improvements=improvements)


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def build_items(analysis: dict, lang: str) -> list[FeedbackItem]:
    """Per-skill blocks plus one overall block — the offline node's output."""
    lang = lang if lang in SKILL_LABEL else "en"
    items = [
        _skill_item(entry, lang)
        for entry in sorted(
            analysis["by_skill"].values(),
            key=lambda e: ("reading", "listening", "speaking", "writing").index(e["skill"]),
        )
    ]

    best = SKILL_LABEL[lang].get(analysis["strongest"], "—")
    worst = SKILL_LABEL[lang].get(analysis["weakest"], "—")
    overall_summary = _OVERALL[lang].format(
        total=analysis["total"], tmax=analysis["total_max"],
        percent=analysis["total_percent"], grade=analysis["grade"] or "—",
        best=best, worst=worst,
    )
    # Carry the best/worst section's headline points up, tagged with the skill
    # they came from so the overall block is attributable.
    strong_entry = analysis["by_skill"].get(analysis["strongest"])
    weak_entry = analysis["by_skill"].get(analysis["weakest"])
    overall = FeedbackItem(
        scope="overall",
        summary=overall_summary,
        strengths=[f"{best} — {_skill_item(strong_entry, lang).strengths[0]}"] if strong_entry else [],
        improvements=[f"{worst} — {_skill_item(weak_entry, lang).improvements[0]}"] if weak_entry else [],
    )
    return items + [overall]


SECTION_MAX_HINT = SECTION_MAX  # re-exported for templates/tests that want the constant
