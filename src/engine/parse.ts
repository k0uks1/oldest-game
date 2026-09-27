import { LEXICON, type LexiconEntry } from "../content/forms.ts";
import { MODIFIERS, STOPWORDS, type ModifierDef } from "../content/modifiers.ts";
import { clampScale } from "./rules.ts";
import { capitalize, levenshtein, normalize, tokenize } from "./text.ts";
import type { Form } from "./types.ts";

export type ParseResult =
  | { readonly ok: true; readonly form: Form; readonly base: LexiconEntry; readonly modifiers: readonly ModifierDef[]; readonly ignored: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly suggestions: readonly string[] };

interface AliasIndex {
  readonly exact: ReadonlyMap<string, LexiconEntry>;
  /** Aliases sorted by length, longest first – for compound suffix matching. */
  readonly bySuffix: readonly (readonly [string, LexiconEntry])[];
}

function buildIndex(): AliasIndex {
  const exact = new Map<string, LexiconEntry>();
  for (const e of LEXICON) {
    // Names first so they win over aliases of other entries.
    const key = normalize(e.name).replaceAll(" ", "");
    if (!exact.has(key)) exact.set(key, e);
  }
  for (const e of LEXICON) {
    for (const k of [e.id, ...e.aliases, ...normalize(e.name).split(" ")]) {
      const key = normalize(k).replaceAll(" ", "");
      if (key.length >= 3 && !exact.has(key)) exact.set(key, e);
    }
  }
  const bySuffix = [...exact.entries()]
    .filter(([k]) => k.length >= 3)
    .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  return { exact, bySuffix };
}

const INDEX = buildIndex();

function matchModifierWord(token: string): ModifierDef | undefined {
  for (const m of MODIFIERS) {
    for (const w of m.words) {
      if (token === w || (token.startsWith(w) && token.length - w.length <= 3 && w.length >= 3)) return m;
    }
  }
  return undefined;
}

function matchModifierPrefix(prefix: string): ModifierDef | undefined {
  // Accept German linking elements ("Fugen-s", "-n", "-en"): Sonnenwolf, Todeswolf …
  for (const m of MODIFIERS) {
    for (const pre of m.prefixes) {
      if (prefix === pre || prefix === `${pre}s` || prefix === `${pre}n` || prefix === `${pre}en`) return m;
    }
  }
  return matchModifierWord(prefix);
}

interface HeadHit {
  readonly entry: LexiconEntry;
  readonly prefix: string;
  readonly fuzzy: boolean;
}

/** Try to read a token as a lexicon entry, possibly a compound "PrefixNoun". */
function matchHead(token: string): HeadHit | undefined {
  const direct = INDEX.exact.get(token);
  if (direct !== undefined) return { entry: direct, prefix: "", fuzzy: false };
  // German plural / inflection endings
  for (const suffix of ["en", "n", "e", "s", "er"]) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) {
      const hit = INDEX.exact.get(token.slice(0, -suffix.length));
      if (hit !== undefined) return { entry: hit, prefix: "", fuzzy: false };
    }
  }
  for (const [alias, entry] of INDEX.bySuffix) {
    if (alias.length >= 4 && token.length > alias.length && token.endsWith(alias)) {
      const prefix = token.slice(0, token.length - alias.length);
      if (matchModifierPrefix(prefix) !== undefined) return { entry, prefix, fuzzy: false };
    }
  }
  return undefined;
}

function fuzzyHead(token: string): LexiconEntry | undefined {
  if (token.length < 5) return undefined;
  const max = token.length >= 8 ? 2 : 1;
  let best: { e: LexiconEntry; d: number; k: string } | undefined;
  for (const [k, e] of INDEX.exact) {
    const d = levenshtein(token, k, max);
    if (d <= max && (best === undefined || d < best.d || (d === best.d && k < best.k))) best = { e, d, k };
  }
  return best?.e;
}

export function suggest(input: string, limit = 5): string[] {
  const tokens = tokenize(input).filter((t) => !STOPWORDS.has(t));
  const scored = new Map<string, number>();
  for (const t of tokens) {
    for (const [k, e] of INDEX.exact) {
      const d = k.includes(t) || t.includes(k) ? 0 : levenshtein(t, k, 3);
      if (d <= 3) scored.set(e.name, Math.min(scored.get(e.name) ?? 99, d));
    }
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([n]) => n);
}

/**
 * Offline parser: free text → Form, fully deterministic.
 * The last token that names a lexicon entry is the head noun; everything
 * else is read as modifiers.
 */
