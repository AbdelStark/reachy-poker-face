---
title: Reachy Poker Face
emoji: 🃏
colorFrom: amber
colorTo: rose
sdk: static
app_file: dist/index.html
app_build_command: npm ci && npm run build
hf_oauth: true
tags:
  - reachy_mini
  - reachy_mini_js_app
---

# Reachy Poker Face

A two-truths-and-a-lie game in which Reachy Mini shows uncertainty through its head and antennas. Jev judges *which story sounds most like the invented one in this game*. It does not detect lies or assess a person's honesty.

The browser app has a Reachy Mini host shell, camera view, text capture, optional browser speech transcription, an expressive probability meter, a final pick, and scorekeeping for the current tab. A narrow server-side relay keeps the TypeSafe API key out of the browser. If Jev is unavailable at the final pick, the app says so and makes a random theatrical pick; it does not pass that off as model judgment.

This is a development preview, not a hardware-tested release. The UI and core tests run without a robot, but antenna-tap behavior, motion, audio, and the host shell need a real Reachy Mini validation pass. Word-timed robot audio transcription, robot-speaker speech, clip export, persistent leaderboard, and calibration controls are not implemented yet. No accuracy or live-robot result is claimed.

## Run locally

Node.js 20+ and a sibling checkout of `reachy-jev` are currently required because this preview uses a local `file:../reachy-jev` dependency. That dependency must become independently installable before public release.

```sh
npm ci
npm run check
npm test
npm run build
```

To inspect the UI without a robot, run `npm run dev` and open `http://127.0.0.1:5173/?preview=1`. Preview mode does not simulate model answers or robot motion.

For model-backed local play, set `TYPESAFE_API_KEY`, a random `REACHY_JEV_RELAY_TOKEN` of at least 32 characters, and run `npm run relay` in a separate shell. The relay binds to `127.0.0.1:8047` and accepts only the exact `REACHY_JEV_ALLOWED_ORIGIN` (default `http://127.0.0.1:5173`). Enter the relay URL and token in the app; the token is retained only in the current page. Do not put `TYPESAFE_API_KEY` in Vite variables, the browser, or a Hugging Face Space secret exposed to static JavaScript.

For a hosted static Space, deploy the relay separately behind HTTPS with authentication, TLS, rate limits, and an allowlisted origin. The loopback relay is for local development and is not reachable from someone else's browser. The static Space metadata above follows the Reachy Mini JavaScript app-host format; it is not a claim that this app has been deployed to a Space.

## How a round works

The player gives three statements. Each statement gets text-only Jev cues and a deterministic weighted meter; no vocal stress or biometric signal is used. The final Jev question asks for exactly one of the three statements. A confidence of at least 0.70 gets a confident motion, 0.40–0.70 a hedge, and below 0.40 a coin-flip motion. The player then reveals the actual lie and the tab-local score updates.

Typing works in the development UI. The optional microphone button uses the browser's SpeechRecognition implementation, which may send audio to a browser vendor. It is not connected to the robot's microphone or a word-timed transcription pipeline. The hosted Reachy shell currently does not grant iframe microphone access, so speech input there is unverified and may be unavailable; type a statement instead. Spoken reactions use browser-local speech synthesis, not Reachy's speaker. The app does not record or export audio.

See [SECURITY.md](SECURITY.md) for deployment and privacy boundaries.
