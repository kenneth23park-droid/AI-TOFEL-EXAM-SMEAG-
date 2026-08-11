"""Write side of the data layer — every mutation the runtime API performs.

Reads stay in `crud.py`, writes live here (coding standard B3: a router never
touches `db.query()` itself). Status transitions exist in exactly one function,
`set_status()`, so Story 3.5 AC6 can be proved with a grep.
"""

from __future__ import annotations

import json
import logging
import random
from datetime import date, datetime
from typing import Any, Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud
from app.media import MediaRef
from app.models import (
    ATTEMPT_STATUSES,
    RUBRIC_SOURCE_DRAFT,
    RUBRIC_SOURCE_TEACHER,
    Attempt,
    AttemptEvent,
    Exam,
    LlmUsage,
    MediaAsset,
    QuestionResponse,
    RubricScore,
    SectionScore,
    Student,
    normalize_rubric_source,
    normalize_status,
    utcnow,
)
from app.scoring import autoscore
from app.scoring import scale as scale_mod
from app.scoring.answer_key import SKILLS, AnswerPack, pack_for, pack_for_attempt

# architecture.md §7.2 defines the denominator as the productive rows only.
# ⚠️ 가설(검증필요, PRD OQ-9): the live system may want every question to carry
# feedback, so the scope is a switch rather than a hard-coded query.
FEEDBACK_SCOPE = "productive_only"      # "productive_only" | "all_questions"

log = logging.getLogger("studyground.crud_write")

PRODUCTIVE_QTYPES = ("WRITING", "SPEAKING")

# Only forward moves plus a re-open of a finished attempt are legal.
_ALLOWED_TRANSITIONS = {
    "in_progress": {"in_progress", "scoring", "completed"},
    "scoring": {"scoring", "completed", "in_progress"},
    "completed": {"completed", "scoring"},
}

# Internal event types — the runtime cursor/clocks and the answer sequence ride on
# `attempt_events` so no schema change (and therefore no migration of someone
# else's file) is needed for them.
EV_STATE = "state_sync"
EV_SEQ = "answer_seq"


# ── students / exams / attempts ────────────────────────────────────────────


def get_or_create_student(
    db: Session, student_no: str, *, name: str = "", klass: str = "", campus: str = ""
) -> Student:
    """Story 3.2 AC2 — an unknown 학번 enrols itself; a known one is reused as is."""
    student = db.scalar(select(Student).where(Student.student_no == student_no))
    if student is not None:
        # Late-arriving profile data fills blanks but never overwrites what exists.
        if name and not student.name:
            student.name = name
        if campus and not student.campus:
            student.campus = campus
        if klass and not student.klass:
            student.klass = klass
        db.flush()
        return student

    student = Student(student_no=student_no, name=name or student_no, klass=klass, campus=campus)
    db.add(student)
    db.flush()
    return student


def get_exam_by_code(db: Session, exam_code: str) -> Exam | None:
    """Exams are pre-registered — the runtime never creates one (Story 3.2 AC2)."""
    return db.scalar(select(Exam).where(Exam.code == exam_code))


def new_session_id(exam_code: str, student_no: str, when: datetime | None = None) -> str:
    """Same shape the offline client mints in exam-store.js: CODE-YYYYMMDD-NO-xxxx."""
    stamp = (when or utcnow()).strftime("%Y%m%d")
    suffix = "".join(random.choice("0123456789abcdef") for _ in range(4))
    return f"{exam_code or 'SET1'}-{stamp}-{student_no or 'GUEST'}-{suffix}"


def find_resumable(db: Session, student_id: int, exam_id: int) -> Attempt | None:
    """architecture.md §7.1 — one live sitting per (student, exam) at a time."""
    return db.scalar(
        select(Attempt)
        .where(
            Attempt.student_id == student_id,
            Attempt.exam_id == exam_id,
            Attempt.status == "in_progress",
        )
        .order_by(Attempt.id.desc())
    )


