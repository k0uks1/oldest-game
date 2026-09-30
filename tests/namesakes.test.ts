/**
 * One thing, one grimoire entry: a learned form typed again in other words ("die Bibel" after
 * "Bibel") is recognised, not learned a second time – and twins older servers made are folded
 * into one on load. Claude is simulated.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { createGame, play } from "../src/engine/game.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { ContentPack, FormSpec } from "../src/engine/ontology/pack.ts";
import type { GameState } from "../src/engine/types.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { emptyLearnedPack, lexiconNames, mergeNamesakes, reconcileLearned } from "../src/llm/learning.ts";
import { readLearnedFile } from "../server/learned.ts";

const core = loadPack(CORE_PACK_RAW);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const bibel = {
  name: "Bibel",
  base: null,
  scale: 2,
  plane: "geist",
  archetype: "book",
  properties: ["papier", "heilig", "glaubt"],
  mechanisms: ["bannt"],
  weaknesses: ["papier"],
  intended_mechanism: null,
  new_properties: [],
  new_qualities: [],
  new_mechanism: null,
};

function fakeClaude(answer: unknown = bibel): string[] {
  const asked: string[] = [];
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { tools?: { name: string }[]; messages: { content: string }[] };
    const tool = body.tools?.[0]?.name ?? "text";
    asked.push(tool);
    const content = tool === "text" ? [{ type: "text", text: "…" }] : [{ type: "tool_use", input: answer }];
    return Promise.resolve(new Response(JSON.stringify({ content, usage: {} }), { status: 200 }));
  };
  return asked;
}

function resolver(): Resolver {
  return new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => ({ ...DEFAULT_SETTINGS, proxyUrl: "/api/claude" }),
    debug: () => false,
    saveLearned: () => undefined,
    today: () => "2026-09-29",
  });
}

/** A duel past its opening (a mouse on the board) – the opening allows only small forms. */
function afterOpening(): GameState {
  const onto = Ontology.compile([core]);
  const mouse = onto.formById("maus");
  assert.ok(mouse !== undefined);
  const r = play(onto, createGame(["A", "B"]), mouse, null);
  assert.ok(r.ok);
  return r.value;
}

