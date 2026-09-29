import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { findCounters } from "../src/engine/rules.ts";
import { signatureFor } from "../src/render/eichel.ts";
import { artFor } from "../src/render/art.ts";
import { chooseRoom } from "../src/render/rooms.ts";

describe("Eichelober and his gang", () => {
  const onto = coreOntology();

  it("both are in the grimoire from the start, bring their standard picture and can still be beaten", () => {
    for (const id of ["eichelober", "eichelober_gang"]) {
      const f = onto.formById(id);
      assert.ok(f !== undefined, id);
      assert.ok(onto.lexicon.includes(f), `${id}: in the lexicon`);
      assert.ok(artFor(f) !== undefined, `${id}: picture`);
      assert.ok(findCounters(onto, f).length > 0, `${id}: counterable`);
    }
  });

  it("the Eichelkäse needs the käsig ability", () => {
    assert.ok(onto.compileForm(onto.formById("eichelober") ?? assert.fail()).verbs.includes("verkaest"));
    const ritter = onto.formById("ritter");
    if (ritter !== undefined) assert.ok(!onto.compileForm(ritter).verbs.includes("verkaest"));
  });

  it("names pick the show: the gang shoots acorns, the Ober attacks with cheese", () => {
    assert.equal(signatureFor("Eichelober"), "eichelkaese");
    assert.equal(signatureFor("Eichel-Ober"), "eichelkaese");
    assert.equal(signatureFor("Eichelober-Gang"), "eichelhagel");
    assert.equal(signatureFor("die Eichelbande"), "eichelhagel");
    assert.equal(signatureFor("Eiche"), null);
  });

  it("the Eichel-Arena comes at once, at any scale and before any field", () => {
    const f = (id: string) => onto.formById(id) ?? assert.fail(id);
    const all = (): boolean => true;
    assert.equal(chooseRoom(onto, [], [f("eichelober_gang")], all)?.id, "eichel", "the gang is only scale 3");
    assert.equal(chooseRoom(onto, ["nass"], [f("eichelober")], all)?.id, "eichel");
    assert.equal(chooseRoom(onto, [], [f("drache"), f("eichelober")], all)?.id, "eichel", "an older form on stage does not stop it");
  });
});
