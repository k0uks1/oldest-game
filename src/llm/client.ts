/**
 * Anthropic Messages API client for the browser.
 *
 * Preferred path: a proxy (`npm start` locally, or the Cloudflare Worker in
 * `server/worker.ts`) holds the API key, so it never reaches the browser.
 * Fallback for the standalone file: "bring your own key" – the player's own key
 * in localStorage, sent with Anthropic's explicit
 * `anthropic-dangerous-direct-browser-access` opt-in. Never ship a build with a key in it.
 */

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface LlmSettings {
  /** Only needed without a proxy ("bring your own key", e.g. index.html opened from disk). */
  readonly apiKey: string;
  readonly model: string;
  /**
   * Claude proxy endpoint that holds the key server-side, e.g. "/api/claude" (local `npm start`)
   * or a Cloudflare Worker URL. Empty = call the Anthropic API directly with `apiKey`.
   */
  readonly proxyUrl: string;
  /** Sent as `x-access-code` to hosted proxies. */
  readonly accessCode: string;
  /**
   * Debug only: parse and narrate mechanically without any LLM call.
   * The real game always runs with Claude.
   */
  readonly debugOffline: boolean;
}

export const DEFAULT_SETTINGS: LlmSettings = { apiKey: "", model: DEFAULT_MODEL, proxyUrl: "", accessCode: "", debugOffline: false };

const STORAGE_KEY = "oldest-game:llm";

export function loadSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const o = parsed as Record<string, unknown>;
    return {
      apiKey: typeof o["apiKey"] === "string" ? o["apiKey"] : "",
      model: typeof o["model"] === "string" && o["model"] !== "" ? o["model"] : DEFAULT_MODEL,
      proxyUrl: typeof o["proxyUrl"] === "string" ? o["proxyUrl"] : "",
      accessCode: typeof o["accessCode"] === "string" ? o["accessCode"] : "",
      debugOffline: o["debugOffline"] === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: LlmSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable – settings stay in memory */
  }
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface CallOptions {
  /** Stable part of the system prompt – sent with cache_control. */
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly tool?: ToolDef;
  readonly temperature?: number;
}

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface CallResult {
  readonly text: string;
  readonly toolInput: unknown;
  readonly usage: Usage;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Running token totals for the session (shown in the settings dialog). */
export const sessionUsage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Can this configuration reach Claude at all? */
export function isClaudeReady(s: LlmSettings): boolean {
  return s.proxyUrl !== "" || s.apiKey !== "";
}

/**
 * Detect the local game server's proxy (`npm start`). Returns the endpoint or "" when
 * the page was opened from disk or the server has no key configured.
 */
export async function detectLocalProxy(fetchImpl: typeof fetch = fetch): Promise<{ url: string; model: string } | null> {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) return null;
  try {
    const res = await fetchImpl("/api/health", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { proxy?: boolean; configured?: boolean; model?: string };
    return j.proxy === true && j.configured === true ? { url: "/api/claude", model: j.model ?? DEFAULT_MODEL } : null;
  } catch {
    return null;
  }
}

export async function callClaude(settings: LlmSettings, opts: CallOptions, fetchImpl: typeof fetch = fetch): Promise<CallResult> {
  const viaProxy = settings.proxyUrl !== "";
  if (!viaProxy && settings.apiKey === "") throw new LlmError("Kein API-Key hinterlegt und kein Proxy verbunden.");
  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0,
    // The long, stable system prompt is cached – follow-up calls pay ~10 % for it.
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.tool !== undefined) {
    body["tools"] = [opts.tool];
    body["tool_choice"] = { type: "tool", name: opts.tool.name };
  }
  // Preferred: the proxy holds the key and pins model/limits. Fallback: bring-your-own-key.
  const res = viaProxy
    ? await fetchImpl(settings.proxyUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.accessCode === "" ? {} : { "x-access-code": settings.accessCode }),
        },
        body: JSON.stringify(body),
      })
    : await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    const hint = res.status === 401 ? " – API-Key prüfen." : res.status === 429 ? " – Rate-Limit, kurz warten." : "";
    throw new LlmError(`Claude-API Fehler ${String(res.status)}${hint} ${detail.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  const content = json.content ?? [];
  const usage: Usage = {
    input: json.usage?.input_tokens ?? 0,
    output: json.usage?.output_tokens ?? 0,
    cacheRead: json.usage?.cache_read_input_tokens ?? 0,
    cacheWrite: json.usage?.cache_creation_input_tokens ?? 0,
  };
  sessionUsage.calls++;
  sessionUsage.input += usage.input;
  sessionUsage.output += usage.output;
  sessionUsage.cacheRead += usage.cacheRead;
  sessionUsage.cacheWrite += usage.cacheWrite;
  return {
    text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
    toolInput: content.find((c) => c.type === "tool_use")?.input,
    usage,
  };
}

/** Approximate cost in USD for Haiku 4.5 ($1 / $5 per MTok, cache read 10 %, write 125 %). */
export function estimateCostUsd(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return (u.input * 1 + u.output * 5 + u.cacheRead * 0.1 + u.cacheWrite * 1.25) / 1_000_000;
}
