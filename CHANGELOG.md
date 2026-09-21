# Changelog

## Unreleased

- Show all four text-model cue scores, normalized weights, and meter contributions; label the composite as a game score rather than a calibrated probability. Show the final model-selected cue only for a Jev-backed pick.
- Add session-only JSONL round traces with text excluded by default and explicit per-round text consent.
- Add a schema-checked, synthetic-tested offline calibration reader that excludes fallback picks and separates models; no live evaluation result.

## 0.0.1 (development preview)

- Add the Jev-scored two-truths-and-a-lie game, typed-text rounds, configurable cues and commit thresholds, final reveal, and local nickname leaderboard.
- Add Reachy Mini browser host, synthetic preview, consent-gated silent video clip capture, authenticated loopback relay, and abstract motion mapping.
- Add source and browser fixture tests plus standalone CI. No live-robot or lie-detection claim.
