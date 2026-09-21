# Reachy Poker Face

A two-truths-and-a-lie game where Reachy Mini's body language shows uncertainty instead of pretending to know the truth. This is not a lie detector: the judgments concern language and delivery cues, not a person's honesty.

The current package is a tested game engine, not yet a playable robot app. It contains the round state machine, timing buckets, cue composite, and confidence-gated commit policy. Browser capture, Jev calls, robot motion, sound, and clip export remain in development; no accuracy or calibration result is claimed.

## Rules

One player says three statements, ending each by a deliberate delimiter. After each, a cue probability drives an expressive meter. A final three-way pick determines the robot's answer. A pick with confidence ≥ 0.70 is confident, 0.40–0.70 hedges, and lower confidence is a theatrical coin flip. The host reveals the real lie to score the round.

The text of a statement is never stored by this engine after the round unless the caller explicitly retains it. Applications must request consent before audio capture or clip export. No voice-stress or biometric features are used.

Run `npm ci`, `npm run check`, and `npm test` (Node.js 20+). See [SECURITY.md](SECURITY.md) for privacy and hardware boundaries.
