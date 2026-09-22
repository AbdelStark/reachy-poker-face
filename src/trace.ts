/** Session-only round evidence. Export is text-free unless consented per round. */

import { DEFAULT_WEIGHTS, commitStyle, liveSuspicion, validatedDelivery, type CueProbabilities, type CueWeights, type CommitThresholds, type Delivery } from "./cues.js";
import type { FinalJudgment } from "./jev.js";
import type { RoundSnapshot, StatementId } from "./round.js";

export const TRACE_SCHEMA = "pokerface.round@1";
const CUE_KEYS = Object.keys(DEFAULT_WEIGHTS);
const STATEMENT_IDS = ["s1", "s2", "s3"] as const;
const STYLES = ["confident", "hedge", "coin_flip"] as const;
const TOP_CUES = ["hedging", "implausibility", "over_detail", "vagueness", "contradiction", "none"] as const;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+#-]{0,79}$/;
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function probability(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
export interface LiveEvidence { id: StatementId; cues: CueProbabilities; weights: CueWeights }
export interface TraceStatement extends LiveEvidence { pLie: number; delivery: readonly Delivery[]; text?: string }
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
    if (typeof keepText !== "boolean") throw new TypeError("keepText must be boolean");
    if (snapshot.phase !== "score" || !snapshot.pick || !snapshot.actualLie || snapshot.statements.length !== 3 || live.length !== 3) {
      throw new TypeError("trace requires a revealed three-statement round");
    }
    const pick = snapshot.pick;
    if (snapshot.statements.some((statement, index) => statement.id !== STATEMENT_IDS[index])
      || !STATEMENT_IDS.includes(pick.choice) || !STATEMENT_IDS.includes(snapshot.actualLie)
      || !STYLES.includes(pick.style) || !probability(pick.confidence)
      || snapshot.correct !== (pick.choice === snapshot.actualLie)) {
      throw new TypeError("invalid round trace provenance");
    }
    if (pick.source === "fixture") throw new TypeError("offline fixture rounds are not calibration evidence");
    if (pick.source !== "jev" && pick.source !== "fallback") throw new TypeError("invalid pick source");
    if ((pick.source === "jev") !== Boolean(final) || (pick.source === "jev") !== Boolean(thresholds)) {
      throw new TypeError("final judgment provenance does not match pick");
    }
    if (final && (final.choice !== pick.choice || final.confidence !== pick.confidence)) {
      throw new TypeError("final judgment does not match recorded pick");
    }
    if (final && (typeof final.model !== "string" || !MODEL_ID.test(final.model) || !STYLES.includes(final.modelCommitStyle)
      || !TOP_CUES.includes(final.topCue as typeof TOP_CUES[number]) || !probability(final.contradiction))) {
      throw new TypeError("invalid final judgment provenance");
    }
    if (thresholds) {
      if (!exactKeys(thresholds, ["hedge", "confident"])) throw new TypeError("invalid trace thresholds");
      try {
        if (commitStyle(pick.confidence, thresholds) !== pick.style) throw new TypeError("inconsistent trace style");
      } catch (error) {
        if (error instanceof RangeError) throw new TypeError("invalid trace thresholds", { cause: error });
        throw error;
      }
    } else if (pick.confidence !== 0 || pick.style !== "coin_flip") throw new TypeError("invalid fallback pick");
    const statements = snapshot.statements.map((statement, index) => {
      const evidence = live[index];
      if (!evidence || evidence.id !== statement.id) throw new TypeError("live evidence does not match round");
      if (!exactKeys(evidence.cues, CUE_KEYS) || !exactKeys(evidence.weights, CUE_KEYS)) throw new TypeError("invalid cue evidence shape");
      if (!probability(statement.pLie) || Object.values(evidence.weights).some((weight) => !probability(weight))) {
        throw new TypeError("invalid trace probabilities");
      }
      if (keepText && (typeof statement.text !== "string" || !statement.text.trim() || statement.text.length > 400)) {
        throw new TypeError("invalid consented statement text");
      }
      if (Math.abs(liveSuspicion(evidence.cues, evidence.weights) - statement.pLie) > 1e-9) {
        throw new TypeError("live evidence does not match statement composite");
      }
      return {
        id: statement.id,
        pLie: statement.pLie,
        delivery: validatedDelivery(statement.delivery),
        cues: { lie_now: evidence.cues.lie_now, implausible: evidence.cues.implausible, hedged: evidence.cues.hedged, too_specific: evidence.cues.too_specific },
        weights: { lie_now: evidence.weights.lie_now, implausible: evidence.weights.implausible, hedged: evidence.weights.hedged, too_specific: evidence.weights.too_specific },
        ...(keepText ? { text: statement.text } : {}),
      };
    });
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
    // The returned record is caller-owned; it must not mutate stored evidence
    // or add unconsented text to a later JSONL export.
    this.records = [...this.records, structuredClone(record)].slice(-100);
    return record;
  }

  toJSONL(): string { return this.records.map((record) => JSON.stringify(record)).join("\n") + (this.records.length ? "\n" : ""); }

  clear(): void { this.records = []; }
}
