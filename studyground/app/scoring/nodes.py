"""The five scoring nodes. Pure functions over the graph state — no I/O besides the LLM call.

    ingest → analyze → route ─┬→ offline_feedback (rules) ─┐
                              └→ online_feedback  (LLM)  ──┴→ compose → END
"""

from __future__ import annotations

import logging
import re
from typing import Any, TypedDict

from app.config import get_settings
from app.schemas import AttemptDetail, FeedbackBundle, FeedbackItem
from app.scoring import answer_key as answer_key_mod
from app.scoring import llm, rules
from app.scoring import rubric as rubric_mod
from app.scoring import scale as scale_mod

log = logging.getLogger("studyground.scoring")

SCOPE_ORDER = ("reading", "listening", "speaking", "writing", "overall")

# qtypes the machine may score on its own (architecture.md 8.3).
AUTOSCORABLE = ("MCQ", "CLOZE", "WORD_FILLING", "INSERT", "BUILD_SENTENCE")
# qtypes that need a rubric (and, eventually, a teacher).
PRODUCTIVE_QTYPES = ("WRITING", "SPEAKING")


class ScoringState(TypedDict, total=False):
    detail: AttemptDetail
    lang: str
    requested_mode: str      # 'auto' | 'offline' | 'online'
    mode: str                # the node that actually produced the items
    analysis: dict[str, Any]
    items: list[FeedbackItem]
    fell_back: bool
    note: str
    # ── architecture.md 8.3 additions — all optional, so old callers still work ──
    responses: list[dict]    # autoscore output: one row per question_response
    rubrics: list[dict]      # rubric_* output: {skill, criterion, score, max_score, band, comment}
    scale: str               # 'toefl120' | 'ielts9'
    scaled: dict[str, Any]   # scale output: {sections, total, band, grade, display}
    stages: list[str]        # reserved: partial-run selection


# ── ingest ────────────────────────────────────────────────────────────────────
def ingest(state: ScoringState) -> ScoringState:
    """Normalise inputs so every downstream node can trust the state."""
    lang = state.get("lang") or get_settings().default_lang
    if lang not in ("en", "ko"):
        lang = "en"
    requested = state.get("requested_mode") or "auto"
    if requested not in ("auto", "offline", "online"):
        requested = "auto"
    # The scale rides on the attempt; an explicit state value wins for re-scoring.
    detail = state.get("detail")
    key = state.get("scale") or getattr(detail, "scale", "") or getattr(detail, "profile", "")
    resolved = scale_mod.get_scale(key).key
    return {
        "lang": lang,
        "requested_mode": requested,
        "fell_back": False,
        "note": "",
        "scale": resolved,
    }


# ── autoscore ─────────────────────────────────────────────────────────────────
_WS = re.compile(r"\s+")


def _norm(value: str) -> str:
    """Answer normalisation: collapse whitespace, lowercase, drop edge punctuation.

    `set1.js` answers are all lowercase (measured), so a case-insensitive compare
    is safe and forgiving of a stray trailing period.
    """
    return _WS.sub(" ", (value or "").strip()).strip(" .,;:!?\"'").lower()


def _tokens(value: str) -> list[str]:
    return [t for t in _norm(value).replace("|", " ").split(" ") if t]


def score_one(qtype: str, student: str, correct: str, max_score: float = 1.0) -> float | None:
    """Deterministic per-question score. `None` means a human still has to grade it."""
    kind = (qtype or "").strip().upper()
    if kind not in AUTOSCORABLE:
        return None
    if not (correct or "").strip():
        return None
    if not (student or "").strip():
        return 0.0

    if kind == "MCQ":
        try:                                   # option index compare when both are ints
            return float(max_score) if int(str(student).strip()) == int(str(correct).strip()) else 0.0
        except (TypeError, ValueError):
            pass                               # fall through to the string compare
    if kind == "BUILD_SENTENCE":
        return float(max_score) if _tokens(student) == _tokens(correct) else 0.0
    return float(max_score) if _norm(student) == _norm(correct) else 0.0


