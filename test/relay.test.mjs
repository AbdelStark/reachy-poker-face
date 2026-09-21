import test from "node:test";
import assert from "node:assert/strict";
import { createRelayServer } from "../server/relay.mjs";

const TOKEN = "a".repeat(32);
const ORIGIN = "http://127.0.0.1:5173";

async function withRelay(ask, run) {
  const server = createRelayServer({ token: TOKEN, allowedOrigin: ORIGIN, ask });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}/v1/systemone`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function request(url, options = {}) {
  return fetch(url, {
    method: "POST",
    headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify({ state: { bank: "pokerface.live@0.1.0" }, questions: { cue: { type: "noul" } } }),
    ...options,
  });
}

test("relay requires a strong token and exact origin", async () => {
  assert.throws(() => createRelayServer({ token: "weak", allowedOrigin: ORIGIN, ask() {} }), TypeError);
  let calls = 0;
  await withRelay(async () => { calls++; return { model: "fixture", answers: {} }; }, async (url) => {
    const forbidden = await request(url, { headers: { Origin: "https://other.example" } });
    assert.equal(forbidden.status, 403);
    const unauthenticated = await request(url, { headers: { Authorization: "Bearer wrong" } });
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls, 0);
    const accepted = await request(url);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(accepted.headers.get("cache-control"), "no-store");
    assert.equal((await accepted.json()).model, "fixture");
    assert.equal(calls, 1);
  });
});

test("relay rejects malformed and oversized requests before calling Jev", async () => {
  let calls = 0;
  await withRelay(async () => { calls++; return { model: "fixture", answers: {} }; }, async (url) => {
    assert.equal((await request(url, { body: "{" })).status, 400);
    assert.equal((await request(url, { body: JSON.stringify({ state: {}, questions: {} }) })).status, 400);
    assert.equal((await request(url, { body: JSON.stringify({ state: "x".repeat(33_000), questions: { cue: { type: "noul" } } }) })).status, 413);
    assert.equal(calls, 0);
  });
});

test("relay degrades to a non-sensitive error on upstream failure", async () => {
  await withRelay(async () => { throw new Error("secret upstream detail"); }, async (url) => {
    const response = await request(url);
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
  });
});
