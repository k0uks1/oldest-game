import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { findCounters } from "../src/engine/rules.ts";
import { signatureFor } from "../src/render/eichel.ts";
import { artFor } from "../src/render/art.ts";

describe("Eichelober – secret characters", () => {
  const onto = coreOntology();

  it("both are secret, bring their own picture and can still be beaten", () => {
    for (const id of ["eichelober", "eichelober_gang"]) {
      const f = onto.formById(id);
      assert.ok(f !== undefined, id);
      assert.equal(f.secret, true, `${id}: secret`);
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
});
