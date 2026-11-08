@echo off
setlocal
cd /d "%~dp0"
echo Voice Profile Studio - base setup
echo Requires 64-bit Python 3.11 or 3.12, and internet for packages.
if exist ".venv\Scripts\python.exe" goto install
py -3.11 --version >nul 2>nul
if not errorlevel 1 (
    py -3.11 -m venv .venv
) else (
    py -3.12 --version >nul 2>nul
    if not errorlevel 1 (
        py -3.12 -m venv .venv
    ) else (
        python -c "import sys; sys.exit(0 if sys.version_info[:2] in ((3, 11), (3, 12)) else 1)" >nul 2>nul
        if not errorlevel 1 (
            python -m venv .venv
        ) else (
            echo Install Python 3.11 or 3.12 from python.org, then run this file again.
            pause
            exit /b 1
        )
    )
)
if errorlevel 1 goto failure
:install
".venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.maxsize > 2**32 and sys.version_info[:2] in ((3, 11), (3, 12)) else 1)"
if errorlevel 1 (
    echo This environment needs 64-bit Python 3.11 or 3.12. Recreate .venv with a supported interpreter.
    goto failure
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failure
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failure
".venv\Scripts\python.exe" -m pip check
if errorlevel 1 goto failure
".venv\Scripts\python.exe" -m unittest discover -s tests
if errorlevel 1 goto failure
echo.
echo Setup complete. Run Start_Windows.cmd to open the app.
echo Optional: Setup_AI.cmd transcription or Setup_AI.cmd diarization.
pause
exit /b 0
:failure
echo.
echo Setup failed. The error above explains which step failed.
pause
exit /b 1
