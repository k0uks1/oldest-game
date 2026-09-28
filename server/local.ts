/**
 * Game server: serves the built game, proxies Claude with the key from the environment or
 * `.env`, and hosts online duels over WebSocket (`/ws`).
 *
 *   cp .env.example .env   # ANTHROPIC_API_KEY=…
 *   npm start              # → http://localhost:5173 (hot-seat + online rooms for testing)
 *
 * Bound to 127.0.0.1 by default. With HOST=0.0.0.0 (Docker) it is a *public* server: the
 * browser proxy and uploads of learned packs are switched off – there, every move is
 * resolved on the server inside a room (one-device duels too), and only the rooms learn.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { ContentPack } from "../src/engine/ontology/pack.ts";
import { Resolver } from "../src/game/resolver.ts";
import type { LlmSettings } from "../src/llm/client.ts";
import { reconcileLearned } from "../src/llm/learning.ts";
import { narrateEpilogueWithClaude } from "../src/llm/narrator.ts";
import { narrateEnd } from "../src/narrate/offline.ts";
import { applyPackDelta, packDelta, WS_PATH, type ServerMsg } from "../src/online/protocol.ts";
import { handleLearned, readLearnedFile, writeLearnedFile } from "./learned.ts";
import { OnlineHub, type HubLimits } from "./online.ts";
import { DEFAULT_PROXY_MODEL, handleProxy, type ProxyEnv } from "./proxy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 1_000_000;

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

class BodyTooLarge extends Error {}

async function toRequest(req: IncomingMessage, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new BodyTooLarge();
    chunks.push(c as Buffer);
  }
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

export interface ServerOptions {
  readonly port: number;
  /** Default 127.0.0.1. Anything else makes this a public server (see header). */
  readonly host?: string;
  readonly html: () => string;
  readonly env: ProxyEnv;
  readonly learnedFile?: string;
  /** Behind a reverse proxy (Caddy): take the client IP from X-Forwarded-For. */
  readonly trustProxy?: boolean;
  readonly limits?: Partial<HubLimits>;
  readonly quiet?: boolean;
}

export interface RunningServer {
  /** Resolves with the bound port (useful with port 0 in tests). */
  readonly ready: Promise<number>;
  readonly hub: OnlineHub;
  close(): Promise<void>;
}

export function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

