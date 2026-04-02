# Precious Metals Digital Signage System — Full Build Spec

## Project Overview

A locally-hosted digital signage application for a precious metals / coin shop. Runs on a Windows PC with 2 monitors. Monitor 2 displays a continuous loop of videos with a live precious metals price ticker along the bottom. Between videos, it can optionally display price charts. Monitor 1 runs a browser-based admin panel to manage the playlist, settings, and system controls.

**Target environment:** Windows 10/11 PC, 2 monitors, always-on during business hours, local network only (no cloud hosting). Internet access required only for price API calls.

**End goal:** Package as a standalone `.exe` via PyInstaller so it can be deployed to any Windows PC with zero Python installation.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Python 3.11+ / Flask | Simple, lightweight, familiar |
| Display | Chrome/Edge in kiosk mode (fullscreen) | Best HTML5 video support, no extra deps |
| Admin GUI | Flask route in browser on Monitor 1 | No desktop framework needed |
| Database | SQLite (via sqlite3 stdlib) | Zero config, file-based, portable |
| Price Data | yfinance (Python library) | Free, no API key, no rate limits, pulls from Yahoo Finance |
| Packaging | PyInstaller | Single `.exe` output for deployment |

---

## Core Features

### 1. Video Loop (Display Page)

- Fullscreen HTML5 `<video>` element on Monitor 2
- Plays videos from the local `/videos/` folder in playlist order
- Auto-advances to next video when current ends
- Loops back to first video after last
- Supports `.mp4`, `.webm`, `.mov` formats
- If playlist is empty, show a branded "No videos loaded" splash screen
- Crossfade or simple cut transition between videos (CSS transition)

### 2. Precious Metals Price Ticker

- Persistent bar along the bottom of the display page (~60px tall)
- Semi-transparent dark background so it overlays video without blocking too much
- Scrolling left-to-right marquee style OR static bar with 4 price blocks — admin toggle
- Displays these 4 metals with current spot price in **CAD**:
  - Gold (XAU) 
  - Silver (XAG) 
  - Platinum (XPT) 
  - Palladium (XPD)
- Each metal shows: **Name | Spot Price (CAD) | Daily Change ($) | Daily Change (%)**
- Green text for positive change, red for negative
- Prices update every **1 minute** via background fetch
- Show "Last updated: HH:MM" timestamp on the ticker
- If API call fails, keep showing last known prices and show a small ⚠ icon
- Graceful fallback: if no prices have ever loaded, show "Prices unavailable"

### 3. Chart Slides (Between Videos)

- Optional: admin can enable/disable chart display
- When enabled, between every N videos (configurable, default every 3), display a full-screen chart slide instead of a video
- Chart options:
  - **Option A (Simple):** Embed silvergoldbull.ca chart widget via iframe if their embed allows it
  - **Option B (Custom):** Use Chart.js or lightweight charting lib to render price history from API data
  - **Option C (Screenshot):** If neither works, use a static/cached screenshot approach
- Chart display duration: configurable (default 15 seconds)
- Cycle through metals: Gold chart → next video cycle → Silver chart → etc.

### 4. Admin Panel (Control GUI)

**Accessible at:** `http://localhost:5000/admin` on Monitor 1

#### Playlist Management
- View current playlist with video thumbnails (if possible) or filenames
- Drag-and-drop reorder
- Add videos: file picker that browses the `/videos/` folder
- Remove videos from playlist (does NOT delete file, just removes from rotation)
- Preview button (plays video in small window on admin page)

#### Playback Controls
- **Start / Stop** the display loop
- **Skip** to next video
- **Pause / Resume** current video
- Status indicator: "Now Playing: filename.mp4"

#### Ticker Settings
- Toggle ticker on/off
- Toggle between scrolling marquee and static bar mode
- Set update interval (default 1 min, range 1-60 min)
- Manual "Refresh Prices Now" button
- Show current cached prices and last update time

#### Chart Settings
- Toggle chart slides on/off
- Set frequency (every N videos, default 3)
- Set chart display duration (seconds)
- Select which metals to show charts for

#### System
- Auto-start on boot toggle (creates/removes Windows startup shortcut)
- Open display page button (launches Chrome kiosk on Monitor 2)
- App version display
- View error log (last 50 lines)

---

## Price Data — yfinance (Free, No API Key)

**Library:** `pip install yfinance`

