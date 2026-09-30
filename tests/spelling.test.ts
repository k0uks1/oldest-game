/**
 * Spelling never makes another form – checked for every lexicon form, not a few hand-picked names, so a
 * regression shows up whichever form it hits. Each form gets its own variants: joined, spaced, hyphenated,
 * other case, with an article, and split at a point derived from its name („Eichelober“ → „Eichel Ober“),
 * so the split points differ from form to form. Debug mode (mechanical parser) and live mode (Claude
 * simulated) are both covered.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { createGame } from "../src/engine/game.ts";
import { Ontology, lookupKey } from "../src/engine/ontology/ontology.ts";
import type { FormSpec } from "../src/engine/ontology/pack.ts";
import { parseForm } from "../src/engine/parse.ts";
import { hash32 } from "../src/engine/text.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";

const core = loadPack(CORE_PACK_RAW);
const onto = Ontology.compile([core]);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Forms reachable by their own name (a name taken by an earlier form belongs to that one). */
const forms = core.forms.filter((f) => onto.formByName(lookupKey(f.name))?.id === f.id);

/** Split one word at a point picked from `seed` („Eichelober“ → „Eichel ober“); short words stay whole. */
function splitAt(word: string, seed: number, glue: string): string {
  if (word.length < 6) return word;
  const at = 3 + (seed % (word.length - 5));
  return `${word.slice(0, at)}${glue}${word.slice(at)}`;
}

/** The ways players write the same name. */
function spellings(name: string): string[] {
  const seed = hash32(name);
  const words = name.split(/[\s-]+/);
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const split = (glue: string, s: number): string => name.replace(longest, splitAt(longest, s, glue));
  const article = ["der", "die", "das", "ein", "eine"][seed % 5] ?? "der";
  return [
    words.join(""),
    words.join(" "),
    words.join("-"),
    name.toLowerCase(),
    name.toUpperCase(),
    // an article – unless the name has one already („Der Weiße Hai“)
    ...(/^(der|die|das|ein|eine) /i.test(name) ? [] : [`${article} ${name}`]),
    `  ${words.join("   ")} `,
    split(" ", seed),
    split("-", seed >>> 8),
  ];
}

/** How a form attacks, after its name – never part of it. */
const ATTACKS = ["stürzt auf den Gegner ein", "greift an", "schlägt zu: mit voller Wucht", "rollt heran – unaufhaltsam", "beißt; dann flieht er"];
const SEPARATORS = [", ", ": ", " – ", "; ", " - "];

function resolver(): Resolver {
  return new Resolver(onto, [core], emptyLearnedPack(), {
    llm: () => ({ ...DEFAULT_SETTINGS, proxyUrl: "/api/claude" }),
    debug: () => false,
    saveLearned: () => undefined,
    today: () => "2026-09-30",
  });
}

/** Simulated Claude: answers each classification with `answer(text)`, counts the calls. */
function fakeClaude(answer: (text: string) => unknown): { calls: number } {
  const seen = { calls: 0 };
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { tools?: { name: string }[]; messages: { content: unknown }[] };
    seen.calls++;
    const text = JSON.stringify(body.messages.at(-1)?.content ?? "");
    const content = body.tools === undefined ? [{ type: "text", text: "…" }] : [{ type: "tool_use", input: answer(text) }];
    return Promise.resolve(new Response(JSON.stringify({ content, usage: {} }), { status: 200 }));
  };
  return seen;
}

/** Claude calling a lexicon form by `name` – with something it read into the player's words. */
function claudeSays(f: FormSpec, name: string, extra = true): Record<string, unknown> {
  return {
    name,
    base: f.id,
    scale: extra ? Math.min(8, f.scale + 1) : f.scale,
    plane: f.plane,
    archetype: f.archetype,
    properties: [],
    mechanisms: [],
    weaknesses: [],
    intended_mechanism: null,
    ...(extra ? { zusaetze: ["wuchtig"] } : {}),
  };
}

