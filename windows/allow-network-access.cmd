@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-network-access.ps1"
if errorlevel 1 echo Failed. Review the error above.
pause