export function parseForm(input: string): ParseResult {
  const tokens = tokenize(input).filter((t) => !STOPWORDS.has(t));
  if (tokens.length === 0) return { ok: false, error: "Beschreibe eine Gestalt.", suggestions: [] };

  // Multi-word names first ("Schwarzes Loch", "Das Ende aller Dinge", "Anti-Leben").
  let headStart = -1;
  let headIndex = -1;
  let head: HeadHit | undefined;
  for (let len = Math.min(tokens.length, 5); len >= 2 && head === undefined; len--) {
    for (let start = tokens.length - len; start >= 0; start--) {
      const entry = INDEX.exact.get(tokens.slice(start, start + len).join(""));
      if (entry !== undefined) {
        head = { entry, prefix: "", fuzzy: false };
        headStart = start;
        headIndex = start + len - 1;
        break;
      }
    }
  }
  for (let i = tokens.length - 1; i >= 0 && head === undefined; i--) {
    const hit = matchHead(tokens[i] ?? "");
    if (hit !== undefined) {
      headStart = i;
      headIndex = i;
      head = hit;
    }
  }
  if (head === undefined) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const e = fuzzyHead(tokens[i] ?? "");
      if (e !== undefined) {
        headStart = i;
        headIndex = i;
        head = { entry: e, prefix: "", fuzzy: true };
        break;
      }
    }
  }
  if (head === undefined) {
    return {
      ok: false,
      error: `Diese Gestalt kennt das Lexikon nicht: „${input.trim()}“.`,
      suggestions: suggest(input),
    };
  }

  const mods: ModifierDef[] = [];
  const ignored: string[] = [];
  const addMod = (m: ModifierDef | undefined, word: string): void => {
    if (m === undefined) ignored.push(word);
    else mods.push(m);
  };
  if (head.prefix !== "") addMod(matchModifierPrefix(head.prefix), head.prefix);
  tokens.forEach((t, i) => {
    if (i >= headStart && i <= headIndex) return;
    const word = matchModifierWord(t);
    if (word !== undefined) return addMod(word, t);
    // a token naming another lexicon entry acts as its element, e.g. "Feuer Wolf"
    const asHead = matchHead(t);
    if (asHead !== undefined) {
      const prefixMod = matchModifierPrefix(t);
      return addMod(prefixMod, t);
    }
    // compound adjective like "eisenharter"? try prefix match on the start
    const byPrefix = MODIFIERS.find((m) => m.prefixes.some((p) => p.length >= 4 && t.startsWith(p)));
    addMod(byPrefix, t);
  });

  const form = applyModifiers(head.entry, mods, input);
  return { ok: true, form, base: head.entry, modifiers: mods, ignored };
}

/** Strip lexicon-only fields. */
export function toForm(entry: LexiconEntry): Form {
  return {
    id: entry.id,
    name: entry.name,
    archetype: entry.archetype,
    scale: entry.scale,
    plane: entry.plane,
    tags: entry.tags,
    verbs: entry.verbs,
    immune: entry.immune,
    weak: entry.weak,
    origin: entry.origin,
    ...(entry.flavor === undefined ? {} : { flavor: entry.flavor }),
  };
}

export function applyModifiers(base: LexiconEntry, mods: readonly ModifierDef[], rawName?: string): Form {
  if (mods.length === 0) return toForm(base);
  const tags = new Set<string>(base.tags);
  const verbs = new Set<string>(base.verbs);
  const immune = new Set<string>(base.immune);
  const weak = new Set<string>(base.weak);
  let scale: number = base.scale;
  let scaleSteps = 0;
  // Tag effects apply once per modifier; size words may stack ("riesiger gigantischer …").
  for (const m of mods) {
    if (m.scaleDelta !== undefined && Math.abs(scaleSteps + m.scaleDelta) <= 2) {
      scale += m.scaleDelta;
      scaleSteps += m.scaleDelta;
    }
  }
  for (const m of new Set(mods)) {
    for (const t of m.removeTags ?? []) tags.delete(t);
    for (const t of m.addTags ?? []) tags.add(t);
    for (const v of m.addVerbs ?? []) verbs.add(v);
    for (const v of m.addImmune ?? []) immune.add(v);
    for (const t of m.addWeak ?? []) weak.add(t);
  }
  // weaknesses must refer to tags the form actually has
  for (const w of [...weak]) if (!tags.has(w)) weak.delete(w);
  if (tags.has("unsterblich")) tags.delete("sterblich");
  const modIds = mods.map((m) => m.id).sort();
  const name = rawName !== undefined && rawName.trim() !== "" ? capitalize(rawName.trim()) : base.name;
  return {
    id: `${base.id}+${modIds.join("+")}`,
    name,
    archetype: base.archetype,
    scale: clampScale(scale),
    plane: base.plane,
    tags: [...tags],
    verbs: [...verbs],
    immune: [...immune],
    weak: [...weak],
    origin: "komponiert",
    ...(base.flavor === undefined ? {} : { flavor: base.flavor }),
  };
}
