#!/usr/bin/env bash
# StudyGround — LOCAL mode. SQLite file DB, rule-based scoring, no internet needed.
#   ./run_local.sh          → http://localhost:8000
#   ./run_local.sh 8080     → a different port
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)}"

if [ ! -d .venv ]; then
  echo "· creating .venv with $PYTHON_BIN"
  "$PYTHON_BIN" -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

export APP_MODE=local
echo "· StudyGround (local) → http://localhost:${PORT}"
exec ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT" "${@:2}"
