import { normalize } from "../text.ts";
import { ARCHETYPES, PLANES, type Archetype, type Form, type Plane, type Scale } from "../types.ts";
import { Trie, TrigramIndex } from "./indexes.ts";
import type { ContentPack, FieldSpec, FormSpec, ModifierSpec, RulingSpec, TagSpec, VerbSpec } from "./pack.ts";
import { difference, fromIterable, has, intersection, type TagSet } from "./tagset.ts";

export interface CompiledVerb {
  readonly spec: VerbSpec;
  readonly targets: TagSet;
  readonly blocked: TagSet;
}

export interface CompiledForm {
  readonly form: Form;
  /** Declared tags + all ancestors + implications, minus `not`. */
  readonly closure: TagSet;
  /** Explicit mechanisms + those granted by any tag in the closure. */
  readonly verbs: readonly string[];
  /** Indices of declared weakness tags. */
  readonly weak: TagSet;
  readonly immune: ReadonlySet<string>;
  /** "Schreck" triggers from tags in the closure: which tag is startled, by which mechanisms / attacker tags. */
  readonly startle: readonly { readonly tag: number; readonly verbs: ReadonlySet<string>; readonly tags: TagSet }[];
}

export class OntologyError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`Content-Pack ungültig (${errors.length} Fehler):\n${errors.slice(0, 20).join("\n")}`);
    this.name = "OntologyError";
  }
}

/** Key used for all name/alias lookups: normalised, no spaces. */
export function lookupKey(s: string): string {
  return normalize(s).replaceAll(" ", "");
}

const ARCHETYPE_SET: ReadonlySet<string> = new Set(ARCHETYPES);
const PLANE_SET: ReadonlySet<string> = new Set(PLANES);

/**
 * Compiled, indexed view over one or more content packs.
 *
 * Scaling properties (n tags, m verbs, k forms):
 *  - compile: O(n + m + k) plus alias indexing; closures are computed lazily and memoised
 *  - counter check: O(|verb.targets| · log |closure|)
 *  - name lookup: O(word length) via hash map / tries, typo lookup via trigram index
 */
export class Ontology {
  readonly packIds: readonly string[];
  readonly tags: readonly TagSpec[];
  readonly verbs: ReadonlyMap<string, CompiledVerb>;
  readonly modifiers: readonly ModifierSpec[];
  readonly fields: readonly FieldSpec[];
  readonly lexicon: readonly Form[];
  readonly warnings: readonly string[];

  private readonly tagIndex = new Map<string, number>();
  private readonly parentIdx: number[][] = [];
  private readonly impliesIdx: number[][] = [];
  private readonly childIdx: number[][] = [];
  private readonly closureMemo: (TagSet | undefined)[] = [];
  private readonly ancestorMemo: (TagSet | undefined)[] = [];
  private readonly descendantMemo: (TagSet | undefined)[] = [];
  private readonly grantsByTag = new Map<number, string[]>();
  private readonly grantTags: TagSet;
  private readonly startleByTag = new Map<number, { verbs: ReadonlySet<string>; tags: TagSet }>();
  private readonly startleTags: TagSet;
  private readonly formsById = new Map<string, Form>();
  private readonly rulings = new Map<string, RulingSpec>();
  private readonly compiled = new WeakMap<Form, CompiledForm>();
  private verbUsersMemo: Map<string, Form[]> | undefined;

  // lookup indexes
  private readonly aliasExact = new Map<string, Form>();
  private readonly aliasSuffix = new Trie<{ alias: string; form: Form }>();
  private readonly aliasFuzzy = new TrigramIndex<Form>();
  private readonly modifierStems = new Trie<ModifierSpec>();
  private readonly modifierPrefixes = new Map<string, ModifierSpec>();
  private readonly tagLookup = new Map<string, string>();
  private readonly tagFuzzy = new TrigramIndex<string>();
  private readonly verbLookup = new Map<string, string>();

  static compile(packs: readonly ContentPack[]): Ontology {
    return new Ontology(packs);
  }

