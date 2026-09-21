import test from "node:test";
import assert from "node:assert/strict";
import { OfflineFixturePort } from "../lib/fixture.js";
import { askLive, askFinal } from "../lib/jev.js";
import { Round } from "../lib/round.js";
import { commitSpeech } from "../lib/dialogue.js";
import { SessionTrace } from "../lib/trace.js";
import { DEFAULT_SETTINGS } from "../lib/settings.js";

test("offline fixture values depend on statement slot, not player text", async () => {
  const fixture = new OfflineFixturePort();
  const first = await askLive(fixture, { id: "s2", text: "a very ordinary story" }, []);
  const second = await askLive(fixture, { id: "s2", text: "a completely different story" }, []);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { lie_now: 0.75, implausible: 0.7, hedged: 0.25, too_specific: 0.3 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => askLive(fixture, { id: "s1", text: "a four word statement" }, [], controller.signal));
});

test("offline fixture pick cannot be mistaken for Jev evidence or exported for calibration", async () => {
  const fixture = new OfflineFixturePort();
  const round = new Round();
  const live = [];
  round.start();
  round.introDone();
  for (const id of ["s1", "s2", "s3"]) {
    const text = `four words for ${id} here`;
    const cues = await askLive(fixture, { id, text }, round.snapshot.statements);
    round.submit(text, [], cues);
    live.push({ id, cues, weights: DEFAULT_SETTINGS.weights });
    round.reactionDone();
  }
  const final = await askFinal(fixture, round.snapshot.statements);
  assert.equal(final.model, "offline-fixture-not-jev");
  const pick = round.commitFixture(final.choice, final.confidence);
  assert.equal(pick.source, "fixture");
  assert.match(commitSpeech(pick, final), /not a Jev judgment/);
  assert.doesNotMatch(commitSpeech(pick, final), /implausibility/);
  round.commitDone();
  round.reveal("s2");
  assert.throws(() => new SessionTrace().add(round.snapshot, live, final), /offline fixture rounds/);
});
