import { Ontology, OntologyError, lookupKey } from "../engine/ontology/ontology.ts";
import { parsePack, type ContentPack, type FormSpec, type RulingSpec, type TagSpec, type VerbSpec } from "../engine/ontology/pack.ts";
import { findCounters } from "../engine/rules.ts";
import { normalize } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";

/**
 * Live learning: when Claude meets something the game does not know, it may
 * propose a new form – and, sparingly, new properties (tags) or a new
 * mechanism. Proposals become a regular content pack ("Gelernt") that is
 * validated exactly like hand-written content and then compiled together with
 * the core pack. Because new tags must hang under existing categories, they
 * inherit every rule of their parents immediately – no new rule code needed.
 *
 * Guardrails (all enforced here, not trusted from the model):
 *  - new tags need ≥ 1 existing parent; at most MAX_NEW_TAGS per proposal
 *  - at most one new mechanism, leverage clamped to 1–2, targets must exist
 *  - the resulting form must have a mechanism, a weakness and at least one
 *    counter in the lexicon – otherwise it is rejected as too powerful
 *  - the whole pack must compile (no cycles, no dangling references)
 */

export const LEARNED_PACK_ID = "gelernt";
export const MAX_NEW_TAGS = 2;
export const MAX_LEARNED_FORMS = 5000;

export interface LearningDelta {
  readonly tags: readonly TagSpec[];
  readonly verbs: readonly VerbSpec[];
}

export const EMPTY_DELTA: LearningDelta = { tags: [], verbs: [] };

export function emptyLearnedPack(): ContentPack {
  return { id: LEARNED_PACK_ID, name: "Gelernt", version: "1", tags: [], verbs: [], modifiers: [], forms: [] };
}

/** Accept a stored/uploaded pack only if it is a well-formed "Gelernt" pack. */
export function readLearnedPack(raw: unknown): ContentPack {
  const r = parsePack(raw);
  return r.ok && r.pack.id === LEARNED_PACK_ID ? r.pack : emptyLearnedPack();
}

export function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "x";
}

export interface Learned {
  readonly onto: Ontology;
  readonly pack: ContentPack;
  readonly form: Form;
  /** True if this call added something new (form, tags or mechanism). */
  readonly isNew: boolean;
  readonly newTags: readonly string[];
  readonly newVerbs: readonly string[];
}

export type LearnResult = { readonly ok: true; readonly value: Learned } | { readonly ok: false; readonly reason: string };

/** Look up a previously learned form by the exact (normalised) text the player typed. */
export function findLearned(onto: Ontology, text: string): Form | undefined {
  const f = onto.formByAlias(lookupKey(text));
  return f?.id.startsWith("g:") === true ? f : undefined;
}

/**
 * Integrate a Claude classification into the learned pack.
 * `base` = compiled packs that never change at runtime (the core).
 */
export interface Discovery {
  /** Player name – shown in the grimoire. */
  readonly by: string;
  /** ISO date (the engine never reads the clock; the caller supplies it). */
  readonly at: string;
}

/**
 * Learned intensities: known qualities only, integers 0..6, a force (hitze, naesse …) at most
 * scale + 2 – re-checked here whatever the parser let through.
 */
