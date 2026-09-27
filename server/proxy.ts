/**
 * Claude proxy core – runtime-agnostic (Web `Request`/`Response`), shared by
 * the local Node server (`npm start`) and the optional Cloudflare Worker.
 *
 * The API key never reaches the browser. The proxy also pins what the
 * browser may ask for, so it cannot be abused as a general-purpose relay:
 * fixed model, capped max_tokens, no streaming, only the fields the game uses.
 */

export interface ProxyEnv {
  readonly apiKey: string;
  readonly model: string;
  /** Hard cap for max_tokens per request. */
  readonly maxTokens: number;
  /** Optional shared secret the client must send as `x-access-code` (for hosted setups). */
  readonly accessCode?: string;
  readonly fetchImpl?: typeof fetch;
}

export const DEFAULT_PROXY_MODEL = "claude-haiku-4-5-20251001";
const ALLOWED_FIELDS = new Set(["system", "messages", "max_tokens", "temperature", "tools", "tool_choice"]);

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

/** Sanitise the client payload: whitelist fields, force model, cap tokens. */
export function sanitize(payload: unknown, env: ProxyEnv): Record<string, unknown> | string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return "Body muss ein JSON-Objekt sein.";
  const out: Record<string, unknown> = { model: env.model };
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v;
  }
  if (!Array.isArray(out["messages"])) return "messages fehlt.";
  const requested = typeof out["max_tokens"] === "number" ? out["max_tokens"] : env.maxTokens;
  out["max_tokens"] = Math.max(1, Math.min(env.maxTokens, Math.floor(requested)));
  return out;
}

/** Handle one request to the proxy. Routes: GET /api/health, POST /api/claude. */
export async function handleProxy(req: Request, env: ProxyEnv): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json(200, { proxy: true, model: env.model, configured: env.apiKey !== "", accessCode: env.accessCode !== undefined });
  }
  if (url.pathname !== "/api/claude") return json(404, { error: "not found" });
  if (req.method !== "POST") return json(405, { error: "POST erwartet" });
  if (env.accessCode !== undefined && req.headers.get("x-access-code") !== env.accessCode) {
    return json(401, { error: "Zugangscode fehlt oder ist falsch." });
  }
  if (env.apiKey === "") {
    return json(500, { error: "Kein ANTHROPIC_API_KEY auf dem Server gesetzt (siehe .env.example)." });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Ungültiges JSON." });
  }
  const body = sanitize(payload, env);
  if (typeof body === "string") return json(400, { error: body });
  const upstream = await (env.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
