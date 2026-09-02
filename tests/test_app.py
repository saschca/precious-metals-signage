import os
import tempfile
import unittest

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


if __name__ == '__main__':
    unittest.main()
