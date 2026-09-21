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
