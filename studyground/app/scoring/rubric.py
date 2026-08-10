"""Offline rubric heuristics — the draft a teacher starts from when no LLM is available.

Deterministic and dependency-free: word count, `minWords` compliance, sentence
count, sentence-length spread and type-token ratio move a **conservative median**
band up or down by a bounded amount. No network, no randomness, no exceptions —
the same text always yields the same rows, and a blank text yields the floor.

Scores are intentionally never at the top of the range: this is a draft, and every
row says so in `comment` (Story 5.1 AC4).

예외가 하나 있다. SET 9 S1 같은 복창(Listen and Repeat) 과제는 정답이 8~14 단어짜리
한 문장이라 길이 지표로 재면 완벽한 답도 플로어를 받는다. `draft(..., task_kind="repeat",
reference=원문)` 경로는 길이 감점 대신 원문 대조(difflib)로 채점한다. 자세한 규칙은
아래 "복창 과제" 절과 `draft()` docstring 참조.
"""

from __future__ import annotations

import difflib
import re

# autoscore 는 typing 외에 아무것도 import 하지 않는다(app.scoring 내부 의존 0).
# 따라서 여기서 끌어와도 순환 import 가 생기지 않는다 — 정규화 철학을
# 두 벌로 갈라 쓰지 않기 위해 normalize_text 를 그대로 재사용한다.
from app.scoring.autoscore import normalize_text
from app.scoring.scale import IELTS, TOEFL, round_half_up_to_half

DRAFT_SOURCE = "ai_draft"

# ── criterion sets ────────────────────────────────────────────────────────────
# (criterion label, weight of each metric family) — the label is what the teacher sees.
_TOEFL_WRITING = ("Task Fulfilment", "Organization & Development", "Language Use", "Vocabulary")
_TOEFL_SPEAKING = ("Delivery", "Language Use", "Topic Development")
_IELTS_WRITING = ("TR", "CC", "LR", "GRA")
_IELTS_SPEAKING = ("FC", "LR", "GRA", "PRO")

CRITERIA = {
    (TOEFL, "writing"): _TOEFL_WRITING,
    (TOEFL, "speaking"): _TOEFL_SPEAKING,
    (IELTS, "writing"): _IELTS_WRITING,
    (IELTS, "speaking"): _IELTS_SPEAKING,
}

# TOEFL public rubrics: Writing is 0–5, Speaking is 0–4.
MAX_SCORE = {
    (TOEFL, "writing"): 5.0,
    (TOEFL, "speaking"): 4.0,
    (IELTS, "writing"): 9.0,
    (IELTS, "speaking"): 9.0,
}

# Conservative middle of each range, and how far a heuristic may move it.
_CENTRE = {5.0: 3.0, 4.0: 2.0, 9.0: 5.5}
_FLOOR = {5.0: 1.0, 4.0: 1.0, 9.0: 4.0}
_CEILING = {5.0: 4.0, 4.0: 3.0, 9.0: 6.5}

# Default `minWords` when the content did not carry one.
DEFAULT_MIN_WORDS = {"writing": 150, "speaking": 60}

_CONNECTIVES = frozenset(
    """however therefore moreover furthermore although though because since whereas
    while nevertheless nonetheless consequently thus hence besides additionally
    instead otherwise meanwhile finally firstly secondly thirdly overall
    for and but so yet if when after before until unless despite""".split()
)

_WORD_RE = re.compile(r"[A-Za-z']+")
_SENT_RE = re.compile(r"[.!?]+(?:\s|$)")

_REVIEW_NOTE = {
    "en": "Rule-based draft — teacher review required.",
    "ko": "규칙 기반 초안 — 교사 검수 필요.",
}


# ── text metrics ──────────────────────────────────────────────────────────────
def measure(text: str) -> dict:
    """Every number the heuristics use. Safe on empty / None input."""
    body = (text or "").strip()
    words = [w.lower() for w in _WORD_RE.findall(body)]
    n = len(words)

    parts = [p.strip() for p in _SENT_RE.split(body) if p.strip()]
    sentences = len(parts)
    lengths = [len(_WORD_RE.findall(p)) for p in parts] or [0]
    mean_len = sum(lengths) / len(lengths)
    variance = sum((x - mean_len) ** 2 for x in lengths) / len(lengths)

    unique = len(set(words))
    connectives = sum(1 for w in words if w in _CONNECTIVES)

    return {
        "word_count": n,
        "sentence_count": sentences,
        "unique_words": unique,
        "type_token_ratio": round(unique / n, 4) if n else 0.0,
        "mean_sentence_words": round(mean_len, 2),
        "sentence_length_sd": round(variance ** 0.5, 2),
        "connective_count": connectives,
        "connective_density": round(connectives / n, 4) if n else 0.0,
        "is_blank": n == 0,
    }


