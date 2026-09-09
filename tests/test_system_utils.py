import unittest
from unittest import mock

from utils import system_utils
from utils.system_utils import (
    ALREADY_RUNNING,
    FAILED,
    LAUNCHED,
    REMOTE_DEBUGGING_PORT,
    build_browser_command,
    launch_chrome_kiosk,
)


class BrowserCommandTests(unittest.TestCase):
    def test_kiosk_uses_isolated_profile_and_unattended_autoplay(self):
        command = build_browser_command(
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            'http://localhost:5000/display',
            1920,
            0,
            r'C:\Signage\signage-browser-profile',
        )

        self.assertIn('--kiosk', command)
        self.assertIn('--window-position=1920,0', command)
        self.assertIn('--autoplay-policy=no-user-gesture-required', command)
        self.assertIn('--user-data-dir=C:\\Signage\\signage-browser-profile', command)
        self.assertIn(f'--remote-debugging-port={REMOTE_DEBUGGING_PORT}', command)
        self.assertEqual(command[-1], 'http://localhost:5000/display')

    def test_monitor_size_is_passed_so_chrome_places_the_window(self):
        """A bare --window-position is routinely ignored, dropping the kiosk
        window on the primary display instead of the selected monitor."""
        command = build_browser_command(
            'chrome.exe', 'http://localhost:5000/display',
            -1920, 0, 'profile', width=2560, height=1440,
        )

        self.assertIn('--window-position=-1920,0', command)
        self.assertIn('--window-size=2560,1440', command)

    def test_window_size_omitted_when_geometry_is_unknown(self):
        command = build_browser_command(
            'chrome.exe', 'http://localhost:5000/display', 1920, 0, 'profile',
        )

        self.assertFalse([a for a in command if a.startswith('--window-size')])


class LaunchOutcomeTests(unittest.TestCase):
    """The launcher must not report a new positioned window when it did not
    create one — that is what made a misplaced display look like success."""

    def setUp(self):
        system_utils._browser_process = None

    def tearDown(self):
        system_utils._browser_process = None

    def test_already_running_is_reported_distinctly(self):
        with mock.patch.object(system_utils, '_browser_is_running', return_value=True):
            result = launch_chrome_kiosk(profile_dir='profile')

        self.assertEqual(result, ALREADY_RUNNING)

    def test_force_closes_the_existing_browser_then_relaunches(self):
        proc = mock.Mock()
        proc.poll.return_value = None

        with mock.patch.object(system_utils, '_browser_is_running',
                               side_effect=[True, False]), \
                mock.patch.object(system_utils, 'close_signage_browser',
                                  return_value=True) as closer, \
                mock.patch.object(system_utils, '_find_browser',
                                  return_value='chrome.exe'), \
                mock.patch.object(system_utils.subprocess, 'Popen',
                                  return_value=proc), \
                mock.patch.object(system_utils.os, 'makedirs'), \
                mock.patch.object(system_utils.time, 'sleep'):
            result = launch_chrome_kiosk(profile_dir='profile', force=True)

        closer.assert_called_once()
        self.assertEqual(result, LAUNCHED)

    def test_force_does_not_relaunch_when_the_old_browser_will_not_close(self):
        with mock.patch.object(system_utils, '_browser_is_running', return_value=True), \
                mock.patch.object(system_utils, 'close_signage_browser',
                                  return_value=False), \
                mock.patch.object(system_utils.subprocess, 'Popen') as popen:
            result = launch_chrome_kiosk(profile_dir='profile', force=True)

        popen.assert_not_called()
        self.assertEqual(result, FAILED)

    def test_browser_that_exits_immediately_is_a_failure(self):
        """A locked profile makes Chrome quit at once; Popen still succeeds."""
        proc = mock.Mock()
        proc.poll.return_value = 1
        proc.returncode = 1

        with mock.patch.object(system_utils, '_browser_is_running', return_value=False), \
                mock.patch.object(system_utils, '_find_browser',
                                  return_value='chrome.exe'), \
                mock.patch.object(system_utils.subprocess, 'Popen',
                                  return_value=proc), \
                mock.patch.object(system_utils.os, 'makedirs'), \
                mock.patch.object(system_utils.time, 'sleep'):
            result = launch_chrome_kiosk(profile_dir='profile')

        self.assertEqual(result, FAILED)

    def test_missing_browser_is_a_failure(self):
        with mock.patch.object(system_utils, '_browser_is_running', return_value=False), \
                mock.patch.object(system_utils, '_find_browser', return_value=None):
            result = launch_chrome_kiosk(profile_dir='profile')

        self.assertEqual(result, FAILED)


if __name__ == '__main__':
    unittest.main()
