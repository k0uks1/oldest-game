import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, coreOntology, loadPack } from "../src/content/index.ts";
import { attempt } from "../src/engine/attempt.ts";
import { createGame, play } from "../src/engine/game.ts";
import { Ontology, OntologyError } from "../src/engine/ontology/ontology.ts";
import { parsePack, type ContentPack } from "../src/engine/ontology/pack.ts";
import { checkCounter as check, checkRuling, DEFAULT_CONFIG } from "../src/engine/rules.ts";
import type { CounterCheck, Form } from "../src/engine/types.ts";

const onto = coreOntology();
const checkCounter = (a: string, t: string, v: string): CounterCheck => check(onto, lx(a), lx(t), v);
const why = (c: CounterCheck): string => c.steps.map((s) => s.text).join("\n");

function lx(id: string): Form {
  const e = onto.formById(id);
  assert.ok(e, `lexicon entry ${id} missing`);
  return e;
}

function adHoc(tags: readonly string[], extra: Partial<Form> = {}): Form {
  return { id: `x_${tags.join("_")}`, name: "Probe", archetype: "orb", scale: 3, plane: "materie", tags, not: [], verbs: [], immune: [], weak: [], origin: "komponiert", ...extra };
}

describe("intensity – Hitze, Wasserkraft, Härte, Kälte", () => {
  it("a torch does not melt an anchor – but a smith does", () => {
    const torch = checkCounter("fackel", "anker", "schmilzt");
    assert.equal(torch.valid, false);
    assert.equal(torch.failedAt, "intensity");
    assert.match(why(torch), /Hitze 2 \(Fackel\) gegen Hitzefestigkeit 3 \(Anker\)/);
    const smith = checkCounter("schmied", "anker", "schmilzt");
    assert.equal(smith.valid, true, why(smith));
  });

  it("a torch still melts ice and burns wood", () => {
    assert.equal(onto.quality(lx("fackel"), "hitze"), 2);
    assert.equal(checkCounter("fackel", "eis", "schmilzt").failedAt === "intensity", false);
    assert.equal(checkCounter("fackel", "stuhl", "verbrennt").valid, true);
  });

  it("plain water does not wear down stone – a river does", () => {
    for (const t of ["bruecke", "fels"]) {
      const c = checkCounter("wasser", t, "erodiert");
      assert.equal(c.valid, false);
      assert.equal(c.failedAt, "intensity", why(c));
    }
    assert.equal(checkCounter("fluss", "fels", "erodiert").valid, true);
  });

  it("water does not quench a volcano – an ocean does", () => {
    assert.equal(checkCounter("wasser", "vulkan", "loescht").failedAt, "intensity");
    assert.equal(checkCounter("ozean", "vulkan", "loescht").valid, true);
  });

  it("a clear surplus gives +1 power (Übermacht)", () => {
    const c = checkCounter("drache", "eis", "schmilzt");
    assert.ok(c.steps.some((s) => s.text.includes("Übermacht")), why(c));
  });

  it("most specific tag wins: steel is harder than metal, gold softer", () => {
    assert.equal(onto.quality(adHoc(["stahl"]), "haerte"), 4);
    assert.equal(onto.quality(adHoc(["gold"]), "haerte"), 2);
    assert.equal(onto.quality(adHoc(["eisen"]), "haerte"), 3);
    // unrelated tags: the maximum
    assert.equal(onto.quality(adHoc(["holz", "stein"]), "haerte"), 3);
  });

  it("a form's own level beats its tags; unset forces use the default", () => {
    assert.equal(onto.quality(lx("kerze"), "hitze"), 1);
    assert.equal(onto.quality(lx("baecker"), "hitze"), 2);
    assert.equal(onto.quality(adHoc(["holz"]), "hitzefest"), 0);
  });
});

describe("containers of fire are not fire", () => {
  it("an oven burns, but water finds no fire to quench in it", () => {
    assert.equal(onto.formHas(lx("ofen"), "feuer"), false);
    assert.equal(onto.quality(lx("ofen"), "hitze"), 3);
    assert.equal(checkCounter("ofen", "stuhl", "verbrennt").valid, true);
    assert.equal(checkCounter("wasser", "ofen", "loescht").failedAt, "surface");
  });
});

