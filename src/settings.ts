import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type CommitThresholds, type CueWeights } from "./cues.js";

export interface GameSettings { weights: CueWeights; thresholds: CommitThresholds }
export const SETTINGS_KEY = "reachy-poker-face.settings.v1";
export const DEFAULT_SETTINGS: GameSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

/** Validate locally stored settings before they can influence a round. */
export function gameSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") throw new TypeError("invalid settings");
  const source = value as { weights?: Record<string, unknown>; thresholds?: Record<string, unknown> };
  const weights = {} as CueWeights;
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof CueWeights)[]) {
    const weight = source.weights?.[key];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError(`invalid ${key} weight`);
    weights[key] = weight;
  }
  if (Object.values(weights).reduce((sum, weight) => sum + weight, 0) <= 0) throw new RangeError("at least one cue weight must be positive");
  const hedge = source.thresholds?.hedge;
  const confident = source.thresholds?.confident;
  if (typeof hedge !== "number" || typeof confident !== "number" || !Number.isFinite(hedge) || !Number.isFinite(confident) || hedge < 0 || confident > 1 || hedge >= confident) throw new RangeError("hedge must be below confident");
  return { weights, thresholds: { hedge, confident } };
}

export function parseSettings(serialized: string | null): GameSettings {
  if (!serialized) return gameSettings(DEFAULT_SETTINGS);
  try { return gameSettings(JSON.parse(serialized)); }
  catch { return gameSettings(DEFAULT_SETTINGS); }
}
