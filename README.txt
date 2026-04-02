PRECIOUS METALS DIGITAL SIGNAGE
================================

FIRST TIME SETUP:
1. Place your video files (.mp4) in the /videos/ folder
2. Double-click PreciousMetalsSignage.exe
3. Open Chrome and go to: http://localhost:5000/admin
4. Add videos to the playlist using the admin panel
5. Click "Launch Display" to open the signage on Monitor 2
6. Click "Start" to begin the video loop
7. Prices load automatically — no API key needed!

DAILY USE:
1. Double-click PreciousMetalsSignage.exe
2. The display will auto-launch and resume where it left off
3. Use http://localhost:5000/admin to manage videos and settings

ADDING NEW VIDEOS:
1. Copy .mp4 files to the /videos/ folder
2. They will appear in the admin panel under "Available Videos"
3. Click "Add" to include them in the playlist

MONITOR SETUP:
- By default, the display opens at monitor position X=1920, Y=0
  (to the right of a standard 1920px primary monitor)
- Change the offset in Settings if your layout differs

TROUBLESHOOTING:
- If prices aren't updating, check your internet connection
- If display is on the wrong monitor, adjust Monitor Offset in Settings
- Check signage.log for error details
- Health check: http://localhost:5000/api/health

FILES:
- PreciousMetalsSignage.exe   The application
- config.json                 Settings (auto-created on first run)
- signage.db                  Database (auto-created on first run)
- signage.log                 Log file (auto-created on first run)
- videos/                     Place your .mp4/.webm/.mov files here