function cappedQualities(base: readonly ContentPack[], form: Form): Record<string, number> | undefined {
  if (form.qualities === undefined) return undefined;
  const kinds = new Map(base.flatMap((p) => p.qualities ?? []).map((q) => [q.id, q.kind]));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(form.qualities)) {
    const kind = kinds.get(k);
    if (kind === undefined || !Number.isFinite(v)) continue;
    out[k] = Math.max(0, Math.min(kind === "kraft" ? Math.min(6, form.scale + 2) : 6, Math.round(v)));
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function learn(
  base: readonly ContentPack[],
  learned: ContentPack,
  text: string,
  form: Form,
  delta: LearningDelta,
  discovery?: Discovery,
): LearnResult {
  if (learned.forms.length >= MAX_LEARNED_FORMS) return { ok: false, reason: "Das Gedächtnis des Spiels ist voll." };
  const id = `g:${slug(text)}`;
  const existing = learned.forms.find((f) => f.id === id);
  if (existing !== undefined) {
    const onto = compile(base, learned);
    const known = onto?.formById(id);
    if (onto !== undefined && known !== undefined) {
      return { ok: true, value: { onto, pack: learned, form: known, isNew: false, newTags: [], newVerbs: [] } };
    }
  }

  const aliases = [...new Set([normalize(text), normalize(form.name)])].filter((a) => a.length >= 3);
  const qualities = cappedQualities(base, form);
  const spec = (tags: readonly string[], verbs: readonly string[]): FormSpec => ({
    id,
    name: form.name,
    archetype: form.archetype,
    scale: form.scale,
    plane: form.plane,
    tags,
    ...(form.not.length > 0 ? { not: form.not } : {}),
    ...(verbs.length > 0 ? { verbs } : {}),
    ...(form.immune.length > 0 ? { immune: form.immune } : {}),
    ...(form.weak.length > 0 ? { weak: form.weak } : {}),
    aliases,
    ...(form.flavor === undefined ? {} : { flavor: form.flavor }),
    ...(form.sprite === undefined ? {} : { sprite: form.sprite }),
    // kept for its colour hints (the rows above are what gets drawn)
    ...(form.sketch === undefined ? {} : { sketch: form.sketch }),
    ...(form.look === undefined ? {} : { look: form.look }),
    ...(qualities === undefined ? {} : { qualities }),
    ...(discovery === undefined ? {} : { discoveredBy: discovery.by.slice(0, 40), discoveredAt: discovery.at.slice(0, 24) }),
  });

  const newTagIds = new Set(delta.tags.map((t) => t.id));
  const newVerbIds = new Set(delta.verbs.map((v) => v.id));
  // Try the full proposal first, then fall back to more conservative variants.
  const attempts: { tags: readonly TagSpec[]; verbs: readonly VerbSpec[]; formTags: readonly string[]; formVerbs: readonly string[] }[] = [
    { tags: delta.tags, verbs: delta.verbs, formTags: form.tags, formVerbs: form.verbs },
    { tags: delta.tags, verbs: [], formTags: form.tags, formVerbs: form.verbs.filter((v) => !newVerbIds.has(v)) },
    { tags: [], verbs: [], formTags: form.tags.filter((t) => !newTagIds.has(t)), formVerbs: form.verbs.filter((v) => !newVerbIds.has(v)) },
  ];
  let lastReason = "Die Gestalt ließ sich nicht einordnen.";
  for (const a of attempts) {
    if (a.formTags.length === 0) continue;
    const candidate: ContentPack = {
      ...learned,
      tags: [...learned.tags, ...a.tags.filter((t) => !learned.tags.some((x) => x.id === t.id))],
      verbs: [...learned.verbs, ...a.verbs.filter((v) => !learned.verbs.some((x) => x.id === v.id))],
      forms: [...learned.forms.filter((f) => f.id !== id), spec(a.formTags, a.formVerbs)],
    };
    const onto = compile(base, candidate);
    if (onto === undefined) continue;
    const compiled = onto.formById(id);
    if (compiled === undefined) continue;
    if (onto.compileForm(compiled).verbs.length === 0) {
      lastReason = "Diese Gestalt kann niemandem etwas anhaben.";
      continue;
    }
    // Every form needs a weakness the rules can reach: keep valid ones or pick a declared tag.
    let final: { onto: Ontology; pack: ContentPack; form: Form } = { onto, pack: candidate, form: compiled };
    if (!compiled.weak.some((w) => onto.formHas(compiled, w))) {
      const fallback = a.formTags.find((t) => onto.hasTag(t));
      if (fallback === undefined) continue;
      const repaired: ContentPack = { ...candidate, forms: [...learned.forms.filter((f) => f.id !== id), { ...spec(a.formTags, a.formVerbs), weak: [fallback] }] };
      const onto2 = compile(base, repaired);
      const f2 = onto2?.formById(id);
      if (onto2 === undefined || f2 === undefined) continue;
      final = { onto: onto2, pack: repaired, form: f2 };
    }
    if (findCounters(final.onto, final.form).length === 0) {
      lastReason = "Diese Gestalt wäre unbesiegbar – so etwas lässt das Spiel nicht zu.";
      continue;
    }
    return {
      ok: true,
      value: { ...final, isNew: true, newTags: a.tags.map((t) => t.label), newVerbs: a.verbs.map((v) => v.label) },
    };
  }
  return { ok: false, reason: lastReason };
}

function compile(base: readonly ContentPack[], learned: ContentPack): Ontology | undefined {
  try {
    return Ontology.compile([...base, learned]);
  } catch (e) {
    if (e instanceof OntologyError) return undefined;
    throw e;
  }
}

/** Store a referee ruling as a precedent in the learned pack (replacing one for the same pair). */
export function addRuling(base: readonly ContentPack[], learned: ContentPack, ruling: RulingSpec): { onto: Ontology; pack: ContentPack } | undefined {
  const rulings = [...(learned.rulings ?? []).filter((r) => r.attacker !== ruling.attacker || r.target !== ruling.target), ruling];
  const pack: ContentPack = { ...learned, rulings };
  const onto = compile(base, pack);
  return onto === undefined ? undefined : { onto, pack };
}

/**
 * Keep a stored learned pack loadable after the core has grown: entries the core now defines
 * itself (same id – e.g. a learned "Löschdecke" that became a hand-drawn core form) are dropped
 * in favour of the core, and any form that no longer compiles is left out instead of
 * discarding the whole pack. Returns undefined if nothing usable remains.
 */
export function reconcileLearned(base: readonly ContentPack[], pack: ContentPack): ContentPack | undefined {
  const ids = (pick: (p: ContentPack) => readonly { readonly id: string }[]): Set<string> =>
    new Set(base.flatMap((p) => pick(p).map((x) => x.id)));
  const tags = ids((p) => p.tags);
  const verbs = ids((p) => p.verbs);
  const modifiers = ids((p) => p.modifiers);
  const forms = ids((p) => p.forms);
  const trimmed: ContentPack = {
    ...pack,
    tags: pack.tags.filter((t) => !tags.has(t.id)),
    verbs: pack.verbs.filter((v) => !verbs.has(v.id)),
    modifiers: pack.modifiers.filter((m) => !modifiers.has(m.id)),
    forms: pack.forms.filter((f) => !forms.has(f.id)),
  };
  if (compile(base, trimmed) !== undefined) return trimmed;
  // Something still clashes: rebuild form by form, keeping whatever compiles.
  let kept: ContentPack = { ...trimmed, forms: [], rulings: [] };
  if (compile(base, kept) === undefined) kept = { ...kept, tags: [], verbs: [], modifiers: [] };
  if (compile(base, kept) === undefined) return undefined;
  for (const f of trimmed.forms) {
    const next: ContentPack = { ...kept, forms: [...kept.forms, f] };
    if (compile(base, next) !== undefined) kept = next;
  }
  for (const r of trimmed.rulings ?? []) {
    const next: ContentPack = { ...kept, rulings: [...(kept.rulings ?? []), r] };
    if (compile(base, next) !== undefined) kept = next;
  }
  return kept;
}
