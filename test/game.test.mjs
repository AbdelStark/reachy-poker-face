import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDelivery, liveSuspicion, commitStyle, Round } from "../lib/index.js";

const cues = { lie_now: 0.6, implausible: 0.2, hedged: 0.5, too_specific: 0.1 };

test("timing buckets are computed from words, not model arithmetic", () => {
  const analysis = analyzeDelivery([
    { word: "I", startMs: 0, endMs: 100 },
    { word: "uh", startMs: 600, endMs: 700 },
    { word: "ran", startMs: 1200, endMs: 1500 },
    { word: "ran", startMs: 1600, endMs: 1800 },
  ]);
  assert.deepEqual(analysis.delivery, ["hesitant", "self-corrected"]);
  assert.equal(analysis.pauseCount, 2);
  assert.equal(analysis.restartCount, 1);
  assert.equal(analysis.length, "short");
  assert.throws(() => analyzeDelivery([]), TypeError);
});

test("composite and commit style honor configured thresholds", () => {
  assert.equal(liveSuspicion(cues), 0.45);
  assert.equal(commitStyle(0.7), "confident");
  assert.equal(commitStyle(0.4), "hedge");
  assert.equal(commitStyle(0.399), "coin_flip");
  assert.throws(() => commitStyle(NaN), RangeError);
});

test("round enforces sequence and text-free export", () => {
  const round = new Round();
  assert.throws(() => round.submit("one two three four", [], cues));
  round.start();
  round.introDone();
  for (let i = 0; i < 3; i++) {
    round.submit(`statement number ${i + 1} is here`, ["steady"], cues);
    round.reactionDone();
  }
  assert.equal(round.snapshot.phase, "think");
  assert.equal(round.commit("s2", 0.3).style, "coin_flip");
  round.commitDone();
  assert.equal(round.reveal("s2"), true);
  assert.equal(JSON.stringify(round.export()).includes("statement number"), false);
  assert.equal(JSON.stringify(round.export({ keepText: true })).includes("statement number"), true);
  round.reset();
  assert.equal(round.snapshot.phase, "idle");
});
