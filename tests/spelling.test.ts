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
import { STOPWORDS, namedForm, nearlyNamedForm, parseForm } from "../src/engine/parse.ts";
import { hash32, tokenize } from "../src/engine/text.ts";
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

  it("words inside a name belong to it: „Hänsel und Gretel“ is not „Hänsel Gretel“, „Tiger im Tank“ not „Tiger Tank“", async () => {
    // every lexicon name with a filler word after its first word – dropping it names another thing
    const inner = forms.filter((f) => tokenize(f.name).slice(1).some((t) => STOPWORDS.has(t)));
    assert.ok(inner.some((f) => f.id === "haensel") && inner.some((f) => f.id === "esso_tiger"));
    const claude = fakeClaude(() => ({}));
    const r = resolver();
    const state = createGame(["A", "B"]);
    for (const f of inner) {
      const [first = "", ...rest] = tokenize(f.name);
      const stripped = [first, ...rest.filter((t) => !STOPWORDS.has(t))].join(" ");
      assert.notEqual(namedForm(onto, stripped)?.id, f.id, `„${stripped}“ is not ${f.name}`);
      const before = claude.calls;
      await r.classify(state, stripped);
      assert.ok(claude.calls > before, `„${stripped}“ goes to Claude`);
    }
  });

  it("wild names stay whole: particles and additions around a lexicon name make the player's own form", async () => {
    // a sample moving through the lexicon, each with other particles – „Mann von und zu Hohenstein“, „Graf von Tiger“ …
    const wild = [(n: string): string => `${n} von und zu Hohenstein`, (n: string): string => `Graf von ${n}`, (n: string): string => `${n} aus dem Nebel`, (n: string): string => `${n} zu Guttenberg`, (n: string): string => `${n} und die sieben Zwerge`, (n: string): string => `${n} von und zu`, (n: string): string => `von und zu ${n}`, (n: string): string => `${n} aus dem Off`];
    const sample = forms.filter((_, i) => i % 61 === 29);
    assert.ok(sample.length >= 16);
    let answer: Record<string, unknown> = {};
    const claude = fakeClaude(() => answer);
    const r = resolver();
    const state = createGame(["A", "B"]);
    for (const [i, f] of sample.entries()) {
      const text = (wild[i % wild.length] ?? wild[0] ?? ((n: string) => n))(f.name);
      assert.equal(namedForm(onto, text), undefined, `„${text}“ is no lexicon name`);
      // Claude keeps the player's naming and builds on the lexicon form
      answer = { ...claudeSays(f, text, false), zusaetze: [text.replace(f.name, "").trim()] };
      const before = claude.calls;
      const c = await r.classify(state, text);
      assert.ok(claude.calls > before, `„${text}“ was asked`);
      assert.ok(c.ok, text);
      assert.notEqual(c.form.id, f.id, `„${text}“ is not plain ${f.name}`);
      assert.equal(c.form.name.toLowerCase(), text.toLowerCase(), "every word of the name stays");
    }
  });

  it("a comma inside a wild name is part of it – only an attack after a known form is cut off", async () => {
    const invented = { name: "Veni, Vidi, Vici", base: null, scale: 3, plane: "geist", archetype: "humanoid", properties: ["mensch", "magisch"], mechanisms: ["bannt"], weaknesses: ["mensch"], intended_mechanism: null };
    fakeClaude(() => invented);
    const r = resolver();
    const state = createGame(["A", "B"]);
    const v = await r.classify(state, "Veni, Vidi, Vici");
    assert.ok(v.ok, v.ok ? "" : v.reason);
    assert.equal(v.form.name, "Veni, Vidi, Vici");
    // Claude answers with a taken lexicon name whose words are not all before the comma: the whole text stays
    const haensel = core.forms.find((f) => f.id === "haensel");
    assert.ok(haensel !== undefined);
    fakeClaude(() => ({ ...claudeSays(haensel, haensel.name), zusaetze: ["mit der Hexe"] }));
    const h = await r.classify(state, "Hänsel, Gretel und die Hexe");
    assert.ok(h.ok, h.ok ? "" : h.reason);
    assert.equal(h.form.name, "Hänsel, Gretel und die Hexe");
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

/** A typo in a name, picked from the name itself: a letter dropped, doubled or two neighbours swapped (never the first). */
function typo(name: string): string {
  const seed = hash32(name);
  const at = 1 + (seed % (name.length - 2));
  const kind = (seed >>> 4) % 3;
  if (kind === 0) return name.slice(0, at) + name.slice(at + 1);
  if (kind === 1) return name.slice(0, at) + name.charAt(at) + name.slice(at);
  return name.slice(0, at) + name.charAt(at + 1) + name.charAt(at) + name.slice(at + 2);
}

describe("Tippfehler in langen Namen treffen die Gestalt – nie eine andere", () => {
  const long = forms.filter((f) => lookupKey(f.name).length >= 8);

  it("a typo in a long name is that form, without asking Claude – and never another lexicon form", async () => {
    const claude = fakeClaude(() => ({}));
    const r = resolver();
    const state = createGame(["A", "B"]);
    const other: string[] = [];
    let hit = 0;
    for (const f of long) {
      const text = typo(f.name);
      if (namedForm(onto, text) !== undefined) continue; // the typo is another real name
      const n = nearlyNamedForm(onto, text);
      if (n === undefined) continue; // two forms just as close: Claude decides
      if (n.id !== f.id) other.push(`„${text}“ → ${n.id} (gemeint ${f.id})`);
      else hit++;
      const c = await r.classify(state, text);
      assert.ok(c.ok && c.form.id === n.id, text);
    }
    assert.deepEqual(other.slice(0, 20), []);
    assert.ok(hit > long.length * 0.9, `${String(hit)} of ${String(long.length)}`);
    assert.equal(claude.calls, 0);
  });

  it("Johnny Gnadenlos, Eichelober, Martin Luther – as players mistype them", () => {
    for (const [text, id] of [["Johny Gnadenlos", "johnny_gnadenlos"], ["Jhonny Gnadenlos", "johnny_gnadenlos"], ["Johnny Gnadelos", "johnny_gnadenlos"], ["Johnnie Gnadenlos", "johnny_gnadenlos"], ["Jonny Gnadenloß", "johnny_gnadenlos"], ["Jony Gnadenloß", "johnny_gnadenlos"], ["Eichel Oberr", "eichelober"], ["Eichelobr", "eichelober"], ["Martin Lutter", "martin_luther"]] as const) {
      assert.equal(parseForm(onto, text).ok && (parseForm(onto, text) as { form: { id: string } }).form.id, id, text);
      assert.equal(nearlyNamedForm(onto, text)?.id, id, text);
    }
  });

  it("an added ending is another word, not a typo: „…in“, „…en“ stay with Claude", () => {
    // forms whose other names carry such an ending already („Zahnärztin“ for the Zahnarzt) are named by them
    const stemmed = (f: FormSpec): boolean => (f.aliases ?? []).some((a) => lookupKey(a).length > lookupKey(f.name).length);
    for (const f of long.filter((x, i) => i % 9 === 0 && !stemmed(x))) {
      for (const ending of ["in", "en", "innen"]) {
        if (namedForm(onto, `${f.name}${ending}`) !== undefined) continue; // the lexicon names it („Gladiatorin“)
        const n = nearlyNamedForm(onto, `${f.name}${ending}`);
        assert.ok(n?.id !== f.id, `„${f.name}${ending}“ is not ${f.id}`);
      }
    }
  });

  it("an invented twin from before the lexicon knew the name never stands in for the original", async () => {
    fakeClaude(() => ({}));
    const johnny = core.forms.find((f) => f.id === "johnny_gnadenlos") ?? assert.fail();
    const twin: FormSpec = { ...johnny, id: "g:johnny_gnadenlos", name: "Johnny Gnadenlos", aliases: ["johnny gnadenlos", "johny gnadenlos", "johnny gnadenlos!"] };
    const learned = { ...emptyLearnedPack(), forms: [twin] };
    const r = new Resolver(Ontology.compile([core, learned]), [core], learned, {
      llm: () => ({ ...DEFAULT_SETTINGS, proxyUrl: "/api/claude" }),
      debug: () => false,
      saveLearned: () => undefined,
      today: () => "2026-10-01",
    });
    const state = createGame(["A", "B"]);
    for (const text of ["Johnny Gnadenlos", "johnny gnadenlos!", "Johny Gnadenlos"]) {
      const c = await r.classify(state, text);
      assert.ok(c.ok && c.form.id === "johnny_gnadenlos", `„${text}“ → ${c.ok ? c.form.id : c.reason}`);
    }
  });
});
