@echo off
echo Building Precious Metals Signage...
echo.

pip install pyinstaller 2>nul

pyinstaller ^
    --onefile ^
    --noconsole ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --hidden-import=yfinance ^
    --hidden-import=apscheduler ^
    --hidden-import=apscheduler.schedulers.background ^
    --hidden-import=apscheduler.triggers.interval ^
    --hidden-import=apscheduler.executors.pool ^
    --hidden-import=apscheduler.jobstores.memory ^
    --name "PreciousMetalsSignage" ^
    app.py

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful!
    echo Output: dist\PreciousMetalsSignage.exe
    echo.
    echo To deploy, copy to a fresh folder with:
    echo   PreciousMetalsSignage.exe
    echo   videos\            (put .mp4 files here)
) else (
    echo.
    echo Build FAILED. Check errors above.
)
pause