# ── heuristic deltas ──────────────────────────────────────────────────────────
def _length_delta(m: dict, min_words: int) -> float:
    n = m["word_count"]
    if n == 0:
        return -99.0                       # blank → clamp to the floor
    if min_words and n < min_words * 0.6:
        return -1.0
    if min_words and n < min_words:
        return -0.5
    if min_words and n >= min_words * 1.4:
        return 0.5
    return 0.0


def _variety_delta(m: dict) -> float:
    """Type-token ratio, length-normalised — TTR falls naturally as texts grow."""
    if m["is_blank"]:
        return -99.0
    ttr = m["type_token_ratio"]
    floor = 0.38 if m["word_count"] > 200 else 0.45
    if ttr >= floor + 0.15:
        return 0.5
    if ttr < floor - 0.08:
        return -0.5
    return 0.0


def _structure_delta(m: dict) -> float:
    if m["is_blank"]:
        return -99.0
    delta = 0.0
    if m["sentence_count"] >= 5 and m["sentence_length_sd"] >= 4.0:
        delta += 0.5                       # a real mix of simple and complex sentences
    elif m["sentence_count"] <= 2 or m["sentence_length_sd"] < 1.5:
        delta -= 0.5                       # one long run-on, or monotone clauses
    if m["mean_sentence_words"] > 40:
        delta -= 0.5                       # likely unpunctuated run-ons
    return delta


def _cohesion_delta(m: dict) -> float:
    if m["is_blank"]:
        return -99.0
    density = m["connective_density"]
    if 0.02 <= density <= 0.09:
        return 0.5
    if density < 0.01:
        return -0.5
    if density > 0.14:
        return -0.5                        # over-used connectives (a band-5 marker)
    return 0.0


# criterion label → which deltas apply to it
_DELTA_MAP = {
    "Task Fulfilment": ("length",),
    "Organization & Development": ("structure", "cohesion"),
    "Language Use": ("structure",),
    "Vocabulary": ("variety",),
    "Delivery": ("length", "structure"),
    "Topic Development": ("length", "cohesion"),
    "TR": ("length",),
    "CC": ("cohesion", "structure"),
    "LR": ("variety",),
    "GRA": ("structure",),
    "FC": ("length", "cohesion"),
    "PRO": ("length",),
}

_DELTA_FN = {
    "length": _length_delta,
    "variety": lambda m, _min: _variety_delta(m),
    "structure": lambda m, _min: _structure_delta(m),
    "cohesion": lambda m, _min: _cohesion_delta(m),
}


def _criterion_score(criterion: str, m: dict, min_words: int, max_score: float) -> float:
    centre = _CENTRE.get(max_score, max_score / 2)
    delta = 0.0
    for name in _DELTA_MAP.get(criterion, ("length",)):
        delta += _DELTA_FN[name](m, min_words)
    value = centre + max(delta, -2.0)
    value = min(max(value, _FLOOR.get(max_score, 0.0)), _CEILING.get(max_score, max_score))
    if m["is_blank"]:
        value = 0.0
    return round_half_up_to_half(value)


# ── 복창(Listen and Repeat) 과제 ───────────────────────────────────────────────
# SET 9 S1 은 들려준 문장 하나를 그대로 따라 말하는 과제다(정답이 8~14 단어인 한 문장).
# 길이 기반 축을 그대로 태우면 완벽하게 따라 말해도 minWords 60 에 걸려 플로어가 나온다 —
# 측정하는 축 자체가 틀린 것이므로, 이 과제는 **원문 대조**로만 채점한다.
_REPEAT_KINDS = frozenset({"repeat", "listen_and_repeat", "repeat_after_me", "listenandrepeat"})

# 축 이름도 바꾼다. Delivery / Language Use / Topic Development 는 "자유 발화에서
# 얼마나 길고 다양하게 말했는가"를 뜻하는 라벨이라, 한 문장 복창 결과에 붙으면
# 교사가 오해한다(짧아서 낮은 점수라고 읽는다). 복창에서 실제로 재는 것은
# "원문과 얼마나 같은가(정확도)" 와 "원문을 얼마나 빠뜨리지 않았는가(완성도)" 둘뿐이다.
_REPEAT_CRITERIA = ("Repetition Accuracy", "Completeness")


