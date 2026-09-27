import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { envFrom, readDotEnv } from "../server/local.ts";
import { handleProxy, sanitize, type ProxyEnv } from "../server/proxy.ts";

function fakeUpstream(capture: { body?: Record<string, unknown>; headers?: Headers }): typeof fetch {
  return ((_url: string, init: RequestInit) => {
    capture.body = JSON.parse(init.body as string) as Record<string, unknown>;
    capture.headers = new Headers(init.headers);
    return Promise.resolve(new Response(JSON.stringify({ content: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  }) as unknown as typeof fetch;
}

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request("http://127.0.0.1/api/claude", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("Claude proxy", () => {
  const base: ProxyEnv = { apiKey: "sk-test", model: "claude-haiku-4-5-20251001", maxTokens: 800 };

  it("pins the model, caps max_tokens and drops unknown fields", () => {
    const out = sanitize({ model: "claude-opus-5-5", max_tokens: 99999, messages: [], stream: true, metadata: {} }, base);
    assert.ok(typeof out !== "string");
    assert.equal(out["model"], "claude-haiku-4-5-20251001");
    assert.equal(out["max_tokens"], 800);
    assert.equal(out["stream"], undefined);
    assert.equal(out["metadata"], undefined);
  });

  it("forwards with the server-side key – the client never sends one", async () => {
    const cap: { body?: Record<string, unknown>; headers?: Headers } = {};
    const res = await handleProxy(post({ messages: [{ role: "user", content: "x" }], max_tokens: 10 }), { ...base, fetchImpl: fakeUpstream(cap) });
    assert.equal(res.status, 200);
    const { headers, body } = cap;
    assert.ok(headers && body);
    assert.equal(headers.get("x-api-key"), "sk-test");
    assert.equal(headers.get("anthropic-dangerous-direct-browser-access"), null);
    assert.equal(body["max_tokens"], 10);
  });

  it("reports health without leaking the key", async () => {
    const res = await handleProxy(new Request("http://127.0.0.1/api/health"), base);
    const text = await res.text();
    assert.ok(!text.includes("sk-test"));
    assert.deepEqual(JSON.parse(text), { proxy: true, model: base.model, configured: true, accessCode: false });
  });

  it("enforces the access code when configured", async () => {
    const env = { ...base, accessCode: "geheim", fetchImpl: fakeUpstream({}) };
    assert.equal((await handleProxy(post({ messages: [] }), env)).status, 401);
    assert.equal((await handleProxy(post({ messages: [] }, { "x-access-code": "geheim" }), env)).status, 200);
  });

  it("rejects bad requests", async () => {
    assert.equal((await handleProxy(post({ nope: 1 }), base)).status, 400);
    assert.equal((await handleProxy(new Request("http://127.0.0.1/api/claude"), base)).status, 405);
    assert.equal((await handleProxy(post({ messages: [] }), { ...base, apiKey: "" })).status, 500);
  });
});

describe("local server config", () => {
  it("reads .env files", () => {
    const dir = mkdtempSync(join(tmpdir(), "og-"));
    const file = join(dir, ".env");
    writeFileSync(file, "# comment\nANTHROPIC_API_KEY=\"sk-abc\"\nCLAUDE_MAX_TOKENS=300\n");
    const env = envFrom(readDotEnv(file));
    assert.equal(env.apiKey, "sk-abc");
    assert.equal(env.maxTokens, 300);
    assert.equal(env.accessCode, undefined);
  });
});
