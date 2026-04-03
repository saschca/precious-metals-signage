import sys
import os
import json
import sqlite3
import socket
import subprocess
import logging
from logging.handlers import RotatingFileHandler
import time
import threading
import mimetypes
import atexit
import webbrowser
from flask import Flask, render_template, render_template_string, jsonify, redirect, url_for, request, Response
from apscheduler.schedulers.background import BackgroundScheduler
from utils.price_fetcher import fetch_and_store, get_failure_status
from utils.system_utils import launch_chrome_kiosk

try:
    from screeninfo import get_monitors
except ImportError:
    get_monitors = None

# Determine base directory (handles PyInstaller bundle)
# BASE_DIR  = where the .exe lives (writable: db, config, videos, logs)
# BUNDLE_DIR = where bundled assets live (templates, static)
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = BASE_DIR

DB_PATH = os.path.join(BASE_DIR, 'signage.db')
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
VIDEOS_DIR = os.path.join(BASE_DIR, 'videos')
LOG_PATH = os.path.join(BASE_DIR, 'signage.log')

VIDEO_EXTS = {'.mp4', '.webm', '.mov'}
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
MEDIA_EXTS = VIDEO_EXTS | IMAGE_EXTS

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
handler = RotatingFileHandler(LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3)
handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
logger = logging.getLogger('signage')
logger.setLevel(logging.INFO)
logger.addHandler(handler)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    return {}

config = load_config()

# ---------------------------------------------------------------------------
# Database initialization
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS playlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            display_order INTEGER NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            enabled BOOLEAN DEFAULT 1
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metal TEXT NOT NULL,
            price_usd REAL NOT NULL,
            price_cad REAL NOT NULL,
            change_dollar REAL,
            change_percent REAL,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Migration: add EUR and USD-change columns to prices
    for col_def in ['price_eur REAL DEFAULT 0',
                     'change_usd REAL DEFAULT 0',
                     'change_eur REAL DEFAULT 0']:
        try:
            cursor.execute(f'ALTER TABLE prices ADD COLUMN {col_def}')
        except sqlite3.OperationalError:
            pass  # column already exists

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')

    # Insert default settings if they don't exist
    defaults = {
        'ticker_enabled': 'true',
        'ticker_mode': 'static',
        'update_interval': '1',
        'chart_metals': '{"GC=F":["5d"],"SI=F":["5d"],"PL=F":["5d"],"PA=F":["5d"]}',
        'chart_frequency': '3',
        'chart_duration': '15',
        'currency': 'CAD',
        'image_duration': '10',
        'auto_start': 'false',
        'display_monitor': '1',
    }
    for key, value in defaults.items():
        cursor.execute(
            'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
            (key, value)
        )

    conn.commit()
    conn.close()
    logger.info('Database initialized')

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__,
            template_folder=os.path.join(BUNDLE_DIR, 'templates'),
            static_folder=os.path.join(BUNDLE_DIR, 'static'))

VERSION_PATH = os.path.join(BASE_DIR, 'VERSION')
if os.path.exists(VERSION_PATH):
    with open(VERSION_PATH, 'r') as f:
        APP_VERSION = f.read().strip()
else:
    APP_VERSION = '0.0.0'

