/** Detect a deliberate physical antenna displacement while both antennas are commanded neutral. */
export class AntennaTap {
  private highFrames = 0;
  private lastTapMs = -Infinity;
  private readonly thresholdRad: number;
  private readonly cooldownMs: number;
  constructor(thresholdRad = 0.3, cooldownMs = 850) {
    if (!Number.isFinite(thresholdRad) || thresholdRad <= 0 || !Number.isFinite(cooldownMs) || cooldownMs < 0) throw new RangeError("invalid antenna detector settings");
    this.thresholdRad = thresholdRad;
    this.cooldownMs = cooldownMs;
  }
  observe(current: readonly number[] | undefined, nowMs: number, enabled: boolean): "right" | "left" | null {
    if (!enabled || !current || current.length !== 2 || current.some((angle) => !Number.isFinite(angle))) {
      this.highFrames = 0;
      return null;
    }
    const right = Math.abs(current[0]!) > this.thresholdRad;
    const left = Math.abs(current[1]!) > this.thresholdRad;
    if (!right && !left) { this.highFrames = 0; return null; }
    this.highFrames++;
    if (this.highFrames < 2 || nowMs - this.lastTapMs < this.cooldownMs) return null;
    this.highFrames = 0;
    this.lastTapMs = nowMs;
    return right ? "right" : "left";
  }
}
