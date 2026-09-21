import { commitStyle, type CommitThresholds, type CueProbabilities, type CueWeights, liveSuspicion } from "./cues.js";

export type Phase = "idle" | "intro" | "capture" | "react" | "think" | "commit" | "reveal" | "score";
export type StatementId = "s1" | "s2" | "s3";
export interface Statement { id: StatementId; text: string; delivery: readonly string[]; pLie: number }
export interface Pick { choice: StatementId; confidence: number; style: ReturnType<typeof commitStyle>; source: "jev" | "fallback" | "fixture" }
export interface RoundSnapshot { phase: Phase; statementNumber: number; statements: readonly Statement[]; pick?: Pick; actualLie?: StatementId; correct?: boolean }

/** Pure game transitions. Speech, model calls, robot motion and persistence belong to adapters. */
export class Round {
  private phase_: Phase = "idle";
  private statements_: Statement[] = [];
  private pick_: Pick | undefined;
  private actualLie_: StatementId | undefined;
  get snapshot(): RoundSnapshot {
    return { phase: this.phase_, statementNumber: Math.min(3, this.statements_.length + 1), statements: [...this.statements_], ...(this.pick_ ? { pick: this.pick_ } : {}), ...(this.actualLie_ ? { actualLie: this.actualLie_, correct: this.actualLie_ === this.pick_?.choice } : {}) };
  }
  start(): void { this.require("idle"); this.phase_ = "intro"; }
  introDone(): void { this.require("intro"); this.phase_ = "capture"; }
  submit(text: string, delivery: readonly string[], cues: CueProbabilities, weights?: CueWeights): Statement {
    this.require("capture");
    const clean = text.trim();
    if (clean.split(/\s+/).length < 4 || clean.length > 400) throw new TypeError("statement must have 4+ words and <=400 characters");
    const id = `s${this.statements_.length + 1}` as StatementId;
    const statement = { id, text: clean, delivery: [...delivery], pLie: liveSuspicion(cues, weights) };
    this.statements_.push(statement);
    this.phase_ = "react";
    return statement;
  }
  reactionDone(): void {
    this.require("react");
    this.phase_ = this.statements_.length === 3 ? "think" : "capture";
  }
  commit(choice: StatementId, confidence: number, thresholds?: CommitThresholds): Pick {
    this.require("think");
    if (!["s1", "s2", "s3"].includes(choice)) throw new TypeError("invalid pick");
    this.pick_ = { choice, confidence, style: commitStyle(confidence, thresholds), source: "jev" };
    this.phase_ = "commit";
    return this.pick_;
  }
  commitFixture(choice: StatementId, confidence: number, thresholds?: CommitThresholds): Pick {
    this.require("think");
    if (!["s1", "s2", "s3"].includes(choice)) throw new TypeError("invalid fixture pick");
    this.pick_ = { choice, confidence, style: commitStyle(confidence, thresholds), source: "fixture" };
    this.phase_ = "commit";
    return this.pick_;
  }
  commitUnavailable(choice: StatementId): Pick {
    this.require("think");
    if (!["s1", "s2", "s3"].includes(choice)) throw new TypeError("invalid fallback pick");
    this.pick_ = { choice, confidence: 0, style: "coin_flip", source: "fallback" };
    this.phase_ = "commit";
    return this.pick_;
  }
  commitDone(): void { this.require("commit"); this.phase_ = "reveal"; }
  reveal(actualLie: StatementId): boolean {
    this.require("reveal");
    if (!["s1", "s2", "s3"].includes(actualLie)) throw new TypeError("invalid reveal");
    this.actualLie_ = actualLie;
    this.phase_ = "score";
    return this.pick_?.choice === actualLie;
  }
  reset(): void { this.phase_ = "idle"; this.statements_ = []; this.pick_ = undefined; this.actualLie_ = undefined; }
  /** Export without identifying or statement text by default. */
  export(options: { keepText?: boolean } = {}): object {
    return { ...this.snapshot, statements: this.statements_.map((statement) => options.keepText ? statement : { id: statement.id, delivery: statement.delivery, pLie: statement.pLie }) };
  }
  private require(phase: Phase): void { if (this.phase_ !== phase) throw new Error(`expected ${phase}, got ${this.phase_}`); }
}
