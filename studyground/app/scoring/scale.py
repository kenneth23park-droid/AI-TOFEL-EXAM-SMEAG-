"""Score scale adapters — architecture.md 9 (Story 6.4).

Three scales share one Protocol so the rest of the app never branches on the exam
profile:

    toefl120  → sections /30, total /120, CEFR grade, band_score = None
    toefl6    → sections and total are Bands 1.0..6.0 in 0.5 steps (ETS, 2026-01~)
    ielts9    → sections and total are Bands 0..9 in 0.5 steps, grade "Band 6.5"

Everything here is pure and offline: no DB, no network, no new dependency.
Both raw→band tables live in JSON next to this file (`ielts_band_table.json`,
`toefl6_band_table.json`) so a corrected table replaces the current one without a
code change.

toefl120 과 toefl6 의 관계
  같은 시험의 **표기 방식**이 둘이라는 뜻이다. ETS 는 2026-01 부터 1~6 밴드로
  보고하고 2028 까지 0~120 을 병기한다. 그래서 toefl6 은 toefl120 을 대체하는 게
  아니라 그 위에 얹히며, 두 눈금 모두 같은 원점수에서 나온다 — 어느 쪽을 성적표에
  쓸지는 `attempts.scale` 이 정한다.
"""

from __future__ import annotations

import json
import logging
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.models import SECTION_MAX, TOTAL_MAX, cefr_for

log = logging.getLogger("studyground.scoring")

# ETS 라이팅 12문항의 배점 — Build a Sentence 는 문항당 1점, 에세이 둘은 각 5.14 점.
# 라이팅 만점 = 10 + 5.14 + 5.14 = 20.28.
ESSAY_WEIGHT = 5.14

BAND_TABLE_PATH = Path(__file__).resolve().parent / "ielts_band_table.json"
TOEFL6_TABLE_PATH = Path(__file__).resolve().parent / "toefl6_band_table.json"

TOEFL = "toefl120"
TOEFL6 = "toefl6"
IELTS = "ielts9"
SCALE_KEYS = (TOEFL, TOEFL6, IELTS)

# profile ('toefl'|'ielts') → scale key, for callers that only carry the profile.
# 'toefl' 은 여전히 0~120 이다 — 밴드로 넘기는 것은 명시적으로 scale='toefl6' 을
# 지정한 응시뿐이다(전환기에 두 눈금이 공존한다).
PROFILE_TO_SCALE = {"toefl": TOEFL, "ielts": IELTS}


