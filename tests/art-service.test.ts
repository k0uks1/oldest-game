import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import type { Form } from "../src/engine/types.ts";
import { artPromptOf } from "../src/llm/parser.ts";
import type { ArtItem } from "../src/online/protocol.ts";
import { parseClientMsg } from "../src/online/protocol.ts";
import { artFor, decodeArt } from "../src/render/art.ts";
import { ArtClient, type ArtTransport } from "../src/ui/art-client.ts";
import prompts from "../src/content/core/art-prompts.json" with { type: "json" };
import { artRequest, artSize } from "../server/art-prompts.ts";
import { styleFor } from "../server/pixellab.ts";

const CORE_PROMPTS_JAEGER = (prompts as Record<string, string>)["jaeger"];
import { ArtService, artKey } from "../server/art-service.ts";
import type { Rgba } from "../server/png.ts";

const pixel = (size: number): Rgba => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(200) });
const onto = coreOntology();
const lx = (id: string): Form => {
  const f = onto.formById(id);
  assert.ok(f);
  return f;
};

describe("just-in-time pictures (server store)", () => {
  it("the key follows the description, not the form – variants are separate, equal ones shared", () => {
    assert.equal(artKey("A hunter  with a rifle", 128), artKey("a hunter with a rifle", 128));
    assert.notEqual(artKey("a hunter with a rifle", 128), artKey("a hunter with a rake", 128));
    assert.notEqual(artKey("a hunter with a rifle", 128), artKey("a hunter with a rifle", 256));
  });

  it("every core form has a description; generated pictures carry twice the sprite detail", () => {
    const req = artRequest(lx("jaeger"));
    assert.ok(req);
    assert.equal(req.size, artSize(3));
    assert.equal(artSize(3), 128);
    assert.equal(artRequest({ id: "g:neu", scale: 1, artPrompt: "a grumpy dwarf", archetype: "humanoid", plane: "leben" })?.prompt, "a grumpy dwarf");
    assert.equal(artRequest({ id: "g:neu", scale: 1, archetype: "humanoid", plane: "leben" }), undefined);
  });

  it("things stay things: no figure for objects, a symbol for ideas – figures keep their pictures", () => {
    const saw = artRequest({ id: "g:saege", scale: 2, artPrompt: "a chainsaw", archetype: "weapon", plane: "materie" });
    assert.ok(saw);
    assert.equal(saw.prompt, "a chainsaw, a single object on its own, no people, no hands");
    assert.equal(styleFor(saw.prompt), "dark fantasy pixel art game sprite");
    const idea = artRequest({ id: "g:gasmangel", scale: 2, artPrompt: "an empty gas canister", archetype: "bottle", plane: "abstrakt" });
    assert.match(idea?.prompt ?? "", /symbolic object, no people/);
    assert.equal(artRequest(lx("jaeger"))?.prompt, CORE_PROMPTS_JAEGER, "figures: same description, same key as before");
    assert.match(styleFor("a hunter"), /full body/);
  });

  it("paints once: pending while running, merged requests, stored on disk, ready afterwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    let calls = 0;
    const svc = new ArtService({
      generate: (_p, size) => {
        calls++;
        return Promise.resolve(pixel(size));
      },
      monthlyLimit: 10,
      dir,
    });
    const done: string[] = [];
    svc.onDone((key) => done.push(key));
    const first = svc.lookup("a grey wolf", 64);
    assert.equal(first.state, "pending");
    assert.equal(svc.lookup("a grey wolf", 64).state, "pending", "joined, not a second job");
    await svc.idle();
    assert.equal(calls, 1);
    assert.deepEqual(done, [first.key]);
    const ready = svc.lookup("a grey wolf", 64);
    assert.ok(ready.state === "ready" && decodeArt(ready.art)?.width === 64);
    // a restarted server finds it on disk
    const again = new ArtService({ monthlyLimit: 0, dir });
    assert.equal(again.lookup("a grey wolf", 64).state, "ready");
  });

  it("without key or budget: none (the drawn sprite stays); the budget survives restarts", async () => {
    assert.equal(new ArtService({ monthlyLimit: 10 }).lookup("x", 64).state, "none");
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const usageFile = join(dir, "usage.json");
    const now = (): Date => new Date("2026-09-28T12:00:00Z");
    const mk = (): ArtService => new ArtService({ generate: (_p, s) => Promise.resolve(pixel(s)), monthlyLimit: 2, usageFile, now });
    const svc = mk();
    for (const p of ["one", "two", "three"]) svc.lookup(p, 32);
    await svc.idle();
    assert.equal(svc.used, 2);
    assert.deepEqual(JSON.parse(readFileSync(usageFile, "utf8")), { month: "2026-09", used: 2 });
    assert.equal(mk().lookup("four", 32).state, "none");
  });

  it("a failing service is not asked twice for the same picture", async () => {
    let calls = 0;
    const svc = new ArtService({
      generate: () => {
        calls++;
        return Promise.reject(new Error("503"));
      },
      monthlyLimit: 10,
    });
    svc.lookup("boom", 32);
    await svc.idle();
    assert.equal(svc.lookup("boom", 32).state, "none");
    assert.equal(calls, 1);
  });
});

describe("pictures on the client", () => {
  it("asks once, waits for pending pictures, registers what arrives", async () => {
    const asked: string[][] = [];
    const t: ArtTransport = {
      ask(forms) {
        asked.push(forms.map((f) => f.id));
      },
    };
    const client = new ArtClient();
    client.setTransport(t);
    const wolf = lx("wolf");
    const arrived: string[] = [];
    client.onArrive = (id) => arrived.push(id);
    client.want([wolf, wolf]);
    client.want([wolf]);
    assert.deepEqual(asked, [["wolf"]]);
    const waiting = client.whenReady(wolf, 5_000);
    client.receive([{ id: "wolf", state: "pending" }]);
    client.receive([{ id: "wolf", state: "ready", art: "2.2.ff0000ff.AwE=" }]);
    assert.equal(await waiting, true);
    assert.deepEqual(arrived, ["wolf"]);
    assert.equal(artFor(wolf)?.width, 2);
  });

  it("gives up on none and on timeout; no transport = no waiting at all", async () => {
    const client = new ArtClient();
    const hai = lx("hai");
    assert.equal(client.coming(hai), false);
    assert.equal(await client.whenReady(hai, 10), false);
    client.setTransport({ ask: () => undefined });
    const w = client.whenReady(hai, 5_000);
    client.receive([{ id: "hai", state: "none" } satisfies ArtItem]);
    assert.equal(await w, false);
    assert.equal(client.coming(hai), false);
    const loewe = lx("loewe");
    assert.equal(await client.whenReady(loewe, 20), false, "timeout");
  });

  it("the protocol accepts short id lists only", () => {
    assert.equal(parseClientMsg(JSON.stringify({ t: "art", ids: ["wolf", "wolf", "hai"] }))?.t, "art");
    assert.equal(parseClientMsg(JSON.stringify({ t: "art", ids: [] })), undefined);
    assert.equal(parseClientMsg(JSON.stringify({ t: "art", ids: Array.from({ length: 30 }, (_, i) => `f${String(i)}`) })), undefined);
  });

  it("Claude's picture description is one clean line", () => {
    assert.equal(artPromptOf("  a  hunter\n with\u0000 rifle "), "a hunter with rifle");
    assert.equal(artPromptOf(42), undefined);
    assert.equal(artPromptOf("x".repeat(500))?.length, 200);
  });
});