def create_attempt(
    db: Session,
    *,
    student: Student,
    exam: Exam,
    profile: str = "toefl",
    scale: str = "",
    campus: str = "",
    content_hash: str = "",
    session: str = "",
) -> Attempt:
    now = utcnow()
    attempt = Attempt(
        student_id=student.id,
        exam_id=exam.id,
        taken_at=now,
        status="in_progress",
        session=session or new_session_id(exam.code, student.student_no, now),
        campus=campus or student.campus or "",
        exam_date=now.date(),
        profile=profile,
        scale=scale or ("ielts9" if profile == "ielts" else "toefl120"),
        content_hash=content_hash,
        started_at=now,
        # 문항 수는 응시할 팩(SET 1 / SET 9 …)에서 온다 — 예전처럼 SET 1 값을 고정하지 않는다.
        total_questions=pack_for(exam.code).total_questions,
    )
    db.add(attempt)
    db.flush()
    return attempt


# ── status (Story 3.5 AC1/AC6 — the single transition point) ───────────────


def set_status(db: Session, attempt: Attempt, status: str, *, reason: str = "") -> str:
    """The only place `attempts.status` is assigned.

    in_progress → scoring → completed, plus the reverse `completed → scoring`
    when a teacher deletes feedback (Story 3.5 AC4). An illegal move is ignored
    rather than raised: a stuck exam must never 500 on the student.
    """
    target = normalize_status(status)
    current = normalize_status(attempt.status)
    if target not in ATTEMPT_STATUSES or target not in _ALLOWED_TRANSITIONS[current]:
        return current
    if target != current:
        attempt.status = target
        log_event(db, attempt, "status", detail={"from": current, "to": target, "reason": reason})
        db.flush()
    return target


# ── answers ────────────────────────────────────────────────────────────────


def _last_client_seq(db: Session, attempt_id: int) -> int:
    row = db.scalar(
        select(AttemptEvent)
        .where(AttemptEvent.attempt_id == attempt_id, AttemptEvent.type == EV_SEQ)
        .order_by(AttemptEvent.id.desc())
    )
    if row is None:
        return 0
    try:
        return int(json.loads(row.detail or "{}").get("seq") or 0)
    except (ValueError, TypeError):
        return 0


def _response_map(attempt: Attempt) -> dict[str, QuestionResponse]:
    return {r.question_key: r for r in attempt.question_responses if r.question_key}


def _answer_text(qtype: str, value: Any) -> str:
    if isinstance(value, (list, dict)):
        return autoscore.display_answer(qtype, value) if isinstance(value, list) else json.dumps(value)
    return autoscore.display_answer(qtype, value)


def upsert_answers(
    db: Session,
    attempt: Attempt,
    items: Sequence[dict],
    *,
    client_seq: int | None = None,
) -> dict:
    """Idempotent (attempt_id, question_key) upsert — an outbox replay is safe.

    A request whose `client_seq` is older than the newest one already applied is
    rejected wholesale with reason 'stale' (architecture.md §7.1 멱등성 규칙).
    """
    last_seq = _last_client_seq(db, attempt.id)
    if client_seq is not None and client_seq < last_seq:
        return {
            "accepted": 0,
            "rejected": [{"question_key": i.get("question_key", ""), "reason": "stale"} for i in items],
            "submitted_count": attempt.submitted_count,
        }

    pack = pack_for_attempt(attempt)
    existing = _response_map(attempt)
    accepted = 0
    rejected: list[dict] = []

    for item in items:
        key = (item.get("question_key") or "").strip()
        if not key:
            rejected.append({"question_key": "", "reason": "missing_question_key"})
            continue

        known = pack.meta(key) or {}
        qtype = (item.get("qtype") or known.get("qtype") or "MCQ").strip().upper()
        skill = (item.get("skill") or known.get("skill") or "").strip()
        module = (item.get("module") or known.get("module") or "").strip()
        no = item.get("no")
        if no is None:
            no = known.get("no") or 0

        row = existing.get(key)
        if row is None:
            row = QuestionResponse(attempt_id=attempt.id, question_key=key, skill=skill, no=int(no))
            db.add(row)
            existing[key] = row
            attempt.question_responses.append(row)

        row.skill = skill or row.skill
        row.module = module or row.module
        row.qtype = qtype
        row.no = int(no)
        row.student_answer = _answer_text(qtype, item.get("answer"))
        row.max_score = float(known.get("max_score") or row.max_score or 1)
        if item.get("prompt"):
            row.prompt = str(item["prompt"])
        accepted += 1

    db.flush()
    if client_seq is not None and client_seq > last_seq:
        log_event(db, attempt, EV_SEQ, detail={"seq": client_seq})
    recalc_progress(db, attempt)
    return {"accepted": accepted, "rejected": rejected, "submitted_count": attempt.submitted_count}


