# Contributing

Reachy Poker Face is an entertainment app, not a lie detector. Open an issue before changing cue semantics, motion ranges, recording/privacy behavior, or the relay contract. Keep model probabilities distinct from game outcomes and do not claim biometric or deception detection.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`, and `python3 -m unittest discover -s scripts -p 'test_calibration.py'` before a pull request. Browser tests use fixture answers and synthetic media; calibration tests use synthetic records. Neither proves robot behavior or model performance. Never commit API keys, recordings, statement transcripts, or identifying player data. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
