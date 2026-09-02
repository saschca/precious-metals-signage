# Chrome launcher and system utilities

import logging
import os
import shutil
import socket
import subprocess

logger = logging.getLogger('signage')

_browser_process = None
REMOTE_DEBUGGING_PORT = 9223


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


def build_browser_command(browser, url, offset_x, offset_y, profile_dir):
    """Build the isolated kiosk command. Kept separate for deterministic tests."""
    return [
        browser,
        '--kiosk',
        '--new-window',
        f'--window-position={offset_x},{offset_y}',
        f'--user-data-dir={profile_dir}',
        f'--remote-debugging-port={REMOTE_DEBUGGING_PORT}',
        '--remote-debugging-address=127.0.0.1',
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--disable-session-crashed-bubble',
        url,
    ]


def launch_chrome_kiosk(port=5000, offset_x=1920, offset_y=0, profile_dir=None):
    """Launch one isolated Chrome/Edge kiosk window on the selected monitor."""
    global _browser_process

    if _browser_process is not None and _browser_process.poll() is None:
        logger.info('Dedicated signage browser is already running')
        return True
    if _browser_is_running():
        logger.info('Dedicated signage browser detected on debugging port')
        return True

    browser = _find_browser()
    if not browser:
        logger.error('Chrome or Microsoft Edge was not found')
        return False

    url = f"http://localhost:{port}/display"
    profile_dir = profile_dir or os.path.join(os.getcwd(), 'signage-browser-profile')
    os.makedirs(profile_dir, exist_ok=True)
    cmd = build_browser_command(browser, url, offset_x, offset_y, profile_dir)

    try:
        _browser_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info(
            'Signage browser launched on position %s,%s using %s',
            offset_x, offset_y, browser,
        )
        return True
    except Exception as e:
        logger.error(f'Failed to launch signage browser: {e}')
        return False
