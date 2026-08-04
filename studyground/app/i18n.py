"""UI strings — English is the default; Korean is the toggle.

The chosen language rides in the `lang` query param and is remembered in a
cookie, so a shared link always carries its own language.
"""

from __future__ import annotations

LANGS = ("en", "ko")
DEFAULT_LANG = "en"
LANG_COOKIE = "sg_lang"

STRINGS: dict[str, dict[str, str]] = {
    # chrome
    "app.name": {"en": "StudyGround", "ko": "StudyGround"},
    "app.tagline": {"en": "SMEAG score reports", "ko": "SMEAG 성적 리포트"},
    "nav.scores": {"en": "Scores", "ko": "성적"},
    "lang.toggle": {"en": "한국어", "ko": "English"},
    "mode.local": {"en": "Local · offline", "ko": "로컬 · 오프라인"},
    "mode.cloud": {"en": "Cloud · online", "ko": "클라우드 · 온라인"},

    # list page
    "list.title": {"en": "Score list", "ko": "성적 목록"},
    "list.subtitle": {
        "en": "{n} attempts · click a row for the full report",
        "ko": "응시 {n}건 · 행을 클릭하면 상세 리포트",
    },
    "list.allStudents": {"en": "All students", "ko": "전체 학생"},
    "list.allExams": {"en": "All exams", "ko": "전체 시험"},
    "list.empty": {"en": "No attempts recorded yet.", "ko": "저장된 응시 기록이 없습니다."},
    "col.date": {"en": "Date", "ko": "응시일"},
    "col.student": {"en": "Student", "ko": "학생"},
    "col.exam": {"en": "Exam", "ko": "시험"},
    "col.total": {"en": "Total", "ko": "총점"},
    "col.grade": {"en": "CEFR", "ko": "등급"},
    "col.status": {"en": "Status", "ko": "상태"},

    # skills
    "skill.reading": {"en": "Reading", "ko": "리딩"},
    "skill.listening": {"en": "Listening", "ko": "리스닝"},
    "skill.speaking": {"en": "Speaking", "ko": "스피킹"},
    "skill.writing": {"en": "Writing", "ko": "라이팅"},
    "skill.overall": {"en": "Overall", "ko": "종합"},

    # status
    "status.scored": {"en": "Scored", "ko": "채점 완료"},
    "status.pending": {"en": "Pending", "ko": "채점 대기"},
    "status.reviewing": {"en": "In review", "ko": "검토 중"},

    # detail page
    "detail.title": {"en": "Score report", "ko": "성적 상세 리포트"},
    "detail.back": {"en": "← Back to list", "ko": "← 목록으로"},
    "detail.taken": {"en": "Taken", "ko": "응시일"},
    "detail.sections": {"en": "Section scores", "ko": "영역별 점수"},
    "detail.review": {"en": "Question review", "ko": "문항 리뷰"},
    "detail.rubric": {"en": "Rubric", "ko": "루브릭"},
    "detail.feedback": {"en": "AI feedback", "ko": "AI 피드백"},
    "detail.strengths": {"en": "Strengths", "ko": "잘한 점"},
    "detail.improvements": {"en": "To improve", "ko": "개선할 점"},
    "detail.noFeedback": {
        "en": "No feedback generated yet — run a re-score.",
        "ko": "아직 생성된 피드백이 없습니다 — 재채점을 실행하세요.",
    },
    "detail.rescore": {"en": "↻ AI re-score", "ko": "↻ AI 재채점"},
    "detail.rescoring": {"en": "Re-scoring…", "ko": "재채점 중…"},
    "detail.rescored": {"en": "Feedback regenerated ({mode}).", "ko": "피드백을 다시 생성했습니다 ({mode})."},
    "detail.rescoreFailed": {"en": "Re-score failed.", "ko": "재채점에 실패했습니다."},
    "detail.qNo": {"en": "No.", "ko": "번호"},
    "detail.question": {"en": "Question", "ko": "문항"},
    "detail.yourAnswer": {"en": "Your answer", "ko": "내 답"},
    "detail.correctAnswer": {"en": "Correct", "ko": "정답"},
    "detail.result": {"en": "Result", "ko": "채점"},
    "detail.correct": {"en": "Correct", "ko": "정답"},
    "detail.wrong": {"en": "Wrong", "ko": "오답"},
    "detail.criterion": {"en": "Criterion", "ko": "평가 항목"},
    "detail.score": {"en": "Score", "ko": "점수"},
    "detail.of": {"en": "of", "ko": "/"},
    "detail.correctCount": {"en": "{correct} of {total} correct", "ko": "{total}문항 중 {correct}개 정답"},
    "detail.fellBack": {
        "en": "The LLM was unavailable — rule-based feedback is shown.",
        "ko": "LLM을 사용할 수 없어 규칙 기반 피드백을 표시합니다.",
    },
    "detail.modeOffline": {"en": "rule-based", "ko": "규칙 기반"},
    "detail.modeOnline": {"en": "LLM", "ko": "LLM"},

    # errors
    "error.404.title": {"en": "Not found", "ko": "찾을 수 없음"},
    "error.404.body": {
        "en": "That page or attempt does not exist.",
        "ko": "해당 페이지 또는 응시 기록이 존재하지 않습니다.",
    },
}


def normalize(lang: str | None) -> str:
    return lang if lang in LANGS else DEFAULT_LANG


def translator(lang: str):
    """Return `t(key, **fmt)` bound to a language, with an EN fallback."""
    lang = normalize(lang)

    def t(key: str, **fmt) -> str:
        entry = STRINGS.get(key)
        if entry is None:
            return key
        text = entry.get(lang) or entry.get(DEFAULT_LANG, key)
        return text.format(**fmt) if fmt else text

    return t
