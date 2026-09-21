import type { EntryType, Questions } from "@typesafe-ai/sdk";
import type { JevPort, JevReply } from "./jev.js";

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
  async systemOne(request: { state: EntryType; questions: Questions }): Promise<JevReply> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`Jev relay returned HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("model" in data) || !("answers" in data) || typeof data.model !== "string" || !data.answers || typeof data.answers !== "object") throw new TypeError("invalid Jev relay response");
    return data as JevReply;
  }
}
