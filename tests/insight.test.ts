import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { ContentPack, FormSpec, RulingSpec } from "../src/engine/ontology/pack.ts";
import { checkCounter } from "../src/engine/rules.ts";
import { describeInsight, findInsights, learnInsights, MIN_EVIDENCE, withInsights } from "../src/game/insight.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";
import { applyPackDelta, packDelta } from "../src/online/protocol.ts";

const core = loadPack(CORE_PACK_RAW);

const blase = (id: string, name: string): FormSpec => ({ id, name, archetype: "orb", scale: 2, plane: "materie", tags: ["g_platzt_leicht", "luft"], verbs: ["verweht"] });

/** Soap bubbles nothing in the core can extinguish – until the precedents say water does. */
function pack(rulings: readonly RulingSpec[]): ContentPack {
  return {
    ...emptyLearnedPack(),
    tags: [{ id: "g_platzt_leicht", label: "platzt leicht", group: "merkmal", parents: ["fest"] }],
    forms: [blase("g:seifenblase", "Seifenblase"), blase("g:kaugummiblase", "Kaugummiblase"), blase("g:riesenblase", "Riesenblase")],
    rulings,
  };
}
const win = (attacker: string, target: string): RulingSpec => ({ attacker, target, valid: true, verb: "loescht", reason: "Wasser lässt Blasen platzen." });

describe("Siegwege aus Präzedenzfällen", () => {
  it("one precedent is only a precedent", () => {
    const onto = Ontology.compile([core, pack([win("feuerwehrmann", "g:seifenblase")])]);
    assert.deepEqual(findInsights(onto), []);
    assert.equal(MIN_EVIDENCE, 2);
  });

  it("two agreeing precedents become a rule for everything with that property", () => {
    const learned = pack([win("feuerwehrmann", "g:seifenblase"), win("wasser", "g:kaugummiblase")]);
    const onto = Ontology.compile([core, learned]);
    const feuerwehr = onto.formById("feuerwehrmann");
    const riesen = onto.formById("g:riesenblase");
    assert.ok(feuerwehr && riesen);
    assert.equal(checkCounter(onto, feuerwehr, riesen, "loescht").failedAt, "surface", "before: nothing to extinguish");
    const insights = findInsights(onto);
    assert.deepEqual(
      insights.map((n) => [n.verb, n.kind, n.tag]),
      [["loescht", "hits", "g_platzt_leicht"]],
      "the most specific declared property – not `luft`, which both also have but water should not hit in general",
    );
    const next = withInsights(learned, insights);
    const o2 = Ontology.compile([core, next]);
    const r2 = o2.formById("g:riesenblase");
    const f2 = o2.formById("feuerwehrmann");
    assert.ok(r2 && f2);
    assert.notEqual(checkCounter(o2, f2, r2, "loescht").failedAt, "surface", "the third bubble is reachable too");
    assert.match(describeInsight(o2, insights[0] ?? { verb: "", kind: "hits", tag: "" }), /„löscht“ wirkt jetzt auf alles, was platzt leicht ist/);
    assert.deepEqual(findInsights(o2), [], "learned once – the precedents now agree with the engine");
  });

  it("widenings travel in pack deltas and never replace a mechanism, only add", () => {
    const learned = pack([win("feuerwehrmann", "g:seifenblase"), win("wasser", "g:kaugummiblase")]);
    const next = withInsights(learned, findInsights(Ontology.compile([core, learned])));
    const d = packDelta(learned, next);
    assert.equal(d.extensions?.length, 1);
    assert.deepEqual(applyPackDelta(learned, d).extensions, next.extensions);
    const o = Ontology.compile([core, next]);
    const loescht = o.verbs.get("loescht");
    const coreLoescht = Ontology.compile([core]).verbs.get("loescht");
    assert.ok(loescht && coreLoescht);
    for (const t of coreLoescht.targets) assert.ok(loescht.targets.includes(t));
  });

  it("the other way round: precedents that deny a win become a blocker – as long as nothing becomes unbeatable", () => {
    const flamme = (id: string, name: string): FormSpec => ({ id, name, archetype: "flame", scale: 3, plane: "materie", tags: ["feuer", "g_ewig"], verbs: ["verbrennt"] });
    const deny = (attacker: string, target: string): RulingSpec => ({ attacker, target, valid: false, verb: "loescht", reason: "Eine ewige Flamme erlischt nicht." });
    const learned: ContentPack = {
      ...emptyLearnedPack(),
      tags: [{ id: "g_ewig", label: "ewig brennend", group: "merkmal", parents: ["unsterblich"] }],
      forms: [flamme("g:ewige_flamme", "Ewige Flamme"), flamme("g:olympisches_feuer", "Olympisches Feuer")],
      rulings: [deny("wasser", "g:ewige_flamme"), deny("feuerwehrmann", "g:olympisches_feuer")],
    };
    const onto = Ontology.compile([core, learned]);
    const wasser = onto.formById("wasser");
    const flame = onto.formById("g:ewige_flamme");
    assert.ok(wasser && flame);
    assert.ok(checkCounter(onto, wasser, flame, "loescht").valid, "the engine alone lets water win");
    const l = learnInsights([core], learned, onto);
    assert.ok(l);
    assert.deepEqual(l.pack.extensions?.map((x) => [x.verb, x.blockedBy]), [["loescht", ["g_ewig"]]]);
    const f2 = l.onto.formById("g:ewige_flamme");
    const w2 = l.onto.formById("wasser");
    assert.ok(f2 && w2);
    assert.equal(checkCounter(l.onto, w2, f2, "loescht").valid, false);
  });
});
