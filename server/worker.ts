/**
 * Optional Cloudflare Worker for hosting the proxy (e.g. game on GitHub Pages).
 *
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler secret put ACCESS_CODE          # recommended when hosted publicly
 *   npx wrangler deploy server/worker.ts --name oldest-game-proxy
 *
 * Then set the proxy URL in the game's Claude settings. CORS is limited to ALLOWED_ORIGIN.
 */
import { DEFAULT_PROXY_MODEL, handleProxy } from "./proxy.ts";

interface WorkerEnv {
  readonly ANTHROPIC_API_KEY?: string;
  readonly ACCESS_CODE?: string;
  readonly CLAUDE_MODEL?: string;
  readonly ALLOWED_ORIGIN?: string;
}

function cors(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-access-code",
    "access-control-max-age": "86400",
  };
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN ?? "*";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const res = await handleProxy(req, {
      apiKey: env.ANTHROPIC_API_KEY ?? "",
      model: env.CLAUDE_MODEL ?? DEFAULT_PROXY_MODEL,
      maxTokens: 1500,
      ...(env.ACCESS_CODE === undefined ? {} : { accessCode: env.ACCESS_CODE }),
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
