import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createRelayServer } from "./relay.mjs";

const token = process.env.REACHY_JEV_RELAY_TOKEN;
const apiKey = process.env.TYPESAFE_API_KEY;
const allowedOrigin = process.env.REACHY_JEV_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173";
const maxUpstreamAttempts = Number(process.env.REACHY_JEV_MAX_UPSTREAM_ATTEMPTS ?? "30");
if (!apiKey || !token) throw new Error("TYPESAFE_API_KEY and REACHY_JEV_RELAY_TOKEN are required");
const client = new TypeSafeClient({ apiKey });
const server = createRelayServer({
  token,
  allowedOrigin,
  maxUpstreamAttempts,
  ask: (state, questions) => client.systemOne(
    { state, questions, model: "jev-latest" },
    { timeout: 5000, retry: { maxRetries: 0 } },
  ),
});
const port = Number(process.env.REACHY_JEV_RELAY_PORT ?? "8047");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("invalid relay port");
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Jev relay listening on 127.0.0.1:${port} for ${allowedOrigin}; upstream attempt limit ${maxUpstreamAttempts}\n`);
});