  private constructor(packs: readonly ContentPack[]) {
    const errors: string[] = [];
    const warnings: string[] = [];
    this.packIds = packs.map((p) => p.id);

    // ── Tags ────────────────────────────────────────────────────────────
    const tags: TagSpec[] = [];
    for (const p of packs) {
      for (const t of p.tags) {
        if (this.tagIndex.has(t.id)) {
          errors.push(`Tag „${t.id}“ doppelt definiert (${p.id}).`);
          continue;
        }
        this.tagIndex.set(t.id, tags.length);
        tags.push(t);
      }
    }
    this.tags = tags;
    const ref = (id: string, where: string): number | undefined => {
      const i = this.tagIndex.get(id);
      if (i === undefined) errors.push(`${where}: unbekannter Tag „${id}“.`);
      return i;
    };
    tags.forEach((t, i) => {
      this.parentIdx[i] = (t.parents ?? []).map((p) => ref(p, `Tag ${t.id}.parents`)).filter(isNum);
      this.impliesIdx[i] = (t.implies ?? []).map((p) => ref(p, `Tag ${t.id}.implies`)).filter(isNum);
      this.childIdx[i] ??= [];
    });
    this.parentIdx.forEach((ps, i) => {
      for (const p of ps) (this.childIdx[p] ??= []).push(i);
    });
    errors.push(...findCycles(this.parentIdx, tags));

    // ── Verbs ───────────────────────────────────────────────────────────
    const verbs = new Map<string, CompiledVerb>();
    for (const p of packs) {
      for (const v of p.verbs) {
        if (verbs.has(v.id)) {
          errors.push(`Mechanismus „${v.id}“ doppelt definiert (${p.id}).`);
          continue;
        }
        verbs.set(v.id, {
          spec: v,
          targets: fromIterable(v.targets.map((t) => ref(t, `Mechanismus ${v.id}.targets`)).filter(isNum)),
          blocked: fromIterable((v.blockedBy ?? []).map((t) => ref(t, `Mechanismus ${v.id}.blockedBy`)).filter(isNum)),
        });
        if (v.targets.length === 0) errors.push(`Mechanismus ${v.id} hat keine Ziele.`);
      }
    }
    this.verbs = verbs;
    const verbRef = (id: string, where: string): boolean => {
      if (verbs.has(id)) return true;
      errors.push(`${where}: unbekannter Mechanismus „${id}“.`);
      return false;
    };
    tags.forEach((t, i) => {
      const grants = (t.grants ?? []).filter((g) => verbRef(g, `Tag ${t.id}.grants`));
      if (grants.length > 0) this.grantsByTag.set(i, grants);
    });
    this.grantTags = fromIterable(this.grantsByTag.keys());
    tags.forEach((t, i) => {
      const raw = t.startledBy ?? [];
      if (raw.length === 0) return;
      const vs = new Set<string>();
      const ts: number[] = [];
      for (const r of raw) {
        if (verbs.has(r)) vs.add(r);
        else ts.push(ref(r, `Tag ${t.id}.startledBy`) ?? -1);
      }
      this.startleByTag.set(i, { verbs: vs, tags: fromIterable(ts.filter((x) => x >= 0)) });
    });
    this.startleTags = fromIterable(this.startleByTag.keys());

    // ── Modifiers ───────────────────────────────────────────────────────
    const modIds = new Set<string>();
    const modifiers: ModifierSpec[] = [];
    for (const p of packs) {
      for (const m of p.modifiers) {
        if (modIds.has(m.id)) {
          errors.push(`Modifikator „${m.id}“ doppelt definiert (${p.id}).`);
          continue;
        }
        modIds.add(m.id);
        modifiers.push(m);
        for (const t of [...(m.add ?? []), ...(m.remove ?? []), ...(m.weak ?? [])]) ref(t, `Modifikator ${m.id}`);
        for (const v of [...(m.verbs ?? []), ...(m.immune ?? [])]) verbRef(v, `Modifikator ${m.id}`);
        for (const w of m.words ?? []) this.modifierStems.insert(lookupKey(w), m);
        for (const pre of m.prefixes ?? []) {
          const k = lookupKey(pre);
          for (const variant of [k, `${k}s`, `${k}n`, `${k}en`]) {
            if (!this.modifierPrefixes.has(variant)) this.modifierPrefixes.set(variant, m);
          }
        }
      }
    }
    this.modifiers = modifiers;

    // ── Arena fields ────────────────────────────────────────────────────
    const families = new Set([...verbs.values()].map((v) => v.spec.family));
    const fields: FieldSpec[] = [];
    for (const p of packs) {
      for (const f of p.fields ?? []) {
        if (fields.some((x) => x.id === f.id)) {
          errors.push(`Arena-Zustand „${f.id}“ doppelt definiert (${p.id}).`);
          continue;
        }
        for (const x of f.from) if (!verbs.has(x) && !this.tagIndex.has(x)) errors.push(`Arena-Zustand ${f.id}.from: „${x}“ ist weder Mechanismus noch Tag.`);
        for (const e of f.effects) for (const x of e.on) if (!verbs.has(x) && !families.has(x)) errors.push(`Arena-Zustand ${f.id}.effects: „${x}“ ist weder Mechanismus noch Familie.`);
        fields.push(f);
      }
    }
    this.fields = fields;

    // ── Forms ───────────────────────────────────────────────────────────
    const lexicon: Form[] = [];
    for (const p of packs) {
      for (const spec of p.forms) {
        if (this.formsById.has(spec.id)) {
          errors.push(`Gestalt „${spec.id}“ doppelt definiert (${p.id}).`);
          continue;
        }
        const form = this.formFromSpec(spec, errors, verbRef, ref);
        if (form === undefined) continue;
        this.formsById.set(form.id, form);
        lexicon.push(form);
      }
    }
    this.lexicon = lexicon;

    // ── Precedents ("Schiedssprüche") ───────────────────────────────────
    for (const p of packs) {
      for (const r of p.rulings ?? []) {
        if (!this.formsById.has(r.attacker) || !this.formsById.has(r.target)) {
          errors.push(`Schiedsspruch ${r.attacker} → ${r.target}: unbekannte Gestalt.`);
          continue;
        }
        if (!verbs.has(r.verb)) {
          errors.push(`Schiedsspruch ${r.attacker} → ${r.target}: unbekannter Mechanismus „${r.verb}“.`);
          continue;
        }
        this.rulings.set(`${r.attacker}>${r.target}`, r); // later packs override earlier ones
      }
    }

    if (errors.length > 0) throw new OntologyError(errors);

    // weaknesses must be reachable
    for (const f of lexicon) {
      const c = this.compileForm(f);
      for (const w of f.weak) {
        const wi = this.tagIndex.get(w);
        if (wi !== undefined && !has(c.closure, wi)) warnings.push(`${f.id}: Schwäche „${w}“ ist kein Tag der Gestalt.`);
      }
    }

    // ── Lookup indexes ──────────────────────────────────────────────────
    const entries = packs.flatMap((p) => p.forms);
    // Names win over aliases, earlier packs over later ones.
    for (const pass of ["name", "alias"] as const) {
      for (const spec of entries) {
        const form = this.formsById.get(spec.id);
        if (form === undefined) continue;
        // Multi-word names: only the last word (the German head noun) becomes an alias –
        // "Leere Rüstung" → "rüstung", not "leere".
        const keys = pass === "name" ? [spec.name, spec.id] : [...(spec.aliases ?? []), normalize(spec.name).split(" ").at(-1) ?? ""];
        for (const raw of keys) {
          const k = lookupKey(raw);
          if (k.length < 3) continue;
          const existing = this.aliasExact.get(k);
          if (existing === undefined) {
            this.aliasExact.set(k, form);
            this.aliasSuffix.insert(reverse(k), { alias: k, form });
            this.aliasFuzzy.add(k, form);
          } else if (existing !== form && pass === "alias" && (spec.aliases ?? []).includes(raw)) {
            warnings.push(`Alias „${raw}“ von ${spec.id} verweist schon auf ${existing.id}.`);
          }
        }
      }
    }
    tags.forEach((t) => {
      for (const k of [t.id, t.label, ...(t.aliases ?? [])]) {
        const key = lookupKey(k);
        if (key.length === 0 || this.tagLookup.has(key)) continue;
        this.tagLookup.set(key, t.id);
        this.tagFuzzy.add(key, t.id);
      }
    });
    for (const v of verbs.values()) {
      for (const k of [v.spec.id, v.spec.label, ...(v.spec.aliases ?? [])]) {
        const key = lookupKey(k);
        if (!this.verbLookup.has(key)) this.verbLookup.set(key, v.spec.id);
      }
    }
    this.warnings = warnings;
  }

