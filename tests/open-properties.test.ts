/**
 * Open property model: Claude may bring entirely new properties – substances, abilities, traits –
 * new graded intensities (a force or a protection) and a mechanism tied to them. Everything is
 * shaped by the parser and re-validated by `learn()`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { checkCounter } from "../src/engine/rules.ts";
import { emptyLearnedPack, learn, LEARNED_TAG_FORCE, sanitizeDelta } from "../src/llm/learning.ts";
import { formFromLlm } from "../src/llm/parser.ts";
import { applyPackDelta, packDelta } from "../src/online/protocol.ts";

const core = loadPack(CORE_PACK_RAW);
const onto = Ontology.compile([core]);

const gast = {
  name: "Ungeladener Gast mit Zwiebel-Atem",
  base: null,
  scale: 3,
  plane: "leben",
  archetype: "humanoid",
  properties: ["mensch", "Zwiebel-Atem"],
  mechanisms: ["blendet", "verpestet"],
  weaknesses: ["mensch"],
  intended_mechanism: null,
  intensitaet: { Gestank: 6 },
  new_properties: [{ name: "Zwiebel-Atem", art: "kann", parents: ["reizend"], verleiht: ["verpestet"], intensitaet: { Gestank: 3 } }],
  new_qualities: [
    { name: "Gestank", art: "kraft", hint: "Socke 2, Müllhalde 4, Stinktier 5." },
    { name: "Geruchsfestigkeit", art: "schutz", hint: "Wer nicht atmet, riecht nichts." },
  ],
  new_mechanism: { label: "verpestet", family: "sinne", targets: ["atmet"], braucht: ["Zwiebel-Atem"], kraft: "Gestank", gegen: "Geruchsfestigkeit", hint: "Der Atem raubt den Atem." },
};

describe("open property model – the format", () => {
  it("a new ability hangs under an existing one and inherits its mechanisms before it is even learned", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    assert.ok(r);
    const atem = r.delta.tags.find((t) => t.label === "Zwiebel-Atem");
    assert.ok(atem);
    assert.equal(atem.group, "faehigkeit");
    assert.deepEqual(atem.parents, ["reizend"]);
    assert.deepEqual(atem.grants, ["g_verpestet"]);
    assert.deepEqual(atem.qualities, { q_gestank: 3 });
    assert.ok(r.form.verbs.includes("blendet"), "reizend blinds – kept although the tag is not learned yet");
    assert.ok(r.form.verbs.includes("g_verpestet"));
  });

  it("new intensities: a force and a protection; the form's own level is capped at scale + 2", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    assert.ok(r);
    assert.deepEqual(
      (r.delta.qualities ?? []).map((q) => [q.id, q.kind]),
      [
        ["q_gestank", "kraft"],
        ["q_geruchsfestigkeit", "schutz"],
      ],
    );
    assert.equal(r.form.qualities?.["q_gestank"], 5);
  });

  it("a new mechanism names who may use it and what it measures itself against", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    const v = r?.delta.verbs[0];
    assert.ok(v);
    assert.deepEqual(v.requires, { any: ["g_zwiebel_atem"], qualities: { q_gestank: 1 } });
    assert.deepEqual(v.needs, [{ by: "q_gestank", vs: "q_geruchsfestigkeit" }]);
  });
});

describe("open property model – learning", () => {
  it("learns ability, intensities and mechanism into one pack; the engine uses them at once", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "ungeladener Gast mit Zwiebel-Atem", r.form, r.delta);
    assert.ok(l.ok, l.ok ? "" : l.reason);
    const { onto: o, form, pack } = l.value;
    assert.deepEqual(l.value.newQualities, ["Gestank", "Geruchsfestigkeit"]);
    assert.equal(pack.qualities?.length, 2);
    const c = o.compileForm(form);
    assert.ok(c.verbs.includes("blendet") && c.verbs.includes("g_verpestet"));
    assert.equal(c.qualities.get("q_gestank"), 5);
    const bauer = o.formById("bauer");
    assert.ok(bauer);
    assert.ok(checkCounter(o, form, bauer, "g_verpestet").valid, "Gestank 5 gegen Geruchsfestigkeit 0");
    // anyone else with the ability gets the mechanism – and nobody without it
    const zwiebel = { ...form, id: "x", tags: ["mensch"], qualities: {} };
    assert.equal(o.compileForm(zwiebel).verbs.includes("g_verpestet"), false);
  });

  it("guards: no big levers through the back door, grants only what a carrier can do, forces capped", () => {
    const clean = sanitizeDelta([core], {
      verbs: [],
      tags: [
        { id: "g_weltenende", label: "Weltenende", group: "faehigkeit", parents: ["wuchtig"], grants: ["wahrer_name", "zerschlaegt"], qualities: { hitze: 6, q_unbekannt: 2 } },
      ],
      qualities: [{ id: "hitze", label: "Hitze", kind: "kraft" }],
    });
    const t = clean.tags[0];
    assert.ok(t);
    assert.deepEqual(t.grants, ["zerschlaegt"], "wahrer_name has a big lever (4)");
    assert.deepEqual(t.qualities, { hitze: LEARNED_TAG_FORCE });
    assert.deepEqual(clean.qualities, [], "an existing quality is not new");

    const floete = formFromLlm(onto, {
      ...gast,
      name: "Holzflöte",
      properties: ["holz", "Flötenton"],
      mechanisms: ["zerschneidet"],
      new_properties: [{ name: "Flötenton", art: "kann", parents: ["laut"], verleiht: ["zerschneidet"] }],
      new_qualities: [],
      new_mechanism: null,
      intensitaet: {},
    }, "Holzflöte");
    assert.ok(floete);
    const l = learn([core], emptyLearnedPack(), "Holzflöte", floete.form, floete.delta);
    assert.ok(l.ok, l.ok ? "" : l.reason);
    const tag = l.value.pack.tags.find((x) => x.id === "g_floetenton");
    assert.ok(tag);
    assert.equal(tag.grants, undefined, "a flute tone cannot cut – the grant is dropped");
    assert.ok(l.value.onto.compileForm(l.value.form).verbs.includes("uebertoent"), "but it is loud");
  });

  it("learned intensities travel in pack deltas (online)", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    assert.ok(r);
    const before = emptyLearnedPack();
    const l = learn([core], before, "ungeladener Gast mit Zwiebel-Atem", r.form, r.delta);
    assert.ok(l.ok);
    const d = packDelta(before, l.value.pack);
    assert.equal(d.qualities?.length, 2);
    const merged = applyPackDelta(before, d);
    assert.deepEqual(merged.qualities, l.value.pack.qualities);
    assert.ok(Ontology.compile([core, merged]).qualities.has("q_gestank"));
  });
});
