import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDelivery, liveSuspicion, commitStyle, Round, gameSettings, parseSettings, DEFAULT_SETTINGS } from "../lib/index.js";

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
  assert.equal(commitStyle(0.6, { hedge: 0.3, confident: 0.55 }), "confident");
  assert.throws(() => commitStyle(0.6, { hedge: 0.7, confident: 0.4 }), RangeError);
  assert.throws(() => commitStyle(NaN), RangeError);
});

test("settings reject corrupt storage and apply cue weights to the next statement", () => {
  assert.deepEqual(parseSettings("not-json"), DEFAULT_SETTINGS);
  assert.throws(() => gameSettings({ weights: { lie_now: 0, implausible: 0, hedged: 0, too_specific: 0 }, thresholds: { hedge: 0.4, confident: 0.7 } }), RangeError);
  assert.throws(() => gameSettings({ weights: DEFAULT_SETTINGS.weights, thresholds: { hedge: 0.8, confident: 0.7 } }), RangeError);
  const weights = { lie_now: 0, implausible: 1, hedged: 0, too_specific: 0 };
  const round = new Round();
  round.start();
  round.introDone();
  assert.equal(round.submit("one two three four", [], cues, weights).pLie, cues.implausible);
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
  assert.throws(() => round.export({ keepText: "true" }), TypeError);
  round.reset();
  assert.equal(round.snapshot.phase, "idle");
});

test("round refuses free-form delivery labels before retaining a statement", () => {
  const round = new Round();
  round.start();
  round.introDone();
  assert.throws(() => round.submit("one two three four", ["private spoken words"], cues), TypeError);
  assert.equal(round.snapshot.phase, "capture");
  assert.deepEqual(round.snapshot.statements, []);
});

test("round results and snapshots cannot mutate the active game's evidence", () => {
  const round = new Round();
  round.start();
  round.introDone();
  const submitted = round.submit("I once ran a marathon", ["steady"], cues);
  submitted.text = "changed after submission";
  submitted.delivery.push("changed");
  assert.equal(round.snapshot.statements[0].text, "I once ran a marathon");
  assert.deepEqual(round.snapshot.statements[0].delivery, ["steady"]);

  const snapshot = round.snapshot;
  snapshot.statements[0].text = "changed through snapshot";
  snapshot.statements[0].delivery.push("changed");
  const exported = round.export({ keepText: true });
  exported.statements[0].text = "changed through export";
  assert.equal(round.snapshot.statements[0].text, "I once ran a marathon");
  assert.deepEqual(round.snapshot.statements[0].delivery, ["steady"]);

  for (const text of ["I once met a dragon", "I once grew a tomato"]) {
    round.reactionDone();
    round.submit(text, [], cues);
  }
  round.reactionDone();
  const pick = round.commit("s2", 0.8);
  pick.choice = "s1";
  round.snapshot.pick.choice = "s3";
  assert.equal(round.snapshot.pick.choice, "s2");
  round.commitDone();
  assert.equal(round.reveal("s2"), true);
});
