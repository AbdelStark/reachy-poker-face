"""Optional authenticated loopback speech for fixed Poker Face game lines.

The browser sends complete text and receives a bounded 16 kHz mono PCM16 WAV.
This companion does not play sound, persist text/audio, or call a cloud service.
"""

from __future__ import annotations

import argparse
import hmac
import io
import json
import os
import subprocess
import wave
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore
from urllib.parse import urlsplit

SAMPLE_RATE = 16_000
MAX_SECONDS = 20
MAX_WAV_BYTES = 44 + SAMPLE_RATE * MAX_SECONDS * 2
MAX_REQUEST_BYTES = 512


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def validate_text(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > 240
        or len(value.split()) > 55
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError("speech text outside bounded printable range")
    return value


def pcm_to_wav(pcm: bytes) -> bytes:
    if not pcm or len(pcm) % 2 or len(pcm) > SAMPLE_RATE * MAX_SECONDS * 2:
        raise ValueError("PCM outside output bounds")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    result = output.getvalue()
    if len(result) > MAX_WAV_BYTES:
        raise ValueError("WAV exceeds output cap")
    return result


def validate_wav(data: object) -> bytes:
    if not isinstance(data, bytes) or not 44 < len(data) <= MAX_WAV_BYTES:
        raise ValueError("invalid bounded WAV")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (
                wav.getnchannels() != 1
                or wav.getsampwidth() != 2
                or wav.getframerate() != SAMPLE_RATE
                or not 0 < wav.getnframes() <= SAMPLE_RATE * MAX_SECONDS
                or len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2
            ):
                raise ValueError("unsupported WAV format")
    except (EOFError, wave.Error) as exc:
        raise ValueError("invalid WAV") from exc
    return data


class EspeakFfmpegVoice:
    """Reference offline voice; host installs eSpeak NG and FFmpeg separately."""

    def __call__(self, text: str) -> bytes:
        text = validate_text(text)
        wav = subprocess.run(
            ["espeak-ng", "--stdout", "--stdin", "-v", "en-us", "-s", "175"],
            input=text.encode("utf-8"),
            capture_output=True,
            check=True,
            timeout=10,
        ).stdout
        if not wav or len(wav) > 8_000_000:
            raise ValueError("eSpeak output outside cap")
        pcm = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "pipe",
                "-f",
                "wav",
                "-i",
                "pipe:0",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                "1",
                "-f",
                "s16le",
                "pipe:1",
            ],
            input=wav,
            capture_output=True,
            check=True,
            timeout=10,
        ).stdout
        return pcm_to_wav(pcm)


def create_tts_server(
    *,
    token: str,
    allowed_origin: str,
    synthesize: Callable[[str], bytes],
    port: int = 0,
) -> ThreadingHTTPServer:
    if not isinstance(token, str) or len(token) < 32 or not token.isascii():
        raise ValueError("TTS token must contain at least 32 ASCII characters")
    origin = urlsplit(allowed_origin)
    if (
        origin.scheme not in ("http", "https")
        or origin.hostname not in ("127.0.0.1", "::1", "localhost")
        or not origin.netloc
        or origin.path
        or origin.query
        or origin.fragment
    ):
        raise ValueError("allowed origin must be an exact local browser origin")
    if not callable(synthesize):
        raise TypeError("synthesize callable required")
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("invalid TTS port")
    gate = BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            pass

        def _send(self, status: int, body: bytes = b"", *, wav: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "audio/wav" if wav else "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            if self.path != "/v1/tts":
                return self._send(404)
            if self.headers.get("Origin") != allowed_origin:
                return self._send(403)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self) -> None:
            self.connection.settimeout(20)
            if self.path != "/v1/tts":
                return self._send(404)
            if self.headers.get("Origin") != allowed_origin:
                return self._send(403)
            supplied = self.headers.get("Authorization", "")
            if not supplied.startswith("Bearer ") or not hmac.compare_digest(
                supplied[7:], token
            ):
                return self._send(401)
            if self.headers.get("Content-Type") != "application/json":
                return self._send(415)
            if self.headers.get("Transfer-Encoding"):
                return self._send(400)
            try:
                length = int(self.headers.get("Content-Length", ""))
            except (TypeError, ValueError):
                return self._send(411)
            if not 0 < length <= MAX_REQUEST_BYTES:
                return self._send(413)
            if not gate.acquire(blocking=False):
                return self._send(429)
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self._send(400)
                try:
                    value = json.loads(raw, object_pairs_hook=_unique_object)
                    if not isinstance(value, dict) or set(value) != {"text"}:
                        raise ValueError("invalid request")
                    text = validate_text(value["text"])
                except (UnicodeDecodeError, ValueError, RecursionError):
                    return self._send(400)
                try:
                    result = validate_wav(synthesize(text))
                except Exception:  # noqa: BLE001 - no process error or text in response
                    return self._send(503)
                self._send(200, result, wav=True)
            finally:
                gate.release()

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Offline loopback TTS for Reachy Poker Face"
    )
    parser.add_argument("--port", type=int, default=8050)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    server = create_tts_server(
        token=os.environ.get("REACHY_TTS_TOKEN", ""),
        allowed_origin=args.origin,
        synthesize=EspeakFfmpegVoice(),
        port=args.port,
    )
    print(
        f"Local TTS listening on 127.0.0.1:{server.server_port} for {args.origin}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
