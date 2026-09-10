import os
import tempfile
import unittest
from unittest import mock

import app as signage


class SignageAppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        signage.DB_PATH = os.path.join(self.temp_dir.name, 'signage.db')
        signage.VIDEOS_DIR = os.path.join(self.temp_dir.name, 'videos')
        os.makedirs(signage.VIDEOS_DIR)
        signage.init_db()
        self.client = signage.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_new_install_starts_in_playing_state(self):
        response = self.client.get('/api/status')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['state'], 'playing')

    def test_new_install_auto_launches_display(self):
        response = self.client.get('/api/settings')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['auto_launch_display'], 'true')
        self.assertEqual(response.get_json()['media_muted'], 'true')

    def test_media_route_supports_byte_ranges(self):
        media_path = os.path.join(signage.VIDEOS_DIR, 'sample.mp4')
        with open(media_path, 'wb') as media_file:
            media_file.write(b'0123456789')

        response = self.client.get(
            '/videos/sample.mp4',
            headers={'Range': 'bytes=2-5'},
        )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b'2345')
        self.assertEqual(response.headers['Content-Range'], 'bytes 2-5/10')
        response.close()

    def test_media_route_does_not_leave_video_directory(self):
        response = self.client.get('/videos/%2e%2e/app.py')
        self.assertEqual(response.status_code, 404)



class DisplayPositionTests(unittest.TestCase):
    """A window placed outside every monitor still exists and still appears in
    the taskbar, but is invisible on every physical screen and cannot be
    dragged back. An unverifiable position must never be used."""

    MONITORS = [
        {'index': 0, 'name': 'Primary', 'width': 2560, 'height': 1440, 'x': 0, 'y': 0},
        {'index': 1, 'name': 'Showroom', 'width': 1920, 'height': 1080, 'x': 2560, 'y': 0},
    ]

    def test_selected_monitor_geometry_is_used(self):
        with mock.patch.object(signage, '_get_monitor_list', return_value=self.MONITORS):
            self.assertEqual(signage.resolve_display_position(1), (2560, 0, 1920, 1080))

    def test_monitor_left_of_primary_keeps_negative_offset(self):
        monitors = [
            {'index': 0, 'name': 'Left', 'width': 1920, 'height': 1080, 'x': -1920, 'y': 0},
            {'index': 1, 'name': 'Primary', 'width': 1920, 'height': 1080, 'x': 0, 'y': 0},
        ]
        with mock.patch.object(signage, '_get_monitor_list', return_value=monitors):
            self.assertEqual(signage.resolve_display_position(0), (-1920, 0, 1920, 1080))

    def test_stale_monitor_index_falls_back_to_a_real_monitor(self):
        with mock.patch.object(signage, '_get_monitor_list', return_value=self.MONITORS):
            x, y, _w, _h = signage.resolve_display_position(5)

        self.assertEqual((x, y), (0, 0))

    def test_undetectable_monitors_use_the_primary_not_a_guess(self):
        """The old code guessed 1920,0, which lands off-screen unless the
        primary happens to be exactly 1920 wide with a monitor to its right."""
        with mock.patch.object(signage, '_get_monitor_list', return_value=None):
            self.assertEqual(signage.resolve_display_position(1), (0, 0, None, None))

    def test_resolved_position_always_lands_on_a_detected_monitor(self):
        with mock.patch.object(signage, '_get_monitor_list', return_value=self.MONITORS):
            for idx in (-1, 0, 1, 2, 99):
                x, y, _w, _h = signage.resolve_display_position(idx)
                on_screen = any(
                    m['x'] <= x < m['x'] + m['width'] and
                    m['y'] <= y < m['y'] + m['height']
                    for m in self.MONITORS
                )
                self.assertTrue(on_screen, f'index {idx} resolved off-screen to {x},{y}')


class NetworkInfoTests(unittest.TestCase):
    """The admin panel reports these URLs, so they must never be loopback —
    an operator typing 127.0.0.1 into a phone reaches the phone."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        signage.DB_PATH = os.path.join(self.temp_dir.name, 'signage.db')
        signage.init_db()
        self.client = signage.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_reports_port_and_non_loopback_addresses(self):
        response = self.client.get('/api/network')
        self.assertEqual(response.status_code, 200)

        payload = response.get_json()
        self.assertEqual(payload['port'], 5000)
        self.assertIsInstance(payload['addresses'], list)
        for address in payload['addresses']:
            self.assertFalse(address.startswith('127.'),
                             f'loopback address reported: {address}')
            self.assertFalse(address.startswith('169.254.'),
                             f'link-local address reported: {address}')


if __name__ == '__main__':
    unittest.main()
