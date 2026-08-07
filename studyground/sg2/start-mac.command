#!/bin/bash
# SMEAG StudyGround — offline launcher (macOS). Double-click to run.
cd "$(dirname "$0")"
PORT=8130
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  osascript -e 'display alert "Python 3 required" message "Install Python 3 from python.org, then double-click again."'
  exit 1
fi
# free the port if a previous run is still up
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null
echo "SMEAG StudyGround → http://localhost:$PORT"
"$PY" -m http.server $PORT >/dev/null 2>&1 &
SRV=$!
sleep 1
open "http://localhost:$PORT/index.html"
echo "Serving offline. Close this window (or press Ctrl+C) to stop the app."
trap "kill $SRV 2>/dev/null" EXIT
wait $SRV
