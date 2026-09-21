/** Session-only round evidence. Export is text-free unless consented per round. */

import type { CueProbabilities, CueWeights, CommitThresholds } from "./cues.js";
import type { FinalJudgment } from "./jev.js";
import type { RoundSnapshot, StatementId } from "./round.js";

export const TRACE_SCHEMA = "pokerface.round@1";
export interface LiveEvidence { id: StatementId; cues: CueProbabilities; weights: CueWeights }
export interface TraceStatement extends LiveEvidence { pLie: number; delivery: readonly string[]; text?: string }
export interface RoundTrace {
  schema: typeof TRACE_SCHEMA;
  statements: readonly TraceStatement[];
  pick: {
    source: "jev" | "fallback";
    choice: StatementId;
    confidence: number;
    style: "confident" | "hedge" | "coin_flip";
    model?: string;
    modelCommitStyle?: FinalJudgment["modelCommitStyle"];
    styleDisagrees?: boolean;
    topCue?: string;
    contradiction?: number;
    thresholds?: CommitThresholds;
  };
  actualLie: StatementId;
  correct: boolean;
}

export class SessionTrace {
  private records: RoundTrace[] = [];

  get count(): number { return this.records.length; }

  add(
    snapshot: RoundSnapshot,
    live: readonly LiveEvidence[],
    final?: FinalJudgment,
    thresholds?: CommitThresholds,
    keepText = false,
  ): RoundTrace {
    if (snapshot.phase !== "score" || !snapshot.pick || !snapshot.actualLie || snapshot.statements.length !== 3 || live.length !== 3) {
      throw new TypeError("trace requires a revealed three-statement round");
    }
    if ((snapshot.pick.source === "jev") !== Boolean(final) || (snapshot.pick.source === "jev") !== Boolean(thresholds)) {
      throw new TypeError("final judgment provenance does not match pick");
    }
    if (final && (final.choice !== snapshot.pick.choice || final.confidence !== snapshot.pick.confidence)) {
      throw new TypeError("final judgment does not match recorded pick");
    }
    const statements = snapshot.statements.map((statement, index) => {
      const evidence = live[index];
      if (!evidence || evidence.id !== statement.id) throw new TypeError("live evidence does not match round");
      return {
        id: statement.id,
        pLie: statement.pLie,
        delivery: [...statement.delivery],
        cues: { ...evidence.cues },
        weights: { ...evidence.weights },
        ...(keepText ? { text: statement.text } : {}),
      };
    });
    const pick = snapshot.pick;
    const record: RoundTrace = {
      schema: TRACE_SCHEMA,
      statements,
      pick: {
        source: pick.source,
        choice: pick.choice,
        confidence: pick.confidence,
        style: pick.style,
        ...(final ? {
          model: final.model,
          modelCommitStyle: final.modelCommitStyle,
          styleDisagrees: final.modelCommitStyle !== pick.style,
          topCue: final.topCue,
          contradiction: final.contradiction,
        } : {}),
        ...(thresholds ? { thresholds: { ...thresholds } } : {}),
      },
      actualLie: snapshot.actualLie,
      correct: pick.choice === snapshot.actualLie,
    };
    this.records = [...this.records, record].slice(-100);
    return record;
  }

  toJSONL(): string { return this.records.map((record) => JSON.stringify(record)).join("\n") + (this.records.length ? "\n" : ""); }

  clear(): void { this.records = []; }
}
