@echo off
title Precious Metals Digital Signage
echo Starting Precious Metals Digital Signage...
echo.

:loop
REM Schedule Chrome kiosk launch after Flask has time to start
start /B cmd /C "timeout /t 3 /nobreak >nul && start chrome --kiosk --new-window --window-position=1920,0 --app=http://localhost:5000/display"

REM Run Flask in the foreground (blocks until exit)
python app.py

echo.
echo Application exited. Restarting in 5 seconds...
timeout /t 5
goto loop
