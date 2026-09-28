/**
 * Prüfstand (docs/engine-neubau.md): concrete pairs judged by common sense, not by the engine.
 *  - `holds`: the engine already gets it right – guarded against regressions
 *  - `todo`: still absurd today; each rebuild step turns some of these into real tests
 * New "bescheuerte Siege" from play testing go here first (as todo).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { parseForm } from "../src/engine/parse.ts";
import { checkCounter } from "../src/engine/rules.ts";
import type { Form } from "../src/engine/types.ts";

const onto = coreOntology();

function lx(id: string): Form {
  const f = onto.formById(id);
  assert.ok(f, `lexicon entry ${id} missing`);
  return f;
}

/** Mechanisms with which `a` beats `t` (empty = cannot). */
function wins(a: Form, t: Form): string[] {
  return onto
    .compileForm(a)
    .verbs.filter((v) => checkCounter(onto, a, t, v).valid);
}

const beats = (a: string, t: string, verb?: string): void => {
  const w = wins(lx(a), lx(t));
  assert.ok(verb === undefined ? w.length > 0 : w.includes(verb), `${a} sollte ${t} besiegen${verb === undefined ? "" : ` (${verb})`} – kann: ${w.join(", ") || "nichts"}`);
};
const cannot = (a: string, t: string, verb?: string): void => {
  const w = wins(lx(a), lx(t));
  assert.ok(verb === undefined ? w.length === 0 : !w.includes(verb), `${a} darf ${t} nicht besiegen${verb === undefined ? "" : ` (${verb})`} – kann: ${w.join(", ")}`);
};

describe("Prüfstand – was schon stimmt", () => {
  it("Feuer und Wasser nach Stärke", () => {
    cannot("fackel", "anker", "schmilzt");
    beats("schmied", "anker", "schmilzt");
    beats("wasser", "fackel", "loescht");
    cannot("wasser", "vulkan", "loescht");
    beats("ozean", "vulkan", "loescht");
  });

  it("Stein widersteht einem Eimer Wasser, nicht einem Fluss", () => {
    cannot("wasser", "fels", "erodiert");
    cannot("wasser", "bruecke", "erodiert");
    beats("fluss", "fels", "erodiert");
  });

  it("Reichweite: Fesseln erreicht keinen Adler, ein Schuss schon", () => {
    cannot("jaeger", "adler", "fesselt");
    beats("jaeger", "adler", "durchbohrt");
  });

  it("Klassiker", () => {
    beats("drache", "ritter");
    beats("hoffnung", "ende", "trotzt");
  });
});

describe("Prüfstand – Affordanzen (Fähigkeiten folgen aus Eigenschaften)", () => {
  it("Kreditkarte, Büroklammer und Kaugummi fesseln keinen Ritter", () => {
    for (const a of ["kreditkarte", "bueroklammer", "kaugummi"]) cannot(a, "ritter", "fesselt");
  });

  it("Begriffe prügeln nicht: Spam und Gruppenchat überrennen niemanden, ein Versprechen fesselt nicht", () => {
    cannot("spam", "katze", "ueberrennt");
    cannot("gruppenchat", "ameise", "ueberrennt");
    cannot("versprechen", "katze", "fesselt");
  });

  it("Dinge ohne Geist täuschen nicht: Hut, Mantel, Keller", () => {
    for (const a of ["hut", "mantel", "keller"]) cannot(a, "eule", "taeuscht");
  });

  it("Weiches schneidet nicht: Legostein durchbohrt keine Mücke, ein Kopf zerschlägt nichts", () => {
    cannot("legostein", "muecke", "durchbohrt");
    cannot("kopf", "rost", "zerschlaegt");
  });

  it("wer etwas zugewiesen bekommt, das er nicht kann, erfährt warum", () => {
    const radio = lx("radio");
    const r = checkCounter(onto, radio, lx("ratte"), "zersetzt");
    assert.equal(r.valid, false);
    assert.match(r.steps.at(-1)?.text ?? "", /kann nicht „zersetzt“ – bräuchte Säure/);
    // assigned or not: the requirement decides (an assigned mechanism is dropped, a granted one follows the ability)
    const umgebaut: Form = { ...radio, id: "radio2", verbs: [...radio.verbs, "zersetzt"] };
    assert.equal(onto.compileForm(umgebaut).verbs.includes("zersetzt"), false);
    const saeureRadio: Form = { ...umgebaut, id: "radio3", tags: [...radio.tags, "saeure"] };
    assert.equal(onto.compileForm(saeureRadio).verbs.includes("zersetzt"), true);
  });

  it("Fähigkeiten bringen ihren Mechanismus mit: scharf schneidet, laut übertönt", () => {
    const stein: Form = { ...lx("kiesel"), id: "scherbe", tags: ["glas", "scharf"], verbs: [] };
    assert.ok(onto.compileForm(stein).verbs.includes("zerschneidet"));
    const hitze: Form = { ...lx("kiesel"), id: "gluehstein", verbs: ["verbrennt"], qualities: { hitze: 3 } };
    assert.ok(onto.compileForm(hitze).verbs.includes("verbrennt"), "Hitze ≥ 2 genügt, ohne Feuer zu sein");
  });
});

describe("Prüfstand – noch absurd (Neubau)", () => {
  it.todo("Klebeband fesselt keinen Ritter (bindet, aber zu schwach: Stärke-Achse)", () => {
    cannot("klebeband", "ritter", "fesselt");
  });

  it.todo("„alter Kaugummi“ ist nicht magisch – alt heißt bei Dingen abgenutzt", () => {
    const r = parseForm(onto, "alter Kaugummi");
    assert.ok(r.ok);
    assert.equal(onto.formHas(r.form, "magisch"), false);
  });
});
