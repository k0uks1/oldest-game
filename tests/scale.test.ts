import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePack } from "../scripts/gen-pack.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { parseForm } from "../src/engine/parse.ts";
import { checkCounter, findCounters } from "../src/engine/rules.ts";
import { rng } from "../src/engine/text.ts";

/**
 * Scalability guard: tens of thousands of tags, thousands of mechanisms and
 * modifiers, 50k forms. Budgets are generous (CI machines vary) but catch
 * accidental O(n²) regressions.
 */
const SIZE = { tags: 30_000, verbs: 5_000, modifiers: 3_000, forms: 50_000 };

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

describe(`scale: ${SIZE.tags} tags · ${SIZE.verbs} verbs · ${SIZE.modifiers} modifiers · ${SIZE.forms} forms`, () => {
  const pack = generatePack(SIZE);
  const [onto, compileMs] = time(() => Ontology.compile([pack]));
  console.log(`  compile: ${compileMs.toFixed(0)} ms`);

  it("compiles within budget", () => {
    assert.ok(compileMs < 20_000, `compile took ${compileMs} ms`);
    assert.equal(onto.lexicon.length, SIZE.forms);
    assert.equal(onto.tagCount, SIZE.tags);
  });

  it("counter checks are fast (independent of vocabulary size)", () => {
    const rand = rng(7);
    const forms = onto.lexicon;
    const n = 20_000;
    const [, ms] = time(() => {
      for (let i = 0; i < n; i++) {
        const a = forms[Math.floor(rand() * forms.length)];
        const t = forms[Math.floor(rand() * forms.length)];
        if (a === undefined || t === undefined) continue;
        const v = onto.compileForm(a).verbs[0];
        if (v !== undefined) checkCounter(onto, a, t, v);
      }
    });
    console.log(`  ${n} checks: ${ms.toFixed(0)} ms (${((ms / n) * 1000).toFixed(1)} µs/check)`);
    assert.ok(ms / n < 0.5, `avg ${ms / n} ms per check`);
  });

  it("finds all counters for a target quickly via inverted index", () => {
    const targets = onto.lexicon.slice(0, 20);
    const [, ms] = time(() => {
      for (const t of targets) findCounters(onto, t);
    });
    console.log(`  findCounters ×20: ${ms.toFixed(0)} ms`);
    assert.ok(ms / targets.length < 500, `avg ${ms / targets.length} ms per target`);
  });

  it("parses names, compounds and typos in O(word length)", () => {
    const f = onto.lexicon[1234];
    assert.ok(f);
    const mod = pack.modifiers[42];
    const word = mod?.words?.[0] ?? "";
    const [r, ms] = time(() => {
      let last = parseForm(onto, `${word} ${f.name}`);
      for (let i = 0; i < 1000; i++) last = parseForm(onto, `${word} ${f.name}`);
      return last;
    });
    console.log(`  1000 parses: ${ms.toFixed(0)} ms`);
    assert.ok(r.ok);
    assert.equal(r.base.id, onto.formByAlias(f.name)?.id);
    assert.ok(ms < 5_000);
  });

  it("resolves free-text tag keywords (LLM output) against the huge vocabulary", () => {
    const label = onto.tagAt(777)?.label ?? "";
    const [id, ms] = time(() => onto.resolveTag(label));
    assert.equal(onto.tagLabel(id ?? ""), label);
    assert.ok(ms < 200);
  });
});
