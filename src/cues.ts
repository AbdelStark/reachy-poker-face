export interface WordTiming { word: string; startMs: number; endMs: number }
export type Delivery = "steady" | "hesitant" | "trailing off" | "self-corrected" | "fast, no pauses";
export interface DeliveryAnalysis { delivery: Delivery[]; length: "short" | "medium" | "long"; pauseCount: number; fillerCount: number; restartCount: number; wordsPerSecond: number }
export function analyzeDelivery(words: readonly WordTiming[]): DeliveryAnalysis {
  if (!words.length) throw new TypeError("at least one word is required");
  const ordered = [...words].sort((a, b) => a.startMs - b.startMs);
  if (ordered.some((w) => !Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || w.startMs < 0 || w.endMs < w.startMs)) throw new RangeError("invalid word timings");
  let pauseCount = 0;
  let restartCount = 0;
  let fillerCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i]!;
    const normalized = current.word.toLowerCase().replace(/[^a-z]/g, "");
    if (["um", "uh", "erm"].includes(normalized)) fillerCount++;
    if (i > 0) {
      const previous = ordered[i - 1]!;
      if (current.startMs - previous.endMs > 400) pauseCount++;
      if (normalized.length > 2 && normalized === previous.word.toLowerCase().replace(/[^a-z]/g, "")) restartCount++;
    }
  }
  const durationS = Math.max(0.001, (ordered.at(-1)!.endMs - ordered[0]!.startMs) / 1000);
  const wordsPerSecond = ordered.length / durationS;
  const delivery: Delivery[] = [];
  if (pauseCount >= 3) delivery.push("trailing off");
  else if (pauseCount > 0 || fillerCount >= 2) delivery.push("hesitant");
  if (restartCount > 0) delivery.push("self-corrected");
  if (!pauseCount && wordsPerSecond > 3.5) delivery.push("fast, no pauses");
  if (!delivery.length) delivery.push("steady");
  return { delivery, length: ordered.length < 6 ? "short" : ordered.length > 18 ? "long" : "medium", pauseCount, fillerCount, restartCount, wordsPerSecond };
}
export interface CueProbabilities { lie_now: number; implausible: number; hedged: number; too_specific: number }
export interface CueWeights { lie_now: number; implausible: number; hedged: number; too_specific: number }
export const DEFAULT_WEIGHTS: CueWeights = { lie_now: 0.5, implausible: 0.2, hedged: 0.2, too_specific: 0.1 };
export interface CommitThresholds { hedge: number; confident: number }
export const DEFAULT_THRESHOLDS: CommitThresholds = { hedge: 0.4, confident: 0.7 };
export function liveSuspicion(cues: CueProbabilities, weights: CueWeights = DEFAULT_WEIGHTS): number {
  let numerator = 0;
  let denominator = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof CueWeights)[]) {
    const p = cues[key];
    const w = weights[key];
    if (!Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(w) || w < 0) throw new RangeError("invalid cue or weight");
    numerator += p * w;
    denominator += w;
  }
  if (denominator <= 0) throw new RangeError("weights must have positive sum");
  return numerator / denominator;
}
export function commitStyle(confidence: number, thresholds: CommitThresholds = DEFAULT_THRESHOLDS): "confident" | "hedge" | "coin_flip" {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError("invalid confidence");
  if (!Number.isFinite(thresholds.hedge) || !Number.isFinite(thresholds.confident) || thresholds.hedge < 0 || thresholds.confident > 1 || thresholds.hedge >= thresholds.confident) throw new RangeError("invalid commit thresholds");
  return confidence >= thresholds.confident ? "confident" : confidence >= thresholds.hedge ? "hedge" : "coin_flip";
}
