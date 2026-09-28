import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ContentPack, FormSpec } from "../src/engine/ontology/pack.ts";
import { artPromptOf } from "../src/llm/parser.ts";
import { decodeArt } from "../src/render/art.ts";
import { ArtService, withArt } from "../server/art-service.ts";
import type { Rgba } from "../server/png.ts";

const form = (id: string, extra: Partial<FormSpec> = {}): FormSpec => ({ id, name: id, archetype: "orb", scale: 3, plane: "materie", tags: ["fest"], ...extra });
const pack = (forms: FormSpec[]): ContentPack => ({ id: "gelernt", name: "g", version: "1", tags: [], verbs: [], modifiers: [], forms });
const pixel = (size: number): Rgba => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(200) });

describe("live art for learned forms", () => {
  it("generates once per form with a prompt and hands back decodable art", async () => {
    const calls: { prompt: string; size: number }[] = [];
    const got = new Map<string, string>();
    const svc = new ArtService({
      generate: (prompt, size) => {
        calls.push({ prompt, size });
        return Promise.resolve(pixel(size));
      },
      monthlyLimit: 10,
      onArt: (id, art) => got.set(id, art),
    });
    const p = pack([form("g:a", { artPrompt: "a red kite" }), form("g:b"), form("g:c", { artPrompt: "x", art: "1.1..AA==" })]);
    svc.scan(p);
    svc.scan(p); // no second attempt
    await svc.idle();
    assert.deepEqual(calls, [{ prompt: "a red kite", size: 64 }]);
    const art = got.get("g:a");
    assert.ok(art !== undefined && decodeArt(art)?.width === 64);
  });

  it("stops at the monthly budget and remembers usage across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const usageFile = join(dir, "art-usage.json");
    const now = (): Date => new Date("2026-09-28T12:00:00Z");
    let n = 0;
    const mk = (): ArtService =>
      new ArtService({
        generate: (_p, size) => {
          n++;
          return Promise.resolve(pixel(size));
        },
        monthlyLimit: 2,
        usageFile,
        now,
        onArt: () => undefined,
      });
    const svc = mk();
    svc.scan(pack([form("g:1", { artPrompt: "one" }), form("g:2", { artPrompt: "two" }), form("g:3", { artPrompt: "three" })]));
    await svc.idle();
    assert.equal(n, 2);
    assert.deepEqual(JSON.parse(readFileSync(usageFile, "utf8")), { month: "2026-09", used: 2 });
    const again = mk();
    again.scan(pack([form("g:4", { artPrompt: "four" })]));
    await again.idle();
    assert.equal(n, 2, "the restarted server still knows the budget is spent");
  });

  it("a failing service leaves the drawn fallback and does not retry forever", async () => {
    let n = 0;
    const svc = new ArtService({
      generate: () => {
        n++;
        return Promise.reject(new Error("503"));
      },
      monthlyLimit: 10,
      onArt: () => assert.fail("no art expected"),
    });
    const p = pack([form("g:x", { artPrompt: "boom" })]);
    svc.scan(p);
    await svc.idle();
    svc.scan(p);
    await svc.idle();
    assert.equal(n, 1);
  });

  it("writes art into the pack for exactly that form", () => {
    const p = pack([form("g:a"), form("g:b")]);
    const q = withArt(p, "g:b", "1.1..AA==");
    assert.equal(q.forms[0]?.art, undefined);
    assert.equal(q.forms[1]?.art, "1.1..AA==");
    assert.equal(withArt(p, "g:gone", "1.1..AA=="), p);
  });

  it("Claude's picture description is one clean line", () => {
    assert.equal(artPromptOf("  a  hunter\\n with\u0000 rifle "), "a hunter\\n with rifle");
    assert.equal(artPromptOf(42), undefined);
    assert.equal(artPromptOf("x".repeat(500))?.length, 200);
  });
});