describe("reach – melee cannot touch what flies", () => {
  it("a hunter does not tie up an eagle – but shoots it", () => {
    const tie = checkCounter("jaeger", "adler", "fesselt");
    assert.equal(tie.valid, false);
    assert.equal(tie.failedAt, "reach");
    assert.equal(checkCounter("jaeger", "adler", "durchbohrt").valid, true);
  });

  it("a flier or a giant still reaches a flier", () => {
    const eagle = lx("adler");
    const flyingClaws = adHoc(["tier", "fliegt"], { verbs: ["zerreisst"], scale: 3 });
    assert.notEqual(check(onto, flyingClaws, eagle, "zerreisst").failedAt, "reach");
    const giant = adHoc(["tier"], { verbs: ["zerreisst"], scale: 5 });
    assert.notEqual(check(onto, giant, eagle, "zerreisst").failedAt, "reach");
  });
});

describe("combination rules", () => {
  it("wet wood does not burn", () => {
    const wet = adHoc(["holz", "wasser"]);
    assert.equal(onto.formHas(wet, "brennbar"), false);
    assert.ok(onto.compileForm(wet).combos.includes("nasses_holz"));
    assert.equal(onto.formHas(adHoc(["holz"]), "brennbar"), true);
  });

  it("the undead do not freeze", () => {
    assert.ok(onto.quality(adHoc(["untot"]), "kaeltefest") >= 3);
  });

  it("combos only apply when all conditions hold", () => {
    assert.ok(!onto.compileForm(adHoc(["feuer"])).combos.includes("irrlicht"));
    assert.equal(onto.quality(adHoc(["feuer", "koerperlos"]), "hitze"), 1);
  });
});

describe("the referee cannot hand out mechanisms", () => {
  it("a hat facing an elephant is no uncertain case", () => {
    const g = play(onto, createGame(["A", "B"], { ...DEFAULT_CONFIG, maxOpeningScale: 4 }), lx("elefant"), null);
    assert.ok(g.ok);
    const r = attempt(onto, g.value, lx("hut"), null);
    assert.ok(r.kind === "failure");
    assert.equal(r.failure.uncertain, undefined);
  });

  it("a stored ruling with a foreign mechanism does not work", () => {
    const c = checkRuling(onto, lx("hut"), lx("elefant"), { attacker: "hut", target: "elefant", valid: true, verb: "zermalmt", reason: "?" });
    assert.equal(c.valid, false);
  });

  it("a ruling cannot overrule intensity", () => {
    const c = checkRuling(onto, lx("fackel"), lx("anker"), { attacker: "fackel", target: "anker", valid: true, verb: "schmilzt", reason: "?" });
    assert.equal(c.valid, false);
    assert.equal(c.failedAt, "intensity");
  });
});

describe("pack validation for intensities", () => {
  const core = loadPack(CORE_PACK_RAW);
  const extra = (p: Partial<ContentPack>): ContentPack => ({ id: "x", name: "x", version: "1", tags: [], verbs: [], modifiers: [], forms: [], ...p });

  it("rejects unknown qualities and out-of-range levels", () => {
    assert.throws(() => Ontology.compile([core, extra({ tags: [{ id: "x_heiss", label: "x", group: "x", qualities: { gluut: 3 } }] })]), OntologyError);
    assert.throws(() => Ontology.compile([core, extra({ tags: [{ id: "x_heiss", label: "x", group: "x", qualities: { hitze: 9 } }] })]), OntologyError);
    assert.throws(() => Ontology.compile([core, extra({ combos: [{ id: "x", if: ["gibtsnicht"], hint: "x" }] })]), OntologyError);
  });

  it("parses qualities, needs, reach and combos from JSON", () => {
    const r = parsePack({
      id: "p", name: "p", version: "1", tags: [], modifiers: [], forms: [],
      verbs: [{ id: "v", label: "v", family: "gewalt", leverage: 0, targets: ["fest"], hint: "h", reach: "weit", needs: [{ by: "hitze" }] }],
    });
    assert.equal(r.ok, false);
  });
});