/** The client address, for per-IP limits. Caddy appends the real peer as the last XFF hop. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const xff = req.headers["x-forwarded-for"];
  if (trustProxy && typeof xff === "string" && xff !== "") return xff.split(",").at(-1)?.trim() ?? "?";
  return req.socket.remoteAddress ?? "?";
}

export function startServer(opts: ServerOptions): RunningServer {
  const host = opts.host ?? "127.0.0.1";
  const isPublic = !isLoopback(host);
  const log = (line: string): void => {
    if (opts.quiet !== true) console.log(line);
  };
  const file = opts.learnedFile ?? LEARNED_FILE;
  const base: readonly ContentPack[] = [loadPack(CORE_PACK_RAW)];
  const learned = readLearnedFile(base, file);

  // Claude on the server: the key never leaves this process. Without a key the rooms
  // fall back to the mechanical parser (handy for testing two tabs locally).
  const llm: LlmSettings = { apiKey: opts.env.apiKey, model: opts.env.model, proxyUrl: "", accessCode: "", debugOffline: false, rememberSecrets: false };
  const claude = (): boolean => opts.env.apiKey !== "";

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: ContentPack | undefined;
  const flush = (): void => {
    if (pending === undefined) return;
    try {
      writeLearnedFile(file, pending);
    } catch (e) {
      console.error(`Gelerntes konnte nicht gespeichert werden: ${e instanceof Error ? e.message : String(e)}`);
    }
    pending = undefined;
  };

  const resolver = new Resolver(Ontology.compile([...base, learned]), base, learned, {
    llm: () => llm,
    debug: () => !claude(),
    saveLearned: () => {
      theHub.learnedChanged();
    },
    today: () => new Date().toISOString().slice(0, 10),
  });
  const theHub = new OnlineHub(resolver, {
    ...(opts.env.accessCode === undefined ? {} : { accessCode: opts.env.accessCode }),
    ...(opts.limits === undefined ? {} : { limits: opts.limits }),
    claude,
    epilogue: async (state) => (claude() && state.history.length > 1 ? narrateEpilogueWithClaude(llm, state, narrateEnd(state)) : narrateEnd(state)),
    persist: (pack) => {
      // debounced: a burst of learning is one write
      pending = pack;
      saveTimer ??= setTimeout(() => {
        saveTimer = undefined;
        flush();
      }, 400);
    },
    log,
  });

  const learnedEndpoint = {
    base,
    get: () => resolver.learned,
    // The local hot-seat uploads its whole pack; merge it into the shared one so nothing a
    // room learned meanwhile is lost.
    put: (pack: ContentPack): ContentPack => {
      const merged = applyPackDelta(resolver.learned, packDelta(resolver.learned, pack));
      resolver.setLearned(reconcileLearned(base, merged) ?? resolver.learned);
      theHub.learnedChanged();
      return resolver.learned;
    },
    writable: !isPublic,
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      try {
        if (url.startsWith("/api/health")) {
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(
            JSON.stringify({
              proxy: !isPublic,
              configured: opts.env.apiKey !== "",
              model: opts.env.model,
              accessCode: opts.env.accessCode !== undefined,
              online: true,
            }),
          );
          return;
        }
        if (url.startsWith("/api/learned")) {
          const r = await handleLearned(await toRequest(req, 0), learnedEndpoint);
          res.writeHead(r.status, { "content-type": "application/json" });
          res.end(await r.text());
          return;
        }
        if (url.startsWith("/api/")) {
          if (isPublic) {
            res.writeHead(403, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Auf diesem Server wird in Räumen gespielt." }));
            return;
          }
          const r = await handleProxy(await toRequest(req, 0), opts.env);
          res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
          res.end(await r.text());
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(opts.html());
      } catch (e) {
        const tooLarge = e instanceof BodyTooLarge;
        res.writeHead(tooLarge ? 413 : 502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: tooLarge ? "Anfrage zu groß" : e instanceof Error ? e.message : String(e) }));
      }
    })();
  });

  // ── WebSocket rooms ─────────────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = theHub.attach({
        ip: clientIp(req, opts.trustProxy === true),
        send: (msg: ServerMsg) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        },
        close: () => {
          ws.close();
        },
      });
      if (conn === undefined) return;
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        conn.receive(Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]).toString("utf8"));
      });
      ws.on("close", () => {
        conn.closed();
      });
      ws.on("error", () => {
        ws.terminate();
      });
    });
  });
  // Heartbeat: dead connections (phone went to sleep) are dropped, so seats show "offline".
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) !== true) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  const sweeper = setInterval(() => {
    theHub.sweep();
  }, 60_000);
  heartbeat.unref();
  sweeper.unref();

  const ready = new Promise<number>((resolve) => {
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : opts.port;
      const key = opts.env.apiKey === "" ? "⚠ kein ANTHROPIC_API_KEY (.env) – Räume nutzen den mechanischen Parser" : `Claude: ${opts.env.model}`;
      log(`▶ http://${isPublic ? host : "localhost"}:${String(port)}   ${key}${isPublic ? "   (öffentlich: nur Räume)" : ""}${opts.env.accessCode === undefined ? "" : "   Zugangscode aktiv"}`);
      resolve(port);
    });
  });

  return {
    ready,
    hub: theHub,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        clearInterval(sweeper);
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        flush();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => {
          resolve();
        });
      }),
  };
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
  const vars = { ...readDotEnv(join(root, ".env")), ...process.env };
  const html = readFileSync(file, "utf8");
  const running = startServer({
    port: Number(vars["PORT"] ?? 5173),
    host: vars["HOST"] ?? "127.0.0.1",
    html: () => html,
    env: envFrom(vars),
    trustProxy: vars["TRUST_PROXY"] === "1",
    ...(vars["LEARNED_FILE"] === undefined ? {} : { learnedFile: vars["LEARNED_FILE"] }),
    limits: {
      ...(vars["MAX_ROOMS"] === undefined ? {} : { maxRooms: Number(vars["MAX_ROOMS"]) }),
      ...(vars["CLAUDE_MOVES_PER_HOUR"] === undefined ? {} : { claudeMovesPerHour: Number(vars["CLAUDE_MOVES_PER_HOUR"]) }),
    },
  });
  const stop = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
