/** Fixed game lines only: no statement text or free-form model output reaches TTS. */

import type { FinalJudgment } from "./jev.js";
import type { Pick } from "./round.js";
import { finalCueSpeech } from "./cue_panel.js";
const CHOICES = new Set<string>(["s1", "s2", "s3"]);
const STYLES = new Set<string>(["confident", "hedge", "coin_flip"]);
const SOURCES = new Set<string>(["jev", "fallback"]);

/** Make the cue audible without presenting a model judgment as lie evidence. */
export function commitSpeech(pick: Pick, final?: FinalJudgment): string {
  if (!CHOICES.has(pick.choice) || !STYLES.has(pick.style) || !SOURCES.has(pick.source)) throw new TypeError("invalid game pick");
  const number = pick.choice.slice(1);
  if (pick.source === "fallback") return `Jev is unavailable. Random pick: number ${number}.`;
  const opening = pick.style === "confident"
    ? `Number ${number}. That's my pick.`
    : pick.style === "hedge"
      ? `I'd say number ${number}, but you're good.`
      : `Honestly? Coin flip. Number ${number}.`;
  const cue = final?.choice === pick.choice && final.confidence === pick.confidence
    ? finalCueSpeech(final.topCue)
    : undefined;
  return `${opening} ${cue ?? "No verified cue to share."} It's a game guess, not proof.`;
}
