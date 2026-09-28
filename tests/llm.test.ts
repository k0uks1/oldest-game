import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { scanText } from "../scripts/secret-scan.ts";
import { callClaude, DEFAULT_SETTINGS, estimateCostUsd, persistable } from "../src/llm/client.ts";
import { abilityCorrection, anchorsFor, formFromLlm } from "../src/llm/parser.ts";

const onto = coreOntology();

describe("formFromLlm – mapping model output onto the ontology", () => {
  it("drops mechanisms the form cannot perform – a radio does not corrode", () => {
    const input = { name: "Radio", base: null, scale: 1, plane: "materie", archetype: "box", properties: ["maschine", "elektrisch"], mechanisms: ["zersetzt", "uebertoent"], intended_mechanism: null };
    assert.equal(formFromLlm(onto, input, "ein Radio"), undefined, "nothing it can do: not laut, no acid – Claude is asked again");
    const loud = formFromLlm(onto, { ...input, properties: ["maschine", "elektrisch", "laut"] }, "ein Radio");
    assert.ok(loud);
    assert.deepEqual(onto.compileForm(loud.form).verbs, ["uebertoent"]);
    assert.deepEqual(loud.form.verbs, ["uebertoent"], "the corroding is gone from the form itself");
    const text = abilityCorrection(onto, "Radio", [{ verb: "zersetzt", why: "bräuchte Säure" }]);
    assert.match(text, /zersetzt \(bräuchte Säure\)/);
  });

  it("resolves free keywords to canonical tags and verbs", () => {
    const r = formFromLlm(
      onto,
      {
        name: "Rostwurm",
        base: null,
        scale: 2,
        plane: "leben",
        archetype: "serpent",
        properties: ["Tier", "Eisen", "gierig", "Quantenschaum", "korrosiv", "Fäulnis"],
        mechanisms: ["rostet", "lässt verrotten"],
        weaknesses: ["gierig"],
        intended_mechanism: "rostet",
      },
      "ein Rostwurm",
    );
    assert.ok(r);
    assert.ok(r.form.tags.includes("tier"));
    assert.ok(r.form.tags.includes("eisen"));
    assert.ok(r.form.verbs.includes("rostet"));
    assert.ok(r.form.verbs.includes("verrottet"), "verb resolved by its label");
    assert.deepEqual(r.form.weak, ["gierig"]);
    assert.equal(r.intendedVerb, "rostet");
    assert.ok(r.unresolved.includes("Quantenschaum"));
    assert.equal(r.form.origin, "llm");
  });

  it("builds on a lexicon anchor and applies removals", () => {
    const r = formFromLlm(
      onto,
      {
        name: "Gläserner Wolf",
        base: "wolf",
        scale: 9,
        plane: "leben",
        archetype: "beast",
        properties: ["Glas"],
        remove_properties: ["Fleisch", "blutet"],
        mechanisms: [],
        intended_mechanism: null,
      },
      "gläserner Wolf",
    );
    assert.ok(r);
    assert.equal(r.base?.id, "wolf");
    assert.equal(r.form.scale, 5, "clamped to base ±2");
    assert.ok(onto.formHas(r.form, "glas"));
    assert.ok(!onto.formHas(r.form, "fleisch"), "removal survives the mensch/tier implication");
    assert.ok(r.form.verbs.includes("zerreisst"), "inherits the anchor's mechanisms");
  });

  it("rejects garbage", () => {
    assert.equal(formFromLlm(onto, null, "x"), undefined);
    assert.equal(formFromLlm(onto, { properties: ["xyzzy"], mechanisms: [] }, "x"), undefined);
  });

  it("finds anchors for compounds and typos", () => {
    assert.equal(anchorsFor(onto, "riesiger Eiswolf")[0]?.id, "wolf");
    assert.ok(anchorsFor(onto, "Drachn").some((f) => f.id === "drache"));
  });
});

describe("callClaude", () => {
  it("sends a cached system prompt, forces the tool and parses the reply", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      sent = { url, init };
      return Promise.resolve(new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "gestalt", input: { ok: true } }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
        }),
        { status: 200 },
      ));
    }) as unknown as typeof fetch;
    const r = await callClaude(
      { ...DEFAULT_SETTINGS, apiKey: "test" },
      { system: "S", user: "U", maxTokens: 50, tool: { name: "gestalt", description: "d", input_schema: {} } },
      fakeFetch,
    );
    assert.deepEqual(r.toolInput, { ok: true });
    assert.equal(r.usage.cacheRead, 100);
    assert.ok(sent);
    const body = JSON.parse(sent.init.body as string) as Record<string, unknown>;
    assert.deepEqual(body["tool_choice"], { type: "tool", name: "gestalt" });
    assert.equal(body["model"], "claude-haiku-4-5-20251001");
    const headers = sent.init.headers as Record<string, string>;
    assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  });

  it("refuses to call without a key", async () => {
    await assert.rejects(callClaude(DEFAULT_SETTINGS, { system: "", user: "", maxTokens: 1 }));
  });

  it("estimates Haiku cost", () => {
    assert.equal(estimateCostUsd({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 1);
  });
});

describe("key hygiene", () => {
  it("does not persist secrets unless the player opts in", () => {
    const s = { ...DEFAULT_SETTINGS, apiKey: "sk-ant-secret", accessCode: "code" };
    assert.equal(persistable(s).apiKey, "");
    assert.equal(persistable(s).accessCode, "");
    assert.equal(persistable({ ...s, rememberSecrets: true }).apiKey, "sk-ant-secret");
  });

  it("secret scan recognises Anthropic keys", () => {
    assert.ok(scanText(`const k = "sk-ant-api03-${"x".repeat(40)}"`));
    assert.ok(!scanText("placeholder: sk-ant-…"));
  });
});

describe("narration stays short", () => {
  it("keeps whole sentences that fit, otherwise cuts at a word", async () => {
    const { brief } = await import("../src/llm/narrator.ts");
    assert.equal(brief("Kurz und gut.", 150), "Kurz und gut.");
    const long = "Der Drache speit Feuer über die Arena. " + "Die Flammen lecken an jedem Stein und jeder Säule, bis nichts mehr bleibt als Asche und Rauch und Stille.".repeat(3);
    const b = brief(long, 150);
    assert.equal(b, "Der Drache speit Feuer über die Arena.");
    assert.ok(brief("x ".repeat(200), 150).length <= 152);
  });
});