  private formFromSpec(
    spec: FormSpec,
    errors: string[],
    verbRef: (id: string, where: string) => boolean,
    ref: (id: string, where: string) => number | undefined,
  ): Form | undefined {
    const where = `Gestalt ${spec.id}`;
    let bad = false;
    if (!ARCHETYPE_SET.has(spec.archetype)) {
      errors.push(`${where}: unbekannter Archetyp „${spec.archetype}“.`);
      bad = true;
    }
    if (!PLANE_SET.has(spec.plane)) {
      errors.push(`${where}: unbekannte Ebene „${spec.plane}“.`);
      bad = true;
    }
    if (!Number.isInteger(spec.scale) || spec.scale < 1 || spec.scale > 8) {
      errors.push(`${where}: Stufe muss 1–8 sein.`);
      bad = true;
    }
    for (const t of [...spec.tags, ...(spec.not ?? []), ...(spec.weak ?? [])]) {
      if (ref(t, where) === undefined) bad = true;
    }
    for (const v of [...(spec.verbs ?? []), ...(spec.immune ?? [])]) if (!verbRef(v, where)) bad = true;
    if (bad) return undefined;
    return {
      id: spec.id,
      name: spec.name,
      archetype: spec.archetype as Archetype,
      scale: spec.scale as Scale,
      plane: spec.plane as Plane,
      tags: spec.tags,
      not: spec.not ?? [],
      verbs: spec.verbs ?? [],
      immune: spec.immune ?? [],
      weak: spec.weak ?? [],
      origin: "lexikon",
      ...(spec.flavor === undefined ? {} : { flavor: spec.flavor }),
    };
  }

