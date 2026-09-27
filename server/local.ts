/**
 * Local game server: serves the built game and proxies Claude with the key
 * from the environment or `.env`. Binds to 127.0.0.1 only.
 *
 *   cp .env.example .env   # ANTHROPIC_API_KEY=…
 *   npm start              # → http://localhost:5173
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLearned } from "./learned.ts";
import { DEFAULT_PROXY_MODEL, handleProxy, type ProxyEnv } from "./proxy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env reader (KEY=value, # comments, optional quotes). */
export function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m === null || line.trimStart().startsWith("#")) continue;
    const [, key = "", raw = ""] = m;
    out[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function envFrom(vars: Record<string, string | undefined>): ProxyEnv {
  return {
    apiKey: vars["ANTHROPIC_API_KEY"] ?? "",
    model: vars["CLAUDE_MODEL"] ?? DEFAULT_PROXY_MODEL,
    maxTokens: Number(vars["CLAUDE_MAX_TOKENS"] ?? 800),
    ...(vars["ACCESS_CODE"] === undefined || vars["ACCESS_CODE"] === "" ? {} : { accessCode: vars["ACCESS_CODE"] }),
  };
}

async function toRequest(req: IncomingMessage, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(`http://127.0.0.1:${String(port)}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(body === undefined || req.method === "GET" ? {} : { body }),
  });
}

export const LEARNED_FILE = join(root, "learned/pack.json");

export function startServer(opts: { port: number; html: () => string; env: ProxyEnv; learnedFile?: string }): void {
  createServer((req, res) => {
    void (async () => {
      try {
        if ((req.url ?? "/").startsWith("/api/learned")) {
          const r = await handleLearned(await toRequest(req, opts.port), opts.learnedFile ?? LEARNED_FILE);
          res.writeHead(r.status, { "content-type": "application/json" });
          res.end(await r.text());
          return;
        }
        if ((req.url ?? "/").startsWith("/api/")) {
          const r = await handleProxy(await toRequest(req, opts.port), opts.env);
          res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
          res.end(await r.text());
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(opts.html());
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  }).listen(opts.port, "127.0.0.1", () => {
    const key = opts.env.apiKey === "" ? "⚠ kein ANTHROPIC_API_KEY (.env) – nur ?debug spielbar" : `Claude: ${opts.env.model}`;
    console.log(`▶ http://localhost:${String(opts.port)}   ${key}`);
  });
}

export function localEnv(): ProxyEnv {
  return envFrom({ ...readDotEnv(join(root, ".env")), ...process.env });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const file = join(root, "dist/index.html");
  if (!existsSync(file)) {
    console.error("dist/index.html fehlt – erst `npm run build` (npm start macht das automatisch).");
    process.exit(1);
  }
  startServer({ port: Number(process.env["PORT"] ?? 5173), html: () => readFileSync(file, "utf8"), env: localEnv() });
}
