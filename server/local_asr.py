"""Optional loopback-only, authenticated ASR for robot-audio game statements.

Requests contain at most 15 seconds of mono 16 kHz float32 little-endian PCM.
The model is loaded only from a complete local directory. No audio is logged,
stored, or sent to an external service by this module.
"""

from __future__ import annotations

import argparse
import hmac
import json
import math
import os
import struct
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any
from urllib.parse import urlsplit

SAMPLE_RATE = 16_000
MIN_SAMPLES = SAMPLE_RATE // 4
MAX_SAMPLES = SAMPLE_RATE * 15
MAX_BODY = MAX_SAMPLES * 4
MAX_WORDS = 100
MAX_TEXT = 400


def validate_pcm(body: bytes) -> None:
    if (
        not isinstance(body, bytes)
        or len(body) % 4
        or not MIN_SAMPLES * 4 <= len(body) <= MAX_BODY
    ):
        raise ValueError(
            "PCM must contain 0.25 to 15 seconds of complete float32 samples"
        )
    if any(
        not math.isfinite(sample) or abs(sample) > 1
        for (sample,) in struct.iter_unpack("<f", body)
    ):
        raise ValueError("PCM contains invalid samples")


def normalized_result(raw: Any, duration_ms: int) -> dict[str, Any]:
    """Bound and validate model output before sending it to a browser."""
    if not isinstance(raw, list) or len(raw) > MAX_WORDS:
        raise ValueError("invalid word count")
    words: list[dict[str, Any]] = []
    previous_start = -1
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"word", "startMs", "endMs"}:
            raise ValueError("invalid word record")
        word, start, end = item["word"], item["startMs"], item["endMs"]
        if (
            not isinstance(word, str)
            or not word.strip()
            or len(word) > 50
            or not isinstance(start, (int, float))
            or isinstance(start, bool)
            or not isinstance(end, (int, float))
            or isinstance(end, bool)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end < start
            or end > duration_ms + 500
            or start < previous_start
        ):
            raise ValueError("invalid word timing")
        previous_start = start
        words.append(
            {"word": word.strip(), "startMs": round(start), "endMs": round(end)}
        )
    text = " ".join(item["word"] for item in words)
    if len(text) > MAX_TEXT:
        raise ValueError("transcript exceeds 400 characters")
    return {"text": text, "words": words}


class LocalWhisperWords:
    """Optional faster-whisper adapter; no implicit model download."""

    def __init__(self, model_path: str | Path) -> None:
        path = Path(model_path)
        if not path.is_dir() or any(
            not (path / name).is_file()
            for name in ("model.bin", "config.json", "tokenizer.json")
        ):
            raise ValueError(
                "model path must be a complete local converted model directory"
            )
        try:
            import numpy as np
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("install the optional ASR requirements first") from exc
        self.np = np
        self.model = WhisperModel(
            str(path), device="cpu", compute_type="int8", local_files_only=True
        )

    def __call__(self, body: bytes) -> list[dict[str, Any]]:
        samples = self.np.frombuffer(body, dtype="<f4")
        segments, _info = self.model.transcribe(
            samples,
            language="en",
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=False,
            word_timestamps=True,
        )
        words: list[dict[str, Any]] = []
        for segment in segments:
            for word in segment.words or ():
                words.append(
                    {
                        "word": word.word,
                        "startMs": word.start * 1000,
                        "endMs": word.end * 1000,
                    }
                )
                if len(words) > MAX_WORDS:
                    raise ValueError("too many ASR words")
        return words


def create_asr_server(
    *,
    token: str,
    allowed_origin: str,
    transcribe: Callable[[bytes], Any],
    port: int = 0,
) -> ThreadingHTTPServer:
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("ASR token must have at least 32 characters")
    origin = urlsplit(allowed_origin)
    if (
        origin.scheme not in ("http", "https")
        or not origin.netloc
        or origin.hostname not in ("127.0.0.1", "::1", "localhost")
        or origin.path
        or origin.query
        or origin.fragment
    ):
        raise ValueError("allowed origin must be an exact origin")
    if not callable(transcribe):
        raise TypeError("transcribe callable required")
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("invalid ASR port")
    gate = BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            pass  # Do not log audio, text, token, or request URLs.

        def _origin(self) -> str | None:
            value = self.headers.get("Origin")
            return allowed_origin if value == allowed_origin else None

        def _send(self, status: int, body: dict[str, Any] | None = None) -> None:
            data = (
                json.dumps(body or {}, separators=(",", ":")).encode("utf-8")
                if status != 204
                else b""
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self._origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def _preflight(self) -> None:
            if self._origin() is None:
                return self._send(403, {"error": "origin_forbidden"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_OPTIONS(self) -> None:
            if self.path != "/v1/asr":
                return self._send(404, {"error": "not_found"})
            self._preflight()

        def do_POST(self) -> None:
            self.connection.settimeout(30)
            if self.path != "/v1/asr":
                return self._send(404, {"error": "not_found"})
            if self.headers.get("Origin") != allowed_origin:
                return self._send(403, {"error": "origin_forbidden"})
            supplied = self.headers.get("Authorization", "")
            if not supplied.startswith("Bearer ") or not hmac.compare_digest(
                supplied[7:], token
            ):
                return self._send(401, {"error": "unauthorized"})
            if self.headers.get("Content-Type") != "application/octet-stream":
                return self._send(415, {"error": "pcm_required"})
            if self.headers.get("Transfer-Encoding"):
                return self._send(400, {"error": "content_length_required"})
            try:
                length = int(self.headers.get("Content-Length", ""))
            except (TypeError, ValueError):
                return self._send(411, {"error": "length_required"})
            if length > MAX_BODY:
                return self._send(413, {"error": "too_large"})
            if length < MIN_SAMPLES * 4 or length % 4:
                return self._send(400, {"error": "invalid_pcm"})
            if not gate.acquire(blocking=False):
                return self._send(429, {"error": "busy"})
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    return self._send(400, {"error": "incomplete_pcm"})
                try:
                    validate_pcm(body)
                except ValueError:
                    return self._send(400, {"error": "invalid_pcm"})
                try:
                    raw = transcribe(body)
                    result = normalized_result(raw, length * 1000 // (SAMPLE_RATE * 4))
                except Exception:  # noqa: BLE001 - model failures must not expose raw errors or text
                    return self._send(503, {"error": "asr_unavailable"})
                self._send(200, result)
            finally:
                gate.release()

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Local word-timed ASR for Reachy Poker Face"
    )
    parser.add_argument(
        "--model-path",
        required=True,
        help="Existing local converted faster-whisper model directory",
    )
    parser.add_argument("--port", type=int, default=8049)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    token = os.environ.get("REACHY_ASR_TOKEN", "")
    server = create_asr_server(
        token=token,
        allowed_origin=args.origin,
        transcribe=LocalWhisperWords(args.model_path),
        port=args.port,
    )
    print(
        f"Local ASR listening on 127.0.0.1:{server.server_port} for {args.origin}",
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