def _norm_task_kind(task_kind: str) -> str:
    return re.sub(r"[^a-z]+", "_", (task_kind or "").strip().lower()).strip("_")


def is_repeat_task(task_kind: str) -> bool:
    """task_kind 가 복창 계열인가. 미지정('')이면 항상 False = 기존 동작."""
    return _norm_task_kind(task_kind) in _REPEAT_KINDS


def compare_repeat(text: str, reference: str) -> dict:
    """전사와 원문의 토큰 단위 대조. 표준 라이브러리(difflib)만 쓴다.

    정규화는 autoscore.normalize_text 와 동일 — 대소문자/앞뒤·중간 공백을 무시한다.
    구두점은 토큰에 붙은 채로 남는데(`cafeteria?` ≠ `cafeteria`), 전사기가 구두점을
    거의 찍지 않으므로 원문 쪽 구두점만 떨어뜨린다. 아포스트로피는 단어의 일부라
    보존한다(`today's` 는 한 토큰).
    """
    ref = _repeat_tokens(reference)
    hyp = _repeat_tokens(text)
    if not ref:
        return {
            "reference_available": False,
            "reference_word_count": 0,
            "said_word_count": len(hyp),
            "matched_words": 0,
            "similarity": 0.0,
            "coverage": 0.0,
        }
    matcher = difflib.SequenceMatcher(None, ref, hyp, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return {
        "reference_available": True,
        "reference_word_count": len(ref),
        "said_word_count": len(hyp),
        "matched_words": matched,
        # similarity: 순서까지 맞아야 오르는 정렬 기반 일치율(2M / (len(ref)+len(hyp))).
        # 원문에 없는 말을 덧붙이면 분모가 커져 떨어진다.
        "similarity": round(matcher.ratio(), 4),
        # coverage: 원문 중 살아남은 비율. 덧붙인 말에는 벌점이 없다.
        "coverage": round(matched / len(ref), 4),
    }


_APOSTROPHE_RE = re.compile(r"[‘’ʼ]")
_PUNCT_RE = re.compile(r"[^a-z0-9']+")


def _repeat_tokens(text: str) -> list[str]:
    body = _APOSTROPHE_RE.sub("'", normalize_text(text))
    return [t for t in (_PUNCT_RE.sub(" ", body)).split() if t]


def _repeat_value(ratio: float, top: float) -> float:
    """일치율 0~1 을 [플로어, 실링] 구간으로 선형 환산한다.

    완벽한 복창이라도 _CEILING 을 넘지 않는다 — 이 모듈이 내는 것은 초안이고,
    만점 근처 점수는 교사 검수를 건너뛰게 만든다(Story 5.1 AC4).
    """
    low = _FLOOR.get(top, 0.0)
    high = _CEILING.get(top, top)
    return round_half_up_to_half(low + max(min(ratio, 1.0), 0.0) * (high - low))


def _repeat_comment(criterion: str, r: dict, lang: str) -> str:
    note = _REVIEW_NOTE.get(lang, _REVIEW_NOTE["en"])
    if r["said_word_count"] == 0:
        return ("No response recorded. " if lang != "ko" else "제출된 답안이 없습니다. ") + note
    if not r["reference_available"]:
        # 원문을 모르면 대조가 불가능하다 → 아래 draft() 의 degrade 규칙 참조.
        return (
            f"[{criterion}] Reference sentence unavailable — scored at the neutral centre, "
            f"{r['said_word_count']} words said. " + note
        )
    facts = (
        f"{r['matched_words']}/{r['reference_word_count']} reference words matched"
        f", similarity {r['similarity']:.2f}"
        f", said {r['said_word_count']} words"
    )
    return f"[{criterion}] {facts}. {note}"


def criteria_for(scale_key: str, skill: str, task_kind: str = "") -> tuple[str, ...]:
    if skill == "speaking" and is_repeat_task(task_kind):
        return _REPEAT_CRITERIA
    return CRITERIA.get((scale_key, skill), CRITERIA[(TOEFL, "writing")])


def max_score_for(scale_key: str, skill: str) -> float:
    return MAX_SCORE.get((scale_key, skill), 5.0)


def _comment(criterion: str, m: dict, min_words: int, lang: str) -> str:
    note = _REVIEW_NOTE.get(lang, _REVIEW_NOTE["en"])
    if m["is_blank"]:
        return ("No response recorded. " if lang != "ko" else "제출된 답안이 없습니다. ") + note
    facts = (
        f"{m['word_count']} words"
        + (f" (min {min_words}{'' if m['word_count'] >= min_words else ' — short'})" if min_words else "")
        + f", {m['sentence_count']} sentences"
        + f", TTR {m['type_token_ratio']:.2f}"
        + f", sentence-length SD {m['sentence_length_sd']:.1f}"
        + f", {m['connective_count']} connectives"
    )
    return f"[{criterion}] {facts}. {note}"


def _repeat_draft(
    skill: str,
    text: str,
    reference: str,
    *,
    scale_key: str,
    lang: str,
) -> list[dict]:
    """복창 과제 전용 행. 길이 지표는 metrics 에만 남기고 점수에는 쓰지 않는다."""
    # measure() 는 문자열을 전제로 한다(`.strip()`). 클라이언트가 숫자나 리스트를
    # 보내도 여기서 죽으면 안 되므로 한 번만 문자열로 눌러 둔다.
    body = text if isinstance(text, str) else normalize_text(text)
    r = compare_repeat(body, reference)
    metrics = dict(measure(body), **r, task_kind="repeat")
    top = max_score_for(scale_key, skill)
    is_band = scale_key == IELTS
    centre = _CENTRE.get(top, top / 2)

    rows: list[dict] = []
    for criterion in _REPEAT_CRITERIA:
        if r["said_word_count"] == 0:
            value = 0.0
        elif not r["reference_available"]:
            value = round_half_up_to_half(centre)
        else:
            ratio = r["similarity"] if criterion == "Repetition Accuracy" else r["coverage"]
            value = _repeat_value(ratio, top)
        rows.append(
            {
                "skill": skill,
                "criterion": criterion,
                "score": value,
                "max_score": top,
                "band": value if is_band else None,
                "comment": _repeat_comment(criterion, r, lang),
                "source": DRAFT_SOURCE,
                "origin": "offline",
                "metrics": metrics,
            }
        )
    return rows


# ── public entry point ────────────────────────────────────────────────────────
def draft(
    skill: str,
    text: str,
    *,
    scale_key: str = TOEFL,
    min_words: int = 0,
    lang: str = "en",
    response_count: int = 1,
    task_kind: str = "",
    reference: str = "",
) -> list[dict]:
    """Rule-based rubric rows for one skill. Never raises, never touches the network.

    `task_kind` 미지정('')이면 기존 길이·다양성 기반 경로 그대로다(하위호환).
    `task_kind="repeat"` (SET 9 S1 Listen and Repeat)이면 길이 감점을 쓰지 않고
    `reference` 원문과의 토큰 대조로 채점한다.

    reference 가 없을 때의 degrade 규칙
      전사만 있고 원문을 모르면 대조할 근거가 없다. 이때 길이 기반 경로로 되돌아가면
      한 문장 답안이 다시 플로어를 받으므로(고치려던 바로 그 버그) 그렇게 하지 않는다.
      대신 **보수적 중앙값(_CENTRE)** 그대로, 즉 delta 0 인 행을 내고 comment 에
      "Reference sentence unavailable" 를 남긴다 — 점수가 아니라 교사에게 보내는 신호다.
      빈 답안은 이 경우에도 0.0 이다(답이 없는 것은 근거가 없는 것과 다르다).
    """
    skill = (skill or "").strip().lower() or "writing"
    scale_key = scale_key if scale_key in (TOEFL, IELTS) else TOEFL
    if skill == "speaking" and is_repeat_task(task_kind):
        return _repeat_draft(skill, text, reference, scale_key=scale_key, lang=lang)
    if not min_words:
        min_words = DEFAULT_MIN_WORDS.get(skill, 0) * max(response_count, 1)

    m = measure(text)
    top = max_score_for(scale_key, skill)
    is_band = scale_key == IELTS

    rows: list[dict] = []
    for criterion in criteria_for(scale_key, skill):
        value = _criterion_score(criterion, m, min_words, top)
        rows.append(
            {
                "skill": skill,
                "criterion": criterion,
                "score": value,
                "max_score": top,
                "band": value if is_band else None,
                "comment": _comment(criterion, m, min_words, lang),
                "source": DRAFT_SOURCE,
                "origin": "offline",
                "metrics": m,
            }
        )
    return rows


__all__ = [
    "CRITERIA",
    "DEFAULT_MIN_WORDS",
    "DRAFT_SOURCE",
    "MAX_SCORE",
    "compare_repeat",
    "criteria_for",
    "draft",
    "is_repeat_task",
    "max_score_for",
    "measure",
]
