import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, coreOntology } from "../src/content/index.ts";
import { Ontology, OntologyError } from "../src/engine/ontology/ontology.ts";
import { parsePack } from "../src/engine/ontology/pack.ts";
import { findCounters } from "../src/engine/rules.ts";
import { normalize } from "../src/engine/text.ts";

const onto = coreOntology();

describe("core pack integrity", () => {
  it("compiles without errors or warnings", () => {
    assert.deepEqual(onto.warnings, []);
  });

  it("every form can act (has at least one mechanism)", () => {
    for (const f of onto.lexicon) assert.ok(onto.compileForm(f).verbs.length > 0, f.id);
  });

  it("every form can be countered by something in the lexicon", () => {
    const uncounterable = onto.lexicon.filter((t) => findCounters(onto, t).length === 0).map((f) => f.id);
    assert.deepEqual(uncounterable, []);
  });

  it("every mechanism is usable by at least one form", () => {
    const unused = [...onto.verbs.keys()].filter((v) => onto.usersOf(v).length === 0);
    assert.deepEqual(unused, []);
  });

  it("names don't collide after normalisation", () => {
    const names = onto.lexicon.map((f) => normalize(f.name));
    assert.equal(new Set(names).size, names.length);
  });
});

describe("pack validation", () => {
  const base = parsePack(CORE_PACK_RAW);
  assert.ok(base.ok);

  it("rejects malformed packs with readable errors", () => {
    const r = parsePack({ id: "x", name: "x", version: "1", tags: [{ id: 3 }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("label")));
  });

  it("reports unknown references", () => {
    const bad = {
      id: "bad", name: "bad", version: "1", verbs: [], modifiers: [],
      tags: [{ id: "a", label: "A", group: "x", parents: ["nope"] }],
      forms: [],
    };
    const r = parsePack(bad);
    assert.ok(r.ok);
    assert.throws(() => Ontology.compile([r.pack]), OntologyError);
  });

  it("detects inheritance cycles", () => {
    const cyc = {
      id: "c", name: "c", version: "1", verbs: [], modifiers: [], forms: [],
      tags: [
        { id: "a", label: "A", group: "x", parents: ["b"] },
        { id: "b", label: "B", group: "x", parents: ["a"] },
      ],
    };
    const r = parsePack(cyc);
    assert.ok(r.ok);
    assert.throws(() => Ontology.compile([r.pack]), /Zyklus/);
  });

  it("allows packs to extend the core with new tags that inherit rules", () => {
    assert.ok(base.ok);
    const ext = parsePack({
      id: "ext", name: "Erweiterung", version: "1", verbs: [], modifiers: [],
      tags: [{ id: "mithril", label: "Mithril", group: "material", parents: ["metall"] }],
      forms: [{ id: "mithrilhemd", name: "Mithrilhemd", archetype: "weapon", scale: 2, plane: "materie", tags: ["mithril"], verbs: ["zerschlaegt"] }],
    });
    assert.ok(ext.ok);
    const o = Ontology.compile([base.pack, ext.pack]);
    const hemd = o.formById("mithrilhemd");
    assert.ok(hemd);
    // lightning targets "metall" – mithril inherits it without any new rule
    assert.ok(findCounters(o, hemd).some((c) => c.verb === "trifft_blitz"));
    // … but rust targets "eisen" only
    assert.ok(!findCounters(o, hemd).some((c) => c.verb === "rostet"));
  });
});