def autoscore(state: ScoringState) -> ScoringState:
    """Machine-scorable qtypes get an `auto_score`; everything else keeps `None`.

    Deterministic and offline. Never raises: a bad row is skipped and recorded in
    `note` so the rest of the attempt still scores.
    """
    detail = state.get("detail")
    rows: list[dict] = []
    problems: list[str] = []

    for q in getattr(detail, "question_responses", []) or []:
        row = {
            "no": getattr(q, "no", 0),
            "question_key": getattr(q, "question_key", "") or "",
            "skill": getattr(q, "skill", "") or "",
            "module": getattr(q, "module", "") or "",
            "qtype": (getattr(q, "qtype", "") or "MCQ").strip().upper(),
            "prompt": getattr(q, "prompt", "") or "",
            "student_answer": getattr(q, "student_answer", "") or "",
            "correct_answer": getattr(q, "correct_answer", "") or "",
            "max_score": float(getattr(q, "max_score", 1) or 1),
            "feedback": getattr(q, "feedback", "") or "",
            "audio_ref": getattr(q, "audio_ref", "") or "",
            "auto_score": getattr(q, "auto_score", None),
        }
        try:
            row["auto_score"] = score_one(
                row["qtype"], row["student_answer"], row["correct_answer"], row["max_score"]
            )
        except Exception as exc:  # noqa: BLE001 — one bad row must not stop the attempt
            problems.append(f"{row['question_key'] or row['no']}: {exc}")
            row["auto_score"] = None
        rows.append(row)

    out: ScoringState = {"responses": rows}
    if problems:
        note = state.get("note", "")
        out["note"] = (note + " " if note else "") + "autoscore skipped: " + "; ".join(problems[:5])
        log.warning("autoscore skipped %d row(s)", len(problems))
    return out


# ── analyze ───────────────────────────────────────────────────────────────────
def analyze(state: ScoringState) -> ScoringState:
    """Scores → the numeric picture both feedback nodes reason over."""
    return {"analysis": rules.analyze(state["detail"])}


# ── need_rubric (conditional edge) ────────────────────────────────────────────
def need_rubric(state: ScoringState) -> str:
    """architecture.md 8.3: skip the rubric nodes entirely when nothing is productive."""
    has_productive = any(
        r.get("qtype") in PRODUCTIVE_QTYPES for r in (state.get("responses") or [])
    )
    if not has_productive:
        return "scale"
    if state.get("requested_mode") == "offline":
        return "rubric_offline"
    return "rubric_online" if get_settings().llm_enabled else "rubric_offline"


def _productive_texts(state: ScoringState) -> dict[str, list[dict]]:
    """skill → the productive rows for it, in question order."""
    grouped: dict[str, list[dict]] = {}
    for row in state.get("responses") or []:
        if row.get("qtype") not in PRODUCTIVE_QTYPES:
            continue
        skill = (row.get("skill") or "").strip().lower()
        if not skill:
            skill = "writing" if row.get("qtype") == "WRITING" else "speaking"
        grouped.setdefault(skill, []).append(row)
    return grouped


# ── 복창(Listen and Repeat) 분기 ───────────────────────────────────────────────
# 에세이·인터뷰는 skill 단위로 합쳐 한 번 채점하는 게 자연스럽다(둘 다 자유 발화/작문이라
# 길이·다양성 지표가 합본에서 더 안정적이다). 반대로 복창은 문항마다 **다른 원문**과
# 대조해야 하므로 합칠 수가 없다 — 합치는 순간 어느 문장이 어느 원문과 짝인지 사라진다.
# 그래서 복창만 문항 단위로 떼어 낸다.
def _pack_for_state(state: ScoringState) -> Any:
    """이 응시의 정답 팩. 팩을 못 고르면 EMPTY_PACK 처럼 아무것도 모르는 상태로 둔다."""
    try:
        detail = state.get("detail")
        exam = getattr(detail, "exam", None)
        code = getattr(exam, "code", "") if exam is not None else ""
        return answer_key_mod.pack_for(code)
    except Exception as exc:  # noqa: BLE001 — 팩 조회 실패가 채점을 멈추면 안 된다
        log.warning("answer pack lookup failed (%s) — 복창 대조 없이 진행한다", exc)
        return answer_key_mod.EMPTY_PACK


