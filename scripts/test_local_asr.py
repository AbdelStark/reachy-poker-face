"""Local ASR boundary tests; no model, weights, robot, or external network."""

import json
import struct
import threading
import types
import unittest
from http.client import HTTPConnection
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.local_asr import (
    MAX_BODY,
    LocalWhisperWords,
    create_asr_server,
    normalized_result,
    validate_pcm,
)

TOKEN = "t" * 32
ORIGIN = "http://127.0.0.1:5173"
PCM = struct.pack("<f", 0.1) * 4_000


class LocalAsrTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def transcribe(body):
            self.calls.append(body)
            return [
                {"word": "I", "startMs": 20, "endMs": 90},
                {"word": "wonder", "startMs": 120, "endMs": 240},
            ]

        self.server = create_asr_server(
            token=TOKEN, allowed_origin=ORIGIN, transcribe=transcribe
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1/asr"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(
        self,
        body=PCM,
        *,
        origin=ORIGIN,
        token=TOKEN,
        content_type="application/octet-stream",
        method="POST",
    ):
        request = Request(
            self.url,
            data=body if method == "POST" else None,
            method=method,
            headers={
                "Origin": origin,
                "Authorization": f"Bearer {token}",
                "Content-Type": content_type,
            },
        )
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as exc:
            response = exc
        with response:
            return (
                response.status,
                response.headers,
                json.loads(response.read() or b"{}"),
            )

    def test_authenticated_pcm_produces_word_timing_without_audio_echo(self):
        status, headers, payload = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(
            payload,
            {
                "text": "I wonder",
                "words": [
                    {"word": "I", "startMs": 20, "endMs": 90},
                    {"word": "wonder", "startMs": 120, "endMs": 240},
                ],
            },
        )
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.calls, [PCM])
        self.assertNotIn("audio", json.dumps(payload).lower())

    def test_origin_auth_format_and_audio_validation_fail_before_model(self):
        cases = [
            ({"origin": "http://evil.example"}, 403),
            ({"token": "wrong"}, 401),
            ({"content_type": "audio/webm"}, 415),
            ({"body": b"x"}, 400),
            ({"body": struct.pack("<f", float("nan")) * 4_000}, 400),
        ]
        for options, expected in cases:
            with self.subTest(options=tuple(options)):
                self.assertEqual(self.request(**options)[0], expected)
        self.assertEqual(self.calls, [])

    def test_oversized_content_length_is_rejected_without_reading_body(self):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.putrequest("POST", "/v1/asr")
            connection.putheader("Origin", ORIGIN)
            connection.putheader("Authorization", f"Bearer {TOKEN}")
            connection.putheader("Content-Type", "application/octet-stream")
            connection.putheader("Content-Length", str(MAX_BODY + 1))
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 413)
            self.assertEqual(self.calls, [])
        finally:
            connection.close()

    def test_preflight_has_narrow_cors_and_missing_model_is_rejected_locally(self):
        status, headers, _payload = self.request(method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Methods"], "POST, OPTIONS")
        self.assertEqual(
            self.request(method="OPTIONS", origin="http://evil.example")[0], 403
        )
        with self.assertRaisesRegex(ValueError, "complete local"):
            LocalWhisperWords("/definitely/not/a/local/model")
        with self.assertRaisesRegex(ValueError, "exact origin"):
            create_asr_server(
                token=TOKEN,
                allowed_origin="https://remote.example",
                transcribe=lambda _body: [],
            )

    def test_invalid_word_timings_and_text_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "timing"):
            normalized_result([{"word": "bad", "startMs": 999, "endMs": 1_000}], 250)
        with self.assertRaisesRegex(ValueError, "timing"):
            normalized_result(
                [{"word": "bad", "startMs": float("nan"), "endMs": 1}], 250
            )
        with self.assertRaisesRegex(ValueError, "400"):
            normalized_result([{"word": "x" * 50, "startMs": 0, "endMs": 1}] * 10, 250)
        self.assertEqual(normalized_result([], 250), {"text": "", "words": []})
        with self.assertRaisesRegex(ValueError, "PCM"):
            validate_pcm(b"abc")

    def test_fake_whisper_adapter_requests_word_timestamps_without_model_download(self):
        calls = []

        class Model:
            def transcribe(self, samples, **options):
                calls.append((samples, options))
                word = types.SimpleNamespace(word=" hello", start=0.02, end=0.20)
                return [types.SimpleNamespace(words=[word])], None

        adapter = object.__new__(LocalWhisperWords)
        adapter.np = types.SimpleNamespace(frombuffer=lambda body, dtype: (body, dtype))
        adapter.model = Model()
        self.assertEqual(
            adapter(PCM), [{"word": " hello", "startMs": 20.0, "endMs": 200.0}]
        )
        self.assertEqual(calls[0][0], (PCM, "<f4"))
        self.assertEqual(calls[0][1]["word_timestamps"], True)
        self.assertEqual(calls[0][1]["vad_filter"], False)
        self.assertEqual(calls[0][1]["language"], "en")


if __name__ == "__main__":
    unittest.main()
