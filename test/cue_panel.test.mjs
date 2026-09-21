import test from "node:test";
import assert from "node:assert/strict";
import { cueBreakdown, finalCueLabel, finalCueSpeech } from "../lib/cue_panel.js";
import { liveSuspicion } from "../lib/cues.js";

test("displayed cue contributions reproduce the actual weighted meter", () => {
  const cues = { lie_now: 0.6, implausible: 0.2, hedged: 0.3, too_specific: 0.1 };
  const weights = { lie_now: 5, implausible: 2, hedged: 2, too_specific: 1 };
  const rows = cueBreakdown(cues, weights);
  assert.deepEqual(rows.map((row) => row.key), ["lie_now", "implausible", "hedged", "too_specific"]);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.effectiveWeight, 0) - 1) < 1e-12);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.contribution, 0) - liveSuspicion(cues, weights)) < 1e-12);
  assert.equal(rows[0].label, "Invented-story cue");
});

test("bad cue vectors cannot be presented as valid explanations", () => {
  const weights = { lie_now: 0.5, implausible: 0.2, hedged: 0.2, too_specific: 0.1 };
  assert.throws(() => cueBreakdown({ lie_now: Number.NaN, implausible: 0, hedged: 0, too_specific: 0 }, weights), RangeError);
  assert.equal(finalCueLabel("none"), "no single cue");
  assert.equal(finalCueSpeech("none"), "No single cue stood out.");
  assert.equal(finalCueSpeech("model_invented_a_reason"), undefined);
  assert.throws(() => finalCueLabel("model_invented_a_reason"), TypeError);
});