  // ── Tags ──────────────────────────────────────────────────────────────

  get tagCount(): number {
    return this.tags.length;
  }

  hasTag(id: string): boolean {
    return this.tagIndex.has(id);
  }

  tagIndexOf(id: string): number | undefined {
    return this.tagIndex.get(id);
  }

  tagAt(index: number): TagSpec | undefined {
    return this.tags[index];
  }

  tagLabel(idOrIndex: string | number): string {
    const i = typeof idOrIndex === "number" ? idOrIndex : this.tagIndex.get(idOrIndex);
    return i === undefined ? String(idOrIndex) : (this.tags[i]?.label ?? String(idOrIndex));
  }

  /** Tag plus everything it is (parents) and has (implications), transitively. */
  closureOf(index: number): TagSet {
    return this.memoWalk(index, this.closureMemo, (i) => [...(this.parentIdx[i] ?? []), ...(this.impliesIdx[i] ?? [])]);
  }

  /** Tag plus its is-a ancestors (no implications). */
  ancestorsOf(index: number): TagSet {
    return this.memoWalk(index, this.ancestorMemo, (i) => this.parentIdx[i] ?? []);
  }

  /** Tag plus all its is-a descendants. */
  descendantsOf(index: number): TagSet {
    return this.memoWalk(index, this.descendantMemo, (i) => this.childIdx[i] ?? []);
  }

  /** Is `tag` equal to or a descendant of `ancestor`? */
  isA(tag: string, ancestor: string): boolean {
    const t = this.tagIndex.get(tag);
    const a = this.tagIndex.get(ancestor);
    return t !== undefined && a !== undefined && has(this.ancestorsOf(t), a);
  }

  /** Iterative, cycle-safe closure walk that reuses memoised sub-results. */
  private memoWalk(start: number, memo: (TagSet | undefined)[], next: (i: number) => readonly number[]): TagSet {
    const cached = memo[start];
    if (cached !== undefined) return cached;
    const seen = new Set<number>([start]);
    const stack = [...next(start)];
    while (stack.length > 0) {
      const i = stack.pop();
      if (i === undefined || seen.has(i)) continue;
      const sub = memo[i];
      if (sub !== undefined) {
        for (const x of sub) seen.add(x);
        continue;
      }
      seen.add(i);
      for (const n of next(i)) if (!seen.has(n)) stack.push(n);
    }
    const result = fromIterable(seen);
    memo[start] = result;
    return result;
  }

  /** Expand declared tags into a closure, then subtract `not` tags and their descendants. */
  expand(declared: readonly string[], not: readonly string[] = []): TagSet {
    const all: number[] = [];
    for (const id of declared) {
      const i = this.tagIndex.get(id);
      if (i !== undefined) for (const x of this.closureOf(i)) all.push(x);
    }
    const removed: number[] = [];
    for (const id of not) {
      const i = this.tagIndex.get(id);
      if (i !== undefined) for (const x of this.descendantsOf(i)) removed.push(x);
    }
    return difference(fromIterable(all), fromIterable(removed));
  }

  // ── Forms ─────────────────────────────────────────────────────────────

  compileForm(form: Form): CompiledForm {
    const cached = this.compiled.get(form);
    if (cached !== undefined) return cached;
    const closure = this.expand(form.tags, form.not);
    const verbs = new Set<string>();
    for (const v of form.verbs) if (this.verbs.has(v)) verbs.add(v);
    for (const t of intersection(closure, this.grantTags)) for (const g of this.grantsByTag.get(t) ?? []) verbs.add(g);
    const compiled: CompiledForm = {
      form,
      closure,
      verbs: [...verbs],
      weak: fromIterable(form.weak.map((w) => this.tagIndex.get(w)).filter(isNum)),
      immune: new Set(form.immune),
      startle: intersection(closure, this.startleTags).map((tag) => ({ tag, ...(this.startleByTag.get(tag) ?? { verbs: new Set<string>(), tags: fromIterable([]) }) })),
    };
    this.compiled.set(form, compiled);
    return compiled;
  }

