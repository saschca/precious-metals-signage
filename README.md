# Precious Metals Digital Signage

Free, self-hosted digital signage system for precious metals shops. Video loop + live price ticker + price charts. Zero API costs.

<!-- ![Screenshot](docs/screenshot.png) -->
*Screenshot coming soon*

---

## What It Does

A full-screen signage display for a second monitor (or TV) that loops your promo videos with a live precious metals price ticker along the bottom. Periodically inserts interactive price chart slides between videos. All controlled from a web-based admin panel.

- **Media loop** — drag-and-drop playlist with videos and image slides
- **Live ticker** — Gold, Silver, Platinum, Palladium prices updated every minute
- **Chart slides** — configurable per-metal, per-timeframe (1W / 1M / 1Y / 10Y)
- **Admin panel** — manage everything from any browser on your network
- **Zero cost** — all price data via Yahoo Finance (yfinance), no API keys needed

## Features

- Bootstrap 5 dark-theme admin panel
- Drag-and-drop playlist reordering (SortableJS)
- Image slides with configurable display duration (.jpg, .png, .webp, .gif)
- Bulk "Add All" media button
- Live price fetching via yfinance — no API key required
- Chart.js price charts with configurable metals and time ranges
- Multi-currency display: CAD, USD, EUR
- Smart monitor picker with "Identify" flash
- Isolated Chrome/Edge kiosk auto-launch on the selected monitor
- Automatic recovery from stalled or unplayable media
- Windows single-instance mutex and scheduled-start installer
- Offline-safe chart timeout: online data cannot stop local videos
- SQLite database — zero configuration
- PyInstaller `.exe` packaging for Windows

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, Waitress, APScheduler |
| Database | SQLite |
| Pricing | yfinance (Yahoo Finance) |
| Frontend | Bootstrap 5, Chart.js, SortableJS |
| Packaging | PyInstaller |

## Quick Start (Windows .exe)

1. Download the Windows zip from [Releases](https://github.com/saschca/precious-metals-signage/releases) and extract the entire folder to a permanent location.
2. Put `.mp4`, `.jpg`, or `.png` files in the included `videos/` folder.
3. Double-click `PreciousMetalsSignage-vX.Y.Z.exe`.
4. Open `http://localhost:5000/admin`, identify the monitors, and select the showroom display.
5. Add the media to the playlist. Playback and the display window start automatically.
6. Double-click `windows/install-startup.cmd` once to start signage automatically after Windows logon.

The Windows task waits 20 seconds for the desktop and displays to initialize, refuses duplicate starts, and restarts the app after a failure. Windows must log into a user account before a visible browser window can open.

To remove automatic startup, run `windows/uninstall-startup.cmd`.

## Running from Source

```bash
git clone https://github.com/saschca/precious-metals-signage.git
cd precious-metals-signage
pip install -r requirements.txt
python app.py
```

The display launches automatically after the local health check passes. Open `http://localhost:5000/admin` to manage it.

## Building the .exe

Run `build.bat` on Windows. It creates a versioned EXE and copies the startup scripts, README, VERSION, and empty media folder into `dist/`.

GitHub Actions also tests the application and produces a ready-to-deploy Windows zip. A `vX.Y.Z` tag publishes that zip as a GitHub release.

## Accessing from the Network

The admin panel and display work from any device on your LAN. Find your PC's IP (`ipconfig`) and open:

```
http://192.168.x.x:5000/admin    # manage from phone/tablet
http://192.168.x.x:5000/display  # open display on any screen
```

## Configuration

An optional `config.json` can override these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `flask_port` | `5000` | Server port |
| `display.video_formats` | `.mp4, .webm, .mov` | Accepted video file types |

All other settings, including ticker, charts, monitor, currency, and display auto-launch, are managed from the admin panel and stored in `signage.db`.

## Project Structure

```
app.py                  # Flask server + all API routes
utils/
  price_fetcher.py      # yfinance price fetching + DB storage
  system_utils.py       # Chrome kiosk launcher
templates/
  admin.html            # Admin panel
  display.html          # Signage display page
static/
  js/admin.js           # Admin panel logic
  js/display.js         # Video loop + ticker + charts
  css/admin.css         # Admin styles
  css/display.css       # Display styles
videos/                 # Drop your video files here
windows/                # Install/remove Windows logon task
tests/                  # Reliability tests
VERSION                 # Semantic version
config.json             # Optional port configuration (gitignored)
signage.db              # SQLite database (gitignored)
```

## License

MIT

## Author

Built by [saschca](https://github.com/saschca)