# ── rounding ──────────────────────────────────────────────────────────────────
def round_half_up(x: float) -> int:
    """Whole-number rounding that always sends .5 up.

    The built-in `round()` is banker's rounding (round(0.5) == 0), which is not
    what a score report is expected to do.
    """
    return int(Decimal(str(float(x))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def round_half_up_to_half(x: float) -> float:
    """Round to the nearest 0.5; .25 and .75 always go UP (architecture.md 9.4).

    IELTS hard rule from `rubrics/ielts_writing_task2.md`. `Decimal` is mandatory
    here — the built-in `round()` would send 6.25 to 6.2 (banker's rounding).
    """
    doubled = Decimal(str(float(x))) * 2
    return float(doubled.quantize(Decimal("1"), rounding=ROUND_HALF_UP) / 2)


def _mean(values: list[float]) -> float:
    return (sum(values) / len(values)) if values else 0.0


# 공식 총체 밴드 행의 criterion 이름. rubric.OFFICIAL_CRITERION 과 같은 문자열이지만
# 여기서 다시 적는다 — scale 은 rubric 을 import 하지 않는다(rubric 이 scale 을 쓴다).
OFFICIAL_CRITERION = "Official Band"


def _official_only(rubrics: list[dict]) -> list[dict]:
    """공식 총체 밴드 행만. 한 행도 없으면 빈 리스트(= 호출부가 옛 경로로 간다).

    ETS 가이드는 과제마다 총체 밴드 하나로 채점한다. 분석 축(TF/OD/LU/VO 등)은
    교사 설명용이라 섹션 점수에 섞이면 안 된다 — 섞으면 같은 답안이 축 개수에 따라
    다른 섹션 점수를 받는다.
    """
    return [
        row
        for row in rubrics or []
        if isinstance(row, dict) and str(row.get("criterion") or "").strip() == OFFICIAL_CRITERION
    ]


def _rubric_values(rubrics: list[dict], *, prefer_band: bool) -> list[float]:
    """Pull the usable number out of each rubric row, skipping unusable ones."""
    out: list[float] = []
    for row in rubrics or []:
        if not isinstance(row, dict):
            continue
        value = row.get("band") if prefer_band else row.get("score")
        if value is None:
            value = row.get("score") if prefer_band else row.get("band")
        try:
            out.append(float(value))
        except (TypeError, ValueError):
            continue
    return out


# ── Protocol ──────────────────────────────────────────────────────────────────
@runtime_checkable
class ScoreScale(Protocol):
    """architecture.md 9.1. Implementations are stateless and reusable."""

    key: str
    section_max: float
    total_max: float

    def section_score(self, raw_correct: float, raw_total: float) -> float: ...
    def combine(self, sections: dict[str, float]) -> float: ...
    def grade(self, total: float) -> str: ...
    def display(self, value: float) -> str: ...
    def rubric_to_section(self, rubrics: list[dict]) -> float: ...


# ── TOEFL ─────────────────────────────────────────────────────────────────────
class Toefl120Scale:
    """The existing behaviour, made explicit. No stored TOEFL value changes."""

    key = TOEFL
    section_max: float = float(SECTION_MAX)      # 30
    total_max: float = float(TOTAL_MAX)          # 120
    uses_band = False

    def section_score(self, raw_correct: float, raw_total: float, *, skill: str = "") -> float:
        if not raw_total:
            return 0.0
        ratio = float(raw_correct) / float(raw_total)
        ratio = min(max(ratio, 0.0), 1.0)
        return float(round_half_up(ratio * self.section_max))

    def combine(self, sections: dict[str, float]) -> float:
        """Sum of the scaled sections — identical to crud.recalc_totals."""
        return float(round_half_up(sum(float(v) for v in (sections or {}).values())))

    def grade(self, total: float) -> str:
        return cefr_for(int(round_half_up(total)))

    def display(self, value: float, maximum: float | None = None) -> str:
        top = self.section_max if maximum is None else float(maximum)
        return f"{round_half_up(value)}/{round_half_up(top)}"

    def rubric_to_section(self, rubrics: list[dict]) -> float:
        """⚠️ 가설(검증필요) — proportional, not the real TOEFL conversion table.

        공식 총체 밴드 행이 하나라도 있으면 **그 행들만** 접는다. 축 행은 교사
        설명용이라 섞으면 안 된다. 밴드 행이 전혀 없는 옛 데이터는 예전처럼
        모든 행을 접는다 — 재채점 없이도 이전 응시가 계속 열려야 한다.
        """
        rubrics = _official_only(rubrics) or rubrics
        earned = _rubric_values(rubrics, prefer_band=False)
        if not earned:
            return 0.0
        maxes: list[float] = []
        for row in rubrics or []:
            try:
                maxes.append(float(row.get("max_score") or 0))
            except (TypeError, ValueError):
                maxes.append(0.0)
        total_max = sum(maxes)
        if total_max <= 0:
            return 0.0
        return self.section_score(sum(earned), total_max)

    def band_score(self, total: float) -> float | None:
        return None

    def storage_total(self, total: float) -> int:
        """architecture.md 9.5 — attempts.total_score is an integer column."""
        return int(round_half_up(total))


# ── TOEFL 1~6 밴드 (ETS, 2026-01~) ────────────────────────────────────────────
class Toefl6Scale:
    """네 영역과 종합을 1.0~6.0(0.5 단위)로 낸다. 종합은 **합이 아니라 평균**이다.

    두 단계를 지난다. 근거의 등급이 서로 다르므로 코드에서도 갈라 둔다.

        1) 원점수 → 0~30 환산   ⚠️가설(검증필요). 정답률 비례.
        2) 0~30 → 1~6 밴드      ✅ETS 공식 표(`toefl6_band_table.json`).

    1단계가 가설인 이유: ETS 표는 "0~30 환산점수"에서 출발하는데, SMEAG 모의고사는
    문항 수가 실제 시험과 다르다(SET 9 는 R 50 · L 47 문항). 실측 환산표가 생기면
    `scaled_from_raw()` 하나만 갈아 끼우면 되고 밴드 경계는 건드릴 필요가 없다.

    Writing·Speaking 은 이 표를 타지 않는다. 과제 수가 적어 원점수가 늘 0.25 단위로
    떨어지는데 그 자리를 표로 옮기면 같은 0.25 차이가 구간마다 밴드를 바꾸기도, 안
    바꾸기도 한다. 대신 비율을 1.0~6.0 에 그대로 펴는 선형식 하나를 쓴다 —
    `linear_band()` · `writing_band()` 참조(2026-09-07 운영 결정, 기관용 눈금이다).

    밴드 바닥은 1.0 이다. ETS 표에서 0점도 밴드 1 이므로 0.0 은 존재하지 않는다.
    "아직 채점 안 된 영역"은 밴드 1 이 아니라 **없음(None)** 이며, 종합 평균에서
    통째로 빠진다 — `combine()` 참조.
    """

    key = TOEFL6
    section_max: float = 6.0
    total_max: float = 6.0
    uses_band = True
    scaled_max: float = 30.0

    def __init__(self, table_path: Path | None = None) -> None:
        self._path = Path(table_path) if table_path else TOEFL6_TABLE_PATH
        self._table: dict | None = None

    # -- table -----------------------------------------------------------------
    def _load(self) -> dict:
        if self._table is None:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                self._table = {
                    "scaled_max": float(raw.get("scaled_max") or 30),
                    "sections": {
                        skill: sorted(
                            [
                                {"min": float(r["min"]), "band": float(r["band"])}
                                for r in rows
                                if isinstance(r, dict) and "min" in r and "band" in r
                            ],
                            key=lambda r: r["min"],
                            reverse=True,
                        )
                        for skill, rows in (raw.get("sections") or {}).items()
                    },
                    "cefr": {str(k): str(v) for k, v in (raw.get("cefr") or {}).items()},
                }
            except Exception as exc:  # noqa: BLE001 — 표가 없다고 채점이 멈춰선 안 된다
                log.warning("toefl6 band table unusable (%s) — falling back to linear", exc)
                self._table = {"scaled_max": 30.0, "sections": {}, "cefr": {}}
        return self._table

    def scaled_from_raw(self, raw_correct: float, raw_total: float) -> float:
        """⚠️가설(검증필요) — 정답률을 그대로 0~30 으로 편다.

        실측 raw→scaled 표가 생기면 여기만 바꾼다. 실제 ETS 환산은 문항 난이도까지
        보정하므로 이 값은 근사치이며, 성적표에도 그렇게 표기해야 한다.
        """
        if not raw_total:
            return 0.0
        ratio = min(max(float(raw_correct) / float(raw_total), 0.0), 1.0)
        return float(round_half_up(ratio * self.scaled_max))

    def band_for_scaled(self, scaled: float, skill: str = "") -> float:
        """0~30 환산점수 → 밴드. ETS 공식 표를 그대로 읽는다."""
        rows = self._load()["sections"].get((skill or "").strip().lower())
        if not rows:
            # 표에 없는 영역: 비례 추정. 로그만 남기고 절대 예외를 던지지 않는다.
            log.info("no TOEFL 1-6 band bracket for skill %r — using a linear estimate", skill)
            ratio = min(max(float(scaled) / self.scaled_max, 0.0), 1.0)
            return round_half_up_to_half(1.0 + ratio * (self.section_max - 1.0))
        value = float(scaled)
        for row in rows:                       # 높은 구간부터
            if value >= row["min"]:
                return float(row["band"])
        return float(rows[-1]["band"])

    # -- ScoreScale ------------------------------------------------------------
    def section_score(self, raw_correct: float, raw_total: float, *, skill: str = "") -> float:
        return self.band_for_scaled(self.scaled_from_raw(raw_correct, raw_total), skill)

    def combine(self, sections: dict[str, float]) -> float:
        """네 영역 밴드의 산술평균을 0.5 단위로 반올림한다(ETS 규칙).

        ETS 예시: 평균 5.125 → 5.0, 5.25 → 5.5. `round_half_up_to_half` 가 바로
        그 규칙이다(.25 는 올림). 값이 없는(None) 영역은 평균에서 빠진다 — 채점
        대기 중인 라이팅을 0 으로 세면 종합이 실제보다 낮게 굳어 버린다.
        """
        values: list[float] = []
        for v in (sections or {}).values():
            if v is None:
                continue
            try:
                values.append(float(v))
            except (TypeError, ValueError):
                continue
        if not values:
            return 0.0
        return round_half_up_to_half(_mean(values))

    def grade(self, total: float) -> str:
        return f"Band {round_half_up_to_half(total):.1f}"

    def cefr(self, band: float) -> str:
        """밴드 → CEFR. ETS 가 같은 표에서 함께 발표한 대응이다(6=C2, 5~5.5=C1 …)."""
        return self._load()["cefr"].get(f"{round_half_up_to_half(band):.1f}", "")

    def display(self, value: float, maximum: float | None = None) -> str:
        return f"{round_half_up_to_half(value):.1f}"

    def rubric_to_section(self, rubrics: list[dict]) -> float:
        """루브릭(과제당 0~5) → 0~30 → 밴드.

        ETS 공식 산출형 루브릭은 네 과제 모두 0~5 다(docs/reference 참조). 과제별
        총체 밴드의 합을 `max_score` 합으로 나눈 비율을 0~30 에 얹는다 — 원점수→환산
        단계와 같은 성격의 ⚠️가설이다.

        Toefl120Scale 과 똑같이, 공식 총체 밴드 행이 있으면 **그 행들만** 접는다.
        분석 축(TF/OD/LU/VO)은 교사 설명용이라 섞으면 축 개수가 점수를 바꾼다.
        영역(skill)은 루브릭 행이 들고 있다. 섞여 있으면 첫 행을 따른다.
        """
        rubrics = _official_only(rubrics) or rubrics
        earned = _rubric_values(rubrics, prefer_band=False)
        if not earned:
            return 0.0
        maxes: list[float] = []
        for row in rubrics or []:
            try:
                maxes.append(float(row.get("max_score") or 0))
            except (TypeError, ValueError):
                maxes.append(0.0)
        top = sum(maxes)
        if top <= 0:
            return 0.0
        skill = ""
        for row in rubrics or []:
            if isinstance(row, dict) and row.get("skill"):
                skill = str(row["skill"]).strip().lower()
                break
        ratio = min(max(sum(earned) / top, 0.0), 1.0)
        if skill in ("speaking", "writing"):
            # 라이팅을 이 경로로 부르면 **에세이만** 접은 값이다. Build a Sentence 를
            # 포함한 영역 밴드는 writing_band() 이고, 자동채점 결과를 함께 들고 있는
            # 호출부가 그쪽을 쓴다.
            return self.linear_band(ratio)
        return self.band_for_scaled(round_half_up(ratio * self.scaled_max), skill)

    def linear_band(self, ratio: float) -> float:
        """기관용 선형 환산 — 비율(0~1)을 1.0~6.0 에 그대로 편다. Writing·Speaking 전용.

        Reading·Listening 과 달리 0~30 환산표를 거치지 않는다. 산출형은 과제 수가 적어
        원점수가 늘 0.25 단위로 떨어지는데, 그 자리를 표로 옮기면 같은 0.25 차이가 어떤
        구간에서는 밴드를 바꾸고 어떤 구간에서는 안 바꾼다. 학생에게 설명되는 눈금이
        아니어서 선형식 하나로 바꿨다.

            밴드 = round½(1 + 원점수 ÷ 만점 × 5)

        2026-09-04 에 스피킹만 "평균을 0.5 로 올린다"(= 5×비율)로 바꿨고, 2026-09-07 에
        여기 +1 을 더해 두 영역 모두 이 식으로 통일했다. 만점이 6.0 에 닿는다.
        .25·.75 는 늘 올린다 — 집 전체의 반올림 규칙과 같다.

        sg2/assets/sg-band.js · smeag-com/scores.html 의 linearBand() 와 같은 규칙.
        """
        r = min(max(float(ratio), 0.0), 1.0)
        band = round_half_up_to_half(1.0 + r * (self.section_max - 1.0))
        return min(max(band, 1.0), self.section_max)

    def speaking_band(self, ratio: float) -> float:
        """스피킹 밴드 — 11 과제(만점 55)의 비율을 선형 환산한다. linear_band 와 같다."""
        return self.linear_band(ratio)

    def writing_raw(
        self,
        auto_correct: float,
        auto_total: float,
        essay_scores: list[float],
        essay_max: float = 5.0,
    ) -> tuple[float, float]:
        """라이팅 원점수 → (raw, max).

        ETS 라이팅은 12문항이다 — Build a Sentence 10 (문항당 1점) + Write an Email +
        Write for an Academic Discussion (각 5.14 점). 에세이는 0~5 루브릭으로 채점하므로
        원점수로 넣을 때 5.14/5 를 곱한다. SET 9 기준 만점은 10 + 5.14 + 5.14 = 20.28.

        채점되지 않은 부분은 raw 에도 max 에도 넣지 않는다 — 넣으면 아직 안 낸 몫이
        오답으로 세어져 밴드가 실제보다 낮게 굳는다.
        """
        raw = 0.0
        top = 0.0
        if auto_total and float(auto_total) > 0:
            raw += min(max(float(auto_correct or 0.0), 0.0), float(auto_total))
            top += float(auto_total)
        for value in essay_scores or []:
            try:
                score = float(value)
            except (TypeError, ValueError):
                continue
            raw += min(max(score, 0.0), essay_max) / essay_max * ESSAY_WEIGHT
            top += ESSAY_WEIGHT
        return raw, top

    def writing_band(
        self,
        auto_correct: float,
        auto_total: float,
        essay_scores: list[float],
        essay_max: float = 5.0,
    ) -> float | None:
        """라이팅 영역 밴드. 에세이가 한 편도 채점되지 않았으면 None(= 채점 대기)이다 —
        BAS 만으로 밴드를 내면 10 점짜리 몫을 다 놓친 점수가 성적표에 실린다.
        """
        usable = []
        for value in essay_scores or []:
            try:
                usable.append(float(value))
            except (TypeError, ValueError):
                continue
        if not usable:
            return None
        raw, top = self.writing_raw(auto_correct, auto_total, usable, essay_max)
        return self.linear_band(raw / top) if top > 0 else None

    def band_score(self, total: float) -> float | None:
        return round_half_up_to_half(total)

    def storage_total(self, total: float) -> int:
        """architecture.md 9.5 — 밴드 × 10 이라야 정수 칼럼에서도 정렬이 산다."""
        return int(round_half_up(round_half_up_to_half(total) * 10))


# ── IELTS ─────────────────────────────────────────────────────────────────────
class Ielts9Scale:
    """Bands everywhere. Raw→band comes from the JSON table, never from code."""

    key = IELTS
    section_max: float = 9.0
    total_max: float = 9.0
    uses_band = True

    def __init__(self, table_path: Path | None = None) -> None:
        self._path = Path(table_path) if table_path else BAND_TABLE_PATH
        self._table: dict | None = None

    # -- table -----------------------------------------------------------------
    def _load(self) -> dict:
        if self._table is None:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                tables = raw.get("tables") or {}
                self._table = {
                    "raw_total": float(raw.get("raw_total") or 40),
                    "tables": {
                        skill: sorted(
                            [
                                {"min": float(r["min"]), "band": float(r["band"])}
                                for r in rows
                                if isinstance(r, dict) and "min" in r and "band" in r
                            ],
                            key=lambda r: r["min"],
                            reverse=True,
                        )
                        for skill, rows in tables.items()
                    },
                }
            except Exception as exc:  # noqa: BLE001 — a missing table must not stop scoring
                log.warning("ielts band table unusable (%s) — falling back to linear", exc)
                self._table = {"raw_total": 40.0, "tables": {}}
        return self._table

    def band_for_raw(self, raw_correct: float, raw_total: float, skill: str = "") -> float:
        table = self._load()
        rows = table["tables"].get((skill or "").strip().lower())
        if not rows:
            # No table for this skill: proportional fallback, logged, never an error.
            log.info("no IELTS band table for skill %r — using a linear estimate", skill)
            ratio = (float(raw_correct) / float(raw_total)) if raw_total else 0.0
            return round_half_up_to_half(min(max(ratio, 0.0), 1.0) * self.section_max)

        # Normalise onto the table's own raw scale (papers are not always /40).
        scale_total = float(raw_total) if raw_total else table["raw_total"]
        normalised = float(raw_correct) * (table["raw_total"] / scale_total) if scale_total else 0.0

        for row in rows:                       # rows are sorted high → low
            if normalised >= row["min"]:
                return float(row["band"])

        lowest = rows[-1]
        log.info(
            "raw %.2f is below every band bracket for %r — applying the lowest bracket (band %.1f)",
            normalised, skill, lowest["band"],
        )
        return float(lowest["band"])

    # -- ScoreScale ------------------------------------------------------------
    def section_score(self, raw_correct: float, raw_total: float, *, skill: str = "") -> float:
        return round_half_up_to_half(self.band_for_raw(raw_correct, raw_total, skill))

    def combine(self, sections: dict[str, float]) -> float:
        values: list[float] = []
        for v in (sections or {}).values():
            try:
                values.append(float(v))
            except (TypeError, ValueError):
                continue
        return round_half_up_to_half(_mean(values))

    def grade(self, total: float) -> str:
        return f"Band {round_half_up_to_half(total):.1f}"

    def display(self, value: float, maximum: float | None = None) -> str:
        return f"{round_half_up_to_half(value):.1f}"

    def rubric_to_section(self, rubrics: list[dict]) -> float:
        """Arithmetic mean of the criterion bands (ielts_writing_task2.md hard rule).

        IELTS 는 원래 분석적 4축 채점이라 축의 평균이 곧 밴드다 — TOEFL 과 달리
        총체 밴드로 갈아탈 이유가 없다. 다만 TOEFL 쪽에서 붙는 Official Band 행이
        IELTS 응시에 섞여 들어오면 평균이 한 번 더 눌리므로 여기서 걷어낸다.
        """
        rows = [row for row in rubrics or [] if not _official_only([row])]
        return round_half_up_to_half(_mean(_rubric_values(rows or rubrics, prefer_band=True)))

    def band_score(self, total: float) -> float | None:
        return round_half_up_to_half(total)

    def storage_total(self, total: float) -> int:
        """architecture.md 9.5 — band × 10 so the integer column still sorts."""
        return int(round_half_up(round_half_up_to_half(total) * 10))


_TOEFL_SINGLETON = Toefl120Scale()
_TOEFL6_SINGLETON = Toefl6Scale()
_IELTS_SINGLETON = Ielts9Scale()


def get_scale(key: str | None) -> ScoreScale:
    """`'ielts9'`/`'ielts'` → IELTS 밴드, `'toefl6'` → TOEFL 1~6 밴드,
    그 밖의 값(None 포함) → toefl120."""
    raw = (key or "").strip().lower()
    raw = PROFILE_TO_SCALE.get(raw, raw)
    if raw == IELTS:
        return _IELTS_SINGLETON
    if raw == TOEFL6:
        return _TOEFL6_SINGLETON
    if raw and raw != TOEFL:
        log.info("unknown scale key %r — defaulting to %s", key, TOEFL)
    return _TOEFL_SINGLETON


__all__ = [
    "BAND_TABLE_PATH",
    "IELTS",
    "Ielts9Scale",
    "SCALE_KEYS",
    "ScoreScale",
    "TOEFL",
    "TOEFL6",
    "TOEFL6_TABLE_PATH",
    "Toefl120Scale",
    "Toefl6Scale",
    "get_scale",
    "round_half_up",
    "round_half_up_to_half",
]
