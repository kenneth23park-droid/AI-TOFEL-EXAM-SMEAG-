"""JSON API — the same data the pages render, plus the AI re-score action."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import crud, crud_write
from app.config import get_settings
from app.db import engine, get_db
from app.i18n import normalize
from app.schemas import (
    AttemptDetail,
    AttemptSummary,
    ExamOut,
    HealthOut,
    RescoreResponse,
    StudentOut,
)
from app.scoring import graph as scoring_graph
from app.scoring import nodes as scoring_nodes

log = logging.getLogger("studyground.scores")

router = APIRouter(prefix="/api", tags=["scores"])


@router.get("/health", response_model=HealthOut)
async def health(db: Session = Depends(get_db)) -> HealthOut:
    settings = get_settings()
    students, attempts = crud.count_rows(db)
    return HealthOut(
        app_mode=settings.app_mode,
        scoring_mode=settings.scoring_mode,
        database=engine.dialect.name,
        langgraph=scoring_graph.uses_langgraph(),
        students=students,
        attempts=attempts,
    )


@router.get("/students", response_model=list[StudentOut])
async def students(db: Session = Depends(get_db)):
    return crud.list_students(db)


@router.get("/exams", response_model=list[ExamOut])
async def exams(db: Session = Depends(get_db)):
    return crud.list_exams(db)


@router.get("/attempts", response_model=list[AttemptSummary])
async def attempts(
    student_id: int | None = None,
    exam_id: int | None = None,
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = crud.list_attempts(db, student_id=student_id, exam_id=exam_id, limit=limit)
    return [crud.to_summary(a) for a in rows]


@router.get("/attempts/{attempt_id}", response_model=AttemptDetail)
async def attempt_detail(
    attempt_id: int,
    lang: str = Query("en"),
    db: Session = Depends(get_db),
):
    """리포트 조회. **읽기 전용이다** — 루브릭 초안을 여기서 만들지 않는다.

    루브릭이 계산되기만 하고 저장되지 않던 문제(NG-2)를 조회 경로에서 고치고 싶은
    유혹이 있다. 그렇게 하면 GET 이 매번 그래프를 돌려(온라인 모드에서는 LLM 호출까지)
    쓰기를 일으키고, 새로고침 두 번이 서로 다른 점수를 만들 수 있으며, 캐시·재시도가
    모두 부작용이 된다. 초안 생성·저장은 명시적 동작인 POST /rescore 한 곳에 둔다.
    """
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Attempt not found.")
    return crud.to_detail(attempt, lang=normalize(lang))


@router.post("/attempts/{attempt_id}/rescore", response_model=RescoreResponse)
async def rescore(
    attempt_id: int,
    lang: str = Query("en"),
    mode: str = Query("auto", pattern="^(auto|offline|online)$"),
    db: Session = Depends(get_db),
):
    """Run the LangGraph pipeline again and replace this attempt's feedback.

    그래프는 이미 루브릭 행을 만들고 있었다(nodes.rubric_offline / rubric_online).
    그 행이 FeedbackBundle 로 흘러가지 않아 저장되지 못했고, 그래서 실제 API 응시는
    Writing/Speaking 루브릭이 영영 없는 채로 status='scoring' 에 갇혔다(NG-2).
    여기서 그래프 상태를 직접 받아 루브릭을 저장하고 섹션 점수를 다시 계산한다.
    """
    attempt = crud.get_attempt(db, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Attempt not found.")

    lang = normalize(lang)
    detail = crud.to_detail(attempt, lang=lang)

    # graph.run() 은 FeedbackBundle 만 돌려주는데 거기에는 rubrics 가 없다.
    # 그 계약을 넓히려면 schemas.FeedbackBundle 과 nodes.to_bundle 을 함께 고쳐야 하고
    # nodes.py 는 이 스트림의 파일이 아니다. 대신 graph.py 의 공개 API 두 개를 그대로
    # 쓴다 — 아래 두 줄이 graph.run() 의 본문과 글자 그대로 같다.
    state = {"detail": detail, "lang": lang, "requested_mode": mode}
    result = scoring_graph.get_graph().invoke(state)
    bundle = scoring_nodes.to_bundle(result, attempt.id)

    rows = crud.save_feedback(db, attempt, bundle)
    saved = _persist_rubrics(db, attempt, result.get("rubrics") or [])

    return RescoreResponse(
        attempt_id=attempt_id,
        mode=bundle.mode,
        fell_back=bundle.fell_back,
        note=bundle.note,
        feedback=rows,
        rubrics_saved=saved.get("written", 0),
        rubrics_kept_teacher=saved.get("kept_teacher", 0),
    )


def _persist_rubrics(db: Session, attempt, rubrics: list[dict]) -> dict:
    """그래프가 낸 루브릭 초안을 저장하고 섹션 점수를 갱신한다.

    저장이 실패해도 리포트/피드백 응답은 살아야 한다(B7/F12) — 예외는 삼키고
    로그만 남긴다. 교사가 확정한 행은 crud_write.upsert_rubric_rows 가 지켜 준다.
    """
    if not rubrics:
        return {"written": 0, "kept_teacher": 0}
    try:
        saved = crud_write.upsert_rubric_rows(db, attempt, rubrics)
        db.commit()
    except Exception as exc:  # noqa: BLE001 — 루브릭 저장 실패가 리포트를 깨뜨리면 안 된다
        log.warning("attempt %s: 루브릭 저장 실패 (%s) — 피드백만 반환한다", attempt.id, exc)
        db.rollback()
        return {"written": 0, "kept_teacher": 0}

    try:
        # 루브릭이 들어왔으니 섹션 합산과 status 를 다시 낸다(grade_attempt 가 commit 한다).
        crud_write.grade_attempt(db, attempt)
    except Exception as exc:  # noqa: BLE001 — 재채점 실패도 응답을 깨뜨리지 않는다
        log.warning("attempt %s: 루브릭 반영 재채점 실패 (%s)", attempt.id, exc)
        db.rollback()
    return saved
