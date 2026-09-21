import type { EntryType, Questions } from "@typesafe-ai/sdk";
import { FINAL_BANK, LIVE_BANK, type JevPort, type JevReply } from "./jev.js";

/** Fixed, text-independent demo answers. Never calls Jev or a relay. */
export class OfflineFixturePort implements JevPort {
  async systemOne(request: { state: EntryType; questions: Questions }, signal?: AbortSignal): Promise<JevReply> {
    if (signal?.aborted) throw signal.reason ?? new Error("fixture aborted");
    const state = request.state as { bank?: unknown; statement?: { id?: unknown }; statements?: unknown[] };
    if (state.bank === LIVE_BANK) {
      const id = state.statement?.id;
      if (id !== "s1" && id !== "s2" && id !== "s3") throw new TypeError("invalid fixture statement");
      const values = {
        s1: [0.2, 0.1, 0.2, 0.1, 0.1],
        s2: [0.75, 0.7, 0.25, 0.3, 0.1],
        s3: [0.35, 0.15, 0.3, 0.2, 0.15],
      }[id];
      return {
        model: "offline-fixture-not-jev",
        answers: Object.fromEntries(
          ["lie_now", "implausible", "hedged", "too_specific", "generic"]
            .map((key, index) => [key, { type: "noul", noul: values[index]! }]),
        ),
      };
    }
    if (state.bank === FINAL_BANK && Array.isArray(state.statements) && state.statements.length === 3) {
      return {
        model: "offline-fixture-not-jev",
        answers: {
          contradiction: { type: "noul", noul: 0.1 },
          the_lie: { type: "choice", choice: "s2", confidence: 0.8 },
          commit_style: { type: "choice", choice: "hedge", confidence: 0.8 },
          top_cue: { type: "choice", choice: "implausibility", confidence: 0.8 },
        },
      };
    }
    throw new TypeError("unknown fixture question bank");
  }
}
