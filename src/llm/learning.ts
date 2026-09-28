import { Ontology, OntologyError, lookupKey } from "../engine/ontology/ontology.ts";
import { parsePack, type ContentPack, type FormSpec, type QualitySpec, type RulingSpec, type TagSpec, type VerbSpec } from "../engine/ontology/pack.ts";
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
 *  - a new ability may grant mechanisms (`grants`) only if it can actually perform them
 *    (affordance) and only small ones (leverage ≤ 2); forces it carries stay ≤ LEARNED_TAG_FORCE
 *  - at most MAX_NEW_QUALITIES new intensities (a force or a protection, default 0)
 *  - at most one new mechanism, leverage clamped to 1–2, targets must exist
 *  - the resulting form must have a mechanism, a weakness and at least one
 *    counter in the lexicon – otherwise it is rejected as too powerful
 *  - the whole pack must compile (no cycles, no dangling references)
 */

export const LEARNED_PACK_ID = "gelernt";
export const MAX_NEW_TAGS = 3;
export const MAX_NEW_QUALITIES = 2;
/** A learned property may carry a force of at most this (a form still caps it at scale + 2). */
export const LEARNED_TAG_FORCE = 3;
export const MAX_LEARNED_FORMS = 5000;

export interface LearningDelta {
  readonly tags: readonly TagSpec[];
  readonly verbs: readonly VerbSpec[];
  /** New intensities (optional: parse results cached before v0.49 have none). */
  readonly qualities?: readonly QualitySpec[];
}

export const EMPTY_DELTA: LearningDelta = { tags: [], verbs: [], qualities: [] };

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
  /** Labels of new intensities ("Gestank"). */
  readonly newQualities?: readonly string[];
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
function cappedQualities(known: readonly QualitySpec[], form: Form): Record<string, number> | undefined {
  if (form.qualities === undefined) return undefined;
  const kinds = new Map(known.map((q) => [q.id, q.kind]));
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
  const clean = sanitizeDelta([...base, learned], delta);
  const qualities = cappedQualities([...base, learned].flatMap((p) => p.qualities ?? []).concat(clean.qualities ?? []), form);
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
    ...(form.art === undefined ? {} : { art: form.art }),
    ...(form.artPrompt === undefined ? {} : { artPrompt: form.artPrompt }),
    ...(form.base === undefined ? {} : { base: form.base }),
    ...(form.mods === undefined ? {} : { mods: form.mods }),
    ...(form.lore === undefined ? {} : { lore: form.lore }),
    ...(form.tone === undefined ? {} : { tone: form.tone }),
    ...(qualities === undefined ? {} : { qualities }),
    ...(discovery === undefined ? {} : { discoveredBy: discovery.by.slice(0, 40), discoveredAt: discovery.at.slice(0, 24) }),
  });

  const newTagIds = new Set(clean.tags.map((t) => t.id));
  const newVerbIds = new Set(clean.verbs.map((v) => v.id));
  const newQualities = clean.qualities ?? [];
  const noNewVerb = (t: TagSpec): TagSpec => (t.grants?.some((g) => newVerbIds.has(g)) === true ? stripGrants(t, (g) => newVerbIds.has(g)) : t);
  // Try the full proposal first, then fall back to more conservative variants.
  const attempts: {
    tags: readonly TagSpec[];
    verbs: readonly VerbSpec[];
    qualities: readonly QualitySpec[];
    formTags: readonly string[];
    formVerbs: readonly string[];
  }[] = [
    { tags: clean.tags, verbs: clean.verbs, qualities: newQualities, formTags: form.tags, formVerbs: form.verbs },
    { tags: clean.tags.map(noNewVerb), verbs: [], qualities: newQualities, formTags: form.tags, formVerbs: form.verbs.filter((v) => !newVerbIds.has(v)) },
    { tags: [], verbs: [], qualities: [], formTags: form.tags.filter((t) => !newTagIds.has(t)), formVerbs: form.verbs.filter((v) => !newVerbIds.has(v)) },
  ];
  let lastReason = "Die Gestalt ließ sich nicht einordnen.";
  for (const a of attempts) {
    if (a.formTags.length === 0) continue;
    const packWith = (tags: readonly TagSpec[]): ContentPack => ({
      ...learned,
      tags: [...learned.tags, ...tags.filter((t) => !learned.tags.some((x) => x.id === t.id))],
      verbs: [...learned.verbs, ...a.verbs.filter((v) => !learned.verbs.some((x) => x.id === v.id))],
      ...(a.qualities.length === 0 && learned.qualities === undefined
        ? {}
        : { qualities: [...(learned.qualities ?? []), ...a.qualities.filter((q) => !(learned.qualities ?? []).some((x) => x.id === q.id))] }),
      forms: [...learned.forms.filter((f) => f.id !== id), spec(a.formTags, a.formVerbs)],
    });
    let candidate = packWith(a.tags);
    let onto = compile(base, candidate);
    if (onto === undefined) continue;
    // Affordance for learned abilities: a property grants only what a bare carrier of it can do.
    const probe = onto;
    const honest = a.tags.map((t) => stripGrants(t, (g) => !probe.compileForm(probeForm(t.id)).verbs.includes(g)));
    if (honest.some((t, i) => t !== a.tags[i])) {
      candidate = packWith(honest);
      onto = compile(base, candidate);
      if (onto === undefined) continue;
    }
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
      value: { ...final, isNew: true, newTags: a.tags.map((t) => t.label), newVerbs: a.verbs.map((v) => v.label), newQualities: a.qualities.map((q) => q.label) },
    };
  }
  return { ok: false, reason: lastReason };
}

