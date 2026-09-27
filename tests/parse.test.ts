import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseForm } from "../src/engine/parse.ts";

function ok(input: string) {
  const r = parseForm(input);
  assert.ok(r.ok, `expected "${input}" to parse: ${r.ok ? "" : r.error}`);
  return r;
}

describe("parseForm", () => {
  it("finds plain lexicon entries by name and alias", () => {
    assert.equal(ok("Wolf").base.id, "wolf");
    assert.equal(ok("ein Wolf").base.id, "wolf");
    assert.equal(ok("Tsunami").base.id, "flutwelle");
    assert.equal(ok("Anti-Leben").base.id, "ende");
  });

  it("handles umlauts and case", () => {
    assert.equal(ok("PHÖNIX").base.id, "phoenix");
    assert.equal(ok("Bär").base.id, "baer");
  });

  it("composes adjectives", () => {
    const r = ok("riesiger gläserner Wolf");
    assert.equal(r.base.id, "wolf");
    assert.equal(r.form.scale, 4);
    assert.ok(r.form.tags.includes("glas"));
    assert.ok(!r.form.tags.includes("fleisch"));
    assert.equal(r.form.origin, "komponiert");
  });

  it("splits German compounds", () => {
    const r = ok("Eiswolf");
    assert.equal(r.base.id, "wolf");
    assert.ok(r.form.tags.includes("eis"));
    const s = ok("Schattendrache");
    assert.equal(s.base.id, "drache");
    assert.ok(s.form.tags.includes("schatten"));
  });

  it("uses the last noun as head, earlier nouns as modifiers", () => {
    const r = ok("Feuer Wolf");
    assert.equal(r.base.id, "wolf");
    assert.ok(r.form.tags.includes("feuer"));
  });

  it("tolerates small typos", () => {
    assert.equal(ok("Dracheee").base.id, "drache");
    assert.equal(ok("Minotaurs").base.id, "minotaurus");
  });

  it("returns suggestions for unknown things", () => {
    const r = parseForm("Quantenkatzenkaffee");
    if (r.ok) assert.equal(r.base.id, "katze");
    const u = parseForm("xyzzy");
    assert.equal(u.ok, false);
  });

  it("caps scale changes at ±2", () => {
    const r = ok("riesiger gigantischer kolossaler Wolf");
    assert.equal(r.form.scale, 5);
  });

  it("is deterministic and ids are stable across word order", () => {
    const a = ok("gläserner riesiger Wolf");
    const b = ok("riesiger gläserner Wolf");
    assert.equal(a.form.id, b.form.id);
  });

  it("untot removes life", () => {
    const r = ok("untoter Drache");
    assert.ok(r.form.tags.includes("untot"));
    assert.ok(!r.form.tags.includes("lebendig"));
  });
});
