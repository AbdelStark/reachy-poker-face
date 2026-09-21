import test from "node:test";
import assert from "node:assert/strict";
import { playerName, parseLeaderboard, recordRound } from "../lib/index.js";

test("local leaderboard ranks bluffs and contains no statement text", () => {
  let entries = recordRound([], " Ada ", true);
  entries = recordRound(entries, "Lin", false);
  entries = recordRound(entries, "ada", true);
  assert.deepEqual(entries, [
    { name: "ada", rounds: 2, fooled: 2 },
    { name: "Lin", rounds: 1, fooled: 0 },
  ]);
  assert.equal(JSON.stringify(entries).includes("statement"), false);
  assert.deepEqual(parseLeaderboard(JSON.stringify(entries)), entries);
});

test("leaderboard rejects malformed storage and unsafe names", () => {
  assert.deepEqual(parseLeaderboard("not-json"), []);
  assert.deepEqual(parseLeaderboard(JSON.stringify([{ name: "Ada", rounds: 1, fooled: 2 }])), []);
  assert.deepEqual(parseLeaderboard(JSON.stringify([{ name: "Ada", rounds: 1, fooled: 0 }, { name: "ada", rounds: 2, fooled: 1 }])), []);
  assert.throws(() => playerName("\u0000bad"), TypeError);
  assert.throws(() => recordRound([], " ", true), TypeError);
});