def _split_repeat(pack: Any, skill: str, responses: list[dict]) -> tuple[list[tuple[dict, str]], list[dict]]:
    """(복창 문항 + 그 원문) 목록과 나머지 문항 목록으로 가른다.

    `skill != 'speaking'` 이면 가르지 않는다 — rubric.draft() 의 복창 경로가 speaking
    에서만 열리므로, 여기서 갈라 봐야 문항 단위로 쪼개지기만 하고 채점 방식은 같다.
    """
    repeats: list[tuple[dict, str]] = []
    others: list[dict] = []
    for row in responses:
        meta = {}
        if skill == "speaking":
            try:
                meta = pack.meta(row.get("question_key") or "") or {}
            except Exception as exc:  # noqa: BLE001 — 한 문항 조회 실패가 전체를 막지 않는다
                log.warning("answer key meta lookup failed for %r (%s)", row.get("question_key"), exc)
                meta = {}
        if rubric_mod.is_repeat_task(meta.get("task_kind") or ""):
            # reference 가 비어 있어도 그대로 보낸다 — rubric.draft() 가 "원문 없음"
            # degrade(보수적 중앙값 + 사유 코멘트)를 책임진다. 여기서 판단하지 않는다.
            repeats.append((row, str(meta.get("reference") or "")))
        else:
            others.append(row)
    return repeats, others


def _tag(rows: list[dict], row: dict) -> list[dict]:
    """문항 단위로 낸 루브릭 행에 출처 문항을 적어 둔다.

    복창 7문항은 criterion 이름이 모두 같아서(Repetition Accuracy / Completeness)
    이 표시가 없으면 교사 화면에서 어느 문항의 행인지 구분할 수 없다. 기존 키는
    건드리지 않는 가산형이다.
    """
    key = row.get("question_key") or ""
    no = row.get("no") or 0
    for r in rows:
        r["question_key"] = key
        r["no"] = no
    return rows


# ── rubric_offline (rules) ────────────────────────────────────────────────────
def rubric_offline(state: ScoringState) -> ScoringState:
    """Deterministic rubric draft. Always succeeds — this is the floor of the system."""
    scale_key = state.get("scale") or scale_mod.TOEFL
    lang = state.get("lang", "en")
    pack = _pack_for_state(state)
    rows: list[dict] = []
    for skill, responses in _productive_texts(state).items():
        repeats, others = _split_repeat(pack, skill, responses)
        for row, reference in repeats:
            rows.extend(
                _tag(
                    rubric_mod.draft(
                        skill,
                        row.get("student_answer") or "",
                        scale_key=scale_key,
                        lang=lang,
                        task_kind="repeat",
                        reference=reference,
                    ),
                    row,
                )
            )
        if others:
            text = "\n\n".join((r.get("student_answer") or "") for r in others)
            rows.extend(
                rubric_mod.draft(
                    skill, text, scale_key=scale_key, lang=lang, response_count=len(others)
                )
            )
    return {"rubrics": rows}


# ── rubric_online (LLM) ───────────────────────────────────────────────────────
def rubric_online(state: ScoringState) -> ScoringState:
    """LLM rubric draft, per skill, degrading to the rule-based draft on any error.

    A per-skill failure only downgrades that skill, so one bad Speaking call does
    not throw away a good Writing draft. Nothing escapes this function.

    복창(Listen and Repeat)만은 LLM 을 태우지 않고 언제나 offline 경로로 보낸다.
    이유: 복창 채점은 "들려준 문장과 얼마나 같은가"라는 **결정적 대조**이고, 그 답은
    difflib 이 정확히 낸다. LLM 에 맡기면 (a) 같은 답안이 호출마다 다른 점수를 받고
    (b) 원문을 프롬프트에 넣어 줘도 모델이 의미 유사성으로 후하게 봐 주며
    (c) 문항 수만큼 호출이 늘어 비용·지연만 커진다. 얻는 게 없다.
    """
    scale_key = state.get("scale") or scale_mod.TOEFL
    lang = state.get("lang", "en")
    pack = _pack_for_state(state)
    rows: list[dict] = []
    failures: list[str] = []

    for skill, all_responses in _productive_texts(state).items():
        repeats, responses = _split_repeat(pack, skill, all_responses)
        for row, reference in repeats:
            rows.extend(
                _tag(
                    rubric_mod.draft(
                        skill,
                        row.get("student_answer") or "",
                        scale_key=scale_key,
                        lang=lang,
                        task_kind="repeat",
                        reference=reference,
                    ),
                    row,
                )
            )
        if not responses:
            continue
        text = "\n\n".join((r.get("student_answer") or "") for r in responses)
        try:
            rows.extend(
                llm.generate_rubric(
                    skill,
                    text,
                    scale_key=scale_key,
                    lang=lang,
                    metrics=rubric_mod.measure(text),
                    max_score=rubric_mod.max_score_for(scale_key, skill),
                    criteria=rubric_mod.criteria_for(scale_key, skill),
                )
            )
        except Exception as exc:  # noqa: BLE001 — every failure degrades to the rules
            log.warning("rubric_online failed for %s, using rules: %s", skill, exc)
            failures.append(f"{skill} ({exc})")
            rows.extend(
                rubric_mod.draft(
                    skill, text, scale_key=scale_key, lang=lang, response_count=len(responses)
                )
            )

    out: ScoringState = {"rubrics": rows}
    if failures:
        note = state.get("note", "")
        out["fell_back"] = True
        out["note"] = (note + " " if note else "") + (
            "LLM rubric unavailable for " + ", ".join(failures) + " — rule-based draft was used."
        )
    return out


