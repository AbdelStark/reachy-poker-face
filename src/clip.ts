/** Browser-local, consent-gated video capture. Never records microphone or robot audio. */
export interface ClipFrame { statementNumber: number; probability: number | null; verdict: string }
export interface ClipFile { blob: Blob; extension: "mp4" | "webm"; filename: string }

const MAX_DURATION_MS = 30_000;
const MAX_CLIP_BYTES = 16_000_000;
const WIDTH = 1280;
const HEIGHT = 720;

function mediaTypes(): Array<{ mimeType: string; extension: ClipFile["extension"] }> {
  const formats: Array<{ mimeType: string; extension: ClipFile["extension"] }> = [];
  for (const mimeType of ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(mimeType)) formats.push({ mimeType, extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" });
  }
  return formats;
}

export class ClipRecorder {
  private readonly recorder: MediaRecorder;
  private readonly stream: MediaStream;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly chunks: Blob[] = [];
  private bytes = 0;
  private readonly extension: ClipFile["extension"];
  private readonly completion: Promise<ClipFile | null>;
  private resolveCompletion!: (file: ClipFile | null) => void;
  private animationFrame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;
  private discarded = false;
  private completed = false;

  constructor(private readonly video: HTMLVideoElement, private readonly frame: () => ClipFrame, consent: boolean) {
    if (!consent) throw new Error("Ask everyone visible for consent before recording.");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) throw new Error("Robot camera video is not ready yet.");
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) throw new Error("This browser cannot record a local clip.");
    const formats = mediaTypes();
    if (!formats.length) throw new Error("This browser cannot record MP4 or WebM video.");
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not initialize clip canvas.");
    this.context = context;
    this.stream = this.canvas.captureStream(30);
    try {
      let selected: { recorder: MediaRecorder; extension: ClipFile["extension"] } | undefined;
      for (const format of formats) {
        try {
          selected = {
            recorder: new MediaRecorder(this.stream, { mimeType: format.mimeType, videoBitsPerSecond: 2_500_000 }),
            extension: format.extension,
          };
          break;
        } catch { /* A browser can advertise a codec but reject its recorder configuration. */ }
      }
      if (!selected) throw new Error("This browser cannot initialize a local video recorder.");
      this.recorder = selected.recorder;
      this.extension = selected.extension;
      this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
      this.recorder.ondataavailable = (event) => {
        if (!event.data.size || this.discarded) return;
        if (this.bytes + event.data.size > MAX_CLIP_BYTES) {
          this.discarded = true;
          void this.finish();
          return;
        }
        this.bytes += event.data.size;
        this.chunks.push(event.data);
      };
      this.recorder.onstop = () => this.complete();
      this.recorder.onerror = () => { this.discarded = true; this.complete(); };
      this.draw();
      this.recorder.start(500);
      this.timer = setTimeout(() => { void this.finish(); }, MAX_DURATION_MS);
    } catch (error) {
      this.stream.getTracks().forEach((track) => track.stop());
      cancelAnimationFrame(this.animationFrame);
      throw error;
    }
  }

  private draw = () => {
    if (this.finished) return;
    const ctx = this.context;
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.videoWidth && this.video.videoHeight) {
      const scale = Math.max(WIDTH / this.video.videoWidth, HEIGHT / this.video.videoHeight);
      const sourceWidth = WIDTH / scale;
      const sourceHeight = HEIGHT / scale;
      const x = (this.video.videoWidth - sourceWidth) / 2;
      const y = (this.video.videoHeight - sourceHeight) / 2;
      ctx.drawImage(this.video, x, y, sourceWidth, sourceHeight, 0, 0, WIDTH, HEIGHT);
    } else {
      ctx.fillStyle = "#0c1019";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    const data = this.frame();
    const probability = data.probability === null || !Number.isFinite(data.probability) ? null : Math.max(0, Math.min(1, data.probability));
    ctx.fillStyle = "rgba(12, 16, 25, 0.84)";
    ctx.fillRect(0, HEIGHT - 150, WIDTH, 150);
    ctx.fillStyle = "#f4c95d";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText("POKER FACE · REACHY MINI × JEV", 36, HEIGHT - 110);
    ctx.fillStyle = "#eef1f6";
    ctx.font = "bold 31px system-ui, sans-serif";
    ctx.fillText(`Statement ${Math.max(1, Math.min(3, data.statementNumber))} / 3`, 36, HEIGHT - 60);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText(data.verdict.slice(0, 65), 300, HEIGHT - 60, 930);
    ctx.fillStyle = "#333c54";
    ctx.fillRect(36, HEIGHT - 28, WIDTH - 72, 12);
    if (probability !== null) {
      ctx.fillStyle = "#f4c95d";
      ctx.fillRect(36, HEIGHT - 28, (WIDTH - 72) * probability, 12);
    }
    this.animationFrame = requestAnimationFrame(this.draw);
  };

  private complete() {
    if (this.completed) return;
    this.completed = true;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.animationFrame);
    this.stream.getTracks().forEach((track) => track.stop());
    const blob = this.discarded ? null : new Blob(this.chunks, { type: this.recorder.mimeType });
    this.chunks.length = 0;
    this.bytes = 0;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    this.resolveCompletion(blob?.size ? { blob, extension: this.extension, filename: `pokerface-${stamp}.${this.extension}` } : null);
  }

  finish(): Promise<ClipFile | null> {
    if (!this.finished) {
      this.finished = true;
      clearTimeout(this.timer);
      cancelAnimationFrame(this.animationFrame);
      if (this.recorder.state === "inactive") this.complete();
      else {
        try { this.recorder.stop(); }
        catch { this.discarded = true; this.complete(); }
      }
    }
    return this.completion;
  }

  discard(): Promise<ClipFile | null> {
    this.discarded = true;
    return this.finish();
  }
}
