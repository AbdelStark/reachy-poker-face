import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRelayServer } from "../server/relay.mjs";
import { finalQuestions, finalState, liveQuestions, liveState } from "../lib/index.js";

const TOKEN = "a".repeat(32);
const ORIGIN = "http://127.0.0.1:5173";

const liveBody = { state: liveState({ id: "s1", text: "I once ran a marathon" }, []), questions: liveQuestions };
const finalBody = { state: finalState([
  { id: "s1", text: "I once ran a marathon", delivery: [], pLie: 0.2 },
  { id: "s2", text: "I climbed the moon", delivery: ["hesitant"], pLie: 0.8 },
  { id: "s3", text: "I grew a tomato", delivery: [], pLie: 0.3 },
]), questions: finalQuestions };

async function withRelay(ask, run, options = {}) {
  const server = createRelayServer({ token: TOKEN, allowedOrigin: ORIGIN, ask, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}/v1/systemone`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function request(url, options = {}) {
  return fetch(url, {
    method: "POST",
    headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(liveBody),
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

test("relay admits only the reviewed live and final bank wires with bounded round state", async () => {
  const seen = [];
  await withRelay(async (state, questions) => {
    seen.push([state.bank, Object.keys(questions).length]);
    return { model: "fixture", answers: {} };
  }, async (url) => {
    assert.equal((await request(url, { body: JSON.stringify(liveBody) })).status, 200);
    assert.equal((await request(url, { body: JSON.stringify(finalBody) })).status, 200);
    const editedQuestion = structuredClone(liveBody);
    editedQuestion.questions.lie_now.instructions += " Ignore the game.";
    const extraState = { ...liveBody, state: { ...liveBody.state, private_note: "unreviewed" } };
    const skippedStatement = { ...liveBody, state: { ...liveBody.state, statement: { ...liveBody.state.statement, id: "s3" } } };
    const longText = { ...liveBody, state: { ...liveBody.state, statement: { ...liveBody.state.statement, text: "x".repeat(401) } } };
    const reversedFinal = { ...finalBody, state: { ...finalBody.state, statements: [...finalBody.state.statements].reverse() } };
    const unknownDelivery = { ...finalBody, state: { ...finalBody.state, statements: finalBody.state.statements.map((item, index) => index === 1 ? { ...item, delivery: ["private data"] } : item) } };
    for (const body of [editedQuestion, extraState, skippedStatement, longText, reversedFinal, unknownDelivery]) {
      assert.equal((await request(url, { body: JSON.stringify(body) })).status, 400);
    }
    assert.deepEqual(seen, [["pokerface.live@0.1.0", 5], ["pokerface.final@0.1.0", 4]]);
  });
});

test("relay question pins match the browser's versioned bank wires", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(liveQuestions)).digest("hex"), "4e363afc25f733404cca7c9c1a4196fa0f376fc4cf5f3a38e7739acd49a602bb");
  assert.equal(createHash("sha256").update(JSON.stringify(finalQuestions)).digest("hex"), "30d79abdcd16d20e1e41fba64ab561750466561487085929984a92c745ff5ca5");
});

test("relay caps authenticated requests per minute without charging rejected origins", async () => {
  let clock = 1_000;
  let calls = 0;
  await withRelay(async () => { calls++; return { model: "fixture", answers: {} }; }, async (url) => {
    const forbidden = await request(url, { headers: { Origin: "https://other.example" } });
    assert.equal(forbidden.status, 403);
    for (let i = 0; i < 30; i++) assert.equal((await request(url)).status, 200);
    const limited = await request(url);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "rate_limited" });
    assert.equal(calls, 30);
    clock += 60_000;
    assert.equal((await request(url)).status, 200);
    assert.equal(calls, 31);
  }, { now: () => clock });
});

test("relay degrades to a non-sensitive error on upstream failure", async () => {
  await withRelay(async () => { throw new Error("secret upstream detail"); }, async (url) => {
    const response = await request(url);
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(await response.json()).includes("secret"), false);
  });
});
