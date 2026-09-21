import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDelivery, askLive, askFinal, liveState, finalQuestions, finalState } from "../dist/index.js";

const delivery = analyzeDelivery([
  { word: "I", startMs: 0, endMs: 100 },
  { word: "ran", startMs: 150, endMs: 300 },
  { word: "a", startMs: 350, endMs: 400 },
  { word: "marathon", startMs: 450, endMs: 900 },
]);
const captured = { id: "s1", text: "I ran a marathon", delivery };
const statements = [
  { id: "s1", text: "I ran a marathon", delivery: ["steady"], pLie: 0.3 },
  { id: "s2", text: "I climbed the moon", delivery: ["steady"], pLie: 0.8 },
  { id: "s3", text: "I grew a tomato", delivery: ["steady"], pLie: 0.2 },
];

test("live question bank uses the actual SDK wire shape", async () => {
  let request;
  const client = { systemOne: async (input) => {
    request = input;
    return { answers: {
      lie_now: { noul: 0.6 }, implausible: { noul: 0.2 }, hedged: { noul: 0.1 }, too_specific: { noul: 0.3 }, generic: { noul: 0.0 },
    } };
  } };
  const cues = await askLive(client, captured, []);
  assert.equal(cues.lie_now, 0.6);
  assert.equal(Object.keys(request.questions).length, 5);
  assert.equal(request.questions.lie_now.type, "noul");
  assert.equal(request.state.statement.text, captured.text);
  assert.equal(liveState(captured, []).bank, "pokerface.live@0.1.0");
});

test("final request asks one three-way Choice and rejects malformed picks", async () => {
  const client = { systemOne: async () => ({ model: "jev-test", answers: {
    the_lie: { choice: "s2", confidence: 0.65 }, top_cue: { choice: "implausibility" }, contradiction: { noul: 0.1 },
  } }) };
  assert.deepEqual(finalQuestions.the_lie.criteria, { s1: null, s2: null, s3: null });
  assert.equal(finalState(statements).statements.length, 3);
  const result = await askFinal(client, statements);
  assert.equal(result.choice, "s2");
  assert.equal(result.confidence, 0.65);
  await assert.rejects(() => askFinal({ systemOne: async () => ({ model: "bad", answers: {
    the_lie: { choice: "s4", confidence: 0.9 }, top_cue: { choice: "none" }, contradiction: { noul: 0 },
  } }) }, statements), TypeError);
});
