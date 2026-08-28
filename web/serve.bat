@echo off
REM Double-click this to run the Phase 0 marker dropper.
REM Keep the black window open - closing it stops the server.
cd /d "%~dp0"
echo.
echo   AR Trail - marker dropper
echo   Opening http://localhost:8080
echo.
echo   Leave this window OPEN while you use the page.
echo   Press Ctrl+C or close it when you are done.
echo.
start "" /b cmd /c "timeout /t 2 >nul & start """" http://localhost:8080"
python -m http.server 8080