/** What a judgement adds to an already learned form. */
export interface Amendment {
  readonly id: string;
  readonly tags: readonly string[];
  readonly verbs?: readonly string[];
  readonly qualities?: Readonly<Record<string, number>>;
}

/**
 * Add properties (and new vocabulary) to learned forms – the judge's way of making a verdict
 * follow from the rules. Validated like `learn`: the pack must compile, learned abilities grant
 * only what their carriers can do, and every amended form keeps a mechanism and a counter.
 * Core forms are never touched. Undefined = rejected (nothing changes).
 */
export function amend(base: readonly ContentPack[], learned: ContentPack, amendments: readonly Amendment[], delta: LearningDelta): { onto: Ontology; pack: ContentPack } | undefined {
  const clean = sanitizeDelta([...base, learned], delta);
  const known = [...base, learned].flatMap((p) => p.qualities ?? []).concat(clean.qualities ?? []);
  const changed = new Map<string, FormSpec>();
  for (const a of amendments) {
    const spec = learned.forms.find((f) => f.id === a.id);
    if (spec === undefined || !a.id.startsWith("g:")) return undefined;
    const merged = { ...(spec.qualities ?? {}), ...(a.qualities ?? {}) };
    const capped = cappedQualities(known, { ...probeForm(""), scale: spec.scale as Form["scale"], qualities: merged });
    const tags = [...new Set([...spec.tags, ...a.tags])];
    const verbs = [...new Set([...(spec.verbs ?? []), ...(a.verbs ?? [])])];
    changed.set(a.id, { ...spec, tags, ...(verbs.length > 0 ? { verbs } : {}), ...(capped === undefined ? {} : { qualities: capped }) });
  }
  const packWith = (tags: readonly TagSpec[]): ContentPack => ({
    ...learned,
    tags: [...learned.tags, ...tags.filter((t) => !learned.tags.some((x) => x.id === t.id))],
    verbs: [...learned.verbs, ...clean.verbs.filter((v) => !learned.verbs.some((x) => x.id === v.id))],
    ...((clean.qualities ?? []).length === 0 && learned.qualities === undefined
      ? {}
      : { qualities: [...(learned.qualities ?? []), ...(clean.qualities ?? []).filter((q) => !(learned.qualities ?? []).some((x) => x.id === q.id))] }),
    forms: learned.forms.map((f) => changed.get(f.id) ?? f),
  });
  let pack = packWith(clean.tags);
  let onto = compile(base, pack);
  if (onto === undefined) return undefined;
  const probe = onto;
  const honest = clean.tags.map((t) => stripGrants(t, (g) => !probe.compileForm(probeForm(t.id)).verbs.includes(g)));
  if (honest.some((t, i) => t !== clean.tags[i])) {
    pack = packWith(honest);
    onto = compile(base, pack);
    if (onto === undefined) return undefined;
  }
  for (const id of changed.keys()) {
    const f = onto.formById(id);
    if (f === undefined || onto.compileForm(f).verbs.length === 0 || findCounters(onto, f).length === 0) return undefined;
  }
  return { onto, pack };
}

