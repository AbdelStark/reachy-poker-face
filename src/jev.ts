import type { EntryType, Questions } from "@typesafe-ai/sdk";
import type { CueProbabilities, DeliveryAnalysis } from "./cues.js";
import type { Statement, StatementId } from "./round.js";

export const LIVE_BANK = "pokerface.live@0.1.0";
export const FINAL_BANK = "pokerface.final@0.1.0";

export interface JevAnswer { type: "noul" | "choice"; noul?: number; choice?: string; confidence?: number }
export interface JevReply { model: string; answers: Record<string, JevAnswer> }
export interface JevPort { systemOne(request: { state: EntryType; questions: Questions }): Promise<JevReply> }
function answer(reply: JevReply, key: string, type: JevAnswer["type"]): JevAnswer {
  const value = reply.answers[key];
  if (!value || value.type !== type) throw new TypeError(`wrong or missing Jev answer: ${key}`);
  return value;
}
function probability(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError("invalid Jev probability");
  return value;
}

export interface CapturedStatement { id: StatementId; text: string; delivery?: DeliveryAnalysis }
function clipped(text: string): string {
  const clean = text.trim();
  if (!clean || clean.length > 400) throw new TypeError("statement text must be 1..400 characters");
  return clean;
}
export function liveState(current: CapturedStatement, earlier: readonly CapturedStatement[]) {
  return {
    bank: LIVE_BANK,
    game: "two truths and a lie",
    statement: {
      id: current.id,
      text: clipped(current.text),
      ...(current.delivery ? { delivery: current.delivery.delivery } : {}),
      length: current.delivery?.length ?? (current.text.trim().split(/\s+/).length < 6 ? "short" : current.text.trim().split(/\s+/).length > 18 ? "long" : "medium"),
    },
    earlier_statements: earlier.map((s) => ({ id: s.id, text: clipped(s.text) })),
  };
}
export const liveQuestions = {
  lie_now: { type: "noul", instructions: "Within this game, does this statement seem more likely to be the invented one than a true personal fact? Judge only the text and delivery; do not infer real-world honesty." },
  implausible: { type: "noul", instructions: "Does the statement itself describe an implausible event, rather than merely an unusual one?" },
  hedged: { type: "noul", instructions: "Does the statement text contain explicit hedging, uncertainty, or self-correction?" },
  too_specific: { type: "noul", instructions: "Does the statement add unnecessary detail that sounds rehearsed? Detail alone does not imply a lie." },
  generic: { type: "noul", instructions: "Is the statement so generic it could apply to almost anyone?" },
} as const;

export async function askLive(client: JevPort, current: CapturedStatement, earlier: readonly CapturedStatement[]): Promise<CueProbabilities> {
  const response = await client.systemOne({ state: liveState(current, earlier), questions: liveQuestions });
  const cues = {
    lie_now: probability(answer(response, "lie_now", "noul").noul),
    implausible: probability(answer(response, "implausible", "noul").noul),
    hedged: probability(answer(response, "hedged", "noul").noul),
    too_specific: probability(answer(response, "too_specific", "noul").noul),
  };
  return cues;
}

export function finalState(statements: readonly Statement[]) {
  if (statements.length !== 3 || statements.map((s) => s.id).join(",") !== "s1,s2,s3") throw new TypeError("final pick requires s1, s2, s3");
  return {
    bank: FINAL_BANK,
    game: "two truths and a lie",
    statements: statements.map((s) => ({ id: s.id, text: clipped(s.text), ...(s.delivery.length ? { delivery: [...s.delivery] } : {}) })),
  };
}
export const finalQuestions = {
  contradiction: { type: "noul", instructions: "Do any two statements contradict each other about the same fact?" },
  the_lie: { type: "choice", instructions: "Which of the three statements is most likely the invented one in this game? Choose one even if uncertain.", criteria: { s1: null, s2: null, s3: null } },
  top_cue: { type: "choice", instructions: "Which single cue most influenced that pick? Choose none if no cue stands out.", criteria: { hedging: null, implausibility: null, over_detail: null, vagueness: null, contradiction: null, none: null } },
} as const;
export interface FinalJudgment { choice: StatementId; confidence: number; topCue: string; contradiction: number; model: string }
export async function askFinal(client: JevPort, statements: readonly Statement[]): Promise<FinalJudgment> {
  const response = await client.systemOne({ state: finalState(statements), questions: finalQuestions });
  const theLie = answer(response, "the_lie", "choice");
  const topCue = answer(response, "top_cue", "choice");
  const contradiction = answer(response, "contradiction", "noul");
  if (!theLie.choice || !["s1", "s2", "s3"].includes(theLie.choice) || !topCue.choice || !["hedging", "implausibility", "over_detail", "vagueness", "contradiction", "none"].includes(topCue.choice)) throw new TypeError("invalid Jev final choice");
  return { choice: theLie.choice as StatementId, confidence: probability(theLie.confidence), topCue: topCue.choice, contradiction: probability(contradiction.noul), model: response.model };
}
