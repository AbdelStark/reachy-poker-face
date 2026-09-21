# Security and privacy

This is entertainment, not lie detection. Do not infer dishonesty, identity, health, or mental state from its output. Do not use it for screening or consequential decisions.

The app sends statement text and a small game state to the configured relay, which sends them to TypeSafe for a Jev judgment. The relay does not intentionally log request bodies or API keys. No statement text is persisted by this app. Numeric settings and, only if the player types a nickname, nickname scores are saved in browser local storage; the UI can clear those scores. The unnamed session score stays in the current tab. A browser speech-recognition provider may process microphone audio off-device when the user presses **Use microphone**; this is independent of the TypeSafe request.

Clip capture is off by default and requires a fresh consent checkbox for each round. It records canvas video only, without an audio track or statement text; recording stops after 30 seconds and the blob remains in browser memory until download or discard. Do not check the box without consent from everyone visible. An exported clip is then under the downloader's control; this app cannot revoke a file they have saved or shared.

Keep the TypeSafe API key server-side. The development relay requires a strong bearer token, checks an exact browser origin, limits body size and concurrent requests, and returns generic upstream errors. Those controls are not a full public-service deployment: add TLS, operational rate limits, abuse controls, secret rotation, and cost monitoring before exposing a relay to the internet. An origin header is not authentication; the bearer token is required even when the origin matches. Do not share the token with untrusted clients.

Robot motion is expressive only. It uses the SDK target interface, but its ranges, neutral pose, physical antenna-tap detection, and leave behavior require a real-device safety check before unattended use. Stop the app if a motion or actuator behaves unexpectedly.