/** A bare carrier of one property – what it grants must work for this. */
function probeForm(tag: string): Form {
  return { id: `probe:${tag}`, name: tag, archetype: "orb", scale: 3, plane: "materie", tags: [tag], not: [], verbs: [], immune: [], weak: [], origin: "komponiert" };
}

function stripGrants(t: TagSpec, drop: (verb: string) => boolean): TagSpec {
  const { grants, ...rest } = t;
  if (grants?.some(drop) !== true) return t;
  const left = grants.filter((g) => !drop(g));
  return left.length > 0 ? { ...rest, grants: left } : rest;
}

/**
 * The authoritative shape check for a proposal, whatever the parser let through: limits, known
 * references, small levers, capped forces. Affordance of grants is checked after compiling.
 */
export function sanitizeDelta(packs: readonly ContentPack[], delta: LearningDelta): LearningDelta {
  const known = new Map(packs.flatMap((p) => p.qualities ?? []).map((q) => [q.id, q]));
  const qualities = (delta.qualities ?? [])
    .filter((q) => /^q_[a-z0-9_]{2,48}$/.test(q.id) && !known.has(q.id) && q.label.length >= 3 && q.label.length <= 30)
    .slice(0, MAX_NEW_QUALITIES)
    .map((q): QualitySpec => ({ id: q.id, label: q.label, kind: q.kind, default: 0, ...(q.hint === undefined ? {} : { hint: q.hint.slice(0, 160) }) }));
  for (const q of qualities) known.set(q.id, q);
  const verbs = delta.verbs.slice(0, 1).map((v): VerbSpec => ({ ...v, leverage: Math.max(1, Math.min(2, Math.round(v.leverage))) }));
  const verbLever = new Map(packs.flatMap((p) => p.verbs).map((v) => [v.id, v.leverage]));
  for (const v of verbs) verbLever.set(v.id, v.leverage);
  const capped = (t: TagSpec): TagSpec => {
    const { qualities: set, ...rest } = t;
    const levels: Record<string, number> = {};
    for (const [k, n] of Object.entries(set ?? {})) {
      const q = known.get(k);
      if (q === undefined || !Number.isFinite(n)) continue;
      levels[k] = Math.max(0, Math.min(q.kind === "kraft" ? LEARNED_TAG_FORCE : 6, Math.round(n)));
    }
    return Object.keys(levels).length > 0 ? { ...rest, qualities: levels } : rest;
  };
  const tags = delta.tags.slice(0, MAX_NEW_TAGS).map((t) => capped(stripGrants(t, (g) => (verbLever.get(g) ?? 99) > 2)));
  return { tags, verbs, qualities };
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
  const qualities = ids((p) => p.qualities ?? []);
  const trimmed: ContentPack = {
    ...pack,
    ...(pack.qualities === undefined ? {} : { qualities: pack.qualities.filter((q) => !qualities.has(q.id)) }),
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
