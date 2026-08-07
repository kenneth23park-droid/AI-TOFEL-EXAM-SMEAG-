"""Deterministic seed — 6 students, 3 exam sets, 12 attempts.

Fixed RNG seed, so a fresh local DB always produces the same numbers and the
same rule-based feedback. Idempotent: seeding an already-populated DB is a no-op.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crud
from app.config import get_settings
from app.db import create_all, session_scope
from app.migrations import run_migrations
from app.models import (
    PRODUCTIVE,
    RECEPTIVE,
    SECTION_MAX,
    Attempt,
    Exam,
    QuestionResponse,
    RubricScore,
    SectionScore,
    Student,
    cefr_for,
)
from app.scoring import graph as scoring_graph

SEED = 20260804
QUESTIONS_PER_RECEPTIVE = 20

STUDENTS = [
    ("S2026-001", "Kim Min-su", "Intensive A", "Capital"),
    ("S2026-002", "Lee Ji-woo", "Intensive A", "Capital"),
    ("S2026-003", "Park Seo-yeon", "Intensive B", "Sparta"),
    ("S2026-004", "Nguyen Thi Mai", "ESL Core", "Classic"),
    ("S2026-005", "Tanaka Haruto", "ESL Core", "Classic"),
    ("S2026-006", "Chen Yu-wei", "Intensive B", "Sparta"),
]

# Seeded receptive questions belong to the first module of their skill.
SEED_MODULE = {"reading": "R1", "listening": "L1"}

# attempts.profile → attempts.scale (architecture.md 6.2.2).
_SCALE_FOR = {"toefl": "toefl120", "ielts": "ielts9"}

EXAMS = [
    ("SET 9", "SMEAG Mock Test — SET 9"),
    ("SET 8", "SMEAG Mock Test — SET 8"),
    ("SET 7", "SMEAG Mock Test — SET 7"),
]

RUBRIC_CRITERIA = {
    "speaking": ("Fluency & Coherence", "Pronunciation", "Vocabulary", "Grammar"),
    "writing": ("Task Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range"),
}

# Ability profile per student: base accuracy 0–1 per skill. Shapes realistic reports.
PROFILES = [
    {"reading": 0.88, "listening": 0.80, "speaking": 0.72, "writing": 0.78},
    {"reading": 0.72, "listening": 0.85, "speaking": 0.80, "writing": 0.66},
    {"reading": 0.60, "listening": 0.55, "speaking": 0.64, "writing": 0.58},
    {"reading": 0.92, "listening": 0.88, "speaking": 0.84, "writing": 0.90},
    {"reading": 0.50, "listening": 0.45, "speaking": 0.58, "writing": 0.48},
    {"reading": 0.76, "listening": 0.70, "speaking": 0.62, "writing": 0.72},
]

READING_PROMPTS = [
    "What is the main idea of the passage?",
    "According to paragraph 2, why did the population decline?",
    "The word 'sustain' in line 14 is closest in meaning to",
    "Which of the following is NOT mentioned as a cause?",
    "What can be inferred about the author's view?",
]
LISTENING_PROMPTS = [
    "What is the conversation mainly about?",
    "Why does the woman visit the office?",
    "What does the professor imply about the assignment?",
    "According to the talk, what happens at plate boundaries?",
    "What will the man probably do next?",
]
CHOICES = ("A", "B", "C", "D")


def _scaled(ratio: float) -> int:
    return max(0, min(SECTION_MAX, round(ratio * SECTION_MAX)))


def _build_attempt(
    db: Session, rng: random.Random, student: Student, exam: Exam, profile: dict, taken_at: datetime,
    status: str,
) -> Attempt:
    # `profile` above is the student's ability profile; this is the *exam* profile
    # (config.default_profile, Story 3.1) that picks the score scale.
    _profile = get_settings().default_profile
    attempt = Attempt(
        student_id=student.id,
        exam_id=exam.id,
        taken_at=taken_at,
        status=status,
        # Story 3.1 — the admin list columns are populated at seed time so the
        # backfill migration never has to guess for freshly created databases.
        session="seed-" + student.student_no + "-" + exam.code.replace(" ", ""),
        campus=student.campus,
        exam_date=taken_at.date(),
        profile=_profile,
        scale=_SCALE_FOR.get(_profile, "toefl120"),
        feedback_progress=100 if status == "completed" else 0,
        started_at=taken_at,
        submitted_at=taken_at,
    )
    db.add(attempt)
    db.flush()

    questions = 0
    for skill in RECEPTIVE:
        # Per-sitting variance around the student's baseline.
        accuracy = min(0.99, max(0.15, rng.gauss(profile[skill], 0.06)))
        prompts = READING_PROMPTS if skill == "reading" else LISTENING_PROMPTS
        correct = 0
        for no in range(1, QUESTIONS_PER_RECEPTIVE + 1):
            key = CHOICES[rng.randrange(len(CHOICES))]
            hit = rng.random() < accuracy
            if hit:
                correct += 1
                answer = key
            else:
                answer = rng.choice([c for c in CHOICES if c != key])
            module = SEED_MODULE[skill]
            db.add(
                QuestionResponse(
                    attempt_id=attempt.id,
                    skill=skill,
                    no=no,
                    prompt=prompts[(no - 1) % len(prompts)],
                    student_answer=answer,
                    correct_answer=key,
                    is_correct=hit,
                    question_key=module + "-" + str(no),
                    qtype="MCQ",
                    module=module,
                    auto_score=1.0 if hit else 0.0,
                    max_score=1.0,
                )
            )
            questions += 1
        db.add(
            SectionScore(
                attempt_id=attempt.id, skill=skill,
                raw_correct=correct, raw_total=QUESTIONS_PER_RECEPTIVE,
                scaled=_scaled(correct / QUESTIONS_PER_RECEPTIVE),
            )
        )

    for skill in PRODUCTIVE:
        criteria = RUBRIC_CRITERIA[skill]
        scores = []
        for criterion in criteria:
            # 0–5 in half-point steps, centred on the student's baseline.
            raw = min(5.0, max(1.0, rng.gauss(profile[skill] * 5, 0.45)))
            value = round(raw * 2) / 2
            scores.append(value)
            db.add(
                RubricScore(
                    attempt_id=attempt.id, skill=skill, criterion=criterion,
                    score=value, max_score=5.0,
                )
            )
        total, maximum = sum(scores), 5.0 * len(criteria)
        db.add(
            SectionScore(
                attempt_id=attempt.id, skill=skill,
                raw_correct=total, raw_total=maximum, scaled=_scaled(total / maximum),
            )
        )

    db.flush()
    db.refresh(attempt)
    attempt.total_score = sum(s.scaled for s in attempt.section_scores)
    attempt.grade = cefr_for(attempt.total_score)
    attempt.total_questions = questions
    attempt.submitted_count = questions
    db.add(attempt)
    db.flush()
    return attempt


def seed(force: bool = False) -> dict:
    """Create the schema and populate it. Returns a small summary."""
    create_all()
    run_migrations()   # `python -m app.seed` on an older DB must not hit missing columns

    with session_scope() as db:
        if db.scalar(select(Student).limit(1)) is not None and not force:
            students, attempts = crud.count_rows(db)
            return {"seeded": False, "students": students, "attempts": attempts}

        rng = random.Random(SEED)

        students = [
            Student(student_no=no, name=name, klass=klass, campus=campus)
            for no, name, klass, campus in STUDENTS
        ]
        exams = [Exam(code=code, title=title) for code, title in EXAMS]
        db.add_all(students + exams)
        db.flush()

        # 12 attempts = 6 students × 2 sittings (most recent set first).
        base = datetime(2026, 7, 28, 9, 0, tzinfo=timezone.utc).replace(tzinfo=None)
        # Unified status set (architecture.md 6.2.2): everything is 'completed'
        # except two sittings left mid-pipeline so the admin views have work to show.
        statuses = {
            (2, 1): "scoring",
            (4, 1): "scoring",
        }
        created: list[Attempt] = []
        for si, student in enumerate(students):
            for ai in range(2):
                exam = exams[ai]  # SET 9 then SET 8
                taken_at = base - timedelta(days=ai * 14 + si, hours=si)
                created.append(
                    _build_attempt(
                        db, rng, student, exam, PROFILES[si], taken_at,
                        statuses.get((si, ai), "completed"),
                    )
                )

        db.commit()

        # Pre-generate rule-based feedback in both languages so the report page
        # has content on first paint without an on-demand LLM call.
        for attempt in created:
            full = crud.get_attempt(db, attempt.id)
            if full is None:
                continue
            for lang in ("en", "ko"):
                detail = crud.to_detail(full, lang=lang)
                bundle = scoring_graph.run(detail, lang=lang, mode="offline")
                crud.save_feedback(db, full, bundle)

        count_students, count_attempts = crud.count_rows(db)
        return {"seeded": True, "students": count_students, "attempts": count_attempts}


if __name__ == "__main__":  # python -m app.seed
    print(seed(force=False))
