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

const FINAL_CUES: Record<string, { label: string; speech: string }> = {
  hedging: { label: "hedging", speech: "Jev flagged hedging in the wording." },
  implausibility: { label: "implausibility", speech: "Jev found the story a stretch." },
  over_detail: { label: "over-detail", speech: "Jev noticed extra detail." },
  vagueness: { label: "vagueness", speech: "Jev found the story vague." },
  contradiction: { label: "a possible contradiction", speech: "Jev flagged a possible contradiction." },
  none: { label: "no single cue", speech: "No single cue stood out." },
};

export function finalCueLabel(value: string): string {
  const cue = FINAL_CUES[value];
  if (!cue) throw new TypeError("unknown final cue");
  return cue.label;
}

/** Return only a fixed line; never put a model-supplied label into speech. */
export function finalCueSpeech(value: string): string | undefined {
  return Object.hasOwn(FINAL_CUES, value) ? FINAL_CUES[value]!.speech : undefined;
}
