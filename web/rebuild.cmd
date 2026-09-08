@echo off
REM Double-click this, or run it from any terminal.
REM
REM Windows refuses to run a .ps1 by default - ExecutionPolicy is Restricted on
REM a fresh machine, and the refusal happens before the script is even read. A
REM .cmd has no such policy, so this exists purely to start the real script
REM without the user having to know that.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rebuild.ps1"

echo.
pause