# ── media ──────────────────────────────────────────────────────────────────


def record_media(
    db: Session,
    attempt: Attempt,
    *,
    question_key: str,
    ref: MediaRef,
    duration_ms: int = 0,
    kind: str = "audio",
) -> MediaAsset:
    """Store the blob's metadata and mirror the path onto the response row."""
    asset = db.scalar(
        select(MediaAsset).where(
            MediaAsset.attempt_id == attempt.id,
            MediaAsset.question_key == question_key,
            MediaAsset.kind == kind,
        )
    )
    if asset is None:
        asset = MediaAsset(attempt_id=attempt.id, question_key=question_key, kind=kind)
        db.add(asset)

    asset.storage = ref.storage
    asset.uri = ref.uri
    asset.mime = ref.mime
    asset.bytes = ref.bytes
    asset.sha256 = ref.sha256
    asset.duration_ms = int(duration_ms or 0)
    db.flush()

    # 키는 두 표 중 한 곳에만 있으므로 meta() 하나로 충분하다(예전 두 줄과 결과가 같다).
    known = pack_for_attempt(attempt).meta(question_key) or {}
    row = _response_map(attempt).get(question_key)
    if row is None:
        row = QuestionResponse(
            attempt_id=attempt.id,
            question_key=question_key,
            skill=known.get("skill") or "speaking",
            no=int(known.get("no") or 0),
            qtype=known.get("qtype") or "SPEAKING",
        )
        db.add(row)
        attempt.question_responses.append(row)
    row.audio_ref = ref.uri
    row.module = row.module or (known.get("module") or "")
    db.flush()
    recalc_progress(db, attempt)
    return asset


# ── events / runtime state ─────────────────────────────────────────────────


def log_event(
    db: Session,
    attempt: Attempt,
    type_: str,
    *,
    screen_id: str = "",
    detail: Any = "",
    ts: datetime | None = None,
) -> AttemptEvent:
    row = AttemptEvent(
        attempt_id=attempt.id,
        ts=ts or utcnow(),
        type=(type_ or "")[:32],
        screen_id=(screen_id or "")[:64],
        detail=detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False),
    )
    db.add(row)
    return row


def log_events(db: Session, attempt: Attempt, events: Iterable[dict]) -> int:
    n = 0
    for e in events:
        log_event(
            db,
            attempt,
            e.get("type") or "client",
            screen_id=e.get("screen_id") or "",
            detail=e.get("detail") if e.get("detail") is not None else "",
        )
        n += 1
    db.flush()
    return n


def save_runtime_state(db: Session, attempt: Attempt, *, cursor: dict, clocks: dict) -> None:
    """Cursor + wall-clock deadlines, so a reload on another device can resume.

    Kept as an `attempt_events` row (latest wins) — the runtime state is a log
    entry by nature and this avoids adding columns another story owns.
    """
    log_event(db, attempt, EV_STATE, detail={"cursor": cursor or {}, "clocks": clocks or {}})
    db.flush()


def load_runtime_state(db: Session, attempt: Attempt) -> dict:
    row = db.scalar(
        select(AttemptEvent)
        .where(AttemptEvent.attempt_id == attempt.id, AttemptEvent.type == EV_STATE)
        .order_by(AttemptEvent.id.desc())
    )
    if row is None:
        return {"cursor": None, "clocks": {}}
    try:
        payload = json.loads(row.detail or "{}")
    except ValueError:
        return {"cursor": None, "clocks": {}}
    return {"cursor": payload.get("cursor"), "clocks": payload.get("clocks") or {}}


