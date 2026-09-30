import { lookupKey, type Ontology } from "./ontology/ontology.ts";
import type { ModifierSpec } from "./ontology/pack.ts";
import { clampScale } from "./rules.ts";
import { capitalize, tokenize } from "./text.ts";
import type { Form } from "./types.ts";

export type ParseResult =
  | {
      readonly ok: true;
      readonly form: Form;
      readonly base: Form;
      readonly modifiers: readonly ModifierSpec[];
      readonly ignored: readonly string[];
    }
  | { readonly ok: false; readonly error: string; readonly suggestions: readonly string[] };

/** German filler words that carry no meaning for parsing. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "ein", "eine", "einer", "eines", "einen", "einem", "der", "die", "das", "des", "dem", "den",
  "aus", "mit", "von", "vom", "und", "sehr", "ganz", "wie", "zu", "zum", "zur", "im", "in", "am",
  "ich", "bin", "spiele", "werde", "nun", "jetzt", "dann", "so", "ist", "sein", "aller", "alle",
]);

const INFLECTIONS = ["en", "n", "e", "s", "er", "es"] as const;
/** Maximum total scale change from size modifiers. */
const MAX_SCALE_SHIFT = 2;

interface HeadHit {
  readonly form: Form;
  readonly prefix: string;
}

/** Read a token as a lexicon entry, possibly inflected or a compound "PrefixNoun". */
function matchHead(onto: Ontology, token: string): HeadHit | undefined {
  const direct = onto.formByAlias(token);
  if (direct !== undefined) return { form: direct, prefix: "" };
  for (const suffix of INFLECTIONS) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) {
      const hit = onto.formByAlias(token.slice(0, -suffix.length));
      if (hit !== undefined) return { form: hit, prefix: "" };
    }
  }
  // Compound: longest alias that ends the word and whose remaining prefix is a modifier.
  for (const { alias, form } of onto.aliasSuffixesOf(token)) {
    if (alias.length < 4 || alias.length === token.length) continue;
    const prefix = token.slice(0, token.length - alias.length);
    if (onto.modifierByPrefix(prefix) !== undefined) return { form, prefix };
  }
  return undefined;
}

export function suggest(onto: Ontology, input: string, limit = 5): string[] {
  const names = new Map<string, number>();
  for (const t of tokenize(input).filter((x) => !STOPWORDS.has(x))) {
    for (const hit of onto.fuzzyForms(t, 3, limit)) {
      names.set(hit.value.name, Math.min(names.get(hit.value.name) ?? 99, hit.distance));
    }
  }
  return [...names.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([n]) => n);
}

/**
 * Offline parser: free text → Form, fully deterministic.
 * The last phrase naming a lexicon entry is the head; everything else is
 * read as modifiers (adjectives, compound prefixes, other nouns as elements).
 */
/**
 * Words that only open a phrase („der“, „ein“, „ich bin ein“, „jetzt“). Particles like „von“, „zu“, „aus“, „und“,
 * „mit“ are not among them: „von und zu Hohenstein“, „Hänsel und Gretel“ – they always belong to the name.
 */
const OPENERS: ReadonlySet<string> = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einen", "einem",
  "ich", "bin", "spiele", "werde", "nun", "jetzt", "dann", "so", "ist", "sein",
]);

/** The tokens of a name without the words that only open the phrase (at least one stays). */
export function nameTokens(text: string): string[] {
  const tokens = tokenize(text);
  let lead = 0;
  while (lead < tokens.length - 1 && OPENERS.has(tokens[lead] ?? "")) lead++;
  return tokens.slice(lead);
}

/**
 * The keys a name may be meant by: as written, or without the words that open it – „ein Zeitalter der
 * Finsternis“ and „Eichel-Ober“ meet their form's `lookupKey`. Words inside a name are never dropped.
 */
export function nameKeys(text: string): string[] {
  return [...new Set([tokenize(text).join(""), nameTokens(text).join("")])].filter((k) => k !== "");
}

/** Do two names mean the same, however spelt („der Rost“ and „Rost“, „Eichel Ober“ and „Eichelober“)? */
export function sameName(a: string, b: string): boolean {
  const kb = nameKeys(b);
  return nameKeys(a).some((k) => kb.includes(k));
}

/**
 * The form a text names outright: its own name, id or declared alias, however spelt – joined, spaced,
 * hyphenated, any case, with or without an article („ein Zeitalter der Finsternis“, „Eichel-Ober“).
 */
export function namedForm(onto: Ontology, text: string): Form | undefined {
  for (const k of nameKeys(text)) {
    const f = onto.formByName(k);
    if (f !== undefined) return f;
  }
  return undefined;
}

