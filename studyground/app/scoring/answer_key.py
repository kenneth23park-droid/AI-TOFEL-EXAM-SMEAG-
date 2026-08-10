"""문항 팩 레지스트리 — exam code 로 서버측 정답키를 고른다.

`attempt` 는 `exam` 을 갖고 `exam` 은 `code` 를 갖는다(models.py). 채점은 그 code 로
팩을 골라야 한다. 예전에는 SET 1 팩 하나뿐이라 `crud_write` 가 `answer_key_set1` 을
직접 import 했고, 그래서 SET 9 응시는 서버에서 한 문항도 채점되지 않았다.

정답키 자체는 손으로 쓰지 않는다 — `tools/gen_answer_key_set{1,9}.js` 가 sg2 의
콘텐츠에서 생성한다. 여기서는 "고르는 규칙"만 정의한다.

## 모르는 code 를 만났을 때 (degrade 규칙)

이 저장소의 철학은 "채점이 터져도 답안을 잃지 않는다"(B7/F12) 다. 그래서 예외를
던지지 않는다. 다만 **모르는 팩을 SET 1 로 대신 채점하지도 않는다**: question_key 는
팩끼리 겹친다(`R1-1` 은 SET 1 에도 SET 9 에도 있고 정답이 서로 다르다). 남의 정답표로
채점하면 답안은 남아도 **점수가 조용히 틀린다** — 미채점보다 나쁘다. 따라서

    code 가 비어 있음  → SET 1        (기존 동작 유지: 팩이 하나뿐이던 시절의 응시·레거시 행)
    아는 code          → 그 팩
    모르는 code        → EMPTY_PACK   (자동채점 0건, 전 문항이 교사 채점 대기로 남음)

EMPTY_PACK 은 자동채점을 건너뛸 뿐 답안 저장·제출·상태 전이는 그대로 돈다.

## EMPTY_PACK 을 받은 응시가 실제로 어떻게 되는가

한동안 이 문서와 코드가 어긋나 있었다. 여기서는 "전 문항이 교사 채점 대기"라고
약속했는데, `crud_write.grade_attempt` 는 그대로 섹션 합산까지 돌려 네 섹션을 모두
0/0 으로 기록하고 총점 0 · grade A1 · status='completed' 로 확정해 버렸다.
지금은 코드가 이 약속을 지킨다 —

    grade_attempt 가 `pack.code == ""` 를 보면 **섹션 점수를 한 줄도 쓰지 않고**
    status='scoring' (reason='pack_unknown') 으로 빠진다. 반환 dict 의
    `gradable=False` / `reason='pack_unknown'` / `sections_written=False` 가 그 사실을
    말한다. 답안·오디오·이벤트는 전부 남는다.

app/seed.py 가 등록하는 SET 8 · SET 7 이 정확히 이 경로를 탄다(둘 다 PACKS 에 없다).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

from app.scoring import answer_key_set1, answer_key_set9

log = logging.getLogger("studyground.scoring")

SKILLS = ("reading", "listening", "writing", "speaking")

# 공백·하이픈·언더스코어만 지운다. 알파벳/숫자만 남기는 식으로 하면 비라틴 문자 code 가
# 통째로 빈 문자열이 되어 "모르는 팩"이 아니라 "기본 팩"으로 새어 나간다.
_CODE_RE = re.compile(r"[\s_\-]+")


def normalize_code(code: str | None) -> str:
    """'SET 9' · 'set-9' · 'set9' 를 모두 'SET9' 로 모은다."""
    return _CODE_RE.sub("", (code or "").strip().upper())


@dataclass(frozen=True)
class AnswerPack:
    """한 세트의 정답키 묶음. 읽기 전용이며 프로세스당 하나만 만든다."""

    code: str
    answer_key: Mapping[str, dict]
    productive_keys: Mapping[str, dict]
    auto_total_by_skill: Mapping[str, int]
    # 산출형(에세이·스피킹) 문항 수 — Writing 섹션 합산의 가중치로 쓴다.
    productive_total_by_skill: Mapping[str, int] = field(default_factory=dict)

    @property
    def total_questions(self) -> int:
        return len(self.answer_key) + len(self.productive_keys)

    def lookup(self, question_key: str) -> dict | None:
        """자동채점 가능한 항목만. 산출형·미등록 키는 None."""
        return self.answer_key.get(question_key or "")

    def meta(self, question_key: str) -> dict | None:
        """자동채점이든 산출형이든 이 팩이 아는 항목."""
        key = question_key or ""
        return self.answer_key.get(key) or self.productive_keys.get(key)


def _productive_totals(productive_keys: Mapping[str, dict]) -> dict[str, int]:
    totals = {skill: 0 for skill in SKILLS}
    for entry in productive_keys.values():
        skill = (entry.get("skill") or "").strip().lower()
        if skill in totals:
            totals[skill] += 1
    return totals


def _pack(code: str, module) -> AnswerPack:
    return AnswerPack(
        code=code,
        answer_key=MappingProxyType(module.ANSWER_KEY),
        productive_keys=MappingProxyType(module.PRODUCTIVE_KEYS),
        auto_total_by_skill=MappingProxyType(dict(module.AUTO_TOTAL_BY_SKILL)),
        productive_total_by_skill=MappingProxyType(_productive_totals(module.PRODUCTIVE_KEYS)),
    )


SET1_PACK = _pack("SET1", answer_key_set1)
SET9_PACK = _pack("SET9", answer_key_set9)

# 자동채점도 산출형도 없는 팩 — 모르는 exam code 의 안전한 착지점.
EMPTY_PACK = AnswerPack(
    code="",
    answer_key=MappingProxyType({}),
    productive_keys=MappingProxyType({}),
    auto_total_by_skill=MappingProxyType({skill: 0 for skill in SKILLS}),
    productive_total_by_skill=MappingProxyType({skill: 0 for skill in SKILLS}),
)

PACKS: dict[str, AnswerPack] = {
    SET1_PACK.code: SET1_PACK,
    SET9_PACK.code: SET9_PACK,
}

# code 가 비었을 때만 쓰는 기본값. 모르는 code 의 기본값이 아니다(모듈 머리말 참고).
DEFAULT_PACK = SET1_PACK


def pack_for(exam_code: str | None) -> AnswerPack:
    """exam code → 정답 팩. 절대 예외를 던지지 않는다."""
    code = normalize_code(exam_code)
    if not code:
        return DEFAULT_PACK
    found = PACKS.get(code)
    if found is not None:
        return found
    log.warning(
        "unknown exam code %r — auto-scoring is skipped for this attempt "
        "(answers are still stored; a teacher grades it)", exam_code,
    )
    return EMPTY_PACK


def pack_for_attempt(attempt) -> AnswerPack:
    """`attempt.exam.code` 로 팩을 고른다. exam 을 못 읽어도 채점이 죽지 않는다."""
    try:
        exam = getattr(attempt, "exam", None)
        code = getattr(exam, "code", "") if exam is not None else ""
    except Exception as exc:  # noqa: BLE001 — lazy load 실패가 채점을 멈추면 안 된다
        log.warning("attempt %s: exam 을 읽지 못했다 (%s) — 기본 팩으로 진행", getattr(attempt, "id", "?"), exc)
        return DEFAULT_PACK
    return pack_for(code)


__all__ = [
    "AnswerPack",
    "DEFAULT_PACK",
    "EMPTY_PACK",
    "PACKS",
    "SET1_PACK",
    "SET9_PACK",
    "SKILLS",
    "normalize_code",
    "pack_for",
    "pack_for_attempt",
]
