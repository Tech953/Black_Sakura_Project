@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run Setup_Windows.cmd first.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" -m voice_studio serve --port 0
if errorlevel 1 (
    echo The app could not start. Review the error above.
    pause
    exit /b 1
)
exit /b 0
