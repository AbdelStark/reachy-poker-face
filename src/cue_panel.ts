import { liveSuspicion, type CueProbabilities, type CueWeights } from "./cues.js";

const CUES = [
  { key: "lie_now", label: "Invented-story cue" },
  { key: "implausible", label: "Implausibility cue" },
  { key: "hedged", label: "Hedging cue" },
  { key: "too_specific", label: "Over-detail cue" },
] as const;

export interface CueRow {
  key: keyof CueProbabilities;
  label: string;
  probability: number;
  effectiveWeight: number;
  contribution: number;
}

/** Show the actual composite terms; a cue is a model judgment, not evidence. */
export function cueBreakdown(cues: CueProbabilities, weights: CueWeights): CueRow[] {
  liveSuspicion(cues, weights); // Validate exactly as the game does.
  const total = CUES.reduce((sum, { key }) => sum + weights[key], 0);
  return CUES.map(({ key, label }) => {
    const effectiveWeight = weights[key] / total;
    return { key, label, probability: cues[key], effectiveWeight, contribution: cues[key] * effectiveWeight };
  });
}

const FINAL_CUES: Record<string, string> = {
  hedging: "hedging",
  implausibility: "implausibility",
  over_detail: "over-detail",
  vagueness: "vagueness",
  contradiction: "a possible contradiction",
  none: "no single cue",
};

export function finalCueLabel(value: string): string {
  const label = FINAL_CUES[value];
  if (!label) throw new TypeError("unknown final cue");
  return label;
}
