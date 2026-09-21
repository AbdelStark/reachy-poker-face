import test from "node:test";
import assert from "node:assert/strict";
import { commitSpeech } from "../lib/index.js";

const cues = ["hedging", "implausibility", "over_detail", "vagueness", "contradiction", "none"];
const styles = ["confident", "hedge", "coin_flip"];

test("every Jev-backed pick speaks a bounded fixed cue line and game caveat", () => {
  for (const style of styles) for (const topCue of cues) {
    const pick = { source: "jev", choice: "s2", confidence: 0.8, style };
    const final = { choice: "s2", confidence: 0.8, topCue, contradiction: 0.2, model: "fixture" };
    const speech = commitSpeech(pick, final);
    assert.match(speech, /number 2/i);
    assert.match(speech, /game guess, not proof/);
    assert.ok(speech.length <= 240 && speech.split(/\s+/).length <= 55);
    assert.ok(!speech.includes("fixture"));
    assert.ok(!speech.includes("s2"));
  }
  assert.match(commitSpeech({ source: "jev", choice: "s2", confidence: 0.8, style: "confident" },
    { choice: "s2", confidence: 0.8, topCue: "implausibility", contradiction: 0.2, model: "fixture" }), /found the story a stretch/);
});

test("fallback and mismatched provenance never speak a model cue or player text", () => {
  const fallback = commitSpeech({ source: "fallback", choice: "s3", confidence: 0, style: "coin_flip" },
    { choice: "s3", confidence: 0, topCue: "hedging", contradiction: 0.2, model: "fixture" });
  assert.equal(fallback, "Jev is unavailable. Random pick: number 3.");
  const mismatch = commitSpeech({ source: "jev", choice: "s1", confidence: 0.8, style: "confident" },
    { choice: "s2", confidence: 0.8, topCue: "hedging", contradiction: 0.2, model: "fixture" });
  assert.match(mismatch, /No verified cue to share/);
  assert.ok(!mismatch.includes("hedging"));
  const unknown = commitSpeech({ source: "jev", choice: "s1", confidence: 0.8, style: "confident" },
    { choice: "s1", confidence: 0.8, topCue: "PRIVATE_UNTRUSTED_TEXT", contradiction: 0.2, model: "fixture" });
  assert.ok(!unknown.includes("PRIVATE_UNTRUSTED_TEXT"));
  assert.throws(() => commitSpeech({ source: "jev", choice: "s2; PRIVATE", confidence: 0.8, style: "confident" }), TypeError);
});
