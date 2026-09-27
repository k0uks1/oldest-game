import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEXICON } from "../src/content/forms.ts";
import { MODIFIERS } from "../src/content/modifiers.ts";
import { isTagId, TAGS } from "../src/content/tags.ts";
import { isVerbId, VERBS } from "../src/content/verbs.ts";
import { toForm } from "../src/engine/parse.ts";
import { checkCounter, effectiveVerbs } from "../src/engine/rules.ts";
import { normalize } from "../src/engine/text.ts";

describe("content integrity", () => {
  it("lexicon ids are unique", () => {
    const ids = LEXICON.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every tag, verb, immunity and weakness reference exists", () => {
    for (const e of LEXICON) {
      for (const t of e.tags) assert.ok(isTagId(t), `${e.id}: tag ${t}`);
      for (const t of e.weak) assert.ok(e.tags.includes(t), `${e.id}: weakness ${t} is not one of its tags`);
      for (const v of e.verbs) assert.ok(isVerbId(v), `${e.id}: verb ${v}`);
      for (const v of e.immune) assert.ok(isVerbId(v), `${e.id}: immune ${v}`);
    }
    for (const t of TAGS.values()) for (const g of t.grants ?? []) assert.ok(isVerbId(g), `grant ${g}`);
    for (const v of VERBS.values()) {
      for (const t of [...v.targets, ...v.blockedBy]) assert.ok(isTagId(t), `${v.id}: ${t}`);
    }
    for (const m of MODIFIERS) {
      for (const t of [...(m.addTags ?? []), ...(m.removeTags ?? []), ...(m.addWeak ?? [])]) {
        assert.ok(isTagId(t), `${m.id}: ${t}`);
      }
    }
  });

  it("every form can act (has at least one mechanism)", () => {
    for (const e of LEXICON) assert.ok(effectiveVerbs(toForm(e)).length > 0, e.id);
  });

  it("every form can be countered by something in the lexicon", () => {
    const forms = LEXICON.map(toForm);
    const uncounterable = forms.filter(
      (t) => !forms.some((a) => a.id !== t.id && effectiveVerbs(a).some((v) => checkCounter(a, t, v).valid)),
    );
    assert.deepEqual(uncounterable.map((f) => f.id), []);
  });

  it("every mechanism is usable by at least one lexicon form", () => {
    const used = new Set(LEXICON.flatMap((e) => effectiveVerbs(toForm(e))));
    const unused = [...VERBS.keys()].filter((v) => !used.has(v));
    assert.deepEqual(unused, []);
  });

  it("names don't collide after normalisation", () => {
    const names = LEXICON.map((e) => normalize(e.name));
    assert.equal(new Set(names).size, names.length);
  });
});