**No API key, no account, no rate limits.** yfinance is an open-source Python library that pulls data from Yahoo Finance's publicly available endpoints.

### Ticker Symbols

```python
METAL_TICKERS = {
    "Gold":      "GC=F",    # Gold futures (USD/oz)
    "Silver":    "SI=F",    # Silver futures (USD/oz)
    "Platinum":  "PL=F",    # Platinum futures (USD/oz)
    "Palladium": "PA=F",    # Palladium futures (USD/oz)
}
FX_TICKER = "CADUSD=X"      # USD/CAD exchange rate
```

### Fetching Prices (Python Example)

```python
import yfinance as yf

def fetch_prices():
    """Fetch all 4 metals + USD/CAD in one batch call."""
    tickers = ["GC=F", "SI=F", "PL=F", "PA=F", "CADUSD=X"]
    data = yf.download(tickers, period="2d", interval="1m", group_by="ticker", progress=False)
    
    # For each metal, get the latest close price
    prices = {}
    for symbol in ["GC=F", "SI=F", "PL=F", "PA=F"]:
        latest = data[symbol]["Close"].dropna().iloc[-1]
        prev_close = data[symbol]["Close"].dropna().iloc[0]  # previous day open for change calc
        prices[symbol] = {
            "price_usd": float(latest),
            "change": float(latest - prev_close),
            "change_pct": float((latest - prev_close) / prev_close * 100),
        }
    
    # Get USD/CAD rate
    usd_cad = 1 / float(data["CADUSD=X"]["Close"].dropna().iloc[-1])
    
    # Convert to CAD
    for symbol in prices:
        prices[symbol]["price_cad"] = prices[symbol]["price_usd"] * usd_cad
        prices[symbol]["change_cad"] = prices[symbol]["change"] * usd_cad
    
    return prices
```

### Key Notes

- **Prices are in USD** — multiply by USD/CAD rate (also from yfinance) for CAD display
- **Futures prices, not spot** — difference is negligible for a shop display
- **One batch call fetches all 5 tickers** — efficient, ~1 second per call
- **Update frequency:** every 1 minute (Yahoo data updates every 1-2 min during market hours)
- **No rate limits** for this usage level (~600 calls/day)
- **Offline handling:** if Yahoo is unreachable, keep showing last known prices from SQLite cache
- **Market hours:** metals futures trade nearly 24 hours (Sun 6pm - Fri 5pm ET on CME), so prices will be live most of the time
- **Historical data:** yfinance also provides historical data for charts — use `period="5d"` or `period="1mo"` for chart slides
- **No API key management needed** — remove API key field from admin panel and config.json

### Chart Data for Chart Slides

```python
# Fetch 7 days of hourly data for chart display
def fetch_chart_data(symbol="GC=F"):
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="7d", interval="1h")
    return hist[["Close"]].to_dict()
```

---

## Folder Structure

```
precious-metals-signage/
├── app.py                  # Flask application entry point
├── config.json             # User configuration (settings)
├── signage.db              # SQLite database (playlist, cached prices)
├── start.bat               # Windows launcher script
├── requirements.txt        # Python dependencies
├── videos/                 # Drop video files here
│   └── (user's .mp4 files)
├── static/
│   ├── css/
│   │   ├── display.css     # Display page styles (ticker, video, charts)
│   │   └── admin.css       # Admin panel styles
│   ├── js/
│   │   ├── display.js      # Display page logic (video loop, ticker updates, charts)
│   │   └── admin.js        # Admin panel logic (drag-drop, controls, AJAX)
│   └── img/
│       └── logo.png        # Splash screen / branding
├── templates/
│   ├── display.html        # Fullscreen display page (Monitor 2)
│   └── admin.html          # Admin control panel (Monitor 1)
└── utils/
    ├── price_fetcher.py    # API integration with caching and fallback
    ├── video_manager.py    # Playlist and video file management
    └── system_utils.py     # Chrome launcher, startup shortcut, etc.
```

---

## Database Schema (SQLite)