# ── progress (Story 3.5) ───────────────────────────────────────────────────


def _is_answered(row: QuestionResponse) -> bool:
    return bool((row.student_answer or "").strip()) or bool((row.audio_ref or "").strip())


def feedback_counts(attempt: Attempt) -> tuple[int, int]:
    """(numerator, denominator) for feedback_progress under the active scope."""
    rows = list(attempt.question_responses)
    if FEEDBACK_SCOPE == "all_questions":
        pool = rows
    else:
        pool = [r for r in rows if (r.qtype or "").upper() in PRODUCTIVE_QTYPES]
    done = [r for r in pool if (r.feedback or "").strip()]
    return len(done), len(pool)


def recalc_progress(db: Session, attempt: Attempt) -> Attempt:
    """Refresh submitted_count / total_questions / feedback_progress, then status.

    Called after every write that can move any of the three (Story 3.5 AC3).
    """
    rows = list(attempt.question_responses)
    attempt.submitted_count = sum(1 for r in rows if _is_answered(r))
    # 응시한 팩의 문항 수가 바닥값이다(SET 1 은 91, SET 9 는 120). 팩을 모르면 0 이라
    # 실제로 들어온 응답 수가 그대로 총 문항 수가 된다 — 없는 문항을 지어내지 않는다.
    attempt.total_questions = max(pack_for_attempt(attempt).total_questions, len(rows))

    done, total = feedback_counts(attempt)
    attempt.feedback_progress = 100 if total == 0 else round(done / total * 100)

    # AC4 — the transition follows the number, in both directions, but only once
    # the sitting has actually been submitted.
    if attempt.submitted_at is not None and normalize_status(attempt.status) != "in_progress":
        set_status(
            db,
            attempt,
            "completed" if attempt.feedback_progress >= 100 else "scoring",
            reason="feedback_progress",
        )

    db.add(attempt)
    db.flush()
    return attempt


# ── grading (Story 3.4) ────────────────────────────────────────────────────


def upsert_section_score(
    db: Session,
    attempt: Attempt,
    skill: str,
    *,
    raw_correct: float,
    raw_total: float,
    scaled: int | None = None,
    provisional: bool = False,
) -> SectionScore:
    """`scaled` 를 주지 않으면 예전과 똑같이 raw 비율로 계산한다(Reading/Listening 무변경).

    `provisional=True` 는 "점수는 나왔지만 확정이 아니다"라는 뜻이다. 산출형이 있는
    섹션은 교사 확정 루브릭이 붙기 전까지 전부 잠정이다.
    """
    row = next((s for s in attempt.section_scores if s.skill == skill and not s.module), None)
    if row is None:
        row = SectionScore(attempt_id=attempt.id, skill=skill)
        db.add(row)
        attempt.section_scores.append(row)
    row.raw_correct = float(raw_correct)
    row.raw_total = float(raw_total)
    if scaled is None:
        row.scaled = round(raw_correct / raw_total * 30) if raw_total else 0
    else:
        row.scaled = int(scaled)
    row.provisional = bool(provisional)
    db.flush()
    return row


def rubric_rows_by_skill(attempt: Attempt) -> dict[str, list[dict]]:
    """`rubric_scores` 행을 scale.rubric_to_section() 이 먹는 dict 로 바꾼다."""
    out: dict[str, list[dict]] = {}
    for row in getattr(attempt, "rubric_scores", []) or []:
        skill = (row.skill or "").strip().lower()
        if not skill:
            continue
        out.setdefault(skill, []).append(
            {
                "skill": skill,
                "question_key": getattr(row, "question_key", "") or "",
                "criterion": row.criterion,
                "score": row.score,
                "max_score": row.max_score,
                "band": row.band,
                "source": normalize_rubric_source(getattr(row, "source", "")),
            }
        )
    return out


