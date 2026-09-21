"""Local TTS contract tests with a synthetic voice and optional installed binaries."""

from __future__ import annotations

import shutil
import threading
import unittest
from http.client import HTTPConnection

from server.local_tts import (
    EspeakFfmpegVoice,
    create_tts_server,
    pcm_to_wav,
    validate_text,
    validate_wav,
)

TOKEN = "t" * 32
ORIGIN = "http://127.0.0.1:5173"
WAV = pcm_to_wav(b"\x00\x00" * 8_000)


class LocalTtsTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def synthesize(text):
            self.calls.append(text)
            return WAV

        self.server = create_tts_server(
            token=TOKEN, allowed_origin=ORIGIN, synthesize=synthesize
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(
        self,
        body=b'{"text":"Three statements. Go."}',
        *,
        origin=ORIGIN,
        token=TOKEN,
        content_type="application/json",
        method="POST",
    ):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(
                method,
                "/v1/tts",
                body=body if method == "POST" else None,
                headers={
                    "Origin": origin,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": content_type,
                },
            )
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_authenticated_template_returns_bounded_wav(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body, WAV)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.calls, ["Three statements. Go."])

    def test_auth_origin_format_and_text_fail_before_synthesis(self):
        for options, expected in (
            ({"origin": "http://evil.example"}, 403),
            ({"token": "wrong"}, 401),
            ({"content_type": "text/plain"}, 415),
            ({"body": b'{"text":"hi","text":"again"}'}, 400),
            ({"body": b'{"text":"hello","path":"elsewhere"}'}, 400),
            ({"body": b'{"text":"hi\\nthere"}'}, 400),
        ):
            with self.subTest(options=options):
                self.assertEqual(self.request(**options)[0], expected)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.request(method="OPTIONS")[0], 204)
        self.assertEqual(
            self.request(method="OPTIONS", origin="http://evil.example")[0], 403
        )

    def test_oversized_request_and_invalid_wav_fail_closed(self):
        self.assertEqual(self.request(body=b"x" * 513)[0], 413)
        self.assertEqual(self.calls, [])
        with self.assertRaises(ValueError):
            validate_wav(b"not-wav")
        with self.assertRaises(ValueError):
            validate_text("x" * 241)
        with self.assertRaises(ValueError):
            pcm_to_wav(b"\x00")
        with self.assertRaises(ValueError):
            create_tts_server(
                token=TOKEN,
                allowed_origin="https://remote.example",
                synthesize=lambda _: WAV,
            )

    @unittest.skipUnless(
        shutil.which("espeak-ng") and shutil.which("ffmpeg"),
        "offline voice binaries absent",
    )
    def test_installed_offline_voice_produces_real_pcm16_wav(self):
        result = EspeakFfmpegVoice()("Three statements. Go.")
        self.assertGreater(len(validate_wav(result)), 44)
        self.assertEqual(result[:4], b"RIFF")
        self.assertEqual(result[8:12], b"WAVE")
        self.assertLessEqual(len(result), 44 + 16_000 * 20 * 2)

        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.server = create_tts_server(
            token=TOKEN, allowed_origin=ORIGIN, synthesize=EspeakFfmpegVoice()
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertGreater(len(validate_wav(body)), 44)


if __name__ == "__main__":
    unittest.main()
