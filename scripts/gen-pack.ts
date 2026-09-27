/**
 * Deterministic synthetic content pack for stress tests.
 *
 *   npx tsx scripts/gen-pack.ts --tags 20000 --verbs 3000 --forms 50000 > big.json
 *
 * Also used programmatically by tests/scale.test.ts.
 */
import type { ContentPack, FormSpec, ModifierSpec, TagSpec, VerbSpec } from "../src/engine/ontology/pack.ts";
import { rng } from "../src/engine/text.ts";
import { ARCHETYPES, PLANES } from "../src/engine/types.ts";

export interface GenOptions {
  readonly tags: number;
  readonly verbs: number;
  readonly modifiers: number;
  readonly forms: number;
  readonly seed?: number;
}

const CONSONANTS = ["b", "d", "dr", "f", "g", "k", "kr", "l", "m", "n", "p", "r", "s", "sch", "t", "tr", "v", "w", "z", "st"];
const VOWELS = ["a", "e", "i", "o", "u", "ei", "au", "ie"];

export function generatePack(opts: GenOptions): ContentPack {
  const rand = rng(opts.seed ?? 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

  const usedWords = new Set<string>();
  const word = (min = 2, max = 4): string => {
    for (let attempt = 0; ; attempt++) {
      let w = "";
      const n = int(min, max) + Math.floor(attempt / 20);
      for (let i = 0; i < n; i++) w += pick(CONSONANTS) + pick(VOWELS);
      if (!usedWords.has(w)) {
        usedWords.add(w);
        return w;
      }
    }
  };

  // Tags: a forest; each tag's parent is an earlier tag (so no is-a cycles), implications random.
  const tags: TagSpec[] = [];
  const roots = Math.max(1, Math.floor(opts.tags / 200));
  for (let i = 0; i < opts.tags; i++) {
    const id = `t${i}`;
    const parents = i < roots ? [] : [`t${int(Math.max(0, Math.floor(i / 8) - 5), Math.floor(i / 8))}`];
    // Realistic shape: implications point to a small pool of general "property" tags.
    const propertyPool = Math.max(1, Math.floor(opts.tags / 50));
    const implies = rand() < 0.15 ? [`t${int(0, propertyPool - 1)}`] : [];
    tags.push({
      id,
      label: word(),
      group: `g${i % 12}`,
      ...(parents.length > 0 ? { parents } : {}),
      ...(implies.length > 0 && implies[0] !== id ? { implies } : {}),
    });
  }
  const verbs: VerbSpec[] = [];
  for (let i = 0; i < opts.verbs; i++) {
    const targets = Array.from({ length: int(1, 4) }, () => `t${int(0, opts.tags - 1)}`);
    const blockedBy = Array.from({ length: int(0, 2) }, () => `t${int(0, opts.tags - 1)}`);
    verbs.push({ id: `v${i}`, label: word(), family: "gewalt", leverage: int(0, 4), targets, blockedBy, hint: "" });
  }
  // grants: a few percent of tags grant a verb
  for (let i = 0; i < tags.length; i += 37) {
    const t = tags[i];
    if (t !== undefined) tags[i] = { ...t, grants: [`v${int(0, opts.verbs - 1)}`] };
  }
  const modifiers: ModifierSpec[] = [];
  for (let i = 0; i < opts.modifiers; i++) {
    modifiers.push({
      id: `m${i}`,
      label: word(),
      words: [word(2, 3)],
      prefixes: [word(2, 2)],
      add: [`t${int(0, opts.tags - 1)}`],
      ...(rand() < 0.2 ? { scale: rand() < 0.5 ? 1 : -1 } : {}),
    });
  }
  const forms: FormSpec[] = [];
  for (let i = 0; i < opts.forms; i++) {
    forms.push({
      id: `f${i}`,
      name: word(2, 4),
      archetype: pick(ARCHETYPES),
      scale: int(1, 8),
      plane: pick(PLANES),
      tags: Array.from({ length: int(2, 6) }, () => `t${int(0, opts.tags - 1)}`),
      verbs: Array.from({ length: int(1, 3) }, () => `v${int(0, opts.verbs - 1)}`),
      ...(rand() < 0.3 ? { aliases: [word(2, 3)] } : {}),
    });
  }
  return { id: "stress", name: "Stresstest", version: "0", tags, verbs, modifiers, forms };
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const arg = (name: string, dflt: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : dflt;
  };
  const pack = generatePack({
    tags: arg("tags", 20000),
    verbs: arg("verbs", 3000),
    modifiers: arg("modifiers", 2000),
    forms: arg("forms", 50000),
  });
  process.stdout.write(JSON.stringify(pack));
}
