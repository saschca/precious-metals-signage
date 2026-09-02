@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-startup.ps1"
if errorlevel 1 echo Removal failed. Review the error above.
pause
