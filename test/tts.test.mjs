import test from "node:test";
import assert from "node:assert/strict";
import { LocalTtsPort, RobotSpeechOutput, validateGameWav } from "../lib/tts.js";

function wav() {
  const bytes = new Uint8Array(44 + 16_000);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
    for (let index = 0; index < 4; index++) bytes[offset + index] = value.charCodeAt(index);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}

test("authenticated local TTS accepts only canonical bounded robot WAV", async () => {
  const bytes = wav();
  const requests = [];
  const port = new LocalTtsPort("http://127.0.0.1:8050", "t".repeat(32), async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(bytes, { headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.length) } });
  });
  const blob = await port.synthesize("Three statements. Go.");
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, bytes.length);
  assert.deepEqual(requests, [{ url: "http://127.0.0.1:8050/v1/tts", body: { text: "Three statements. Go." }, auth: `Bearer ${"t".repeat(32)}` }]);
  assert.throws(() => new LocalTtsPort("https://remote.example", "t".repeat(32)), TypeError);
  assert.throws(() => new LocalTtsPort("http://localhost:8050", "t".repeat(32)), TypeError);
  assert.throws(() => validateGameWav(bytes.subarray(0, bytes.length - 2)), TypeError);
});

test("malformed or oversized TTS response cannot reach robot upload", async () => {
  const bytes = wav();
  bytes[24] = 0; // Break sample-rate field.
  const port = new LocalTtsPort("http://127.0.0.1:8050", "t".repeat(32), async () =>
    new Response(bytes, { headers: { "Content-Type": "audio/wav", "Content-Length": String(bytes.length) } }));
  const events = [];
  const robot = { uploadAudio: async () => { events.push("upload"); return "id"; }, playUploadedAudio: async () => ({ started: true }), cancelAudio: () => true };
  await assert.rejects(new RobotSpeechOutput(robot, port).speak("hello"), /WAV/);
  assert.deepEqual(events, []);
  const oversize = new LocalTtsPort("http://127.0.0.1:8050", "t".repeat(32), async () =>
    new Response("no", { headers: { "Content-Type": "audio/wav", "Content-Length": "900000" } }));
  await assert.rejects(oversize.synthesize("hello"), /length/);
});

test("robot audio starts only after local synthesis and is cancelled on reset", async () => {
  const events = [];
  const tts = { synthesize: async (_text, signal) => { events.push("synthesize"); assert.equal(signal.aborted, false); return new Blob([wav()], { type: "audio/wav" }); } };
  const robot = {
    uploadAudio: async (blob) => { events.push("upload"); assert.equal(blob.type, "audio/wav"); return "audio-1"; },
    playUploadedAudio: async (id) => { events.push(`play:${id}`); return { started: true }; },
    cancelAudio: (id) => { events.push(`cancel:${id}`); return true; },
  };
  const output = new RobotSpeechOutput(robot, tts);
  await output.speak("Three statements. Go.");
  assert.deepEqual(events, ["synthesize", "upload", "play:audio-1"]);
  output.cancel();
  assert.equal(events.at(-1), "cancel:audio-1");
});

test("cancel during upload prevents stale playback even if upload resolves later", async () => {
  let release;
  const events = [];
  const tts = { synthesize: async () => new Blob([wav()], { type: "audio/wav" }) };
  const robot = {
    uploadAudio: () => { events.push("upload"); return new Promise((resolve) => { release = resolve; }); },
    playUploadedAudio: async () => { events.push("play"); return { started: true }; },
    cancelAudio: (id) => { events.push(`cancel:${id}`); return true; },
  };
  const output = new RobotSpeechOutput(robot, tts);
  const speaking = output.speak("hello");
  await Promise.resolve();
  assert.deepEqual(events, ["upload"]);
  output.cancel();
  release("late-id");
  await speaking;
  assert.deepEqual(events, ["upload", "cancel:late-id"]);
});

test("cancel during synthesis never uploads late audio", async () => {
  let release;
  const events = [];
  const tts = { synthesize: () => new Promise((resolve) => { release = resolve; }) };
  const robot = {
    uploadAudio: async () => { events.push("upload"); return "id"; },
    playUploadedAudio: async () => { events.push("play"); return { started: true }; },
    cancelAudio: () => true,
  };
  const output = new RobotSpeechOutput(robot, tts);
  const speaking = output.speak("hello");
  output.cancel();
  release(new Blob([wav()], { type: "audio/wav" }));
  await speaking;
  assert.deepEqual(events, []);
});
