"""Admin grading back office — Epic 4 shell: left nav, strings, render helper.

The package is split by screen (answers / speaking / stats) because one module
would blow past the 400-line ceiling in coding standard C4. Everything is wired
into a single `router` so `main.py` needs exactly one registration line:

    router
      ├── pages_router   prefix=/admin       HTML screens
      └── api_router     prefix=/api/admin   JSON + media stream

Admin strings live here rather than in `app/i18n.py` so this epic owns all of its
own files; `admin_render()` injects them as `at('key')` next to the shared `t()`.
"""

from __future__ import annotations

from datetime import date
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import crud
from app.db import get_db
from app.templating import render, resolve_lang

# Session cookie for the media guard (Story 4.4 AC7). It is a placeholder for a
# real login — set when an admin screen is served, checked before audio is streamed.
ADMIN_COOKIE = "sg_admin"
ADMIN_COOKIE_VALUE = "1"

# Story 4.1 AC1 — the ten observed menu entries, in the observed order.
NAV: tuple[tuple[str, str, str, str], ...] = (
    ("dashboard", "/admin", "Dashboard", "대시보드"),
    ("exams", "/admin/exams", "Exam Management", "시험 관리"),
    ("questions", "/admin/questions", "Question Bank", "문제 은행"),
    ("students", "/admin/students", "Students Management", "학생 관리"),
    ("simulation", "/admin/simulation", "TOEFL Simulation", "TOEFL 시뮬레이션"),
    ("register", "/admin/register", "Answer REGISTER", "정답 등록"),
    ("answers", "/admin/answers", "TOEFL(2) ANSWERS", "TOEFL(2) 답안"),
    ("speaking", "/admin/speaking", "SPEAKING ANSWERS", "스피킹 답안"),
    ("statistics", "/admin/statistics", "Exam Statistics", "시험 통계"),
    ("rankings", "/admin/rankings", "Rankings by Grade", "등급별 순위"),
    ("usage", "/admin/usage", "AI Usage & Cost", "AI 사용량·비용"),
)

