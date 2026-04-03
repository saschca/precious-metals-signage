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
- Chrome kiosk auto-launch on selected monitor
- Single-instance guard (port check + lockfile)
- SQLite database — zero configuration
- PyInstaller `.exe` packaging for Windows

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, APScheduler |
| Database | SQLite |
| Pricing | yfinance (Yahoo Finance) |
| Frontend | Bootstrap 5, Chart.js, SortableJS |
| Packaging | PyInstaller |

## Quick Start (Windows .exe)

1. Download `PreciousMetalsSignage.exe` from [Releases](https://github.com/saschca/precious-metals-signage/releases)
2. Place it in a folder, create a `videos/` subfolder, drop in your `.mp4` / `.jpg` / `.png` files
3. Double-click the exe
4. Open `http://localhost:5000/admin` in your browser
5. Add videos to the playlist, hit Play, click Launch Display

That's it. Prices load automatically. No Python, no API keys, no config files needed.

## Running from Source

```bash
git clone https://github.com/saschca/precious-metals-signage.git
cd precious-metals-signage
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000/admin` in your browser.

## Building the .exe

```bash
pip install pyinstaller
pyinstaller --onefile --noconsole ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --hidden-import=yfinance ^
    --hidden-import=apscheduler ^
    --hidden-import=apscheduler.schedulers.background ^
    --hidden-import=apscheduler.triggers.interval ^
    --hidden-import=apscheduler.executors.pool ^
    --hidden-import=apscheduler.jobstores.memory ^
    --hidden-import=screeninfo ^
    --name "PreciousMetalsSignage" ^
    app.py
```

Output: `dist/PreciousMetalsSignage.exe`

## Accessing from the Network

The admin panel and display work from any device on your LAN. Find your PC's IP (`ipconfig`) and open:

```
http://192.168.x.x:5000/admin    # manage from phone/tablet
http://192.168.x.x:5000/display  # open display on any screen
```

## Configuration

A `config.json` is auto-created on first run. Defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `flask_port` | `5000` | Server port |
| `display.video_formats` | `.mp4, .webm, .mov` | Accepted video file types |

All other settings (ticker, charts, monitor, currency) are managed from the admin panel and stored in `signage.db`.

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
VERSION                 # Semantic version
config.json             # Auto-generated config (gitignored)
signage.db              # SQLite database (gitignored)
```

## License

MIT

## Author

Built by [saschca](https://github.com/saschca)
