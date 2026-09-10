# Chrome launcher and system utilities

import json
import logging
import os
import shutil
import socket
import subprocess
import time
import urllib.request

logger = logging.getLogger('signage')

_browser_process = None
REMOTE_DEBUGGING_PORT = 9223

# Launch outcomes returned by launch_chrome_kiosk().
LAUNCHED = 'launched'
ALREADY_RUNNING = 'already-running'
FAILED = 'failed'


def _find_browser():
    """Return an installed Chromium browser executable, preferring Chrome."""
    path = shutil.which('chrome') or shutil.which('chrome.exe')
    if path:
        return path

    candidates = []
    for env_name in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        root = os.environ.get(env_name)
        if root:
            candidates.extend([
                os.path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            ])

    return next((path for path in candidates if os.path.isfile(path)), None)


def _browser_is_running():
    """The dedicated browser exposes this loopback port while it is running."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(('127.0.0.1', REMOTE_DEBUGGING_PORT)) == 0


def _devtools_opener():
    """A URL opener that ignores any configured HTTP proxy.

    The DevTools endpoint is on loopback. urllib honours http_proxy/HTTPS_PROXY
    by default, which would send these requests to a proxy that cannot reach it.
    """
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def close_signage_browser(timeout=6.0):
    """Close the dedicated kiosk browser and wait for it to release its port.

    Uses the DevTools HTTP endpoint so an orphaned browser from a previous app
    run can be closed too, not just a process this module still has a handle on.
    """
    global _browser_process

    opener = _devtools_opener()
    base = f'http://127.0.0.1:{REMOTE_DEBUGGING_PORT}'

    try:
        with opener.open(f'{base}/json/list', timeout=1.5) as resp:
            targets = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        logger.warning('Could not list signage browser targets: %s', e)
        targets = []

    for target in targets:
        target_id = target.get('id')
        if not target_id or target.get('type') != 'page':
            continue
        try:
            opener.open(f'{base}/json/close/{target_id}', timeout=1.5).close()
        except Exception as e:
            logger.warning('Could not close browser target %s: %s', target_id, e)

    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _browser_is_running():
            break
        time.sleep(0.25)

    # Anything still alive that we own gets terminated directly.
    if _browser_process is not None and _browser_process.poll() is None:
        logger.info('Terminating the tracked signage browser process')
        try:
            _browser_process.terminate()
            _browser_process.wait(timeout=5)
        except Exception as e:
            logger.warning('Could not terminate signage browser: %s', e)
    _browser_process = None

    closed = not _browser_is_running()
    if not closed:
        logger.error('Signage browser is still holding port %s', REMOTE_DEBUGGING_PORT)
    return closed


def build_browser_command(browser, url, offset_x, offset_y, profile_dir,
                          width=None, height=None):
    """Build the isolated kiosk command. Kept separate for deterministic tests.

    --window-size is sent alongside --window-position because Chrome routinely
    ignores a bare position when it has no explicit size to place, and lands the
    kiosk window on the primary display instead of the selected monitor.
    """
    command = [
        browser,
        '--kiosk',
        '--new-window',
        f'--window-position={offset_x},{offset_y}',
    ]

    if width and height:
        command.append(f'--window-size={width},{height}')

    command += [
        f'--user-data-dir={profile_dir}',
        f'--remote-debugging-port={REMOTE_DEBUGGING_PORT}',
        '--remote-debugging-address=127.0.0.1',
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        url,
    ]
    return command


def launch_chrome_kiosk(port=5000, offset_x=1920, offset_y=0, profile_dir=None,
                        width=None, height=None, force=False):
    """Launch one isolated Chrome/Edge kiosk window on the selected monitor.

    Returns LAUNCHED, ALREADY_RUNNING or FAILED. Callers must not treat
    ALREADY_RUNNING as "a new window appeared on the selected monitor" — it
    means an existing browser was left exactly where it already was.

    force=True closes any existing signage browser first, so an operator
    pressing the button in the admin panel always gets a freshly positioned
    window. Automatic start-up launches leave a healthy browser alone.
    """
    global _browser_process

    running = (_browser_process is not None and _browser_process.poll() is None) \
        or _browser_is_running()

    if running:
        if not force:
            logger.info('Dedicated signage browser is already running')
            return ALREADY_RUNNING
        logger.info('Relaunch requested — closing the existing signage browser')
        if not close_signage_browser():
            logger.error('Could not close the existing signage browser; not relaunching')
            return FAILED

    browser = _find_browser()
    if not browser:
        logger.error('Chrome or Microsoft Edge was not found')
        return FAILED

    url = f"http://localhost:{port}/display"
    profile_dir = profile_dir or os.path.join(os.getcwd(), 'signage-browser-profile')
    os.makedirs(profile_dir, exist_ok=True)
    cmd = build_browser_command(browser, url, offset_x, offset_y, profile_dir,
                                width, height)

    try:
        _browser_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        logger.error(f'Failed to launch signage browser: {e}')
        return FAILED

    # Popen succeeding only means the process started. A bad profile lock or a
    # missing display makes Chrome exit immediately, which used to be reported
    # to the operator as a successful launch.
    time.sleep(1.0)
    if _browser_process.poll() is not None:
        logger.error(
            'Signage browser exited immediately (code %s) — check that the '
            'profile directory %s is not locked by another browser',
            _browser_process.returncode, profile_dir,
        )
        _browser_process = None
        return FAILED

    logger.info(
        'Signage browser launched at %s,%s (size %sx%s) using %s',
        offset_x, offset_y, width or 'auto', height or 'auto', browser,
    )
    return LAUNCHED
