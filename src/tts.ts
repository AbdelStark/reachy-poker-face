/** Optional local TTS transport and owned Reachy Mini speaker output. */

const MAX_WAV_BYTES = 44 + 16_000 * 20 * 2;

export function validateGameWav(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.length <= 44 || bytes.length > MAX_WAV_BYTES) throw new TypeError("invalid bounded WAV");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (word(0) !== "RIFF" || view.getUint32(4, true) !== bytes.length - 8 || word(8) !== "WAVE" || word(12) !== "fmt " || view.getUint32(16, true) !== 16) throw new TypeError("invalid WAV header");
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16_000 || view.getUint32(28, true) !== 32_000 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16) throw new TypeError("unsupported WAV format");
  if (word(36) !== "data" || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new TypeError("invalid WAV frames");
}

export class LocalTtsPort {
  private readonly endpoint: URL;

  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new TypeError("TTS URL must be numeric loopback HTTP with a port");
    if (!/^[\x20-\x7e]+$/.test(token)) throw new TypeError("invalid TTS token");
    if (token.length < 32) throw new TypeError("TTS token must be at least 32 characters");
    this.endpoint = new URL("/v1/tts", url);
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Blob> {
    if (typeof text !== "string" || !text.trim() || text.length > 240 || text.trim().split(/\s+/).length > 55 || /[\x00-\x1f\x7f]/.test(text)) throw new TypeError("invalid game speech text");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await this.fetcher.call(globalThis, this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok || response.headers.get("Content-Type") !== "audio/wav") throw new Error(`Local TTS unavailable (HTTP ${response.status})`);
      const length = Number(response.headers.get("Content-Length"));
      if (!Number.isSafeInteger(length) || length <= 44 || length > MAX_WAV_BYTES) throw new TypeError("invalid TTS response length");
      if (!response.body) throw new TypeError("TTS response has no body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_WAV_BYTES) { await reader.cancel(); throw new TypeError("TTS response exceeds cap"); }
        chunks.push(value);
      }
      if (total !== length) throw new TypeError("TTS response length mismatch");
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      validateGameWav(bytes);
      return new Blob([bytes], { type: "audio/wav" });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export interface RobotAudioPort {
  uploadAudio(blob: Blob, options?: { description?: string }): Promise<string>;
  playUploadedAudio(uploadId: string, options?: { timeoutMs?: number }): Promise<{ started: true }>;
  cancelAudio(uploadId?: string | null): boolean;
}

export class RobotSpeechOutput {
  private generation = 0;
  private controller: AbortController | undefined;
  private uploadId: string | undefined;

  constructor(private readonly robot: RobotAudioPort, private readonly tts: LocalTtsPort) {}

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    if (this.uploadId) {
      try { this.robot.cancelAudio(this.uploadId); }
      catch { /* A disconnected SDK must not prevent local cleanup. */ }
    }
    this.uploadId = undefined;
  }

  async speak(text: string): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const wav = await this.tts.synthesize(text, controller.signal);
      if (generation !== this.generation) return;
      const id = await this.robot.uploadAudio(wav, { description: "poker-face-game-line" });
      if (generation !== this.generation) { this.robot.cancelAudio(id); return; }
      this.uploadId = id;
      await this.robot.playUploadedAudio(id, { timeoutMs: 8_000 });
      if (generation !== this.generation) this.robot.cancelAudio(id);
    } catch (error) {
      if (generation === this.generation) { this.cancel(); throw error; }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
}
