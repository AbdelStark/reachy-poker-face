import test from "node:test";
import assert from "node:assert/strict";
import { AntennaTap } from "../lib/antenna.js";
import { toSdkTarget, showSuspicion, performCoinFlip } from "../lib/motion.js";

test("motion conversion uses metres and SDK right-left antenna order", () => {
  const target = toSdkTarget({ rollDeg: 0, pitchDeg: 0, yawDeg: 0, zMm: 10, rightAntennaDeg: 30, leftAntennaDeg: -30 });
  assert.equal(target.head.length, 16);
  assert.equal(target.head[11], 0.01);
  assert.ok(Math.abs(target.antennas[0] - Math.PI / 6) < 1e-8);
  assert.ok(Math.abs(target.antennas[1] + Math.PI / 6) < 1e-8);
  assert.throws(() => toSdkTarget({ rollDeg: 0, pitchDeg: 0, yawDeg: 0, zMm: 0, rightAntennaDeg: 0, leftAntennaDeg: 0 }, 5), RangeError);
});

test("motion never commands a disconnected robot", async () => {
  let calls = 0;
  const robot = { state: "disconnected", gotoTarget() { calls++; return true; } };
  assert.equal(showSuspicion(robot, 0.8), false);
  await performCoinFlip(robot, async () => {});
  assert.equal(calls, 0);
});

test("coin flip stops sending commands after app cleanup", async () => {
  let calls = 0;
  let active = true;
  const robot = { state: "streaming", gotoTarget() { calls++; return true; } };
  await performCoinFlip(robot, async () => { active = false; }, () => active);
  assert.equal(calls, 1);
});

test("antenna tap needs two frames, neutral reset, and cooldown", () => {
  const tap = new AntennaTap();
  assert.equal(tap.observe([0.4, 0], 0, true), null);
  assert.equal(tap.observe([0.4, 0], 40, true), "right");
  assert.equal(tap.observe([0.4, 0], 80, false), null);
  assert.equal(tap.observe([0, 0.4], 100, true), null);
  assert.equal(tap.observe([0, 0.4], 140, true), null);
  assert.equal(tap.observe([0, 0], 900, true), null);
  assert.equal(tap.observe([0, 0.4], 940, true), null);
  assert.equal(tap.observe([0, 0.4], 980, true), "left");
});
