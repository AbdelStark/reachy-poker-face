import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const MAX_BODY = 32 * 1024;
const MAX_INFLIGHT = 4;
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
  return body && typeof body === "object" && !Array.isArray(body)
    && body.state !== null && body.state !== undefined
    && body.questions && typeof body.questions === "object" && !Array.isArray(body.questions)
    && Object.keys(body.questions).length > 0 && Object.keys(body.questions).length <= 24
    && Object.values(body.questions).every((q) => q && typeof q === "object" && ["noul", "choice", "score"].includes(q.type));
}

/** A deliberately narrow authenticated proxy; it never logs request state or API keys. */
export function createRelayServer({ token, allowedOrigin, ask }) {
  if (typeof token !== "string" || token.length < 32) throw new TypeError("relay token must have at least 32 characters");
  if (typeof allowedOrigin !== "string" || !/^https?:\/\/[^/]+$/.test(allowedOrigin)) throw new TypeError("invalid allowed origin");
  if (typeof ask !== "function") throw new TypeError("ask function required");
  let inflight = 0;
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
    if (inflight >= MAX_INFLIGHT) return send(response, 429, { error: "busy" }, origin);
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
      const result = await ask(body.state, body.questions);
      return send(response, 200, { model: result.model, answers: result.answers, usage: result.usage }, origin);
    } catch {
      return send(response, 503, { error: "judgment_unavailable" }, origin);
    } finally {
      inflight--;
    }
  });
}