def teacher_confirmed_skills(attempt: Attempt) -> set[str]:
    """교사가 확정한 루브릭(source='teacher')이 하나라도 있는 스킬 집합.

    완료(status='completed') 판정의 유일한 근거다 — AI 초안은 점수를 만들 뿐
    시험을 끝내지 못한다.
    """
    out: set[str] = set()
    for row in getattr(attempt, "rubric_scores", []) or []:
        skill = (row.skill or "").strip().lower()
        if skill and normalize_rubric_source(getattr(row, "source", "")) == RUBRIC_SOURCE_TEACHER:
            out.add(skill)
    return out


def upsert_rubric_rows(
    db: Session,
    attempt: Attempt,
    rows: Iterable[dict],
    *,
    source: str = RUBRIC_SOURCE_DRAFT,
) -> dict:
    """(attempt_id, skill, question_key, criterion) 키로 루브릭 행을 upsert 한다.

    `question_key` 는 문항 단위로 채점하는 과제(Listen and Repeat)에만 붙고, 스킬을
    합쳐 채점하는 과제(에세이·인터뷰)는 '' 다. 이 컬럼이 키에 없으면 원문이 서로 다른
    복창 7문항이 한 자리를 두고 덮어써서 마지막 문항만 남는다.

    **source='teacher' 인 행은 절대 덮지 않는다.** 이 함수의 존재 이유가 그것이다:
    리포트를 다시 요청할 때마다 AI 초안이 다시 흘러 들어오는데, 교사가 확정해 둔
    행이 그때마다 초안으로 되돌아가면 채점이 영원히 끝나지 않는다. 교사 확정본을
    갱신할 수 있는 것은 또 다른 교사 확정본뿐이다.

    각 행의 `source` 가 우선이고, 없으면 인자 `source` 를 쓴다(모르는 값 → 초안).
    """
    existing: dict[tuple[str, str, str], RubricScore] = {}
    for row in getattr(attempt, "rubric_scores", []) or []:
        existing[
            (
                (row.skill or "").strip().lower(),
                (getattr(row, "question_key", "") or "").strip(),
                (row.criterion or "").strip(),
            )
        ] = row

    written = 0
    kept_teacher = 0
    skipped = 0

    for item in rows or []:
        skill = (item.get("skill") or "").strip().lower()
        question_key = (item.get("question_key") or "").strip()
        criterion = (item.get("criterion") or "").strip()
        if not skill or not criterion:
            skipped += 1
            continue

        incoming = normalize_rubric_source(item.get("source") or source)
        current = existing.get((skill, question_key, criterion))
        if current is not None and incoming != RUBRIC_SOURCE_TEACHER:
            if normalize_rubric_source(getattr(current, "source", "")) == RUBRIC_SOURCE_TEACHER:
                kept_teacher += 1
                continue

        if current is None:
            current = RubricScore(
                attempt_id=attempt.id,
                skill=skill,
                question_key=question_key,
                criterion=criterion,
            )
            db.add(current)
            attempt.rubric_scores.append(current)
            existing[(skill, question_key, criterion)] = current

        current.score = float(item.get("score") or 0)
        current.max_score = float(item.get("max_score") or 5)
        current.comment = str(item.get("comment") or "")
        band = item.get("band")
        current.band = None if band is None else float(band)
        current.source = incoming
        written += 1

    db.flush()
    return {"written": written, "kept_teacher": kept_teacher, "skipped": skipped}


# 한 섹션이 어떤 상태로 확정됐는가 — grade_attempt 가 이 셋을 모아 status 를 가른다.
SECTION_AUTO = "auto"                # 산출형이 없다(Reading/Listening) — 그 자체로 확정
SECTION_PROVISIONAL = "provisional"  # 점수는 나왔으나 교사 확정 전
SECTION_FINAL = "final"              # 교사 확정 루브릭이 반영됨


