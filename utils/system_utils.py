# Chrome launcher, startup shortcut, system utilities

import subprocess
import logging

logger = logging.getLogger('signage')


def launch_chrome_kiosk(port=5000, offset_x=1920, offset_y=0):
    """Launch Chrome in kiosk mode positioned on Monitor 2."""
    url = f"http://localhost:{port}/display"
    cmd = (
        f'start chrome --kiosk --new-window'
        f' --window-position={offset_x},{offset_y}'
        f' --app={url}'
    )
    try:
        subprocess.Popen(cmd, shell=True)
        logger.info(f'Chrome kiosk launched: {cmd}')
        return True
    except Exception as e:
        logger.error(f'Failed to launch Chrome: {e}')
        return False
