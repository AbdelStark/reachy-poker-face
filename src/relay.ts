import type { EntryType, Questions } from "@typesafe-ai/sdk";
import type { JevPort, JevReply } from "./jev.js";

export class RelayLimitError extends Error {
  constructor() {
    super("Jev relay request limit reached");
    this.name = "RelayLimitError";
  }
}

/** Browser transport for a separately hosted authenticated Jev relay. No API key enters the bundle. */
export class RelayPort implements JevPort {
  private readonly endpoint: URL;
  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new TypeError("relay must use HTTPS or loopback HTTP");
    if (url.username || url.password || url.search || url.hash) throw new TypeError("relay URL must not contain credentials or query data");
    if (token.length < 32) throw new TypeError("relay token must be at least 32 characters");
    this.endpoint = new URL("/v1/systemone", url);
  }
  async systemOne(request: { state: EntryType; questions: Questions }, signal?: AbortSignal): Promise<JevReply> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await this.fetcher.call(globalThis, this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (response.status === 429) throw new RelayLimitError();
      if (!response.ok) throw new Error(`Jev relay returned HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("model" in data) || !("answers" in data) || typeof data.model !== "string" || !data.answers || typeof data.answers !== "object") throw new TypeError("invalid Jev relay response");
      return data as JevReply;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