def _section_from_pack(
    db: Session,
    attempt: Attempt,
    pack: AnswerPack,
    adapter,
    skill: str,
    auto_correct: float,
    rubrics: list[dict],
    confirmed: bool = False,
) -> str:
    """한 섹션의 원점수를 확정한다. 반환값은 SECTION_* 셋 중 하나.

    ⚠️ 가설(검증필요) — 자동채점분과 산출형을 **문항 수 비율**로 섞는다. 실제 TOEFL 의
    변환표가 아니다(scale.Toefl120Scale.rubric_to_section 이 스스로 밝히는 것과 같은
    한계다). SET 9 Writing 은 build 10 + 에세이 2 라서 이 비율이면 에세이 비중이 1/6 뿐인데,
    실제 시험은 에세이 비중이 훨씬 크다. 근거 있는 표가 확보되면 여기와 scale.py 를 함께 고친다.
    """
    auto_total = float(pack.auto_total_by_skill.get(skill, 0) or 0)
    prod_total = float(pack.productive_total_by_skill.get(skill, 0) or 0)

    if prod_total <= 0:
        # Reading/Listening — 예전 경로 그대로.
        upsert_section_score(db, attempt, skill, raw_correct=auto_correct, raw_total=auto_total)
        return SECTION_AUTO

    if not rubrics:
        # 루브릭이 아직 하나도 없다. 자동채점분은 사실대로 남기고 분모에는 산출형 문항도
        # 세어 "12문항 중 10문항만 채점됨"이 보이게 한다. scaled 는 그 비율로 나오는
        # **하한**(=산출형을 0점으로 본 값)이며 잠정이다 — 0 으로 굳히면 총점 0 · grade A1 이
        # 확정된 점수처럼 읽힌다(NG-1 이 만든 사고가 정확히 그것이었다).
        upsert_section_score(
            db, attempt, skill,
            raw_correct=auto_correct, raw_total=auto_total + prod_total, provisional=True,
        )
        return SECTION_PROVISIONAL

    section_max = float(getattr(adapter, "section_max", 30) or 30)
    rubric_scaled = float(adapter.rubric_to_section(rubrics))
    # 루브릭 결과(0..section_max)를 "맞춘 문항 수" 단위로 환산해 자동채점분과 더한다.
    rubric_equiv = (rubric_scaled / section_max) * prod_total if section_max else 0.0
    upsert_section_score(
        db, attempt, skill,
        raw_correct=auto_correct + rubric_equiv, raw_total=auto_total + prod_total,
        provisional=not confirmed,
    )
    # AI 초안만으로도 점수는 나온다. 다만 그것은 확정이 아니다.
    return SECTION_FINAL if confirmed else SECTION_PROVISIONAL


def _ungradable(db: Session, attempt: Attempt, reason: str) -> dict:
    """채점 불가 ≠ 0점 — 섹션 점수를 **아예 쓰지 않고** 빠진다.

    모르는 exam code 는 EMPTY_PACK 으로 착지한다(answer_key.py 머리말). 그 상태로
    섹션 합산까지 돌면 네 섹션이 모두 0/0 으로 기록되고, 총점 0 · grade A1 ·
    status='completed' 가 **확정된 결과처럼** 남는다. 채점할 수단이 없다는 사실과
    0점이라는 판정은 다른 말이므로, 여기서는 아무 점수도 쓰지 않고 상태만
    scoring 으로 둔다. 답안·이벤트·진행률은 그대로 살아 있다(B7/F12).
    """
    recalc_progress(db, attempt)
    # recalc_progress 는 산출형 응답이 하나도 없으면 feedback_progress 를 100 으로 올려
    # completed 로 밀 수 있다. 채점 불가 응시에는 그 판정을 허용하지 않는다.
    set_status(db, attempt, "scoring", reason=reason)
    db.commit()
    return {
        "graded": 0,
        # 정답표가 없으니 저장된 응답 전부가 사람 손을 기다린다.
        "pending_productive": len(list(attempt.question_responses)),
        "pending_sections": [],
        "provisional_sections": [],
        "awaiting_teacher": [],
        "sections_written": False,
        "gradable": False,
        "reason": reason,
        "pack": "",
        "status": attempt.status,
        "total_score": attempt.total_score,
    }


