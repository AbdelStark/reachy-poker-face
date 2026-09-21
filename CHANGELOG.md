# Changelog

## Unreleased

- Define the live/final question batches as versioned `reachy-jev` banks and project them through the shared validator; pin the typed wire builder and preserve the reviewed TypeSafe request bytes.
- Offer an explicit native file-share action for consented silent clips after reveal when the browser supports it; cancellation preserves the local clip, with download and discard still available.
- Keep the round in `INTRO` until the operator confirms the opening line has finished; only then open statement capture and start a consented clip. Request cancellation of any remaining speech before capture, without claiming a robot-silence receipt.
- Ask Jev for the final `commit_style` Choice and record whether its suggestion disagrees with the app's confidence-based style; keep the code rule authoritative and reject contradictory style evidence in calibration input.
- Allow immediate round reset during a pending Jev call; abort the browser request, fence late answers and recognition callbacks, and let a new round proceed without waiting for the old result. Offline browser tests cover both races.
- Report the strictly above-0.70 final-pick subset with count, coverage, accuracy, and Wilson interval per model; reject duplicate JSON keys and fallback records with impossible model evidence. Synthetic calculations only, no performance claim.
- Add an immediate in-round stop-and-discard control for consented local clips, plus deletion of a finished clip before download; the game continues and the browser test covers both states.
- Speak the final Jev cue through a bounded fixed template that labels it a game guess, not proof; fallback picks remain explicitly random and never speak a model cue or player statement. Share one cue vocabulary between visible and spoken explanations and cover the robot-speaker request in a fake-host browser test.
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
