# Claude Code Prompt Sequence — Precious Metals Digital Signage

Feed these prompts to Claude Code ONE AT A TIME. Wait for each step to be complete and working before moving to the next. Test after each step.

---

## STEP 0 — Load the spec

```
Read the attached file PreciousMetals-Signage-Spec.md. This is the full project spec. Familiarize yourself with it — I'll be asking you to build it section by section. Don't build anything yet, just confirm you understand the project.
```

*(Attach the spec file when you send this)*

---

## STEP 1 — Project scaffolding

```
Create the project folder structure from the spec. Set up:
- All folders (static/css, static/js, static/img, templates, utils, videos)
- requirements.txt with flask, yfinance, apscheduler
- config.json with all default settings from the spec
- Empty placeholder files for all Python and HTML files
- The SQLite database initialization code (playlist, prices, settings tables)
- A basic app.py that creates the Flask app, initializes the DB on first run, and runs on port 5000
- start.bat that launches the app

I should be able to run "pip install -r requirements.txt" then "python app.py" and see "Running on http://localhost:5000" with no errors.
```

**TEST:** Run it. Confirm Flask starts clean.

---

## STEP 2 — Video file serving and playlist API

```
Build the video management backend:
- GET /api/videos — scans the /videos/ folder and returns a list of available .mp4/.webm/.mov files as JSON
- GET /api/playlist — returns the current playlist from SQLite as JSON (ordered by display_order)
- POST /api/playlist/add — adds a video filename to the playlist (auto-assigns next display_order)
- POST /api/playlist/remove — removes a video from the playlist by ID (doesn't delete the file)
- POST /api/playlist/reorder — accepts a JSON array of IDs in new order, updates display_order for each
- GET /videos/<filename> — serves video files from the /videos/ folder with proper MIME types and range request support (important for video seeking)

Test with curl or browser. Drop a couple .mp4 files in /videos/ first.
```

**TEST:** Drop 2-3 mp4 files in `/videos/`. Hit `localhost:5000/api/videos` in browser — should see filenames. Use curl to add them to playlist, then hit `/api/playlist`.

---

## STEP 3 — Display page with video loop

```
Build templates/display.html and static/js/display.js:
- Fullscreen page, black background, no scrollbars, no cursor
- HTML5 <video> element that fills the entire screen
- On page load, fetches playlist from /api/playlist
- Plays first video, auto-advances to next on "ended" event
- Loops back to first video after the last one
- If playlist is empty, show a centered "No videos loaded" message on dark background
- Polls /api/playlist every 30 seconds to pick up changes from admin
- Route: GET /display serves this page
- GET / redirects to /display

No ticker yet, no charts yet — just the video loop working perfectly.
```

**TEST:** Open `localhost:5000/display` — videos should play in sequence and loop. Add/remove videos via the API and confirm the display picks up changes within 30 seconds.

---

## STEP 4 — Price fetcher with yfinance

```
Build utils/price_fetcher.py:
- Uses yfinance to fetch prices for GC=F, SI=F, PL=F, PA=F and CADUSD=X
- Converts USD prices to CAD using the exchange rate
- Calculates daily change (dollar and percent) for each metal
- Stores results in the SQLite prices table
- Logs success/failure

Wire it into app.py:
- Use APScheduler to run the price fetcher every 1 minute (configurable from settings table)
- Run once on startup immediately
- Add GET /api/prices endpoint that returns the latest cached prices as JSON
- Add POST /api/prices/refresh endpoint that triggers an immediate fetch

Handle errors gracefully — if yfinance fails, log it and keep the last known prices.
```

**TEST:** Start the app, wait 10 seconds, then hit `localhost:5000/api/prices` — should see all 4 metals with CAD prices, change amounts, and timestamps.

---

## STEP 5 — Price ticker on display page

```
Add the price ticker to the display page:
- Fixed bar along the bottom of display.html, ~60px tall
- Semi-transparent dark background (rgba), z-index above video
- Fetches prices from /api/prices every 60 seconds
- Static mode (default): 4 equal columns showing:
  GOLD $3,245.80 ▲$12.30 (+0.50%)  |  SILVER $42.15 ▼$0.85 (-1.97%)  | etc.
- Green (#4CAF50) for positive change, red (#F44336) for negative
- Up/down triangle arrows (▲/▼) before the change amount
- "Last updated: HH:MM" timestamp on the right end
- If prices unavailable, show "Prices loading..." in muted text
- Font should be clean sans-serif, large enough to read from 10+ feet (font-size from config, default 28px)
- Also implement marquee mode: same content but scrolling left with CSS animation
- Read ticker_mode from /api/settings to decide which mode to use

Don't touch the video loop — ticker overlays on top of it.
```

**TEST:** Open display page — video plays with ticker bar showing live prices along the bottom. Prices should be green or red based on daily change.

---

## STEP 6 — Chart slides between videos

```
Add chart slides to the display page:
- Add GET /api/chart-data/<symbol> endpoint that returns 7 days of hourly price data from yfinance (in CAD), formatted for Chart.js
- Load Chart.js via CDN in display.html
- After every N videos (read chart_frequency from settings, default 3), show a chart slide instead of the next video:
  - Full screen dark background
  - Chart.js line chart with the price history
  - Title: "GOLD — 7 Day Price (CAD)" etc.
  - Dark theme: dark background, subtle grid lines, gold/silver/platinum/palladium colored line
  - Display for chart_duration seconds (from settings, default 15), then resume video loop
- Cycle through metals: first chart shows Gold, next shows Silver, then Platinum, then Palladium, then back to Gold
- If charts are disabled in settings (charts_enabled = false), skip chart slides entirely
- Cache chart data — only refetch every 15 minutes, not on every chart display
```

