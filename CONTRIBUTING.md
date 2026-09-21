# Contributing

Install FFmpeg (including `ffprobe`) for the browser clip-container test; it inspects an actual synthetic download, not only a MIME label.

Reachy Poker Face is an entertainment app, not a lie detector. Open an issue before changing cue semantics, motion ranges, recording/privacy behavior, or the relay contract. Keep model probabilities distinct from game outcomes and do not claim biometric or deception detection.

The live and final Jev questions are versioned banks in `src/jev.ts` and projected by `reachy-jev`. A wording or option change needs a bank-version bump, a reviewed update to the wire snapshot in `test/jev.test.mjs`, and a note about what old traces can no longer be compared with. Do not change the snapshot hash merely to make a test pass.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`, `python3 -m unittest discover -s scripts -p 'test_*.py'`, `ruff check scripts server/local_asr.py server/local_tts.py`, and `ruff format --check scripts server/local_asr.py server/local_tts.py` before a pull request. For the optional ASR runtime, install `requirements-asr.txt` and run `python3 scripts/check_asr_api.py`; this checks the API without model weights. For TTS changes, install eSpeak NG and FFmpeg and run `python3 -m unittest scripts.test_local_tts -v` so the installed-binary smoke does not skip. Browser tests use fixture answers and synthetic media; Python tests use fake models and synthetic records. None proves robot behavior, speech accuracy, voice quality, or model performance. Never commit API keys, recordings, statement transcripts, model weights, or identifying player data. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