def grade_attempt(db: Session, attempt: Attempt) -> dict:
    """The single entry point into auto-scoring (Story 3.4 AC1).

    Answers are compared against the server-side key only — whatever the browser
    claimed is correct is ignored (AC6). Productive rows keep `auto_score = NULL`.

    어느 정답표를 쓸지는 `attempt.exam.code` 가 정한다(app/scoring/answer_key.py).

    상태는 셋으로 갈린다(하나의 `done` 이 셋을 동시에 판정하려다 셋 다 틀렸었다):

        채점 불가        → scoring, reason='pack_unknown', 섹션 점수를 쓰지 않음
        점수 산출됨·잠정 → scoring, 점수는 나오되 provisional=True
        확정            → completed, 산출형 섹션마다 교사 확정 루브릭이 있을 때만
    """
    pack = pack_for_attempt(attempt)
    if not pack.code:
        return _ungradable(db, attempt, "pack_unknown")

    adapter = scale_mod.get_scale(attempt.scale or attempt.profile)
    correct_by_skill: dict[str, float] = {}
    graded = 0
    pending = 0

    for row in attempt.question_responses:
        entry = pack.lookup(row.question_key or "")
        if entry is None:
            # Productive (or unknown) — a teacher decides; leave auto_score NULL.
            row.auto_score = None
            row.is_correct = False
            if (row.qtype or "").upper() in PRODUCTIVE_QTYPES:
                pending += 1
            continue

        qtype = entry["qtype"]
        raw = _client_answer_value(row, qtype)
        value = autoscore.score(qtype, raw, entry["answer"])
        row.qtype = qtype
        row.skill = row.skill or entry["skill"]
        row.module = row.module or entry["module"]
        row.max_score = float(entry.get("max_score") or 1)
        row.auto_score = 0.0 if value is None else float(value)
        row.is_correct = row.auto_score >= row.max_score
        row.correct_answer = autoscore.display_answer(qtype, entry["answer"])
        correct_by_skill[entry["skill"]] = correct_by_skill.get(entry["skill"], 0.0) + row.auto_score
        graded += 1

    rubrics = rubric_rows_by_skill(attempt)
    confirmed = teacher_confirmed_skills(attempt)
    pending_sections: list[str] = []       # 루브릭이 아예 없는 섹션
    provisional_sections: list[str] = []   # 점수는 나왔으나 확정 전인 섹션
    for skill in SKILLS:
        state = _section_from_pack(
            db, attempt, pack, adapter, skill,
            correct_by_skill.get(skill, 0.0), rubrics.get(skill) or [],
            confirmed=skill in confirmed,
        )
        if state == SECTION_PROVISIONAL:
            provisional_sections.append(skill)
            if not rubrics.get(skill):
                pending_sections.append(skill)

    crud.recalc_totals(db, attempt)
    recalc_progress(db, attempt)

    # AC8 — 자동채점만으로는 어떤 응시도 완료되지 않는다. 완료의 근거는 오직
    # "산출형이 있는 섹션마다 교사 확정 루브릭이 있는가" 하나다. 예전에는 여기서
    # pending_sections(=루브릭 유무)를 봤는데, 그러면 AI 초안이 저장되는 순간
    # 교사 검수 없이 완료로 넘어가 버린다. 반대로 pending(산출형 응답 수)을 함께 보면
    # 교사가 확정한 뒤에도 영원히 scoring 에 갇힌다 — 둘 다 떼고 확정 여부만 본다.
    awaiting_teacher = [s for s in _teacher_required_skills(pack, attempt) if s not in confirmed]
    done = not awaiting_teacher
    set_status(db, attempt, "completed" if done else "scoring", reason="autoscore")
    db.commit()
    return {
        "graded": graded,
        "pending_productive": pending,
        "pending_sections": pending_sections,
        "provisional_sections": provisional_sections,
        "awaiting_teacher": awaiting_teacher,
        "sections_written": True,
        "gradable": True,
        "reason": "",
        "pack": pack.code,
        "status": attempt.status,
        "total_score": attempt.total_score,
    }