**TEST:** Watch the display loop through videos. After every 3rd video, a price chart should appear for 15 seconds then resume. Each chart appearance should show a different metal.

---

## STEP 7 — Admin panel

```
Build the admin panel at GET /admin using Bootstrap 5 dark theme:
- Load Bootstrap 5 CSS/JS, Bootstrap Icons, and SortableJS all via CDN
- Set data-bs-theme="dark" on the <html> tag
- Layout: Use Bootstrap cards in a responsive grid

Card 1 — Now Playing (top, full width):
- Shows current video filename or "Stopped"
- Play, Pause, Skip, Stop buttons using Bootstrap Icons
- Buttons call /api/control/play, /api/control/pause, /api/control/skip, /api/control/stop via fetch()

Card 2 — Playlist (left column):
- Shows current playlist as a Bootstrap list-group
- Each item has a drag handle (grip icon), filename, and a remove button (trash icon)
- SortableJS for drag-and-drop reorder, POSTs new order on drop
- Below the list: a dropdown of available videos (from /api/videos minus already-in-playlist) with an "Add" button

Card 3 — Current Prices (right column):
- Shows all 4 metals with current CAD price, change, percent
- Green/red color coding
- Last updated timestamp
- "Refresh Now" button

Card 4 — Settings (below):
- Ticker: on/off toggle, static/marquee radio, update interval slider (1-60 min)
- Charts: on/off toggle, frequency slider (every 1-10 videos), duration slider (5-60 seconds)
- Display: monitor offset X/Y inputs
- "Launch Display" button that opens /display in a new window
- Save button that POSTs to /api/settings

Card 5 — System (bottom):
- App version
- Auto-start toggle
- Last 10 log entries (from /api/logs)

All controls use vanilla JS fetch() calls. Poll /api/status every 5 seconds to update the Now Playing card.

Also build the backend endpoints:
- POST /api/control/play, /pause, /skip, /stop — control playback state
- GET /api/status — returns current state (playing/paused/stopped, current video, uptime)
- GET /api/settings and POST /api/settings — read/write settings
- GET /api/logs — returns last 50 lines of signage.log

The display page needs to poll /api/status to respond to admin controls (play/pause/skip/stop).
```

**TEST:** Open admin on Monitor 1 and display on Monitor 2. Add videos, reorder them, hit play. Verify play/pause/skip/stop all work. Change ticker mode, refresh prices, toggle charts. Everything should respond.

---

## STEP 8 — Chrome kiosk launcher

```
Add a "Launch Display" feature:
- In the admin panel's System card, the "Launch Display" button should call POST /api/launch-display
- The backend endpoint launches Chrome in kiosk mode on Monitor 2:
  Command: start chrome --kiosk --new-window --window-position={offset_x},{offset_y} --app=http://localhost:5000/display
- Read monitor_offset_x and monitor_offset_y from config.json (default 1920,0)
- On Windows, use subprocess.Popen with shell=True
- Also add this launch command to start.bat so the display auto-opens when the app starts
- Update start.bat to:
  1. Start the Flask app in the background
  2. Wait 3 seconds for Flask to start
  3. Launch Chrome kiosk on Monitor 2
```

**TEST:** Click "Launch Display" in admin — Chrome should open fullscreen on Monitor 2 showing the video loop with ticker.

---

## STEP 9 — Polish and error handling

```
Final polish pass:
- Add logging throughout: use Python logging module writing to signage.log with rotation (5MB max, 3 backups)
- If yfinance fails 3+ times in a row, set a warning flag visible in the admin panel (yellow badge on the Prices card)
- Display page should never show errors to the viewer — always graceful fallback
- Admin panel: add toast notifications (Bootstrap toasts) for success/error on all actions
- Make sure all fetch() calls in JS have proper error handling
- Test with empty playlist, missing videos folder, no internet connection
- Add /api/health endpoint that returns 200 OK for basic health check
- Auto-create /videos/ folder on startup if it doesn't exist
- Add a favicon (simple gold circle SVG inline in the HTML)
```

**TEST:** Kill your internet and confirm the display keeps looping videos with last known prices. Empty the playlist and confirm a "No videos" message shows. Restart the app and confirm everything resumes.

---

## STEP 10 — PyInstaller packaging

```
Prepare for PyInstaller:
- Add frozen/bundled path detection at the top of app.py:
  import sys, os
  if getattr(sys, 'frozen', False):
      BASE_DIR = os.path.dirname(sys.executable)
  else:
      BASE_DIR = os.path.dirname(os.path.abspath(__file__))
- Make sure ALL file paths (templates, static, videos, config.json, signage.db, signage.log) use BASE_DIR
- Create a pyinstaller.spec or build.bat with:
  pyinstaller --onefile --noconsole --add-data "templates;templates" --add-data "static;static" --name "PreciousMetalsSignage" app.py
- Test the resulting .exe:
  1. Copy PreciousMetalsSignage.exe to a fresh folder
  2. Create a /videos/ subfolder with some .mp4 files
  3. Double-click the .exe
  4. Confirm Flask starts, display works, prices load
- Create a README.txt with the Quick Start instructions from the spec
```

**TEST:** Run the .exe from a clean folder. Everything should work exactly like the dev version. No Python needed on the machine.

---

## DONE

Final deliverable is a folder containing:
```
PreciousMetalsSignage/
├── PreciousMetalsSignage.exe
├── start.bat
├── README.txt
├── videos/           (empty, user adds .mp4 files)
└── config.json       (auto-created on first run)
```