export function parseForm(onto: Ontology, input: string): ParseResult {
  const tokens = tokenize(input).filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) return { ok: false, error: "Beschreibe eine Gestalt.", suggestions: [] };
  // 0. the whole input is a form's own name or alias, however spelt („Zeitalter der Finsternis“, „Eichel Ober“)
  const named = namedForm(onto, input);
  if (named !== undefined) return { ok: true, form: named, base: named, modifiers: [], ignored: [] };

  let head: HeadHit | undefined;
  let headStart = -1;
  let headEnd = -1;
  // 1. multi-word names ("Schwarzes Loch", "Anti Leben"), longest first, rightmost first
  for (let len = Math.min(tokens.length, 5); len >= 2 && head === undefined; len--) {
    for (let start = tokens.length - len; start >= 0; start--) {
      const form = onto.formByAlias(tokens.slice(start, start + len).join(""));
      if (form !== undefined) {
        head = { form, prefix: "" };
        headStart = start;
        headEnd = start + len - 1;
        break;
      }
    }
  }
  // 2. single tokens, rightmost first
  for (let i = tokens.length - 1; i >= 0 && head === undefined; i--) {
    const hit = matchHead(onto, tokens[i] ?? "");
    if (hit !== undefined) {
      head = hit;
      headStart = headEnd = i;
    }
  }
  // 3. typo tolerance
  for (let i = tokens.length - 1; i >= 0 && head === undefined; i--) {
    const t = tokens[i] ?? "";
    // Short words are too close to each other ("Tisch" ≠ "Fisch", "Milch" ≠ "Molch") and typos
    // rarely hit the first letter – only then is a near miss worth guessing.
    // Two edits only as stuck/missing keys ("Dracheee"), never as two swapped letters ("Toilette" ≠ "Tablette").
    if (t.length < 7 || onto.modifierByWord(t) !== undefined) continue;
    const best = onto
      .fuzzyForms(t, t.length >= 8 ? 2 : 1, 5)
      .find((c) => c.key.startsWith(t.charAt(0)) && (c.distance < 2 || Math.abs(c.key.length - t.length) === c.distance));
    if (best !== undefined) {
      head = { form: best.value, prefix: "" };
      headStart = headEnd = i;
    }
  }
  if (head === undefined) {
    return {
      ok: false,
      error: `Diese Gestalt kennt das Lexikon nicht: „${input.trim()}“.`,
      suggestions: suggest(onto, input),
    };
  }

  const mods: ModifierSpec[] = [];
  const ignored: string[] = [];
  const addMod = (m: ModifierSpec | undefined, word: string): void => {
    if (m === undefined) ignored.push(word);
    else mods.push(m);
  };
  if (head.prefix !== "") addMod(onto.modifierByPrefix(head.prefix), head.prefix);
  tokens.forEach((t, i) => {
    if (i >= headStart && i <= headEnd) return;
    addMod(onto.modifierByWord(t) ?? onto.modifierByPrefix(t) ?? modifierByLeadingPrefix(onto, t), t);
  });

  const form = applyModifiers(onto, head.form, mods, input);
  return { ok: true, form, base: head.form, modifiers: mods, ignored };
}

/** "eisenharter" → modifier for "eisen" (longest known prefix of at least 4 letters). */
function modifierByLeadingPrefix(onto: Ontology, token: string): ModifierSpec | undefined {
  for (let len = token.length - 1; len >= 4; len--) {
    const m = onto.modifierByPrefix(token.slice(0, len));
    if (m !== undefined) return m;
  }
  return undefined;
}

/**
 * Apply modifiers at the *declared* level; the ontology expands the result.
 * Removing a tag goes to `not`, so implications of other tags cannot bring it back.
 */
export function applyModifiers(
  onto: Ontology,
  base: Form,
  mods: readonly ModifierSpec[],
  rawName?: string,
): Form {
  if (mods.length === 0) return base;
  const tags = new Set<string>(base.tags);
  const not = new Set<string>(base.not);
  const verbs = new Set<string>(base.verbs);
  const immune = new Set<string>(base.immune);
  const weak = new Set<string>(base.weak);
  let shift = 0;
  // Size words may stack ("riesiger gigantischer …"); tag effects apply once per modifier.
  for (const m of mods) {
    if (m.scale !== undefined && Math.abs(shift + m.scale) <= MAX_SCALE_SHIFT) shift += m.scale;
  }
  for (const m of new Set(mods)) {
    for (const t of m.remove ?? []) {
      tags.delete(t);
      not.add(t);
    }
    for (const t of m.add ?? []) {
      tags.add(t);
      not.delete(t);
    }
    for (const v of m.verbs ?? []) verbs.add(v);
    for (const v of m.immune ?? []) immune.add(v);
    for (const t of m.weak ?? []) weak.add(t);
  }
  const draft: Form = {
    id: `${base.id}+${mods.map((m) => m.id).sort().join("+")}`,
    name: rawName !== undefined && rawName.trim() !== "" ? capitalize(rawName.trim()) : base.name,
    archetype: base.archetype,
    scale: clampScale(base.scale + shift),
    plane: base.plane,
    tags: [...tags],
    not: [...not],
    verbs: [...verbs],
    immune: [...immune],
    weak: [],
    origin: "komponiert",
    ...(base.flavor === undefined ? {} : { flavor: base.flavor }),
  };
  // Weaknesses must refer to tags the form (still) has after expansion.
  const keptWeak = [...weak].filter((w) => onto.formHas(draft, w));
  return { ...draft, weak: keptWeak };
}

/** Normalised lookup key, re-exported for UI search. */
export { lookupKey };
