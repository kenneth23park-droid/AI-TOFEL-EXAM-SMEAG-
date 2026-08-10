# StudyGround

SMEAG `scores.php` replacement — a score-report app with **one codebase and two run modes**.

| | LOCAL · offline | CLOUD · online |
|---|---|---|
| DB | SQLite file (auto-created + seeded on first run) | Supabase / Postgres |
| Scoring | deterministic rule-based node — **zero network** | Claude (LLM) node, auto-falls back to the rules |
| Assets | bundled CSS/JS, system fonts, no CDN | identical |
| Run | `./run_local.sh` → http://localhost:8000 | Vercel (`api/index.py` + `vercel.json`) |

Templates, JS, CSS, routers and schema are **100% identical** between modes. One
environment variable switches everything:

```bash
APP_MODE=local   # or cloud
```

## Run

```bash
cd studyground && ./run_local.sh          # creates .venv, installs, serves :8000
./run_local.sh 8080                       # different port
```

No internet required: LOCAL mode never calls out. Only the first block of
`requirements.txt` is needed for it — `psycopg`, `anthropic` and `langgraph` are
for CLOUD mode and are optional (see *Scoring pipeline* below).

## Architecture

```
browser  ── score list / score report · EN⇄KO toggle · AI re-score button
   │
FastAPI ── routers/pages · routers/scores   (Jinja2 templates + /assets)
   │        schemas.py (Pydantic contract) · crud.py + db.py (SQLAlchemy)
   │
   ├── SQLite file      APP_MODE=local
   └── Supabase/Postgres APP_MODE=cloud · DATABASE_URL
```

## Scoring pipeline (LangGraph)

```
ingest → analyze → route(mode?) ─┬→ offline_feedback (rules)  ─┐
                                 └→ online_feedback  (LLM)   ──┴→ compose → END
```

Produces per-skill (R·L·S·W) blocks plus one overall block, in EN and KO.
`route` picks the online node only in cloud mode with `ANTHROPIC_API_KEY` set;
any LLM failure degrades to the rule-based node and the report says so.

If `langgraph` is not installed the **same node functions** run in sequence
(`_SequentialGraph`), so LOCAL mode has no hard dependency on it.
`GET /api/health` reports `"langgraph": true` when a real `CompiledStateGraph`
is in use.

## Data model

```
students ──< attempts >── exams          (SET 9 / SET 8 / SET 7)
                │
                ├──< section_scores      R·L·S·W scaled /30  → total /120
                ├──< question_responses  per-question my-answer vs key (R·L)
                ├──< rubric_scores       0–5 criteria (S·W)
                └──< ai_feedback         per-skill + overall, per language
```

`schema.sql` is the Postgres/Supabase DDL; `app/models.py` produces the same
shape on SQLite via `create_all()`.

## Screens

- **`/`** — score list. Student/exam filter, R·L·S·W scaled scores, total /120,
  CEFR grade, status badge. Click a row for the report.
- **`/attempts/{id}`** — score report. Total ring + section bars, R·L question
  review (my answer vs correct), S·W rubric bars, AI feedback, **↻ AI re-score**,
  EN⇄KO toggle.

UI defaults to **English**; `?lang=ko` (or the toggle) switches to Korean and is
remembered in a cookie.

## API

```
GET  /api/health                       mode, dialect, langgraph, row counts
GET  /api/students | /api/exams
GET  /api/attempts?student_id=&exam_id=
GET  /api/attempts/{id}?lang=en
POST /api/attempts/{id}/rescore?lang=en&mode=auto|offline|online
```

## Cloud deploy

1. Run `schema.sql` against a fresh Supabase project.
2. Set on Vercel: `APP_MODE=cloud`, `DATABASE_URL`, `ANTHROPIC_API_KEY`.
3. Deploy — `vercel.json` routes everything to `api/index.py`, which serves the
   identical FastAPI app.

## Verify

```bash
curl -s localhost:8000/api/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/            # 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/attempts/1  # 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/attempts/999 # 404
curl -s -X POST "localhost:8000/api/attempts/1/rescore?lang=ko"
```

Seed is deterministic (`SEED = 20260804`): 6 students, 3 exam sets, 12 attempts,
and identical rule-based feedback on every fresh database. Re-seeding a
populated DB is a no-op; `python -m app.seed` re-runs it.

Exam audio has its own gate — it runs whenever an mp3 is added or replaced
(generators, `tools/audio_gate.py`, and the pre-commit hook all call it), and
layer 3 transcribes the changed audio back to text to check it against the
script. See [docs/audio-gate.md](docs/audio-gate.md).

## BMAD streams

| Stream | Scope | Contract |
|---|---|---|
| A — backend/API | `db.py` · `models.py` · `crud.py` · `routers/` · `seed.py` | `schemas.py` + `schema.sql` |
| B — frontend | `templates/` · `static/` (offline design system) | `schemas.py` field names |
| C — AI/LangGraph | `scoring/` (graph · nodes · rules · llm) | `AttemptDetail` in → `FeedbackBundle` out |
