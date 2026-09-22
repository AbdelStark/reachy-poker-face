import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

const MAX_BODY = 32 * 1024;
const MAX_INFLIGHT = 4;
const MAX_PER_MINUTE = 30;
const DEFAULT_UPSTREAM_ATTEMPTS = 30;
// Update these only after reviewing a versioned question-bank change. The
// browser's wire snapshot test checks that both digests still match its banks.
const QUESTION_HASHES = Object.freeze({
  "pokerface.live@0.1.0": "4e363afc25f733404cca7c9c1a4196fa0f376fc4cf5f3a38e7739acd49a602bb",
  "pokerface.final@0.1.0": "30d79abdcd16d20e1e41fba64ab561750466561487085929984a92c745ff5ca5",
});
const DELIVERY = new Set(["steady", "hesitant", "trailing off", "self-corrected", "fast, no pauses"]);
const LENGTHS = new Set(["short", "medium", "long"]);
const GAME = "two truths and a lie";
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function text(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 400 && value === value.trim();
}
function delivery(value) {
  return Array.isArray(value) && value.length <= 3 && value.every((item) => DELIVERY.has(item));
}
function statement(value, id, mode) {
  if (!record(value)) return false;
  const keys = mode === "live" ? ["id", "text", "length"] : ["id", "text"];
  return exactKeys(value, Object.hasOwn(value, "delivery") ? [...keys, "delivery"] : keys)
    && value.id === id && text(value.text)
    && (mode !== "live" || LENGTHS.has(value.length))
    && (!Object.hasOwn(value, "delivery") || delivery(value.delivery));
}
function validState(state) {
  if (!record(state) || state.game !== GAME) return false;
  if (state.bank === "pokerface.live@0.1.0") {
    if (!exactKeys(state, ["bank", "game", "statement", "earlier_statements"])) return false;
    const id = state.statement?.id;
    const position = ["s1", "s2", "s3"].indexOf(id);
    return position >= 0 && statement(state.statement, id, "live")
      && Array.isArray(state.earlier_statements)
      && state.earlier_statements.length === position
      && state.earlier_statements.every((item, index) => statement(item, `s${index + 1}`, "earlier"));
  }
  if (state.bank === "pokerface.final@0.1.0") {
    return exactKeys(state, ["bank", "game", "statements"])
      && Array.isArray(state.statements) && state.statements.length === 3
      && state.statements.every((item, index) => statement(item, `s${index + 1}`, "final"));
  }
  return false;
}
function validBearer(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function send(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}
function validRequest(body) {
  if (!exactKeys(body, ["state", "questions"]) || !validState(body.state) || !record(body.questions)) return false;
  const expected = QUESTION_HASHES[body.state.bank];
  return createHash("sha256").update(JSON.stringify(body.questions)).digest("hex") === expected;
}

/** A deliberately narrow authenticated proxy; it never logs request state or API keys. */
export function createRelayServer({ token, allowedOrigin, ask, maxUpstreamAttempts = DEFAULT_UPSTREAM_ATTEMPTS, now = () => performance.now() }) {
  if (typeof token !== "string" || token.length < 32) throw new TypeError("relay token must have at least 32 characters");
  if (typeof allowedOrigin !== "string" || !/^https?:\/\/[^/]+$/.test(allowedOrigin)) throw new TypeError("invalid allowed origin");
  if (typeof ask !== "function") throw new TypeError("ask function required");
  if (!Number.isSafeInteger(maxUpstreamAttempts) || maxUpstreamAttempts < 1 || maxUpstreamAttempts > 10_000) throw new TypeError("upstream attempt limit must be an integer from 1 to 10000");
  if (typeof now !== "function") throw new TypeError("clock function required");
  let inflight = 0;
  let windowStart = now();
  let calls = 0;
  let upstreamAttempts = 0;
  return createServer(async (request, response) => {
    const origin = request.headers.origin === allowedOrigin ? allowedOrigin : undefined;
    if (request.headers.origin && !origin) return send(response, 403, { error: "origin_forbidden" });
    if (request.url !== "/v1/systemone") return send(response, 404, { error: "not_found" }, origin);
    if (request.method === "OPTIONS") {
      if (!origin) return send(response, 403, { error: "origin_forbidden" });
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
      return response.end();
    }
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" }, origin);
    if (!validBearer(request.headers.authorization, token)) return send(response, 401, { error: "unauthorized" }, origin);
    if (!request.headers["content-type"]?.startsWith("application/json")) return send(response, 415, { error: "json_required" }, origin);
    const current = now();
    if (current - windowStart >= 60_000) { windowStart = current; calls = 0; }
    if (calls >= MAX_PER_MINUTE) return send(response, 429, { error: "rate_limited" }, origin);
    if (inflight >= MAX_INFLIGHT) return send(response, 429, { error: "busy" }, origin);
    calls++;
    inflight++;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) return send(response, 413, { error: "too_large" }, origin);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return send(response, 400, { error: "invalid_json" }, origin); }
      if (!validRequest(body)) return send(response, 400, { error: "invalid_request" }, origin);
      if (upstreamAttempts >= maxUpstreamAttempts) return send(response, 429, { error: "upstream_attempt_limit" }, origin);
      upstreamAttempts++;
      const result = await ask(body.state, body.questions);
      return send(response, 200, { model: result.model, answers: result.answers, usage: result.usage }, origin);
    } catch {
      return send(response, 503, { error: "judgment_unavailable" }, origin);
    } finally {
      inflight--;
    }
  });
}