# Ensure videos directory exists
os.makedirs(VIDEOS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return redirect(url_for('display'))

@app.route('/display')
def display():
    return render_template('display.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

# --- API: Health -----------------------------------------------------------
@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok', 'version': APP_VERSION})

# --- API: Playlist ---------------------------------------------------------
@app.route('/api/playlist')
def api_playlist():
    conn = get_db()
    rows = conn.execute(
        'SELECT id, filename, display_order, enabled FROM playlist ORDER BY display_order'
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        ext = os.path.splitext(d['filename'])[1].lower()
        d['type'] = 'image' if ext in IMAGE_EXTS else 'video'
        d['exists'] = os.path.isfile(os.path.join(VIDEOS_DIR, d['filename']))
        result.append(d)
    return jsonify(result)

@app.route('/api/playlist/add', methods=['POST'])
def api_playlist_add():
    data = request.get_json(silent=True) or {}
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'filename is required'}), 400

    # Validate the file actually exists in /videos/
    ext = os.path.splitext(filename)[1].lower()
    filepath = os.path.join(VIDEOS_DIR, filename)
    if ext not in MEDIA_EXTS or not os.path.isfile(filepath):
        return jsonify({'error': 'file not found in videos folder'}), 404

    conn = get_db()
    # Check if already in playlist
    exists = conn.execute('SELECT id FROM playlist WHERE filename = ?', (filename,)).fetchone()
    if exists:
        conn.close()
        return jsonify({'error': 'already in playlist'}), 409

    # Get next display_order
    row = conn.execute('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM playlist').fetchone()
    next_order = row['next_order']

    conn.execute('INSERT INTO playlist (filename, display_order) VALUES (?, ?)', (filename, next_order))
    conn.commit()
    new_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
    conn.close()

    logger.info(f'Added to playlist: {filename} (order={next_order})')
    return jsonify({'id': new_id, 'filename': filename, 'display_order': next_order}), 201

@app.route('/api/playlist/add-all', methods=['POST'])
def api_playlist_add_all():
    all_files = []
    for f in sorted(os.listdir(VIDEOS_DIR)):
        ext = os.path.splitext(f)[1].lower()
        if ext in MEDIA_EXTS and os.path.isfile(os.path.join(VIDEOS_DIR, f)):
            all_files.append(f)

    conn = get_db()
    existing = {row['filename'] for row in conn.execute('SELECT filename FROM playlist').fetchall()}
    row = conn.execute('SELECT COALESCE(MAX(display_order), 0) AS max_order FROM playlist').fetchone()
    next_order = row['max_order'] + 1

    added = []
    for filename in all_files:
        if filename not in existing:
            conn.execute('INSERT INTO playlist (filename, display_order) VALUES (?, ?)', (filename, next_order))
            added.append(filename)
            next_order += 1

    conn.commit()
    conn.close()

    logger.info(f'Bulk added {len(added)} videos to playlist')
    return jsonify({'added': added, 'count': len(added)}), 201

@app.route('/api/playlist/remove', methods=['POST'])
def api_playlist_remove():
    data = request.get_json(silent=True) or {}
    item_id = data.get('id')
    if item_id is None:
        return jsonify({'error': 'id is required'}), 400

    conn = get_db()
    row = conn.execute('SELECT filename FROM playlist WHERE id = ?', (item_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'playlist item not found'}), 404

    filename = row['filename']
    conn.execute('DELETE FROM playlist WHERE id = ?', (item_id,))

    # Re-number display_order to keep it contiguous
    rows = conn.execute('SELECT id FROM playlist ORDER BY display_order').fetchall()
    for i, r in enumerate(rows, start=1):
        conn.execute('UPDATE playlist SET display_order = ? WHERE id = ?', (i, r['id']))

    conn.commit()
    conn.close()

    logger.info(f'Removed from playlist: {filename} (id={item_id})')
    return jsonify({'removed': item_id})

@app.route('/api/playlist/reorder', methods=['POST'])
def api_playlist_reorder():
    data = request.get_json(silent=True) or {}
    order = data.get('order')  # list of IDs in new order
    if not order or not isinstance(order, list):
        return jsonify({'error': 'order must be a JSON array of playlist IDs'}), 400

    conn = get_db()
    for i, item_id in enumerate(order, start=1):
        conn.execute('UPDATE playlist SET display_order = ? WHERE id = ?', (i, item_id))
    conn.commit()
    conn.close()

    logger.info(f'Playlist reordered: {order}')
    return jsonify({'reordered': order})

# --- API: Videos -----------------------------------------------------------
@app.route('/api/videos')
def api_videos():
    os.makedirs(VIDEOS_DIR, exist_ok=True)
    files = []
    for f in sorted(os.listdir(VIDEOS_DIR)):
        ext = os.path.splitext(f)[1].lower()
        if ext in MEDIA_EXTS:
            filepath = os.path.join(VIDEOS_DIR, f)
            try:
                files.append({
                    'filename': f,
                    'size': os.path.getsize(filepath),
                    'type': 'image' if ext in IMAGE_EXTS else 'video',
                })
            except OSError:
                pass
    return jsonify(files)

# --- API: Prices -----------------------------------------------------------
METAL_NAMES = {'GC=F': 'Gold', 'SI=F': 'Silver', 'PL=F': 'Platinum', 'PA=F': 'Palladium'}

@app.route('/api/prices')
def api_prices():
    conn = get_db()
    rows = conn.execute('''
        SELECT metal, price_usd, price_cad, price_eur,
               change_usd, change_dollar, change_eur, change_percent, fetched_at
        FROM prices
        WHERE fetched_at = (SELECT MAX(fetched_at) FROM prices)
    ''').fetchall()
    conn.close()

    failures, last_err = get_failure_status()
    prices = []
    for r in rows:
        d = dict(r)
        d['name'] = METAL_NAMES.get(d['metal'], d['metal'])
        prices.append(d)

    return jsonify({
        'prices': prices,
        'failures': failures,
        'last_error': last_err,
    })

@app.route('/api/prices/refresh', methods=['POST'])
def api_prices_refresh():
    result = fetch_and_store(DB_PATH)
    if result:
        return jsonify({'status': 'ok', 'prices': result})
    failures, last_err = get_failure_status()
    return jsonify({'status': 'error', 'error': last_err, 'failures': failures}), 502

# --- API: Chart data -------------------------------------------------------
import yfinance as yf

_chart_cache = {}           # "symbol:period" -> {'data': ..., 'time': float}
_chart_cache_lock = threading.Lock()
CHART_CACHE_TTL = 900       # 15 minutes

CHART_PERIODS = {
    '5d':  {'interval': '1h', 'label': '1 Week'},
    '1mo': {'interval': '1h', 'label': '1 Month'},
    '1y':  {'interval': '1d', 'label': '1 Year'},
    '10y': {'interval': '1d', 'label': '10 Years'},
}

@app.route('/api/chart-data/<symbol>')
def api_chart_data(symbol):
    if symbol not in METAL_NAMES:
        return jsonify({'error': 'invalid symbol'}), 400

    period = request.args.get('period', '5d')
    if period not in CHART_PERIODS:
        return jsonify({'error': 'invalid period'}), 400

    pconf = CHART_PERIODS[period]
    interval = pconf['interval']
    cache_key = f'{symbol}:{period}'

    # Serve from cache if fresh
    with _chart_cache_lock:
        cached = _chart_cache.get(cache_key)
        if cached and time.time() - cached['time'] < CHART_CACHE_TTL:
            return jsonify(cached['data'])

    try:
        tickers = [symbol, 'CADUSD=X', 'EURUSD=X']
        data = yf.download(tickers, period=period, interval=interval,
                           group_by='ticker', progress=False, threads=True)

        if data.empty:
            raise ValueError('yfinance returned empty data')

        # FX rates
        fx_close = data['CADUSD=X']['Close'].dropna()
        if fx_close.empty:
            raise ValueError('No FX data')
        usd_cad = 1.0 / float(fx_close.iloc[-1])

        usd_eur = 0.0
        try:
            eur_close = data['EURUSD=X']['Close'].dropna()
            if not eur_close.empty:
                usd_eur = 1.0 / float(eur_close.iloc[-1])
        except Exception:
            pass

        metal_col = data[symbol]['Close'].dropna()
        if metal_col.empty:
            raise ValueError(f'No data for {symbol}')

        if interval == '1h':
            labels = [t.strftime('%b %d %H:%M') for t in metal_col.index]
        elif period == '10y':
            labels = [t.strftime('%b %Y') for t in metal_col.index]
        else:
            labels = [t.strftime('%b %d') for t in metal_col.index]

        raw_usd = [float(p) for p in metal_col]
        result = {
            'symbol': symbol,
            'name': METAL_NAMES[symbol],
            'period': period,
            'period_label': pconf['label'],
            'labels': labels,
            'prices_usd': [round(p, 2) for p in raw_usd],
            'prices_cad': [round(p * usd_cad, 2) for p in raw_usd],
            'prices_eur': [round(p * usd_eur, 2) for p in raw_usd],
        }

        with _chart_cache_lock:
            _chart_cache[cache_key] = {'data': result, 'time': time.time()}

        logger.info(f'Chart data fetched for {symbol} period={period} ({len(labels)} points)')
        return jsonify(result)

    except Exception as e:
        logger.error(f'Chart data fetch failed for {symbol} period={period}: {e}')
        # Return stale cache if available
        with _chart_cache_lock:
            if cached:
                return jsonify(cached['data'])
        return jsonify({'error': str(e)}), 502

# --- API: Monitors ---------------------------------------------------------
def _get_monitor_list():
    """Return list of monitor dicts, or None if screeninfo unavailable."""
    if get_monitors is None:
        return None
    try:
        monitors = get_monitors()
        return [{
            'index': i,
            'name': m.name or f'Monitor {i + 1}',
            'width': m.width,
            'height': m.height,
            'x': m.x,
            'y': m.y,
        } for i, m in enumerate(monitors)]
    except Exception as e:
        logger.error(f'Monitor detection failed: {e}')
        return None

@app.route('/api/monitors')
def api_monitors():
    monitors = _get_monitor_list()
    if monitors is None:
        return jsonify({'error': 'screeninfo not available'}), 500
    return jsonify(monitors)

IDENTIFY_HTML = '''<!DOCTYPE html>
<html><head><style>
body { margin:0; background:#000; color:#fff; display:flex; flex-direction:column;
       align-items:center; justify-content:center; height:100vh;
       font-family:'Segoe UI',Arial,sans-serif; user-select:none; }
.num { font-size:14rem; font-weight:700; line-height:1; }
.label { font-size:2.5rem; font-weight:300; opacity:0.6; margin-top:0.5rem; }
</style></head><body>
<div class="num">{{ n }}</div>
<div class="label">{{ name }}</div>
<script>setTimeout(function(){ window.close(); }, 3000);</script>
</body></html>'''

@app.route('/display/identify')
def display_identify():
    n = request.args.get('n', '?')
    name = request.args.get('name', '')
    return render_template_string(IDENTIFY_HTML, n=n, name=name)

@app.route('/api/monitors/identify', methods=['POST'])
def api_monitors_identify():
    monitors = _get_monitor_list()
    if monitors is None:
        return jsonify({'error': 'screeninfo not available'}), 500

    port = config.get('flask_port', 5000)
    for m in monitors:
        url = f'http://localhost:{port}/display/identify?n={m["index"] + 1}&name={m["name"]}'
        cmd = (
            f'start "" chrome --app="{url}" --new-window'
            f' --window-position={m["x"]},{m["y"]}'
            f' --window-size={m["width"]},{m["height"]}'
        )
        subprocess.Popen(cmd, shell=True)

    logger.info(f'Monitor identify launched for {len(monitors)} monitors')
    return jsonify({'count': len(monitors)})

# --- API: Settings ---------------------------------------------------------
@app.route('/api/settings', methods=['GET'])
def api_settings_get():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM settings').fetchall()
    conn.close()
    result = {r['key']: r['value'] for r in rows}
    return jsonify(result)

@app.route('/api/settings', methods=['POST'])
def api_settings_update():
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({'error': 'no data'}), 400

    conn = get_db()
    db_keys = {'ticker_enabled', 'ticker_mode', 'update_interval',
               'chart_metals', 'chart_frequency', 'chart_duration',
               'currency', 'image_duration', 'auto_start', 'display_monitor'}

    for key, value in data.items():
        if key in db_keys:
            conn.execute(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                (key, str(value))
            )
    conn.commit()
    conn.close()

    # Reschedule price fetcher if interval changed
    if 'update_interval' in data:
        start_scheduler()

    logger.info(f'Settings updated: {list(data.keys())}')
    return jsonify({'status': 'ok'})

# --- API: Launch display ---------------------------------------------------
@app.route('/api/launch-display', methods=['POST'])
def api_launch_display():
    port = config.get('flask_port', 5000)

    # Look up selected monitor's position
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = 'display_monitor'").fetchone()
    conn.close()
    monitor_idx = int(row['value']) if row else 1

    monitors = _get_monitor_list()
    if monitors and 0 <= monitor_idx < len(monitors):
        m = monitors[monitor_idx]
        offset_x, offset_y = m['x'], m['y']
    else:
        # Fallback: assume second monitor is to the right
        offset_x, offset_y = 1920, 0

    ok = launch_chrome_kiosk(port, offset_x, offset_y)
    if ok:
        return jsonify({'status': 'ok', 'monitor': monitor_idx})
    return jsonify({'error': 'failed to launch Chrome'}), 500

# --- API: Status & Control -------------------------------------------------
_start_time = time.time()

_playback = {
    'state': 'stopped',       # playing | paused | stopped
    'current_video': None,
    'skip_counter': 0,
}
_playback_lock = threading.Lock()

@app.route('/api/status')
def api_status():
    with _playback_lock:
        state = dict(_playback)
    state['uptime'] = int(time.time() - _start_time)
    state['version'] = APP_VERSION
    return jsonify(state)

@app.route('/api/control/play', methods=['POST'])
def api_control_play():
    with _playback_lock:
        _playback['state'] = 'playing'
    logger.info('Playback: play')
    return jsonify({'state': 'playing'})

@app.route('/api/control/pause', methods=['POST'])
def api_control_pause():
    with _playback_lock:
        if _playback['state'] == 'paused':
            _playback['state'] = 'playing'
        else:
            _playback['state'] = 'paused'
        new_state = _playback['state']
    logger.info(f'Playback: {new_state}')
    return jsonify({'state': new_state})

@app.route('/api/control/stop', methods=['POST'])
def api_control_stop():
    with _playback_lock:
        _playback['state'] = 'stopped'
        _playback['current_video'] = None
    logger.info('Playback: stop')
    return jsonify({'state': 'stopped'})

@app.route('/api/control/skip', methods=['POST'])
def api_control_skip():
    with _playback_lock:
        _playback['skip_counter'] += 1
        _playback['state'] = 'playing'
        counter = _playback['skip_counter']
    logger.info(f'Playback: skip ({counter})')
    return jsonify({'state': 'playing', 'skip_counter': counter})

@app.route('/api/control/report', methods=['POST'])
def api_control_report():
    """Called by display page to report what it's currently showing."""
    data = request.get_json(silent=True) or {}
    with _playback_lock:
        if data.get('current_video') is not None:
            _playback['current_video'] = data['current_video']
    return jsonify({'ok': True})

# --- API: Logs -------------------------------------------------------------
@app.route('/api/logs')
def api_logs():
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH, 'r') as f:
            lines = f.readlines()
        return jsonify([l.rstrip() for l in lines[-50:]])
    return jsonify([])

