/** Authenticated loopback transport for word-timed robot-audio ASR. */

import type { WordTiming } from "./cues.js";

export interface AsrTranscript { text: string; words: WordTiming[] }
const MAX_PCM_BYTES = 16_000 * 15 * 4;

export function parseAsrTranscript(value: unknown, durationMs = 15_000): AsrTranscript {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid ASR result");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "text,words" || typeof record.text !== "string" || record.text.length > 400 || !Array.isArray(record.words) || record.words.length > 100) throw new TypeError("invalid ASR result");
  let previousStart = -1;
  const words: WordTiming[] = [];
  for (const value of record.words) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid ASR word");
    const word = value as Record<string, unknown>;
    if (Object.keys(word).sort().join(",") !== "endMs,startMs,word" || typeof word.word !== "string" || !word.word.trim() || word.word.length > 50 || typeof word.startMs !== "number" || typeof word.endMs !== "number" || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.startMs < 0 || word.startMs < previousStart || word.endMs < word.startMs || word.endMs > durationMs + 500) throw new TypeError("invalid ASR word timing");
    previousStart = word.startMs;
    words.push({ word: word.word, startMs: word.startMs, endMs: word.endMs });
  }
  if (record.text !== words.map((word) => word.word).join(" ")) throw new TypeError("ASR text and word timings disagree");
  return { text: record.text, words };
}

export class LocalAsrPort {
  private readonly endpoint: URL;
  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new TypeError("ASR URL must be numeric loopback HTTP with a port");
    if (token.length < 32) throw new TypeError("ASR token must be at least 32 characters");
    this.endpoint = new URL("/v1/asr", url);
  }
  async transcribe(pcm: Uint8Array, signal?: AbortSignal): Promise<AsrTranscript> {
    if (!(pcm instanceof Uint8Array) || pcm.length < 16_000 || pcm.length > MAX_PCM_BYTES || pcm.length % 4) throw new RangeError("invalid bounded 16 kHz PCM");
    const body = new Uint8Array(pcm.length);
    body.set(pcm);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await this.fetcher.call(globalThis, this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${this.token}` },
        body: body.buffer,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Local ASR returned HTTP ${response.status}`);
      return parseAsrTranscript(await response.json(), pcm.length * 1000 / (16_000 * 4));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      body.fill(0);
    }
  }
}