describe("Eine Gestalt, ein Eintrag", () => {
  it("the same thing in other words is the known form, remembered – and the new wording is learned", async () => {
    const r = resolver();
    const asked = fakeClaude();
    const first = await r.resolve(createGame(["A", "B"]), "Bibel");
    assert.ok(first.kind === "turn");
    const again = await r.resolve(createGame(["A", "B"]), "die Bibel");
    assert.ok(again.kind === "turn");
    assert.equal(again.turn.form.id, first.turn.form.id);
    assert.equal(again.turn.novelty?.kind, "remembered");
    assert.equal(r.learned.forms.filter((f) => f.name === "Bibel").length, 1, "one grimoire entry");
    const parses = asked.filter((t) => t === "gestalt").length;
    await r.resolve(createGame(["A", "B"]), "die Bibel");
    assert.equal(asked.filter((t) => t === "gestalt").length, parses, "the new wording is known now – no Claude call");
  });

  it("words beyond the name make another form: the ten-legged Rincewind stays ten-legged", async () => {
    const rincewind = { name: "Rincewind", base: null, scale: 3, plane: "geist", archetype: "humanoid", properties: ["mensch", "magisch"], mechanisms: ["bannt"], weaknesses: ["mensch"], intended_mechanism: null };
    const r = resolver();
    fakeClaude(rincewind);
    const plain = await r.resolve(createGame(["A", "B"]), "Rincewind");
    assert.ok(plain.kind === "turn");
    // Claude calls the joke form just „Rincewind“ again (with its extra legs in the properties)
    fakeClaude({ ...rincewind, properties: ["mensch", "magisch", "schnell"] });
    const ten = await r.resolve(createGame(["A", "B"]), "zehnbeiniger Rincewind");
    assert.ok(ten.kind === "turn");
    assert.notEqual(ten.turn.form.id, plain.turn.form.id);
    assert.equal(ten.turn.form.name, "Zehnbeiniger Rincewind", "the player's words, since „Rincewind“ is taken");
    // and it is recognised by its own words from now on – still ten-legged
    const again = await r.resolve(createGame(["A", "B"]), "zehnbeiniger Rincewind");
    assert.ok(again.kind === "turn");
    assert.equal(again.turn.form.id, ten.turn.form.id);
  });

  it("repair: forms of the same name but another shape are not folded, and alien wordings come off", () => {
    const g = (id: string, tags: string[], aliases: string[], scale = 3): FormSpec => ({ id, name: "Gandalf", archetype: "humanoid", scale, plane: "geist", tags, verbs: ["bannt"], aliases });
    const two = mergeNamesakes({ ...emptyLearnedPack(), forms: [g("g:gandalf", ["mensch"], ["gandalf"]), g("g:zehnbeiniger_gandalf", ["mensch", "schnell"], ["zehnbeiniger gandalf"], 4)] });
    assert.equal(two.forms.length, 2, "another shape is another form");
    // what an earlier merge left behind: the joke's wording on the plain Gandalf
    const fixed = mergeNamesakes({ ...emptyLearnedPack(), forms: [g("g:gandalf", ["mensch"], ["gandalf", "der gandalf", "zehnbeiniger gandalf"])] });
    assert.deepEqual(fixed.forms[0]?.aliases, ["gandalf", "der gandalf"]);
    const own = mergeNamesakes({ ...emptyLearnedPack(), forms: [{ ...g("g:alte_bibel", ["mensch"], ["alte bibel", "bibel"]), name: "Bibel" }] });
    assert.deepEqual(own.forms[0]?.aliases, ["alte bibel", "bibel"], "the form's own first wording stays");
  });

  it("the player's own name stays: a lookalike of a lexicon form is not played as that form", async () => {
    // Claude took the monk as base (a „heiliger“ anchor) and changed nothing – still an „Unheiliger Franzose“
    fakeClaude({ name: "Unheiliger Franzose", base: "moench", scale: 3, plane: "geist", archetype: "humanoid", properties: [], mechanisms: [], weaknesses: [], intended_mechanism: null });
    const r = resolver();
    const t = await r.resolve(createGame(["A", "B"]), "unheiliger Franzose");
    assert.ok(t.kind === "turn");
    assert.equal(t.turn.form.name, "Unheiliger Franzose");
    assert.notEqual(t.turn.form.id, "moench");
    // typing the lexicon form itself still plays the original
    fakeClaude({ name: "Mönch", base: "moench", scale: 3, plane: "geist", archetype: "humanoid", properties: [], mechanisms: [], weaknesses: [], intended_mechanism: null });
    const m = await r.resolve(createGame(["A", "B"]), "ein Mönch");
    assert.ok(m.kind === "turn");
    assert.equal(m.turn.form.id, "moench");
  });

  it("spelling does not make another form: „Eichel Ober“, „Eichel-Ober“, „Eichel Ober Gang“ are the lexicon's", async () => {
    // Claude would call it a variation – it is never asked
    const asked = fakeClaude({ name: "Eichel Ober", base: "eichelober", scale: 4, plane: "leben", archetype: "humanoid", properties: ["laut"], mechanisms: [], weaknesses: [], intended_mechanism: null, zusaetze: ["Eichel Ober"] });
    const r = resolver();
    for (const [text, id] of [["Eichel Ober", "eichelober"], ["Eichel-Ober", "eichelober"], ["der eichelober", "eichelober"], ["Eichel Ober Gang", "eichelober_gang"], ["Eichelober Gang", "eichelober_gang"]] as const) {
      const t = await r.resolve(afterOpening(), text);
      assert.ok(t.kind === "turn", text);
      assert.equal(t.turn.form.id, id, text);
    }
    assert.equal(asked.filter((t) => t === "gestalt").length, 0, "no Claude call for a spelling");
    assert.equal(r.learned.forms.length, 0, "nothing learned");
  });

  it("how a form attacks is not its name: „Haus, stürzt auf den Gegner ein“ is the house", async () => {
    // Claude reads the collapse into the house as a variation
    fakeClaude({ name: "Haus", base: "haus", scale: 4, plane: "materie", archetype: "house", properties: ["masse"], mechanisms: ["begraebt"], weaknesses: [], intended_mechanism: "begraebt", zusaetze: ["stürzt ein"] });
    const r = resolver();
    const t = await r.resolve(afterOpening(), "Haus, stürzt auf den Gegner ein");
    assert.ok(t.kind === "turn");
    assert.equal(t.turn.form.id, "haus");
    assert.equal(r.learned.forms.length, 0, "no grimoire entry");
    // a real variation with a clause keeps the player's form words only
    fakeClaude({ name: "Haus", base: "haus", scale: 5, plane: "materie", archetype: "house", properties: ["brennt"], mechanisms: [], weaknesses: [], intended_mechanism: null, zusaetze: ["brennend"] });
    const b = await r.resolve(afterOpening(), "brennendes Haus, stürzt ein");
    assert.ok(b.kind === "turn");
    assert.equal(b.turn.form.name, "Brennendes Haus");
  });

  it("repair: a stored name that kept the attack is cut back to the form's words", () => {
    const f: FormSpec = { id: "g:haus_stuerzt_auf_den_gegner_ein", name: "Haus, stürzt auf den Gegner ein", archetype: "house", scale: 4, plane: "materie", tags: ["stein"], verbs: ["trotzt"], base: "haus", aliases: ["haus stuerzt auf den gegner ein"] };
    const wild: FormSpec = { id: "g:veni_vidi_vici", name: "Veni, Vidi, Vici", archetype: "humanoid", scale: 3, plane: "geist", tags: ["mensch"], verbs: ["bannt"], aliases: ["veni vidi vici"] };
    const fixed = mergeNamesakes({ ...emptyLearnedPack(), forms: [f, wild] }, lexiconNames([core]));
    const [house, veni] = fixed.forms;
    assert.ok(house !== undefined && veni !== undefined);
    assert.equal(house.name, "Haus");
    assert.deepEqual(house.aliases, ["haus stuerzt auf den gegner ein"], "its own first wording stays");
    assert.equal(veni.name, "Veni, Vidi, Vici", "a wild name with commas stays whole – „Veni“ is no known form");
  });

  it("anchors: typos yes, lookalikes no – „unheiliger“ is not the monk's „heiliger“", async () => {
    const { anchorsFor } = await import("../src/llm/parser.ts");
    const onto = Ontology.compile([core]);
    assert.deepEqual(anchorsFor(onto, "unheiliger Franzose"), []);
    assert.deepEqual(anchorsFor(onto, "Wolff").map((f) => f.id), ["wolf"]);
    assert.deepEqual(anchorsFor(onto, "gläserner Wolf").map((f) => f.id), ["wolf"]);
  });

  it("twins made before are folded into the first: aliases, precedents, notes and evidence follow", () => {
    const spec = (id: string, aliases: string[]): FormSpec => ({ id, name: "Bibel", archetype: "book", scale: 2, plane: "geist", tags: ["papier", "heilig"], verbs: ["bannt"], weak: ["papier"], aliases });
    const pack: ContentPack = {
      ...emptyLearnedPack(),
      forms: [spec("g:bibel", ["bibel"]), spec("g:die_bibel", ["die bibel"])],
      rulings: [
        { attacker: "g:die_bibel", target: "ratte", valid: true, verb: "bannt", reason: "Gebannt." },
        { attacker: "g:bibel", target: "g:die_bibel", valid: false, verb: "bannt", reason: "Sich selbst?" },
      ],
      notes: [{ form: "ratte", other: "g:die_bibel", text: "Quatsch." }],
      extensions: [{ verb: "bannt", targets: ["fleisch"], evidence: ["g:die_bibel>ratte", "g:bibel>ratte"] }],
    };
    const one = mergeNamesakes(pack);
    assert.deepEqual(one.forms.map((f) => f.id), ["g:bibel"]);
    assert.deepEqual(one.forms[0]?.aliases, ["bibel", "die bibel"]);
    assert.deepEqual(one.rulings, [{ attacker: "g:bibel", target: "ratte", valid: true, verb: "bannt", reason: "Gebannt." }], "a ruling against itself goes");
    assert.equal(one.notes?.[0]?.other, "g:bibel");
    assert.deepEqual(one.extensions?.[0]?.evidence, ["g:bibel>ratte"]);
    assert.equal(mergeNamesakes(one), one, "nothing to do: the same pack");
    assert.equal(reconcileLearned([core], pack)?.forms.length, 1);
    // a variation is another thing, even with the same name
    const varied = mergeNamesakes({ ...pack, forms: [spec("g:bibel", []), { ...spec("g:bibel_brennt", []), base: "buch", mods: ["brennend"] }] });
    assert.equal(varied.forms.length, 2);
  });

  it("the server folds twins in its stored pack when it loads it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "twins-")), "pack.json");
    const spec = (id: string): FormSpec => ({ id, name: "Bibel", archetype: "book", scale: 2, plane: "geist", tags: ["papier", "heilig"], verbs: ["bannt"], weak: ["papier"], aliases: [id.slice(2).replace(/_/g, " ")] });
    writeFileSync(file, JSON.stringify({ ...emptyLearnedPack(), forms: [spec("g:bibel"), spec("g:die_bibel")] }));
    assert.deepEqual(readLearnedFile([core], file).forms.map((f) => f.id), ["g:bibel"]);
  });
});
