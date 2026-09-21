import test from "node:test";
import assert from "node:assert/strict";
import { RobotStatementRecorder, pcm16k } from "../lib/robot_audio.js";
import { LocalAsrPort, parseAsrTranscript } from "../lib/asr.js";
import { analyzeDelivery } from "../lib/cues.js";

test("robot PCM is bounded, finite, mono, and resampled to 16 kHz little-endian", () => {
  const chunk = new Float32Array(24_000).fill(0.25); // 0.5 s at 48 kHz
  const pcm = pcm16k([chunk], 48_000);
  assert.equal(pcm.length, 8_000 * 4);
  const view = new DataView(pcm.buffer);
  assert.ok(Math.abs(view.getFloat32(0, true) - 0.25) < 1e-6);
  assert.ok(Math.abs(view.getFloat32(pcm.length - 4, true) - 0.25) < 1e-6);
  assert.throws(() => pcm16k([new Float32Array(20)], 48_000), RangeError);
  assert.throws(() => pcm16k([new Float32Array([Number.NaN]), chunk], 48_000), RangeError);
  assert.throws(() => pcm16k([new Float32Array(48_000 * 16)], 48_000), RangeError);
});

test("loopback ASR response feeds real word timing to delivery buckets", async () => {
  const result = { text: "I um paused here", words: [
    { word: "I", startMs: 0, endMs: 100 },
    { word: "um", startMs: 180, endMs: 260 },
    { word: "paused", startMs: 800, endMs: 1100 },
    { word: "here", startMs: 1200, endMs: 1450 },
  ] };
  const fetcher = function (url, init) {
    assert.equal(this, globalThis);
    assert.equal(String(url), "http://127.0.0.1:8049/v1/asr");
    assert.equal(init.headers.Authorization, `Bearer ${"t".repeat(32)}`);
    assert.equal(init.headers["Content-Type"], "application/octet-stream");
    assert.equal(init.body.byteLength, 96_000);
    return Promise.resolve({ ok: true, json: async () => result });
  };
  const port = new LocalAsrPort("http://127.0.0.1:8049", "t".repeat(32), fetcher);
  const transcript = await port.transcribe(new Uint8Array(96_000));
  assert.equal(transcript.text, result.text);
  assert.equal(analyzeDelivery(transcript.words).pauseCount, 1);
  assert.throws(() => new LocalAsrPort("https://example.com", "t".repeat(32)), TypeError);
  assert.throws(() => new LocalAsrPort("http://localhost:8049", "t".repeat(32)), TypeError);
});

test("malformed timing and text mismatch are not accepted as delivery evidence", () => {
  assert.throws(() => parseAsrTranscript({ text: "different", words: [{ word: "hello", startMs: 0, endMs: 50 }] }), TypeError);
  assert.throws(() => parseAsrTranscript({ text: "hello", words: [{ word: "hello", startMs: 500, endMs: 100 }] }), TypeError);
  assert.throws(() => parseAsrTranscript({ text: "hello", words: [{ word: "hello", startMs: 0, endMs: 16_000 }] }), TypeError);
});

test("revoking consent during worklet startup cannot activate capture later", async () => {
  const originalWindow = globalThis.window;
  let release;
  let closed = 0;
  class FakeContext {
    audioWorklet = { addModule: () => new Promise((resolve) => { release = resolve; }) };
    async close() { closed++; }
  }
  globalThis.window = { AudioContext: FakeContext };
  try {
    const recorder = new RobotStatementRecorder({ getAudioTracks: () => [{ readyState: "live" }] }, () => {});
    const starting = recorder.start();
    await recorder.discard();
    release();
    await assert.rejects(starting, /cancelled/);
    assert.equal(closed, 1);
    await assert.rejects(recorder.start(), /cannot be restarted/);
  } finally {
    globalThis.window = originalWindow;
  }
});