def _teacher_required_skills(pack: AnswerPack, attempt: Attempt) -> list[str]:
    """교사 확정 루브릭이 있어야 완료가 되는 스킬 — 팩의 산출형 + 실제 산출형 응답.

    팩에 에세이/스피킹이 있으면 응답이 하나도 없어도(=백지) 사람이 확인해야 한다.
    반대로 팩이 모르는 산출형 응답이 들어와 있어도 그 스킬은 사람 몫이다.
    """
    required = {
        skill for skill in SKILLS
        if float(pack.productive_total_by_skill.get(skill, 0) or 0) > 0
    }
    for row in attempt.question_responses:
        if (row.qtype or "").upper() in PRODUCTIVE_QTYPES:
            skill = (row.skill or "").strip().lower()
            if skill in SKILLS:
                required.add(skill)
    return [skill for skill in SKILLS if skill in required]


def _client_answer_value(row: QuestionResponse, qtype: str) -> Any:
    """`student_answer` is stored as display text; turn it back into a comparable."""
    text = row.student_answer or ""
    if qtype == "BUILD_SENTENCE":
        return text.split()
    return text


# ── submission ─────────────────────────────────────────────────────────────


def mark_submitted(db: Session, attempt: Attempt, *, client_finished_at: datetime | None = None) -> Attempt:
    """Freeze the sitting and move it into the scoring queue (Story 3.2 AC6)."""
    if attempt.submitted_at is None:
        attempt.submitted_at = utcnow()
    if client_finished_at is not None:
        log_event(db, attempt, "submit", detail={"client_finished_at": client_finished_at.isoformat()})
    if attempt.exam_date is None:
        attempt.exam_date = date.today()
    recalc_progress(db, attempt)
    set_status(db, attempt, "scoring", reason="submit")
    db.add(attempt)
    db.commit()
    return attempt



# ── LLM 사용량 원장 (호출 단위) ─────────────────────────────────────────────


def save_llm_usage(db: Session, attempt_id: int | None, records) -> int:
    """usage 수집기가 모은 호출들을 원장에 적는다. 저장한 행 수를 돌려준다.

    **호출 한 번이 한 행이다.** 한 응시를 여러 번 재채점하면 행이 여러 개 쌓이고,
    그게 맞다 — 재채점이 실제로 돈을 쓰기 때문이다. 집계는 언제나 행 단위로 하며
    attempt_id 는 추적용 참고 컬럼이다(models.LlmUsage 참고).

    계측 저장이 실패해도 채점/피드백은 살아야 한다(B7/F12): 예외는 삼키고 0 을 돌려준다.
    """
    rows = list(records or [])
    if not rows:
        return 0
    try:
        for r in rows:
            db.add(LlmUsage(
                attempt_id=attempt_id,
                scope=r.scope or "",
                provider=r.provider or "",
                model=r.model or "",
                input_tokens=int(r.input_tokens or 0),
                output_tokens=int(r.output_tokens or 0),
                cache_read_tokens=int(r.cache_read_tokens or 0),
                cache_write_tokens=int(r.cache_write_tokens or 0),
                cost_micros=r.cost_micros,          # None = 단가 미등록. 0 으로 접지 않는다.
                price_version=r.price_version or "",
                latency_ms=int(r.latency_ms or 0),
                ok=bool(r.ok),
                error=(r.error or "")[:2000],
            ))
        db.commit()
        return len(rows)
    except Exception as exc:  # noqa: BLE001 — 계측 저장이 본 기능을 막지 않는다
        log.warning("LLM 사용량 저장 실패 (%s건): %s", len(rows), exc)
        db.rollback()
        return 0


__all__ = [
    "FEEDBACK_SCOPE",
    "SECTION_AUTO",
    "SECTION_FINAL",
    "SECTION_PROVISIONAL",
    "create_attempt",
    "feedback_counts",
    "find_resumable",
    "get_exam_by_code",
    "get_or_create_student",
    "grade_attempt",
    "load_runtime_state",
    "log_event",
    "log_events",
    "mark_submitted",
    "new_session_id",
    "recalc_progress",
    "record_media",
    "rubric_rows_by_skill",
    "save_runtime_state",
    "set_status",
    "teacher_confirmed_skills",
    "upsert_answers",
    "save_llm_usage",
    "upsert_rubric_rows",
    "upsert_section_score",
]
