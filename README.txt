PRECIOUS METALS DIGITAL SIGNAGE
================================

FIRST TIME SETUP:
1. Extract the complete release folder to a permanent location
2. Place your media files in the /videos/ folder
3. Double-click PreciousMetalsSignage-vX.Y.Z.exe
4. Open http://localhost:5000/admin
5. Identify and select the showroom monitor
6. Add media to the playlist; the display and playback start automatically
7. Double-click windows/install-startup.cmd to start after Windows logon

DAILY USE:
1. Sign into Windows (automatic Windows login is optional)
2. The scheduled task starts the app after 20 seconds
3. The display opens on the selected monitor and starts playing
4. Use http://localhost:5000/admin to manage videos and settings

ADDING NEW VIDEOS:
1. Copy .mp4 files to the /videos/ folder
2. They will appear in the admin panel under "Available Videos"
3. Click "Add" to include them in the playlist

MONITOR SETUP:
- Use Identify in the admin panel, select the showroom monitor, and save
- The signage browser uses a separate profile from normal office Chrome

TROUBLESHOOTING:
- If prices aren't updating, check your internet connection
- Price/chart failures do not stop the local media loop
- If display is on the wrong monitor, use Identify and save the correct monitor
- Check signage.log for error details
- Health check: http://localhost:5000/api/health

FILES:
- PreciousMetalsSignage-vX.Y.Z.exe   The application
- signage.db                  Database (auto-created on first run)
- signage.log                 Log file (auto-created on first run)
- videos/                     Place media files here
- windows/                    Automatic startup installer/remover
