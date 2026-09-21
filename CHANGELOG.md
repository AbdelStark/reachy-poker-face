# Changelog

## Unreleased

- Keep robot motion off on connection until an explicit session arm; gate neutral, live reactions, coin flips, reset/leave poses, and antenna taps, with a fake-robot browser command-boundary test. No physical stop or hardware validation is implied.
- Verify consented synthetic downloads with `ffprobe` for container, dimensions, duration, and no audio; fall back to WebM if an advertised MP4 encoder cannot initialize, and discard recordings above 16 MB.
- Add opt-in robot-speaker game lines through an authenticated local eSpeak/FFmpeg WAV companion and the pinned SDK audio-upload path. Cancellation and fail-closed browser behavior are fixture-tested; playback has no robot validation or completion acknowledgement.
- Add opt-in robot-stream PCM capture and a loopback-only faster-whisper companion that returns bounded word timings; derive delivery buckets in code and require per-round audio consent. Synthetic browser streams, fake-model HTTP tests, and an installed-package API smoke cover software boundaries only.
- Show all four text-model cue scores, normalized weights, and meter contributions; label the composite as a game score rather than a calibrated probability. Show the final model-selected cue only for a Jev-backed pick.
- Add session-only JSONL round traces with text excluded by default and explicit per-round text consent.
- Add a schema-checked, synthetic-tested offline calibration reader that excludes fallback picks and separates models; no live evaluation result.

## 0.0.1 (development preview)

- Add the Jev-scored two-truths-and-a-lie game, typed-text rounds, configurable cues and commit thresholds, final reveal, and local nickname leaderboard.
- Add Reachy Mini browser host, synthetic preview, consent-gated silent video clip capture, authenticated loopback relay, and abstract motion mapping.
- Add source and browser fixture tests plus standalone CI. No live-robot or lie-detection claim.