```sql
-- Playlist table
CREATE TABLE playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enabled BOOLEAN DEFAULT 1
);

-- Cached prices
CREATE TABLE prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metal TEXT NOT NULL,          -- GC=F, SI=F, PL=F, PA=F
    price_usd REAL NOT NULL,
    price_cad REAL NOT NULL,
    change_dollar REAL,
    change_percent REAL,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings (key-value store)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Default settings to insert on first run:
-- ticker_enabled: "true"
-- ticker_mode: "static"          -- "static" or "marquee"
-- update_interval: "1"           -- minutes
-- charts_enabled: "true"
-- chart_frequency: "3"           -- every N videos
-- chart_duration: "15"           -- seconds
-- auto_start: "false"
```

---

## Flask Routes

```
GET  /                  → Redirect to /display
GET  /display           → Display page (fullscreen video + ticker)
GET  /admin             → Admin control panel

# API endpoints (called by admin panel and display page via AJAX)
GET  /api/playlist      → Current playlist as JSON
POST /api/playlist/add  → Add video to playlist
POST /api/playlist/remove       → Remove video from playlist  
POST /api/playlist/reorder      → Update playlist order
GET  /api/videos        → List available video files in /videos/ folder

GET  /api/prices        → Current cached prices as JSON
POST /api/prices/refresh        → Force price refresh now

GET  /api/settings      → All settings as JSON
POST /api/settings      → Update settings

GET  /api/status        → System status (playing, current video, uptime, etc.)
POST /api/control/play  → Start playback
POST /api/control/stop  → Stop playback  
POST /api/control/skip  → Skip to next video
POST /api/control/pause → Pause/resume

GET  /api/logs          → Last 50 log lines

# Video file serving
GET  /videos/<filename> → Serve video file from /videos/ folder
```

---

## Display Page Behavior (display.html + display.js)

### Video Playback Logic
1. On page load, fetch playlist from `/api/playlist`
2. Start playing first enabled video
3. On video `ended` event:
   a. Increment video counter
   b. If charts enabled AND counter % chart_frequency == 0 → show chart slide
   c. Else → play next video in playlist
4. Poll `/api/playlist` every 30 seconds to pick up admin changes
5. Poll `/api/prices` every 60 seconds (backend handles the actual API throttling)
6. Poll `/api/control` endpoint for play/pause/skip commands (OR use WebSocket/SSE for real-time control — WebSocket preferred if complexity is acceptable)