# EN default, KO toggle (P3). Keys mirror the observed back-office wording.
STRINGS: dict[str, dict[str, str]] = {
    "admin.title": {"en": "Admin", "ko": "관리자"},
    "admin.tagline": {"en": "Grading back office", "ko": "채점 백오피스"},
    "admin.toStudent": {"en": "Student view", "ko": "학생 화면"},
    "admin.comingSoon": {"en": "Coming soon", "ko": "준비 중"},
    "admin.comingSoonBody": {
        "en": "This screen is not built yet. The menu entry is kept so the navigation "
              "matches the existing back office.",
        "ko": "아직 구현되지 않은 화면입니다. 기존 백오피스와 내비게이션을 맞추기 위해 "
              "메뉴는 그대로 노출합니다.",
    },
    "admin.dashboard": {"en": "Dashboard", "ko": "대시보드"},
    "admin.students": {"en": "Students", "ko": "학생 수"},
    "admin.attempts": {"en": "Attempts", "ko": "응시 수"},
    "admin.awaiting": {"en": "Awaiting feedback", "ko": "피드백 대기"},
    "admin.completed": {"en": "Completed", "ko": "채점 완료"},

    # answers list
    "answers.title": {"en": "3-Subject Answer Management", "ko": "3과목 답안 관리"},
    "answers.intro": {
        "en": "Review READING / LISTENING / WRITING answers by switching tabs on a "
              "single screen, and write feedback for each question.",
        "ko": "한 화면에서 탭만 전환하며 READING / LISTENING / WRITING 답안을 검토하고, "
              "문항마다 피드백을 작성하세요.",
    },
    "answers.session": {"en": "Session", "ko": "세션"},
    "answers.studentQuery": {"en": "Student Name/ID", "ko": "학생 이름/학번"},
    "answers.dateFrom": {"en": "Exam Date (From)", "ko": "시험일 (시작)"},
    "answers.dateTo": {"en": "Exam Date (To)", "ko": "시험일 (종료)"},
    "answers.search": {"en": "Search", "ko": "검색"},
    "answers.reset": {"en": "Reset", "ko": "초기화"},
    "answers.empty": {"en": "No attempts match your search.", "ko": "검색 조건에 맞는 응시 기록이 없습니다."},
    "col.session": {"en": "Session", "ko": "세션"},
    "col.examName": {"en": "Exam Name", "ko": "시험명"},
    "col.campus": {"en": "Campus", "ko": "캠퍼스"},
    "col.examDate": {"en": "Exam Date", "ko": "시험일"},
    "col.submitted": {"en": "Submitted Questions", "ko": "제출 문항"},
    "col.progress": {"en": "Feedback Progress", "ko": "피드백 진행률"},
    "col.manage": {"en": "Manage", "ko": "관리"},
    "action.view": {"en": "View", "ko": "보기"},
    "action.write": {"en": "Write Answer", "ko": "답안 작성"},
    "answers.items": {"en": "{n} ITEMS", "ko": "{n} 문항"},
    "page.prev": {"en": "← Prev", "ko": "← 이전"},
    "page.next": {"en": "Next →", "ko": "다음 →"},
    "page.of": {"en": "Page {page} of {pages} · {total} attempts",
                "ko": "{pages}쪽 중 {page}쪽 · 총 {total}건"},

    # answer detail
    "detail.adminTitle": {"en": "Answer detail", "ko": "답안 상세"},
    "detail.readonly": {"en": "Read only", "ko": "읽기 전용"},
    "detail.editing": {"en": "Writing answers", "ko": "답안 작성 중"},
    "detail.studentAnswer": {"en": "Student answer", "ko": "학생 답안"},
    "detail.correctAnswerFull": {"en": "Correct answer", "ko": "정답"},
    "detail.notSubmitted": {"en": "No answer submitted / NOT SUBMIT", "ko": "미제출 / NOT SUBMIT"},
    "detail.feedbackLabel": {"en": "Feedback", "ko": "피드백"},
    "detail.feedbackPlaceholder": {
        "en": "Write your comments, model answer, or grading notes…",
        "ko": "코멘트, 모범 답안, 채점 메모를 작성하세요…",
    },
    "detail.save": {"en": "Save", "ko": "저장"},
    "detail.saved": {"en": "Saved", "ko": "저장됨"},
    "detail.saveFailed": {"en": "Save failed — retry", "ko": "저장 실패 — 다시 시도"},
    "detail.manual": {"en": "Manual", "ko": "수동 채점"},
    "detail.noRows": {"en": "No {skill} responses for this attempt.",
                      "ko": "이 응시에는 {skill} 답안이 없습니다."},
    "detail.year": {"en": "Year", "ko": "연도"},
    "detail.campus": {"en": "Campus", "ko": "캠퍼스"},

    # speaking
    "speaking.title": {"en": "Speaking answers", "ko": "스피킹 답안"},
    "speaking.intro": {
        "en": "Play each recording, score it against the rubric, and leave feedback.",
        "ko": "녹음을 재생하고 루브릭에 따라 채점한 뒤 피드백을 남기세요.",
    },
    "speaking.empty": {"en": "No attempts carry Speaking responses yet.",
                       "ko": "스피킹 답안이 있는 응시 기록이 아직 없습니다."},
    "speaking.reviewed": {"en": "{done} / {total} reviewed", "ko": "{total}문항 중 {done}건 검토"},
    "speaking.prompt": {"en": "Prompt", "ko": "문항"},
    "speaking.recording": {"en": "Recording", "ko": "녹음"},
    "speaking.noRecording": {"en": "NOT SUBMIT", "ko": "NOT SUBMIT"},
    "speaking.duration": {"en": "Duration", "ko": "길이"},
    "speaking.speed": {"en": "Speed", "ko": "재생 속도"},
    "speaking.score": {"en": "Rubric score", "ko": "루브릭 점수"},

    # statistics
    "stats.title": {"en": "Exam statistics", "ko": "시험 통계"},
    "stats.candidates": {"en": "Candidates", "ko": "응시자 수"},
    "stats.avgTotal": {"en": "Average total", "ko": "평균 총점"},
    "stats.highest": {"en": "Highest", "ko": "최고점"},
    "stats.lowest": {"en": "Lowest", "ko": "최저점"},
    "stats.bySkill": {"en": "Average by skill", "ko": "영역별 평균"},
    "stats.accuracy": {"en": "Correct rate by question", "ko": "문항별 정답률"},
    "stats.distribution": {"en": "CEFR distribution", "ko": "CEFR 등급 분포"},
    "stats.rate": {"en": "Correct rate", "ko": "정답률"},
    "stats.responses": {"en": "Responses", "ko": "응답 수"},
    "stats.noData": {"en": "Not enough data.", "ko": "집계할 데이터가 없습니다."},
    "stats.includeScoring": {"en": "Include in-scoring attempts", "ko": "채점 중 응시 포함"},
    "stats.allExams": {"en": "All exams", "ko": "전체 시험"},
    "stats.campus": {"en": "Campus", "ko": "캠퍼스"},
    "stats.apply": {"en": "Apply", "ko": "적용"},

    # rankings
    "rank.title": {"en": "Rankings by grade", "ko": "등급별 순위"},
    "rank.allGrades": {"en": "All grades", "ko": "전체 등급"},
    "rank.export": {"en": "Export CSV", "ko": "CSV 내려받기"},
    "rank.empty": {"en": "No ranked attempts for this filter.", "ko": "해당 조건의 순위 데이터가 없습니다."},
    "col.rank": {"en": "Rank", "ko": "순위"},
    "col.studentNo": {"en": "Student No", "ko": "학번"},
}