# --- Video file serving (with range request support) -----------------------
MIME_MAP = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif',
}

@app.route('/videos/<path:filename>')
def serve_video(filename):
    filepath = os.path.join(VIDEOS_DIR, filename)
    if not os.path.isfile(filepath):
        return jsonify({'error': 'not found'}), 404

    file_size = os.path.getsize(filepath)
    ext = os.path.splitext(filename)[1].lower()
    content_type = MIME_MAP.get(ext, mimetypes.guess_type(filename)[0] or 'application/octet-stream')

    range_header = request.headers.get('Range')
    if range_header:
        # Parse "bytes=start-end"
        byte_range = range_header.replace('bytes=', '').split('-')
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1

        def generate():
            with open(filepath, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return Response(
            generate(),
            status=206,
            content_type=content_type,
            headers={
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(length),
            },
            direct_passthrough=True,
        )

    # Full file response
    def generate():
        with open(filepath, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk

    return Response(
        generate(),
        status=200,
        content_type=content_type,
        headers={
            'Accept-Ranges': 'bytes',
            'Content-Length': str(file_size),
        },
        direct_passthrough=True,
    )

# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------
scheduler = BackgroundScheduler(daemon=True)

def _scheduled_fetch():
    fetch_and_store(DB_PATH)

def start_scheduler():
    """Start the price-fetch scheduler using the interval from the settings table."""
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = 'update_interval'").fetchone()
    conn.close()
    interval = int(row['value']) if row else 1

    # Remove any existing price job so we can re-add with new interval
    if scheduler.get_job('price_fetch'):
        scheduler.remove_job('price_fetch')

    scheduler.add_job(
        _scheduled_fetch,
        'interval',
        minutes=interval,
        id='price_fetch',
        replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()
        atexit.register(scheduler.shutdown)

    logger.info(f'Price scheduler started (every {interval} min)')

# ---------------------------------------------------------------------------
# Instance guard
# ---------------------------------------------------------------------------
def is_port_in_use(port):
    """Check if a port is already bound by another process."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect(('127.0.0.1', port))
            return True
        except (ConnectionRefusedError, OSError):
            return False

LOCK_PATH = os.path.join(BASE_DIR, '.signage.lock')

def acquire_lock(port):
    """Write a lockfile with our PID. Returns True if we got the lock."""
    if os.path.exists(LOCK_PATH):
        try:
            with open(LOCK_PATH, 'r') as f:
                old_pid = int(f.read().strip())
            # Check if that process is still alive (Windows-compatible)
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, old_pid)
            if handle:
                kernel32.CloseHandle(handle)
                return False  # process still running
        except (ValueError, OSError, AttributeError):
            pass  # stale lock, we can take it
    with open(LOCK_PATH, 'w') as f:
        f.write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(LOCK_PATH) and os.remove(LOCK_PATH))
    return True

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    port = config.get('flask_port', 5000)

    # Prevent duplicate launches
    if is_port_in_use(port) or not acquire_lock(port):
        print(f'Another instance is already running on port {port}.')
        print(f'Opening admin panel in browser...')
        webbrowser.open(f'http://localhost:{port}/admin')
        sys.exit(0)

    init_db()

    # Fetch prices once immediately, then start scheduler
    print('Fetching initial prices...')
    result = fetch_and_store(DB_PATH)
    if result:
        print(f'  Prices loaded: {", ".join(r["name"] for r in result)}')
    else:
        print('  Price fetch failed (will retry on schedule)')

    start_scheduler()

    logger.info(f'Starting Precious Metals Signage on port {port}')
    print(f'Precious Metals Digital Signage')
    print(f'  Admin:   http://localhost:{port}/admin')
    print(f'  Display: http://localhost:{port}/display')
    app.run(host='0.0.0.0', port=port, debug=False)
