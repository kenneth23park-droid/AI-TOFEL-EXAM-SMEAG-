"""Pydantic contracts — the interface every BMAD stream codes against.

Stream A (backend) fills these, Stream B (frontend) renders them, Stream C
(LangGraph) consumes `AttemptDetail` and returns `FeedbackBundle`. Change a
field here and every stream sees it.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import SECTION_MAX, TOTAL_MAX


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StudentOut(ORMModel):
    id: int
    student_no: str
    name: str
    klass: str = ""
    campus: str = ""


class ExamOut(ORMModel):
    id: int
    code: str
    title: str


class SectionScoreOut(ORMModel):
    skill: str
    raw_correct: float
    raw_total: float
    scaled: int
    max_score: int = SECTION_MAX
    module: str = ""
    # 교사 확정 루브릭이 붙기 전의 산출형 섹션은 점수가 나와도 잠정이다(가산 필드).
    provisional: bool = False


class QuestionResponseOut(ORMModel):
    no: int
    skill: str
    prompt: str
    student_answer: str
    correct_answer: str
    is_correct: bool
    # architecture.md 7.3 — additive only, so existing consumers keep working.
    question_key: str = ""
    qtype: str = "MCQ"
    module: str = ""
    feedback: str = ""
    auto_score: float | None = None
    max_score: float = 1
    audio_ref: str = ""


class RubricScoreOut(ORMModel):
    skill: str
    criterion: str
    score: float
    max_score: float
    comment: str = ""
    band: float | None = None       # IELTS only, 0.5 steps
    # ai_draft | teacher — 'teacher' 만 확정본이다(가산 필드).
    source: str = "ai_draft"


class FeedbackOut(ORMModel):
    scope: str
    lang: str
    mode: str
    summary: str
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


class AttemptSummary(ORMModel):
    """One row of the scores list."""

    id: int
    student: StudentOut
    exam: ExamOut
    taken_at: datetime
    total_score: int
    total_max: int = TOTAL_MAX
    grade: str
    status: str                     # in_progress | scoring | completed
    sections: dict[str, int] = Field(default_factory=dict)   # skill → scaled /30

    # architecture.md 7.3 — admin list columns, all optional for back-compat.
    session: str | None = None
    campus: str = ""
    exam_date: date | None = None
    submitted_count: int = 0
    total_questions: int = 0
    feedback_progress: int = 0      # 0..100
    profile: str = "toefl"
    scale: str = "toefl120"
    band_score: float | None = None  # IELTS overall band; None on the TOEFL scale


class AttemptDetail(AttemptSummary):
    """Everything the report page (and the scoring graph) needs."""

    section_scores: list[SectionScoreOut] = Field(default_factory=list)
    question_responses: list[QuestionResponseOut] = Field(default_factory=list)
    rubric_scores: list[RubricScoreOut] = Field(default_factory=list)
    feedback: list[FeedbackOut] = Field(default_factory=list)


class FeedbackItem(BaseModel):
    """One feedback block returned by the scoring graph."""

    scope: str
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


class FeedbackBundle(BaseModel):
    """Stream C's return contract: per-skill blocks + one overall block."""

    attempt_id: int
    mode: str                       # 'offline' (rules) | 'online' (LLM)
    lang: str = "en"
    items: list[FeedbackItem] = Field(default_factory=list)
    fell_back: bool = False         # online was attempted but the offline node answered
    note: str = ""


class RescoreResponse(BaseModel):
    ok: bool = True
    attempt_id: int
    mode: str
    fell_back: bool = False
    note: str = ""
    feedback: list[FeedbackOut] = Field(default_factory=list)
    # 이번 호출이 저장한 루브릭 행 수와, 덮지 않고 지켜 낸 교사 확정 행 수(가산 필드).
    rubrics_saved: int = 0
    rubrics_kept_teacher: int = 0
    # 이번 호출이 실제로 태운 LLM 호출 수와 금액(마이크로달러). 오프라인 모드면 0.
    llm_calls: int = 0
    llm_cost_micros: int = 0


# ── runtime API (architecture.md §7.1 — Stories 3.2 / 3.3 / 3.5) ──────────
# Additive only: nothing above this line changes shape.


class AttemptCreateIn(BaseModel):
    student_no: str
    exam_code: str
    name: str = ""                      # used only when the 학번 is new
    klass: str = ""
    profile: str = "toefl"              # toefl | ielts
    campus: str = ""
    content_hash: str = ""
    timing_hash: str = ""
    session: str = ""                   # client-minted offline id, if it has one


class AttemptCreateOut(BaseModel):
    attempt_id: int
    session: str
    server_time: datetime               # client derives serverNowOffset (§5.5)
    resume: bool = False
    status: str = "in_progress"
    total_questions: int = 0


class CursorIn(BaseModel):
    screen_id: str = ""
    screen_index: int = 0
    phase_index: int = 0


class AttemptStateIn(BaseModel):
    cursor: CursorIn | None = None
    clocks: dict[str, int] = Field(default_factory=dict)   # clock key → epoch ms


class AttemptStateOut(BaseModel):
    session: str | None = None
    status: str
    cursor: dict | None = None
    clocks: dict = Field(default_factory=dict)
    answered_count: int = 0
    server_time: datetime


class AnswerItemIn(BaseModel):
    question_key: str
    skill: str = ""
    module: str = ""
    qtype: str = ""
    no: int | None = None
    answer: Any = None                  # int index | str | list[str] | None
    elapsed_ms: int = 0
    prompt: str = ""


class AnswersIn(BaseModel):
    items: list[AnswerItemIn] = Field(default_factory=list)
    client_seq: int | None = None


class RejectedAnswer(BaseModel):
    question_key: str
    reason: str


class AnswersOut(BaseModel):
    accepted: int = 0
    rejected: list[RejectedAnswer] = Field(default_factory=list)
    submitted_count: int = 0


class MediaUploadIn(BaseModel):
    question_key: str
    mime: str = "audio/webm"
    duration_ms: int = 0
    data_b64: str = ""


class MediaUploadOut(BaseModel):
    audio_ref: str
    bytes: int
    sha256: str
    storage: str = "file"
    asset_id: int | None = None


class EventIn(BaseModel):
    ts: int | None = None               # client epoch ms, informational
    type: str
    screen_id: str = ""
    detail: Any = ""


class EventsIn(BaseModel):
    events: list[EventIn] = Field(default_factory=list)


class AttemptSubmitIn(BaseModel):
    client_finished_at: datetime | None = None
    answered_count: int = 0


class AttemptSubmitOut(BaseModel):
    attempt_id: int
    status: str = "scoring"
    submitted_count: int = 0
    total_questions: int = 0
    feedback_progress: int = 0
    already_submitted: bool = False


class AttemptResultPending(BaseModel):
    """Returned while auto-scoring has not finished (architecture.md §7.1)."""

    attempt_id: int
    status: str = "scoring"
    ready: bool = False


class HealthOut(BaseModel):
    status: str = "ok"
    app_mode: str
    scoring_mode: str
    database: str                   # 'sqlite' | 'postgresql'
    langgraph: bool                 # True when a real CompiledStateGraph is in use
    students: int
    attempts: int