# ── scale ─────────────────────────────────────────────────────────────────────
def scale(state: ScoringState) -> ScoringState:
    """Turn raw counts and rubric rows into the numbers the report shows.

    Never raises: an unknown scale key, a missing table or a malformed rubric row
    all degrade to the TOEFL scale rather than stopping the pipeline.
    """
    detail = state.get("detail")
    try:
        adapter = scale_mod.get_scale(state.get("scale"))
        sections: dict[str, float] = {}

        for section in getattr(detail, "section_scores", []) or []:
            skill = (section.skill or "").strip().lower()
            if adapter.key == scale_mod.IELTS:
                sections[skill] = adapter.section_score(
                    section.raw_correct, section.raw_total, skill=skill
                )
            else:
                sections[skill] = float(section.scaled)

        # A fresh rubric draft outranks the stored section score for that skill.
        by_skill: dict[str, list[dict]] = {}
        for row in state.get("rubrics") or []:
            by_skill.setdefault((row.get("skill") or "").strip().lower(), []).append(row)
        for skill, rows in by_skill.items():
            if rows:
                sections[skill] = adapter.rubric_to_section(rows)

        total = adapter.combine(sections)
        scaled = {
            "scale": adapter.key,
            "sections": sections,
            "total": total,
            "band": adapter.band_score(total),
            "grade": adapter.grade(total),
            "display": adapter.display(total, adapter.total_max),
            "storage_total": adapter.storage_total(total),
        }
        return {"scaled": scaled, "scale": adapter.key}
    except Exception as exc:  # noqa: BLE001 — scaling must never stop the pipeline
        log.warning("scale node failed (%s) — leaving the stored totals untouched", exc)
        note = state.get("note", "")
        return {
            "scaled": {},
            "note": (note + " " if note else "") + f"scale skipped ({exc}).",
        }


# ── route ─────────────────────────────────────────────────────────────────────
def route(state: ScoringState) -> str:
    """Conditional edge: which feedback node runs."""
    requested = state.get("requested_mode", "auto")
    if requested == "offline":
        return "offline_feedback"
    settings = get_settings()
    if requested == "online":
        return "online_feedback" if settings.anthropic_api_key else "offline_feedback"
    # auto → online only when cloud mode has a key
    return "online_feedback" if settings.llm_enabled else "offline_feedback"


# ── offline_feedback (rules) ──────────────────────────────────────────────────
def offline_feedback(state: ScoringState) -> ScoringState:
    items = rules.build_items(state["analysis"], state.get("lang", "en"))
    out: ScoringState = {"items": items, "mode": "offline"}
    if state.get("requested_mode") == "online" and not get_settings().anthropic_api_key:
        # The caller asked for the LLM explicitly — say why they got rules instead.
        out["fell_back"] = True
        out["note"] = "ANTHROPIC_API_KEY is not set — rule-based feedback was used."
    return out


