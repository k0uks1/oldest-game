import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { findCounters } from "../src/engine/rules.ts";
import { emptyLearnedPack, findLearned, learn, readLearnedPack } from "../src/llm/learning.ts";
import { formFromLlm } from "../src/llm/parser.ts";

const core = loadPack(CORE_PACK_RAW);
const onto = Ontology.compile([core]);

const kaese = {
  name: "Stinkender Käse",
  base: null,
  scale: 2,
  plane: "materie",
  archetype: "blob",
  properties: ["fest", "Käse", "gierig"],
  mechanisms: ["übertönt"],
  weaknesses: ["Käse"],
  intended_mechanism: null,
  new_properties: [{ name: "Käse", parents: ["fest"], implies: ["brennbar"] }],
  new_mechanism: { label: "verpestet", family: "sinne", targets: ["atmet", "riecht nach nichts"], blocked_by: ["koerperlos"], hint: "Der Gestank raubt den Atem." },
};

describe("live learning", () => {
  it("turns Claude's proposal into a validated delta (new tag under existing parents, weak new verb)", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const tag = r.delta.tags[0];
    assert.ok(tag);
    assert.equal(tag.id, "g_kaese");
    assert.deepEqual(tag.parents, ["fest"]);
    const verb = r.delta.verbs[0];
    assert.ok(verb);
    assert.equal(verb.leverage, 2, "non-violent learned mechanisms get a small lever");
    assert.deepEqual(verb.targets, ["atmet"], "unknown targets are dropped");
    assert.ok(r.form.tags.includes("g_kaese"));
  });

  it("learns the form: it compiles, inherits rules through its parents and is counterable", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok, l.ok ? "" : l.reason);
    const { onto: o2, form } = l.value;
    assert.ok(o2.formHas(form, "fest"), "Käse ⊂ fest");
    assert.ok(o2.formHas(form, "brennbar"), "implication from the proposal");
    assert.ok(findCounters(o2, form).some((c) => c.verb === "verbrennt"), "fire burns cheese without any new rule");
    assert.ok(form.weak.length > 0);
    assert.equal(findLearned(o2, "Stinkender Käse")?.id, form.id, "same text → same form next time");
  });

  it("is idempotent for the same text", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const first = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(first.ok);
    const second = learn([core], first.value.pack, "stinkender Käse", r.form, r.delta);
    assert.ok(second.ok);
    assert.equal(second.value.isNew, false);
    assert.equal(second.value.pack.forms.length, 1);
  });

  it("rejects tags that do not hang under the taxonomy", () => {
    const r = formFromLlm(onto, { ...kaese, new_properties: [{ name: "Quirks", parents: ["völlig unbekannt"] }] }, "quirks");
    assert.ok(r);
    assert.equal(r.delta.tags.length, 0);
  });

  it("refuses unbeatable creations", () => {
    const godlike = formFromLlm(
      onto,
      { name: "Nichtsnutz", base: null, scale: 8, plane: "abstrakt", archetype: "void", properties: ["unsterblich", "körperlos"], mechanisms: ["beendet"], intended_mechanism: null },
      "absolut unbesiegbares allmächtiges ding",
    );
    assert.ok(godlike);
    const l = learn([core], emptyLearnedPack(), "absolut unbesiegbares allmächtiges ding", godlike.form, godlike.delta);
    if (l.ok) assert.ok(findCounters(l.value.onto, l.value.form).length > 0);
  });

  it("survives round-tripping through storage", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    const restored = readLearnedPack(JSON.parse(JSON.stringify(l.value.pack)));
    assert.equal(restored.forms.length, 1);
    assert.equal(readLearnedPack({ id: "fremd" }).forms.length, 0, "foreign packs are ignored");
  });
});

describe("learned pack persistence (local server)", () => {
  it("validates and writes the pack file, then serves it back", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { handleLearned } = await import("../server/learned.ts");
    const file = join(mkdtempSync(join(tmpdir(), "og-learned-")), "pack.json");
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    const put = await handleLearned(new Request("http://x/api/learned", { method: "PUT", body: JSON.stringify(l.value.pack) }), file);
    assert.equal(put.status, 200);
    const get = await handleLearned(new Request("http://x/api/learned"), file);
    assert.equal(readLearnedPack(await get.json()).forms.length, 1);
    const bad = await handleLearned(new Request("http://x/api/learned", { method: "PUT", body: JSON.stringify({ ...l.value.pack, forms: [{ id: "x", name: "x", archetype: "orb", scale: 3, plane: "materie", tags: ["gibtsnicht"] }] }) }), file);
    assert.equal(bad.status, 400, "invalid packs are never written");
  });
});

describe("learned weaknesses", () => {
  it("keeps a weakness that refers to a newly proposed tag", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    assert.deepEqual(r.form.weak, ["g_kaese"]);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    assert.deepEqual(l.value.form.weak, ["g_kaese"]);
  });
});
