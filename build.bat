@echo off
echo Building Precious Metals Signage...
echo.

REM Read version from VERSION file
set /p VERSION=<VERSION
echo Version: %VERSION%
echo.

pip install pyinstaller 2>nul

pyinstaller ^
    --onefile ^
    --noconsole ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --add-data "VERSION;." ^
    --hidden-import=yfinance ^
    --hidden-import=apscheduler ^
    --hidden-import=apscheduler.schedulers.background ^
    --hidden-import=apscheduler.triggers.interval ^
    --hidden-import=apscheduler.executors.pool ^
    --hidden-import=apscheduler.jobstores.memory ^
    --hidden-import=screeninfo ^
    --hidden-import=waitress ^
    --name "PreciousMetalsSignage-v%VERSION%" ^
    app.py

if %ERRORLEVEL% EQU 0 (
    if not exist "dist\windows" mkdir "dist\windows"
    if not exist "dist\videos" mkdir "dist\videos"
    copy /Y "windows\*" "dist\windows\" >nul
    copy /Y "README.txt" "dist\README.txt" >nul
    copy /Y "VERSION" "dist\VERSION" >nul
    echo.
    echo Build successful!
    echo Output: dist\PreciousMetalsSignage-v%VERSION%.exe
    echo.
    echo To deploy, copy the contents of dist to a fresh folder with:
    echo   PreciousMetalsSignage-v%VERSION%.exe
    echo   videos\            (put media files here)
    echo   windows\           (automatic startup installer)
) else (
    echo.
    echo Build FAILED. Check errors above.
)
if not defined CI pause