def admin_t(lang: str):
    """`at(key, **fmt)` — same contract as i18n.translator, scoped to this epic."""
    def at(key: str, **fmt) -> str:
        entry = STRINGS.get(key)
        if entry is None:
            return key
        text = entry.get(lang) or entry.get("en", key)
        return text.format(**fmt) if fmt else text

    return at


def nav_items(active: str, lang: str) -> list[dict]:
    return [
        {"key": key, "href": href, "label": (ko if lang == "ko" else en), "active": key == active}
        for key, href, en, ko in NAV
    ]


def admin_render(request: Request, template: str, lang: str, active: str, context: dict, status_code: int = 200):
    """templating.render() plus the admin chrome, and the media-guard cookie."""
    ctx = {"at": admin_t(lang), "nav": nav_items(active, lang), "active_nav": active}
    ctx.update(context)
    response = render(request, template, lang, ctx, status_code=status_code)
    response.set_cookie(ADMIN_COOKIE, ADMIN_COOKIE_VALUE, max_age=60 * 60 * 8, samesite="lax")
    return response


def is_admin(request: Request) -> bool:
    """Story 4.4 AC7 — audio is only streamed to a browser that holds an admin session."""
    return request.cookies.get(ADMIN_COOKIE) == ADMIN_COOKIE_VALUE


def parse_date(value: str | None) -> date | None:
    """Blank / malformed dates are ignored rather than raising — a search box is not an API."""
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def keep_query(request: Request, **overrides) -> str:
    """Carry the current search parameters across pagination links (Story 4.2 AC7)."""
    params = dict(request.query_params)
    for key, value in overrides.items():
        if value is None or value == "":
            params.pop(key, None)
        else:
            params[key] = str(value)
    return ("?" + urlencode(params)) if params else ""


pages_router = APIRouter(prefix="/admin", tags=["admin"], include_in_schema=False)
api_router = APIRouter(prefix="/api/admin", tags=["admin"], include_in_schema=False)
router = APIRouter(include_in_schema=False)


# Imported after the helpers above exist — the submodules import them from here.
from app.routers.admin import answers, speaking, stats, usage  # noqa: E402

pages_router.include_router(answers.router)
pages_router.include_router(speaking.router)
pages_router.include_router(stats.router)
pages_router.include_router(usage.router)
api_router.include_router(answers.api)
api_router.include_router(speaking.api)


@pages_router.get("")
async def dashboard(
    request: Request,
    lang: str | None = None,
    db: Session = Depends(get_db),
):
    lang = resolve_lang(request, lang)
    students, attempts = crud.count_rows(db)
    total, rows = crud.search_attempts(db, limit=200)
    awaiting = len([r for r in rows if r.feedback_progress < 100])
    completed = len([r for r in rows if r.status == "completed"])

    return admin_render(request, "admin_base.html", lang, "dashboard", {
        "page_title": admin_t(lang)("admin.dashboard"),
        "tiles": [
            ("admin.students", students),
            ("admin.attempts", attempts),
            ("admin.awaiting", awaiting),
            ("admin.completed", completed),
        ],
        "total_attempts": total,
    })


def _coming_soon(active: str):
    """Story 4.1 AC2 — the link resolves to a placeholder, never a 404."""

    async def page(request: Request, lang: str | None = None):
        lang = resolve_lang(request, lang)
        label = next((ko if lang == "ko" else en for key, _, en, ko in NAV if key == active), active)
        return admin_render(request, "admin_base.html", lang, active, {"page_title": label})

    return page


for _key, _path, _en, _ko in NAV:
    if _key in ("dashboard", "answers", "speaking", "statistics", "rankings", "usage"):
        continue
    pages_router.add_api_route(_path.replace("/admin", "", 1), _coming_soon(_key), methods=["GET"])

router.include_router(pages_router)
router.include_router(api_router)

__all__ = ["ADMIN_COOKIE", "NAV", "STRINGS", "admin_render", "admin_t", "api_router",
           "is_admin", "keep_query", "pages_router", "parse_date", "router"]