# ── online_feedback (LLM) ─────────────────────────────────────────────────────
def online_feedback(state: ScoringState) -> ScoringState:
    """LLM feedback, with an automatic fall back to the rule-based node on any error."""
    lang = state.get("lang", "en")
    try:
        items = llm.generate(state["analysis"], lang)
        return {"items": items, "mode": "online"}
    except Exception as exc:  # noqa: BLE001 — every failure degrades to offline
        log.warning("online feedback failed, falling back to rules: %s", exc)
        return {
            "items": rules.build_items(state["analysis"], lang),
            "mode": "offline",
            "fell_back": True,
            "note": f"LLM unavailable ({exc}) — rule-based feedback was used.",
        }


# ── compose ───────────────────────────────────────────────────────────────────
_TEACHER_PREFIX = {"en": "Teacher feedback:", "ko": "교사 피드백:"}


def _teacher_notes(detail: Any) -> dict[str, list[str]]:
    """skill → the teacher's own per-question notes, in question order."""
    notes: dict[str, list[str]] = {}
    for q in getattr(detail, "question_responses", []) or []:
        text = (getattr(q, "feedback", "") or "").strip()
        if not text:
            continue
        skill = (getattr(q, "skill", "") or "").strip().lower()
        if skill:
            notes.setdefault(skill, []).append(text)
    return notes


def _apply_teacher_rubrics(detail: Any, drafted: list[dict]) -> list[dict]:
    """A stored rubric row that already carries a teacher comment wins over the draft.

    Priority is teacher > AI (Story 5.1/5.2). `rubric_scores` has no `source`
    column yet — that is Story 5.1 AC6 in `models.py`, which is not this stream's
    file — so a non-empty stored `comment` is taken as the teacher's mark.
    """
    if not drafted:
        return drafted
    stored = {
        ((r.skill or "").strip().lower(), (r.criterion or "").strip()): r
        for r in (getattr(detail, "rubric_scores", []) or [])
        if (getattr(r, "comment", "") or "").strip()
    }
    if not stored:
        return drafted

    merged: list[dict] = []
    for row in drafted:
        key = ((row.get("skill") or "").strip().lower(), (row.get("criterion") or "").strip())
        teacher = stored.get(key)
        if teacher is None:
            merged.append(row)
            continue
        merged.append(
            {
                **row,
                "score": float(teacher.score),
                "max_score": float(teacher.max_score),
                "band": teacher.band,
                "comment": teacher.comment,
                "source": "manual",
                "origin": "teacher",
            }
        )
    return merged


def compose(state: ScoringState) -> ScoringState:
    """Order the blocks, drop unknown scopes, and guarantee one block per skill.

    Also the single place where the teacher outranks the AI: any per-question
    feedback a teacher typed is appended to that skill's block, and any rubric row
    the teacher already commented on replaces the drafted row.
    """
    produced = {item.scope: item for item in state.get("items", [])}
    analysis = state.get("analysis", {})
    lang = state.get("lang", "en")
    detail = state.get("detail")

    # Anything the producer skipped (or hallucinated a scope for) is filled from the rules.
    fallback = {item.scope: item for item in rules.build_items(analysis, lang)} if analysis else {}
    teacher = _teacher_notes(detail)
    prefix = _TEACHER_PREFIX.get(lang, _TEACHER_PREFIX["en"])

    ordered: list[FeedbackItem] = []
    for scope in SCOPE_ORDER:
        item = produced.get(scope) or fallback.get(scope)
        notes = teacher.get(scope)
        if notes:
            # Teacher > AI: the human's words lead the block and are never dropped.
            lines = [f"{prefix} {n}" for n in notes]
            if item is None:
                item = FeedbackItem(scope=scope, summary=lines[0], improvements=lines[1:])
            else:
                item = item.model_copy(
                    update={"improvements": lines + list(item.improvements)}
                )
        if item is not None:
            ordered.append(item)

    out: ScoringState = {"items": ordered}
    rubrics = _apply_teacher_rubrics(detail, state.get("rubrics") or [])
    if rubrics:
        out["rubrics"] = rubrics
    return out


def to_bundle(state: ScoringState, attempt_id: int) -> FeedbackBundle:
    return FeedbackBundle(
        attempt_id=attempt_id,
        mode=state.get("mode", "offline"),
        lang=state.get("lang", "en"),
        items=state.get("items", []),
        fell_back=bool(state.get("fell_back")),
        note=state.get("note", ""),
    )