describe("Schreibweise macht keine neue Gestalt – für jede Gestalt des Lexikons", () => {
  it(`covers the whole lexicon (${String(forms.length)} forms)`, () => {
    assert.ok(forms.length > 1000);
    assert.ok(forms.some((f) => f.id === "eichelober") && forms.some((f) => f.id === "eichelober_gang"));
  });

  it("debug mode: every spelling of a form's name is that form", () => {
    const wrong: string[] = [];
    for (const f of forms) {
      for (const text of spellings(f.name)) {
        const r = parseForm(onto, text);
        if (!r.ok || r.form.id !== f.id) wrong.push(`„${text}“ → ${r.ok ? r.form.id : r.error} (erwartet ${f.id})`);
      }
    }
    assert.deepEqual(wrong.slice(0, 20), []);
  });

  it("live mode: every spelling of a form's name is that form, without asking Claude", async () => {
    const claude = fakeClaude(() => ({}));
    const r = resolver();
    const state = createGame(["A", "B"]);
    const wrong: string[] = [];
    for (const f of forms) {
      for (const text of spellings(f.name)) {
        const c = await r.classify(state, text);
        if (!c.ok || c.form.id !== f.id) wrong.push(`„${text}“ → ${c.ok ? c.form.id : c.reason} (erwartet ${f.id})`);
      }
    }
    assert.deepEqual(wrong.slice(0, 20), []);
    assert.equal(claude.calls, 0, "a spelling is never sent to Claude");
    assert.equal(r.learned.forms.length, 0);
  });

  it("live mode: Claude's answer in another spelling, with the attack after the name, is the lexicon form", async () => {
    // Claude names the form in the player's spelling and reads the attack into it – still the form itself
    let current: FormSpec | undefined;
    let spelt = "";
    fakeClaude(() => (current === undefined ? {} : claudeSays(current, spelt)));
    const r = resolver();
    const state = createGame(["A", "B"]);
    const wrong: string[] = [];
    for (const [i, f] of forms.entries()) {
      const all = spellings(f.name);
      spelt = all[hash32(f.id) % all.length] ?? f.name;
      current = f;
      const text = `${spelt}${SEPARATORS[i % SEPARATORS.length] ?? ", "}${ATTACKS[hash32(f.name) % ATTACKS.length] ?? "greift an"}`;
      const c = await r.classify(state, text);
      if (!c.ok || c.form.id !== f.id) wrong.push(`„${text}“ → ${c.ok ? `${c.form.id} „${c.form.name}“` : c.reason} (erwartet ${f.id})`);
    }
    assert.deepEqual(wrong.slice(0, 20), []);
    assert.equal(r.learned.forms.length, 0, "nothing learned, no grimoire entry");
  });

  it("live mode: words beyond the name still reach Claude – the shortcut is not a match-anything", async () => {
    const claude = fakeClaude(() => ({}));
    const r = resolver();
    const state = createGame(["A", "B"]);
    const adjectives = ["zehnbeiniger", "gläserner", "winziger", "brennender", "uralter"];
    for (const f of forms.filter((_, i) => i % 7 === 3)) {
      const before = claude.calls;
      await r.classify(state, `${adjectives[hash32(f.id) % adjectives.length] ?? "winziger"} ${f.name}`);
      assert.ok(claude.calls > before, `„… ${f.name}“ was asked`);
    }
  });

  it("live mode: a varied form keeps the player's form words as its name – never the attack", async () => {
    // a sample that moves through the lexicon (every 97th form, a different adjective and attack each)
    const sample = forms.filter((_, i) => i % 97 === 11);
    assert.ok(sample.length >= 10);
    let current: FormSpec | undefined;
    fakeClaude(() => (current === undefined ? {} : claudeSays(current, current.name)));
    const r = resolver();
    const state = createGame(["A", "B"]);
    for (const [i, f] of sample.entries()) {
      current = f;
      const words = `Riesiges ${f.name}`;
      const text = `${words}${SEPARATORS[i % SEPARATORS.length] ?? ", "}${ATTACKS[i % ATTACKS.length] ?? "greift an"}`;
      const c = await r.classify(state, text);
      assert.ok(c.ok, text);
      assert.equal(c.form.name, words, text);
    }
  });
});
