/**
 * Urteil: two forms the players invented meet – Claude judges and names what was missing, the
 * forms learn it, the engine checks again; a remaining disagreement becomes a precedent.
 * Claude is simulated (fetch), everything else runs for real.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { createGame } from "../src/engine/game.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { GameState } from "../src/engine/types.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { judgementFrom } from "../src/llm/judge.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";

const core = loadPack(CORE_PACK_RAW);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const blase = {
  name: "Seifenblasen-Drache",
  base: null,
  scale: 3,
  plane: "materie",
  archetype: "beast",
  properties: ["luft", "fliegt", "Seifenhaut"],
  mechanisms: ["blendet"],
  weaknesses: ["Seifenhaut"],
  intended_mechanism: null,
  ton: "heiter",
  new_properties: [{ name: "Seifenhaut", art: "ist", parents: ["fluessig"] }],
  new_qualities: [],
  new_mechanism: null,
};
const kaktuskatze = {
  name: "Kaktuskatze",
  base: null,
  scale: 3,
  plane: "leben",
  archetype: "beast",
  properties: ["saeugetier", "pflanze", "spitz", "klauen"],
  mechanisms: ["zerreisst"],
  weaknesses: ["pflanze"],
  intended_mechanism: null,
};

type Answer = (tool: string, user: string) => unknown;

function fakeClaude(answer: Answer): string[] {
  const calls: string[] = [];
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { tools?: { name: string }[]; messages: { content: string }[] };
    const tool = body.tools?.[0]?.name ?? "text";
    calls.push(tool);
    const input = answer(tool, body.messages[0]?.content ?? "");
    const content = tool === "text" ? [{ type: "text", text: "…" }] : [{ type: "tool_use", input }];
    return Promise.resolve(new Response(JSON.stringify({ content, usage: {} }), { status: 200 }));
  };
  return calls;
}

function resolver(): Resolver {
  return new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => ({ ...DEFAULT_SETTINGS, proxyUrl: "/api/claude" }),
    debug: () => false,
    saveLearned: () => undefined,
    today: () => "2026-09-28",
  });
}

async function twoInvented(r: Resolver, judge: unknown): Promise<{ state: GameState; calls: string[] }> {
  const calls = fakeClaude((tool, user) => (tool === "urteil" ? judge : user.includes("Kaktuskatze") ? kaktuskatze : blase));
  const first = await r.resolve(createGame(["A", "B"]), "Seifenblasen-Drache");
  assert.equal(first.kind, "turn");
  const s1 = first.turn.state;
  const second = await r.resolve(s1, "Kaktuskatze");
  assert.equal(second.kind, "turn", second.kind === "rejected" ? second.reason : "");
  return { state: second.turn.state, calls };
}

describe("Urteil für zwei erfundene Gestalten", () => {
  it("Claude judges, the forms learn what was missing, and the engine then agrees by itself", async () => {
    const r = resolver();
    const judge = {
      sieg: true,
      begruendung: "Kaktusstacheln lassen jede Seifenhaut platzen.",
      mechanismus: "lässt platzen",
      angreifer: { eigenschaften: [] },
      ziel: { eigenschaften: ["platzt leicht"] },
      new_properties: [{ name: "platzt leicht", art: "merkmal", parents: ["zerbrechlich", "fest"] }],
      new_mechanism: { label: "lässt platzen", family: "gewalt", targets: ["platzt leicht"], braucht: ["spitz"], hint: "Ein Stich, und es ist vorbei." },
    };
    const { state, calls } = await twoInvented(r, judge);
    assert.ok(calls.includes("urteil"));
    const last = state.history.at(-1);
    assert.equal(last?.verb, "g_laesst_platzen");
    const target = state.history.at(-2)?.form;
    assert.ok(target?.tags.includes("g_platzt_leicht"), "the target on stage is the better-understood version");
    assert.ok(r.learned.verbs.some((v) => v.id === "g_laesst_platzen"));
    assert.equal((r.learned.rulings ?? []).length, 0, "no precedent needed");
    // requires spitz: only carriers can use it
    assert.deepEqual(r.learned.verbs.find((v) => v.id === "g_laesst_platzen")?.requires, { any: ["spitz"] });
  });

  it("where the engine still disagrees, the verdict becomes a precedent – and the pair is judged only once", async () => {
    // what the engine says on its own (an unusable judgement changes nothing)
    const plain = await twoInvented(resolver(), { sieg: "?", begruendung: "" });
    const engineWins = plain.state.history.at(-1)?.player === 1 && plain.state.history.length === 2;
    const r = resolver();
    const judge = { sieg: !engineWins, begruendung: "Die Katze scheut die glitschige Blase.", mechanismus: "zerreisst", angreifer: {}, ziel: {} };
    const { state, calls } = await twoInvented(r, judge);
    const ruling = (r.learned.rulings ?? [])[0];
    assert.ok(ruling, "precedent stored");
    assert.equal(ruling.valid, !engineWins);
    assert.equal(ruling.reason, "Die Katze scheut die glitschige Blase.");
    if (engineWins) assert.equal(state.history.length, 1, "the precedent overturned the engine's win");
    assert.equal(calls.filter((c) => c === "urteil").length, 1);
  });

  it("Claude's answer is shaped strictly: unknown words dropped, at most three per side", () => {
    const onto = Ontology.compile([core]);
    const wolf = onto.formById("wolf");
    const hai = onto.formById("hai");
    assert.ok(wolf && hai);
    const j = judgementFrom(onto, wolf, hai, { sieg: true, begruendung: "  weil   ", mechanismus: "zerreisst", angreifer: { eigenschaften: ["quatschwort", "schwimmt", "scharf", "laut", "spitz"] } });
    assert.ok(j);
    assert.equal(j.reason, "weil");
    assert.equal(j.verb, "zerreisst");
    assert.deepEqual(j.attacker.tags, ["schwimmt", "scharf", "laut"]);
    assert.equal(judgementFrom(onto, wolf, hai, { sieg: "ja", begruendung: "x" }), undefined);
  });

  it("one invented form is enough: an absurd win against a hand-written form is judged and overturned", async () => {
    const r = resolver();
    const radio = {
      name: "Säureradio",
      base: null,
      scale: 2,
      plane: "materie",
      archetype: "box",
      properties: ["maschine", "elektrisch", "laut", "saeure"],
      mechanisms: ["zersetzt", "uebertoent"],
      weaknesses: ["elektrisch"],
      intended_mechanism: "zersetzt",
    };
    const ratte = { name: "Ratte", base: "ratte", scale: 2, plane: "leben", archetype: "beast", properties: [], mechanisms: [], weaknesses: [], intended_mechanism: null };
    const judge = { sieg: false, begruendung: "Ein Radio dudelt, es ätzt nicht – die Ratte huscht davon.", mechanismus: "zersetzt", angreifer: {}, ziel: { eigenschaften: ["schnell"] } };
    const calls = fakeClaude((tool, user) => (tool === "urteil" ? judge : user.includes("Säureradio") ? radio : ratte));
    const first = await r.resolve(createGame(["A", "B"]), "Ratte");
    assert.equal(first.kind, "turn");
    const second = await r.resolve(first.turn.state, "Säureradio");
    assert.equal(second.kind, "turn");
    assert.ok(calls.includes("urteil"), "judged although only the attacker is invented");
    const ruling = (r.learned.rulings ?? []).find((x) => x.target === "ratte" && x.attacker === "g:saeureradio");
    assert.ok(ruling, "the engine alone would have let acid win – now a precedent says no");
    assert.equal(ruling.valid, false);
    assert.equal(second.turn.outcome.kind, "failure", "the precedent overturns the engine's win");
    assert.equal(r.onto.formById("ratte")?.tags.includes("schnell"), false, "hand-written forms never change");
    assert.match(second.turn.verdict ?? "", /Urteil/);
  });

  it("„Quatsch?“ on a win with an invented form has the pair judged again – it counts from the next time", async () => {
    const r = resolver();
    const radio = { name: "Säureradio", base: null, scale: 2, plane: "materie", archetype: "box", properties: ["maschine", "elektrisch", "laut", "saeure"], mechanisms: ["zersetzt"], weaknesses: ["elektrisch"], intended_mechanism: "zersetzt" };
    const ratte = { name: "Ratte", base: "ratte", scale: 2, plane: "leben", archetype: "beast", properties: [], mechanisms: [], weaknesses: [], intended_mechanism: null };
    let verdict: unknown = { sieg: true, begruendung: "Säure ist Säure.", mechanismus: "zersetzt" };
    fakeClaude((tool, user) => (tool === "urteil" ? verdict : user.includes("Säureradio") ? radio : ratte));
    const first = await r.resolve(createGame(["A", "B"]), "Ratte");
    assert.equal(first.kind, "turn");
    const second = await r.resolve(first.turn.state, "Säureradio");
    assert.equal(second.kind, "turn");
    assert.equal(second.turn.outcome.kind, "success");
    verdict = { sieg: false, begruendung: "Ein Radio ätzt nicht.", mechanismus: "zersetzt" };
    const reason = await r.reconsider("g:saeureradio", "ratte", "zersetzt");
    assert.equal(reason, "Ein Radio ätzt nicht.");
    assert.equal(r.onto.rulingFor("g:saeureradio", "ratte")?.valid, false);
    assert.equal(await r.reconsider("ritter", "ratte", "durchbohrt"), undefined, "two hand-written forms: the engine's own business");
  });
});