### Ticker Rendering
- Fixed position bottom bar, z-index above video
- If static mode: 4 equal columns, one per metal
- If marquee mode: CSS animation scrolling left, repeating
- Color coding: green (#4CAF50) for positive change, red (#F44336) for negative
- Font: monospace or clean sans-serif, large enough to read from 10+ feet away
- Example static layout:
  ```
  GOLD $3,245.80 ▲$12.30 (+0.50%)  |  SILVER $42.15 ▼$0.85 (-1.97%)  |  PLATINUM $1,089.40 ▲$5.20 (+0.48%)  |  PALLADIUM $987.60 ▲$3.10 (+0.31%)
  ```

### Chart Slides
- Full screen, dark background
- **Chart.js via CDN** for rendering price charts:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  ```
- Line chart showing recent price trend (7 days hourly data from yfinance)
- Title: "GOLD — 7 Day Price (CAD)" etc.
- Dark theme chart config (dark background, light grid lines, colored line)
- Auto-dismiss after configured duration
- Cycle through metals on each chart appearance

---

## Admin Panel Behavior (admin.html + admin.js)

### UI Framework
- **Bootstrap 5 via CDN** — no build tools, just add to HTML:
  ```html
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  ```
- Use `data-bs-theme="dark"` on `<html>` tag for built-in dark theme
- Bootstrap Icons via CDN for play/pause/skip/settings icons:
  ```html
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  ```
- Layout: Bootstrap grid with cards for each section (Playlist, Playback, Ticker, Charts, System)
- Responsive enough to use on a phone/tablet if needed (but primary use is desktop)
- Vanilla JS for all interactivity — no React, no build step

### Drag-and-Drop Playlist
- **SortableJS via CDN** for drag-and-drop reordering:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
  ```
- Playlist rendered as Bootstrap list-group with drag handles
- On reorder, POST new order to `/api/playlist/reorder`
- Visual feedback during drag (Bootstrap's `list-group-item-action` hover states)

### Real-time Status
- Poll `/api/status` every 5 seconds
- Show: current video name, playback state, last price update, error count

---

## Background Tasks

### Price Fetcher (runs in Flask background thread or APScheduler)
1. Every N minutes (configurable):
   a. For each metal (XAU, XAG, XPT, XPD):
      - Call GoldAPI.io endpoint
      - Parse response
      - Store in `prices` table
      - Log success/failure
   b. Stagger calls 2-3 seconds apart to be gentle on rate limits
2. On failure:
   - Log error with timestamp and HTTP status
   - Keep serving last known good prices
   - After 3 consecutive failures, set a warning flag visible in admin
3. Cache strategy:
   - Always serve from SQLite cache, never block display on API call
   - Store last 24 hours of price history for chart data

---

## Chrome Kiosk Launcher

### Windows batch command to open Chrome on Monitor 2:
```batch
start chrome --kiosk --new-window --window-position=1920,0 --app=http://localhost:5000/display
```

**Notes:**
- `--window-position=1920,0` assumes Monitor 2 is to the right of a 1920px primary monitor
- Make this configurable in settings (monitor offset X, Y)
- `--kiosk` makes it fullscreen with no browser chrome
- `--app=` removes address bar
- Alternative: use `--start-fullscreen` if kiosk is too locked down

### Auto-detect monitor layout (nice to have):
- Python `screeninfo` library can detect monitor positions
- Auto-calculate the correct `--window-position` values

---

## PyInstaller Packaging

### Build command:
```bash
pyinstaller --onefile --noconsole --add-data "templates;templates" --add-data "static;static" --add-data "start.bat;." --name "PreciousMetalsSignage" app.py
```

### Notes:
- `--onefile` creates single `.exe`
- `--noconsole` hides the terminal window
- `--add-data` bundles templates and static files
- `/videos/` folder stays EXTERNAL (not bundled) so user can add/remove videos
- `config.json` and `signage.db` also stay external (created on first run if missing)
- The `.exe` should detect if it's running from PyInstaller bundle and adjust paths accordingly:
  ```python
  import sys, os
  if getattr(sys, 'frozen', False):
      BASE_DIR = os.path.dirname(sys.executable)
  else:
      BASE_DIR = os.path.dirname(os.path.abspath(__file__))
  ```

### Distribution package:
```
PreciousMetalsSignage/
├── PreciousMetalsSignage.exe
├── config.json          (created on first run)
├── videos/              (empty folder, user adds videos)
└── README.txt           (quick start instructions)
```

---

## Configuration File (config.json)

```json
{
  "flask_port": 5000,
  "monitor_offset_x": 1920,
  "monitor_offset_y": 0,
  "ticker": {
    "enabled": true,
    "mode": "static",
    "update_interval_minutes": 1,
    "font_size": 28,
    "opacity": 0.85
  },
  "charts": {
    "enabled": true,
    "frequency": 3,
    "duration_seconds": 15,
    "metals": ["GC=F", "SI=F", "PL=F", "PA=F"]
  },
  "display": {
    "transition": "cut",
    "video_formats": [".mp4", ".webm", ".mov"]
  }
}
```

---

## Error Handling

- All API errors logged to `signage.log` with rotation (max 5MB, keep 3 backups)
- Display page NEVER crashes — video loop continues even if prices fail
- Admin panel shows error count and last error message
- If Flask itself crashes, `start.bat` can include a restart loop:
  ```batch
  :loop
  PreciousMetalsSignage.exe
  timeout /t 5
  goto loop
  ```

---

## Dependencies (requirements.txt)

```
flask>=3.0
yfinance>=0.2.36
apscheduler>=3.10
```

**Dev dependencies (not needed in production):**
```
pyinstaller>=6.0
```

---

## Nice-to-Have Features (Phase 2)

- [ ] WebSocket for real-time admin-to-display communication (no polling)
- [ ] Multiple display page support (different playlists per monitor)
- [ ] Scheduled playlists (different videos morning vs afternoon)
- [ ] RSS news ticker alongside prices
- [ ] Remote admin access (password protected, accessible from phone on same network)
- [ ] Price alerts (flash ticker when gold crosses a threshold)
- [ ] Historical price logging and CSV export
- [ ] Image slideshow support (not just video)
- [ ] Custom branded splash/screensaver for when no videos are loaded
- [ ] Support for secondary API provider auto-failover

---

## Quick Start Instructions (for README.txt)

```
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

TROUBLESHOOTING:
- If prices aren't updating, check your internet connection
- If display is on the wrong monitor, adjust Monitor Offset in Settings
- Check signage.log for error details
```