  /** Does the (expanded) form carry `tagId` – directly, by inheritance or implication? */
  formHas(form: Form, tagId: string): boolean {
    const i = this.tagIndex.get(tagId);
    return i !== undefined && has(this.compileForm(form).closure, i);
  }

  /** Expanded tag ids of a form (for UI / narration). */
  formTags(form: Form): string[] {
    return [...this.compileForm(form).closure].map((i) => this.tags[i]?.id ?? "").filter((x) => x !== "");
  }

  /** Stored precedent for exactly this pair, if any. */
  rulingFor(attackerId: string, targetId: string): RulingSpec | undefined {
    return this.rulings.get(`${attackerId}>${targetId}`);
  }

  formById(id: string): Form | undefined {
    return this.formsById.get(id);
  }

  /** Lexicon forms able to use `verb` (built lazily, cached). */
  usersOf(verb: string): readonly Form[] {
    if (this.verbUsersMemo === undefined) {
      const map = new Map<string, Form[]>();
      for (const f of this.lexicon) {
        for (const v of this.compileForm(f).verbs) {
          const list = map.get(v);
          if (list === undefined) map.set(v, [f]);
          else list.push(f);
        }
      }
      this.verbUsersMemo = map;
    }
    return this.verbUsersMemo.get(verb) ?? [];
  }

  // ── Lookup (parser / LLM resolver) ───────────────────────────────────

  formByAlias(key: string): Form | undefined {
    return this.aliasExact.get(key);
  }

  /** All aliases that are a suffix of `word` (longest first). */
  aliasSuffixesOf(word: string): { alias: string; form: Form }[] {
    return this.aliasSuffix.prefixesOf(reverse(word)).flatMap((h) => h.values);
  }

  fuzzyForms(word: string, maxDistance: number, limit = 5): { key: string; value: Form; distance: number }[] {
    return this.aliasFuzzy.search(word, maxDistance, limit);
  }

  /** Modifier whose stem starts `word` with at most `maxSuffix` extra letters (inflection). */
  modifierByWord(word: string, maxSuffix = 3): ModifierSpec | undefined {
    for (const hit of this.modifierStems.prefixesOf(word)) {
      if (hit.length >= 3 && word.length - hit.length <= maxSuffix) return hit.values[0];
      if (hit.length === word.length) return hit.values[0];
    }
    return undefined;
  }

  modifierByPrefix(prefix: string): ModifierSpec | undefined {
    return this.modifierPrefixes.get(prefix) ?? this.modifierByWord(prefix);
  }

  /** Map a free-text keyword (e.g. from the LLM) to a canonical tag id. */
  resolveTag(keyword: string): string | undefined {
    const key = lookupKey(keyword);
    const exact = this.tagLookup.get(key);
    if (exact !== undefined) return exact;
    if (key.length < 4) return undefined;
    return this.tagFuzzy.search(key, key.length >= 8 ? 2 : 1, 1)[0]?.value;
  }

  resolveVerb(keyword: string): string | undefined {
    return this.verbLookup.get(lookupKey(keyword));
  }
}

function isNum(x: number | undefined): x is number {
  return x !== undefined;
}

function reverse(s: string): string {
  return Array.from(s).reverse().join("");
}

/** Detect cycles in the is-a graph (implications may be cyclic, inheritance may not). */
function findCycles(parents: readonly (readonly number[])[], tags: readonly TagSpec[]): string[] {
  const state = new Uint8Array(parents.length); // 0 new, 1 on stack, 2 done
  const errors: string[] = [];
  for (let root = 0; root < parents.length; root++) {
    if (state[root] !== 0) continue;
    const stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
    state[root] = 1;
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const ps = parents[top.node] ?? [];
      if (top.next < ps.length) {
        const p = ps[top.next++] ?? 0;
        if (state[p] === 1) errors.push(`Zyklus in der Vererbung bei Tag „${tags[p]?.id ?? p}“.`);
        else if (state[p] === 0) {
          state[p] = 1;
          stack.push({ node: p, next: 0 });
        }
      } else {
        state[top.node] = 2;
        stack.pop();
      }
    }
  }
  return errors;
}

