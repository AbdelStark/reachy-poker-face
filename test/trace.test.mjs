import test from "node:test";
import assert from "node:assert/strict";
import { Round, SessionTrace, TRACE_SCHEMA, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from "../lib/index.js";

const cues = { lie_now: 0.6, implausible: 0.2, hedged: 0.3, too_specific: 0.1 };
function completedRound(fallback = false) {
  const round = new Round();
  round.start();
  round.introDone();
  for (const text of ["I once ran a marathon", "I once met a dragon", "I once grew a tomato"]) {
    round.submit(text, [], cues);
    round.reactionDone();
  }
  if (fallback) round.commitUnavailable("s2");
  else round.commit("s2", 0.8);
  round.commitDone();
  round.reveal("s2");
  return round;
}
const live = ["s1", "s2", "s3"].map((id) => ({ id, cues, weights: DEFAULT_WEIGHTS }));
const final = { choice: "s2", confidence: 0.8, modelCommitStyle: "hedge", topCue: "implausibility", contradiction: 0.1, model: "fixture" };

test("session trace is text-free by default and keeps model provenance", () => {
  const recorder = new SessionTrace();
  const record = recorder.add(completedRound().snapshot, live, final, DEFAULT_THRESHOLDS);
  assert.equal(record.schema, TRACE_SCHEMA);
  assert.equal(record.pick.model, "fixture");
  assert.equal(record.pick.style, "confident");
  assert.equal(record.pick.modelCommitStyle, "hedge");
  assert.equal(record.pick.styleDisagrees, true);
  assert.equal(record.correct, true);
  assert.equal(recorder.count, 1);
  const jsonl = recorder.toJSONL();
  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(jsonl.includes("marathon"), false);
  assert.equal(jsonl.includes("dragon"), false);
  assert.equal(jsonl.includes("tomato"), false);
  assert.equal(jsonl.includes("nickname"), false);
  assert.deepEqual(JSON.parse(jsonl).statements[0].cues, cues);
});

test("mutating an add result cannot change stored or text-free trace evidence", () => {
  const recorder = new SessionTrace();
  const record = recorder.add(completedRound().snapshot, live, final, DEFAULT_THRESHOLDS);
  const before = recorder.toJSONL();
  record.statements[0].text = "private words added after recording";
  record.statements[0].cues.lie_now = 0;
  record.statements[0].weights.lie_now = 0;
  record.pick.choice = "s1";
  record.pick.thresholds.hedge = 0;
  assert.equal(recorder.toJSONL(), before);
  assert.equal(recorder.toJSONL().includes("private words"), false);
});

test("text needs explicit per-round consent; fallback stays distinguishable", () => {
  const recorder = new SessionTrace();
  recorder.add(completedRound().snapshot, live, final, DEFAULT_THRESHOLDS, true);
  assert.equal(recorder.toJSONL().includes("marathon"), true);
  const fallback = recorder.add(completedRound(true).snapshot, live);
  assert.equal(fallback.pick.source, "fallback");
  assert.equal(fallback.pick.model, undefined);
  assert.equal(fallback.pick.modelCommitStyle, undefined);
  assert.equal(fallback.pick.styleDisagrees, undefined);
  assert.equal(fallback.pick.confidence, 0);
  recorder.clear();
  assert.equal(recorder.count, 0);
  assert.equal(recorder.toJSONL(), "");
});

test("model style agreement is recorded without overriding the code rule", () => {
  const recorder = new SessionTrace();
  const record = recorder.add(completedRound().snapshot, live, { ...final, modelCommitStyle: "confident" }, DEFAULT_THRESHOLDS);
  assert.equal(record.pick.style, "confident");
  assert.equal(record.pick.modelCommitStyle, "confident");
  assert.equal(record.pick.styleDisagrees, false);
});

test("trace rejects partial rounds and mismatched evidence", () => {
  const recorder = new SessionTrace();
  assert.throws(() => recorder.add(new Round().snapshot, live), TypeError);
  assert.throws(() => recorder.add(completedRound().snapshot, live.slice(1), final, DEFAULT_THRESHOLDS), TypeError);
  assert.throws(() => recorder.add(completedRound().snapshot, [{ ...live[0], cues: { ...cues, lie_now: 0.1 } }, ...live.slice(1)], final, DEFAULT_THRESHOLDS), /composite/);
  assert.throws(() => recorder.add(completedRound().snapshot, live, { ...final, choice: "s1" }, DEFAULT_THRESHOLDS), TypeError);
  assert.throws(() => recorder.add(completedRound(true).snapshot, live, final, DEFAULT_THRESHOLDS), TypeError);
});
