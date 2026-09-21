import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import type { CueProbabilities, DeliveryAnalysis } from "./cues.js";
import type { Statement, StatementId } from "./round.js";

export const LIVE_BANK = "pokerface.live@0.1.0";
export const FINAL_BANK = "pokerface.final@0.1.0";

export interface CapturedStatement { id: StatementId; text: string; delivery: DeliveryAnalysis }
function clipped(text: string): string {
  const clean = text.trim();
  if (!clean || clean.length > 400) throw new TypeError("statement text must be 1..400 characters");
  return clean;
}
export function liveState(current: CapturedStatement, earlier: readonly CapturedStatement[]) {
  return {
    bank: LIVE_BANK,
    game: "two truths and a lie",
    statement: { id: current.id, text: clipped(current.text), delivery: current.delivery.delivery, length: current.delivery.length },
    earlier_statements: earlier.map((s) => ({ id: s.id, text: clipped(s.text) })),
  };
}
export const liveQuestions = {
  lie_now: noul("Within this game, does this statement seem more likely to be the invented one than a true personal fact? Judge only the text and delivery; do not infer real-world honesty."),
  implausible: noul("Does the statement itself describe an implausible event, rather than merely an unusual one?"),
  hedged: noul("Does the statement text contain explicit hedging, uncertainty, or self-correction?"),
  too_specific: noul("Does the statement add unnecessary detail that sounds rehearsed? Detail alone does not imply a lie."),
  generic: noul("Is the statement so generic it could apply to almost anyone?"),
};

export async function askLive(client: TypeSafeClient, current: CapturedStatement, earlier: readonly CapturedStatement[]): Promise<CueProbabilities> {
  const response = await client.systemOne({ state: liveState(current, earlier), questions: liveQuestions });
  const answers = response.answers;
  const cues = {
    lie_now: answers.lie_now.noul,
    implausible: answers.implausible.noul,
    hedged: answers.hedged.noul,
    too_specific: answers.too_specific.noul,
  };
  if (Object.values(cues).some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new TypeError("invalid Jev cue probability");
  return cues;
}

export function finalState(statements: readonly Statement[]) {
  if (statements.length !== 3 || statements.map((s) => s.id).join(",") !== "s1,s2,s3") throw new TypeError("final pick requires s1, s2, s3");
  return {
    bank: FINAL_BANK,
    game: "two truths and a lie",
    statements: statements.map((s) => ({ id: s.id, text: clipped(s.text), delivery: [...s.delivery] })),
  };
}
export const finalQuestions = {
  contradiction: noul("Do any two statements contradict each other about the same fact?"),
  the_lie: choice("Which of the three statements is most likely the invented one in this game? Choose one even if uncertain.", { s1: null, s2: null, s3: null }),
  top_cue: choice("Which single cue most influenced that pick? Choose none if no cue stands out.", { hedging: null, implausibility: null, over_detail: null, vagueness: null, contradiction: null, none: null }),
};
export interface FinalJudgment { choice: StatementId; confidence: number; topCue: string; contradiction: number; model: string }
export async function askFinal(client: TypeSafeClient, statements: readonly Statement[]): Promise<FinalJudgment> {
  const response = await client.systemOne({ state: finalState(statements), questions: finalQuestions });
  const { the_lie, top_cue, contradiction } = response.answers;
  if (!["s1", "s2", "s3"].includes(the_lie.choice) || !Number.isFinite(the_lie.confidence) || the_lie.confidence < 0 || the_lie.confidence > 1) throw new TypeError("invalid Jev final pick");
  return { choice: the_lie.choice, confidence: the_lie.confidence, topCue: top_cue.choice, contradiction: contradiction.noul, model: response.model };
}
