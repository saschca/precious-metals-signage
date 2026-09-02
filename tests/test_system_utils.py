import unittest

from utils.system_utils import REMOTE_DEBUGGING_PORT, build_browser_command


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


if __name__ == '__main__':
    unittest.main()
