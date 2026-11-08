@echo off
setlocal
cd /d "%~dp0"
set "target=FULL_REZZ_2.0_Offline_Setup.exe"
for %%P in (01 02 03 04) do if not exist "%target%.part%%P" goto missing
if exist "%target%" goto verify
if exist "%target%.building" del "%target%.building"
copy /b "%target%.part01"+"%target%.part02"+"%target%.part03"+"%target%.part04" "%target%.building" >nul
if errorlevel 1 goto failed
powershell.exe -NoProfile -Command "$h=(Get-FileHash -LiteralPath 'FULL_REZZ_2.0_Offline_Setup.exe.building' -Algorithm SHA256).Hash; if ($h -ne '1232d1b909aa8031891d37a43a08718bc053527c3d04652b9dc4cfd70aa7888c') { exit 1 }"
if errorlevel 1 goto failed
move "%target%.building" "%target%" >nul
if errorlevel 1 goto failed
:verify
powershell.exe -NoProfile -Command "$h=(Get-FileHash -LiteralPath 'FULL_REZZ_2.0_Offline_Setup.exe' -Algorithm SHA256).Hash; if ($h -ne '1232d1b909aa8031891d37a43a08718bc053527c3d04652b9dc4cfd70aa7888c') { exit 1 }"
if errorlevel 1 goto failed
echo Installer verified. Starting FULL_REZZ setup.
start "" "%target%"
exit /b 0
:missing
echo Extract ALL FOUR installer ZIPs into this same folder, then run again.
pause
exit /b 1
:failed
echo Assembly or SHA256 verification failed. Setup was not started.
echo Keep the fragments and download any damaged or missing part again.
pause
exit /b 1
