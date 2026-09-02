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

### sg2 (static app) serverless functions

`sg2/api/*.js` are separate from the FastAPI app. Environment variables on that
Vercel project:

| Variable | Used by | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `/api/feedback`, `/api/score` | that provider is not offered |
| `SUPABASE_SERVICE_ROLE_KEY` | `/api/score` | **AI scoring returns 503** — students may only read `sg_task_scores`, never write it, so drafts are written server-side |
| `OPENAI_API_KEY` | speech-to-text for Speaking | Speaking is skipped as `no_transcript` (never scored 0) |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | both | the newest plain-named model is picked automatically |

`/api/score` grades Writing and Speaking against the official ETS scoring guides
(0–5 per task) and stores the draft in `sg_task_scores`. A teacher confirms it on
`review.html`; a confirmed row is never overwritten by re-scoring. The 1–6 band is
worked out from those scores at display time — see `docs/scoring-rationale.md` §6-1.

### Backups

The free plan gives 500 MB of database and 1 GB of storage. `tools/backup_supabase.py`
downloads everything to this machine once **DB + Storage passes 400 MB**, well before
either limit bites:

```bash
python3 tools/backup_supabase.py --check    # usage only
python3 tools/backup_supabase.py            # backs up only if over the threshold
```

Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, and `supabase/usage.sql` applied
once. Tables land as JSONL, recordings as the original files, with a `manifest.json`
carrying sizes and sha256. Backing up never deletes anything — freeing space is the
separate, opt-in `--prune-recordings 90`. See `docs/backup.md`.

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

세트 하나를 새로 만들 때는 네 관문을 순서대로 지난다 — 원본 문서 그대로 문제지 짓기,
스크립트로 ElevenLabs 음성 만들고 받아쓰기로 대조하기, 정답지와 문제지 전수 크로스체크,
저장한 뒤 되읽어 확인하기. 각 관문을 무엇이 막는지는
[docs/set-build.md](docs/set-build.md) 에 있다.

## BMAD streams

| Stream | Scope | Contract |
|---|---|---|
| A — backend/API | `db.py` · `models.py` · `crud.py` · `routers/` · `seed.py` | `schemas.py` + `schema.sql` |
| B — frontend | `templates/` · `static/` (offline design system) | `schemas.py` field names |
| C — AI/LangGraph | `scoring/` (graph · nodes · rules · llm) | `AttemptDetail` in → `FeedbackBundle` out |
