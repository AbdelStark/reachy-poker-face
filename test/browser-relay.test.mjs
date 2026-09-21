import test from "node:test";
import assert from "node:assert/strict";
import { RelayPort } from "../lib/index.js";

test("browser relay binds fetch to the global object", async () => {
  const calls = [];
  function fetcher(input, init) {
    assert.equal(this, globalThis);
    calls.push({ input: String(input), init });
    return Promise.resolve({ ok: true, json: async () => ({ model: "fixture", answers: {} }) });
  }
  const relay = new RelayPort("http://127.0.0.1:8047", "t".repeat(32), fetcher);
  const reply = await relay.systemOne({ state: { bank: "fixture" }, questions: { cue: { type: "noul" } } });
  assert.equal(reply.model, "fixture");
  assert.equal(calls[0].input, "http://127.0.0.1:8047/v1/systemone");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${"t".repeat(32)}`);
});

test("browser relay forwards round cancellation to its fetch", async () => {
  let requestSignal;
  const fetcher = (_input, init) => {
    requestSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const relay = new RelayPort("http://127.0.0.1:8047", "t".repeat(32), fetcher);
  const controller = new AbortController();
  const pending = relay.systemOne({ state: { bank: "fixture" }, questions: {} }, controller.signal);
  assert.equal(requestSignal.aborted, false);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestSignal.aborted, true);
});
