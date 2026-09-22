import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { analyzeDelivery, askLive, askFinal, askFinalWithRetry, RelayLimitError, LIVE_BANK, FINAL_BANK, LIVE_QUESTION_BANK, FINAL_QUESTION_BANK, liveQuestions, liveState, finalQuestions, finalState } from "../lib/index.js";

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

test("versioned banks preserve the reviewed pre-refactor TypeSafe wire", () => {
  assert.equal(LIVE_BANK, `${LIVE_QUESTION_BANK.bank}@${LIVE_QUESTION_BANK.version}`);
  assert.equal(FINAL_BANK, `${FINAL_QUESTION_BANK.bank}@${FINAL_QUESTION_BANK.version}`);
  assert.equal(Object.keys(liveQuestions).length, 5);
  assert.equal(Object.keys(finalQuestions).length, 4);
  // A wording/option change requires a bank-version bump and a reviewed snapshot update.
  const wire = JSON.stringify({ liveQuestions, finalQuestions });
  assert.equal(createHash("sha256").update(wire).digest("hex"), "6c67087c2db936f12e49d9778f54d1c3cead2789e195858bab44a378d8370c29");
});

test("live question bank uses the actual SDK wire shape", async () => {
  let request;
  const client = { systemOne: async (input) => {
    request = input;
    return { model: "jev-test", answers: {
      lie_now: { type: "noul", noul: 0.6 }, implausible: { type: "noul", noul: 0.2 }, hedged: { type: "noul", noul: 0.1 }, too_specific: { type: "noul", noul: 0.3 }, generic: { type: "noul", noul: 0.0 },
    } };
  } };
  const cues = await askLive(client, captured, []);
  assert.equal(cues.lie_now, 0.6);
  assert.equal(Object.keys(request.questions).length, 5);
  assert.equal(request.questions.lie_now.type, "noul");
  assert.equal(request.state.statement.text, captured.text);
  assert.equal(liveState(captured, []).bank, "pokerface.live@0.1.0");
});

test("final request asks for a game pick and model style suggestion", async () => {
  const client = { systemOne: async () => ({ model: "jev-test", answers: {
    the_lie: { type: "choice", choice: "s2", confidence: 0.65 }, commit_style: { type: "choice", choice: "confident" }, top_cue: { type: "choice", choice: "implausibility" }, contradiction: { type: "noul", noul: 0.1 },
  } }) };
  assert.deepEqual(finalQuestions.the_lie.criteria, { s1: null, s2: null, s3: null });
  assert.deepEqual(finalQuestions.commit_style.criteria, { confident: null, hedge: null, coin_flip: null });
  assert.equal(finalState(statements).statements.length, 3);
  const result = await askFinal(client, statements);
  assert.equal(result.choice, "s2");
  assert.equal(result.confidence, 0.65);
  assert.equal(result.modelCommitStyle, "confident");
  await assert.rejects(() => askFinal({ systemOne: async () => ({ model: "bad", answers: {
    the_lie: { type: "choice", choice: "s4", confidence: 0.9 }, commit_style: { type: "choice", choice: "confident" }, top_cue: { type: "choice", choice: "none" }, contradiction: { type: "noul", noul: 0 },
  } }) }, statements), TypeError);
  await assert.rejects(() => askFinal({ systemOne: async () => ({ model: "bad", answers: {
    the_lie: { type: "choice", choice: "s2", confidence: 0.9 }, commit_style: { type: "choice", choice: "PRIVATE_UNTRUSTED_TEXT" }, top_cue: { type: "choice", choice: "none" }, contradiction: { type: "noul", noul: 0 },
  } }) }, statements), TypeError);
});

test("final retry makes at most two calls and reports a successful second answer", async () => {
  let calls = 0;
  let retries = 0;
  const client = { systemOne: async () => {
    if (++calls === 1) throw new Error("temporary relay failure");
    return { model: "second-answer", answers: {
      the_lie: { type: "choice", choice: "s2", confidence: 0.65 },
      commit_style: { type: "choice", choice: "hedge" },
      top_cue: { type: "choice", choice: "implausibility" },
      contradiction: { type: "noul", noul: 0.1 },
    } };
  } };
  const result = await askFinalWithRetry(client, statements, undefined, () => { retries++; });
  assert.equal(result.model, "second-answer");
  assert.equal(calls, 2);
  assert.equal(retries, 1);
  await assert.rejects(() => askFinalWithRetry({ systemOne: async () => { calls++; throw new Error("offline"); } }, statements), /offline/);
  assert.equal(calls, 4);
});

test("final retry does not start a second call after reset abort", async () => {
  const abort = new AbortController();
  let calls = 0;
  let retries = 0;
  const client = { systemOne: async () => {
    calls++;
    abort.abort(new Error("new round"));
    throw new Error("late relay failure");
  } };
  await assert.rejects(() => askFinalWithRetry(client, statements, abort.signal, () => { retries++; }), /late relay failure/);
  assert.equal(calls, 1);
  assert.equal(retries, 0);
  await assert.rejects(() => askFinalWithRetry(client, statements, abort.signal), /new round/);
  assert.equal(calls, 1);
});

test("final relay limit never starts a futile retry", async () => {
  let calls = 0;
  let retries = 0;
  const client = { systemOne: async () => { calls++; throw new RelayLimitError(); } };
  await assert.rejects(() => askFinalWithRetry(client, statements, undefined, () => { retries++; }), RelayLimitError);
  assert.equal(calls, 1);
  assert.equal(retries, 0);
});
