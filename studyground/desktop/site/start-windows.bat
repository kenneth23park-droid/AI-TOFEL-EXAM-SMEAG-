@echo off
REM SMEAG StudyGround - offline launcher (Windows). Double-click to run.
cd /d "%~dp0"
set PORT=8130
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install from python.org, then double-click again.
  pause
  exit /b 1
)
echo SMEAG StudyGround  ^-^>  http://localhost:%PORT%
start "" http://localhost:%PORT%/index.html
python -m http.server %PORT%
