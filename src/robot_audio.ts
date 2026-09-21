/** Explicit, bounded robot-stream capture for local word-timed ASR. */

const OUTPUT_RATE = 16_000;
const MIN_SECONDS = 0.25;
const MAX_SECONDS = 15;

export function pcm16k(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) throw new RangeError("invalid capture rate");
  let count = 0;
  for (const chunk of chunks) {
    count += chunk.length;
    if (count > sampleRate * MAX_SECONDS) throw new RangeError("recording exceeds 15 seconds");
    for (const sample of chunk) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new RangeError("invalid audio sample");
    }
  }
  if (count < sampleRate * MIN_SECONDS) throw new RangeError("record at least a quarter second");
  const outputCount = Math.floor(count * OUTPUT_RATE / sampleRate);
  const output = new Uint8Array(outputCount * 4);
  const view = new DataView(output.buffer);
  const merged = new Float32Array(count);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  for (let index = 0; index < outputCount; index++) {
    const at = index * sampleRate / OUTPUT_RATE;
    const left = Math.floor(at);
    const fraction = at - left;
    const sample = merged[left]! * (1 - fraction) + merged[Math.min(left + 1, count - 1)]! * fraction;
    view.setFloat32(index * 4, sample, true);
  }
  merged.fill(0);
  return output;
}

export class RobotStatementRecorder {
  private context: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private node: AudioWorkletNode | undefined;
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private overflow = false;
  private used = false;
  private cancelled = false;

  constructor(private readonly stream: MediaStream, private readonly onLimit: () => void) {}

  async start(): Promise<void> {
    if (this.used || this.cancelled) throw new Error("capture instance cannot be restarted");
    this.used = true;
    const track = this.stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
    if (!track) throw new Error("robot audio track unavailable");
    const browser = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Context = browser.AudioContext ?? browser.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is unavailable");
    const context = new Context();
    try {
      await context.audioWorklet.addModule("/robot-voice-worklet.js");
      if (this.cancelled) throw new Error("capture was cancelled");
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const node = new AudioWorkletNode(context, "robot-voice-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.active || !(event.data instanceof Float32Array)) return;
        if (this.overflow) return;
        this.sampleCount += event.data.length;
        if (this.sampleCount > context.sampleRate * MAX_SECONDS) {
          this.overflow = true;
          this.onLimit();
          return;
        }
        this.chunks.push(event.data);
      };
      source.connect(node);
      node.connect(context.destination); // Processor writes no output: always silent.
      this.context = context;
      this.source = source;
      this.node = node;
      this.active = true;
      await context.resume();
      if (this.cancelled) throw new Error("capture was cancelled");
      if (context.state !== "running") throw new Error("robot audio capture did not start");
      this.timer = setTimeout(this.onLimit, MAX_SECONDS * 1000 - 100);
    } catch (error) {
      await this.discard();
      await context.close().catch(() => {});
      throw error;
    }
  }

  private async close(): Promise<Float32Array[]> {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) { this.node.port.onmessage = null; this.node.port.close(); }
    const context = this.context;
    this.context = undefined;
    this.source = undefined;
    this.node = undefined;
    if (context) await context.close().catch(() => {});
    const chunks = this.chunks;
    this.chunks = [];
    this.sampleCount = 0;
    return chunks;
  }

  async stop(): Promise<Uint8Array> {
    const rate = this.context?.sampleRate;
    if (!rate) throw new Error("capture is not active");
    const chunks = await this.close();
    try {
      if (this.overflow) throw new RangeError("recording exceeded 15 seconds");
      return pcm16k(chunks, rate);
    } finally {
      chunks.forEach((chunk) => chunk.fill(0));
      this.overflow = false;
    }
  }

  async discard(): Promise<void> {
    this.cancelled = true;
    const chunks = await this.close();
    chunks.forEach((chunk) => chunk.fill(0));
    this.overflow = false;
    // The host owns the audio track. Never stop it here.
  }
}
