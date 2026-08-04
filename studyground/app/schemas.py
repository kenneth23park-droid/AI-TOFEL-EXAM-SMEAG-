"""Pydantic contracts — the interface every BMAD stream codes against.

Stream A (backend) fills these, Stream B (frontend) renders them, Stream C
(LangGraph) consumes `AttemptDetail` and returns `FeedbackBundle`. Change a
field here and every stream sees it.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import SECTION_MAX, TOTAL_MAX


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StudentOut(ORMModel):
    id: int
    student_no: str
    name: str
    klass: str = ""


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


class QuestionResponseOut(ORMModel):
    no: int
    skill: str
    prompt: str
    student_answer: str
    correct_answer: str
    is_correct: bool


class RubricScoreOut(ORMModel):
    skill: str
    criterion: str
    score: float
    max_score: float
    comment: str = ""


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
    status: str
    sections: dict[str, int] = Field(default_factory=dict)   # skill → scaled /30


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


class HealthOut(BaseModel):
    status: str = "ok"
    app_mode: str
    scoring_mode: str
    database: str                   # 'sqlite' | 'postgresql'
    langgraph: bool                 # True when a real CompiledStateGraph is in use
    students: int
    attempts: int
