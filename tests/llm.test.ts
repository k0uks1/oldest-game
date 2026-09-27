import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { callClaude, DEFAULT_SETTINGS, estimateCostUsd } from "../src/llm/client.ts";
import { anchorsFor, formFromLlm } from "../src/llm/parser.ts";

const onto = coreOntology();

describe("formFromLlm – mapping model output onto the ontology", () => {
  it("resolves free keywords to canonical tags and verbs", () => {
    const r = formFromLlm(
      onto,
      {
        name: "Rostwurm",
        base: null,
        scale: 2,
        plane: "leben",
        archetype: "serpent",
        properties: ["Tier", "Eisen", "gierig", "Quantenschaum"],
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
