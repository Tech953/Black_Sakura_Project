@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run Setup_Windows.cmd first.
    pause
    exit /b 1
)
set "VOICE_STUDIO_BACKEND=%~1"
if "%VOICE_STUDIO_BACKEND%"=="" (
    echo Available backends: transcription, diarization, separation
    set /p "VOICE_STUDIO_BACKEND=Choose a backend: "
)
if /i "%VOICE_STUDIO_BACKEND%"=="transcription" goto install
if /i "%VOICE_STUDIO_BACKEND%"=="diarization" goto install
if /i "%VOICE_STUDIO_BACKEND%"=="separation" goto install
echo Choose transcription, diarization, or separation.
pause
exit /b 1
:install
".venv\Scripts\python.exe" -m pip install -r "requirements-%VOICE_STUDIO_BACKEND%.txt"
if errorlevel 1 goto failure
".venv\Scripts\python.exe" -m pip check
if errorlevel 1 goto failure
echo.
echo Optional packages installed. Restart the app to refresh availability.
echo First AI use downloads weights unless you provide a local model folder.
echo For diarization, accept Community-1 access conditions and set HF_TOKEN locally.
echo See README.md for setup and compatibility details.
pause
exit /b 0
:failure
echo.
echo Optional setup failed. Review dependency conflicts above.
echo Base audio and character authoring still work. See README.md for separate AI environments.
pause
exit /b 1
