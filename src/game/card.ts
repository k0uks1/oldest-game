/**
 * The form card ("Gestaltkarte"): everything a player may look up about a form, as plain data –
 * shown in the grimoire, under the input line and in the summary. DOM-free and pure, so the
 * same card appears in the browser, in tests and (later) in exports.
 */
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Form, Tone } from "../engine/types.ts";

export const SCALE_NAMES = ["", "winzig", "klein", "menschengroß", "groß", "gewaltig", "Landschaft", "Welt", "kosmisch"] as const;
const PLANE_NAMES: Readonly<Record<Form["plane"], string>> = { materie: "Materie", leben: "Leben", geist: "Geist", abstrakt: "Abstraktes" };

export interface CardAbility {
  readonly label: string;
  /** The property it comes from ("scharf"), if not the form's own. */
  readonly via?: string;
}

export interface CardLevel {
  readonly label: string;
  readonly level: number;
  readonly kind: "kraft" | "schutz";
}

export interface FormCard {
  readonly name: string;
  readonly scale: number;
  readonly scaleName: string;
  readonly plane: string;
  /** The lexicon form it varies, and how (as the player meant it plus what changed). */
  readonly base?: { readonly id: string; readonly name: string };
  readonly mods: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** What it is (substance, kind), what it has (traits), what it can do. */
  readonly is: readonly string[];
  readonly traits: readonly string[];
  readonly can: readonly CardAbility[];
  readonly levels: readonly CardLevel[];
  readonly weak: readonly string[];
  readonly lore?: string;
  readonly flavor?: string;
  readonly tone?: Tone;
  readonly learned: boolean;
}

/** "scharf (Klinge, Schneide)" → "scharf": the explanation in brackets is for Claude, not the card. */
export function shortLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const ABILITY_GROUPS = new Set(["faehigkeit"]);
const TRAIT_GROUPS = new Set(["merkmal", "zustand", "geist"]);

export function formCard(onto: Ontology, form: Form): FormCard {
  const c = onto.compileForm(form);
  const label = (id: string): string => shortLabel(onto.tagLabel(id));
  const group = (id: string): string => onto.tagAt(onto.tagIndexOf(id) ?? -1)?.group ?? "";
  const base = form.base === undefined ? undefined : onto.formById(form.base);
  const declared = form.tags.filter((t) => onto.hasTag(t));
  const is = declared.filter((t) => !ABILITY_GROUPS.has(group(t)) && !TRAIT_GROUPS.has(group(t))).map(label);
  const traits = declared.filter((t) => TRAIT_GROUPS.has(group(t))).map(label);
  const can = c.verbs.map((v): CardAbility => {
    const via = onto.grantSource(form, v);
    return { label: onto.verbs.get(v)?.spec.label ?? v, ...(via === undefined ? {} : { via: label(via) }) };
  });
  const levels = [...c.qualities].flatMap(([id, level]): CardLevel[] => {
    const q = onto.qualities.get(id);
    return q === undefined ? [] : [{ label: q.label, level, kind: q.kind }];
  });
  const added = base === undefined ? [] : form.tags.filter((t) => !base.tags.includes(t) && onto.hasTag(t)).map(label);
  const removed = base === undefined ? [] : [...form.not.filter((t) => !base.not.includes(t)), ...base.tags.filter((t) => !form.tags.includes(t))].filter((t) => onto.hasTag(t)).map(label);
  return {
    name: form.name,
    scale: form.scale,
    scaleName: SCALE_NAMES[form.scale],
    plane: PLANE_NAMES[form.plane],
    ...(base === undefined ? {} : { base: { id: base.id, name: base.name } }),
    mods: form.mods ?? [],
    added: [...new Set(added)],
    removed: [...new Set(removed)],
    is: [...new Set(is)],
    traits: [...new Set(traits)],
    can,
    levels,
    weak: [...new Set(form.weak.filter((w) => onto.hasTag(w)).map(label))],
    ...(form.lore === undefined ? {} : { lore: form.lore }),
    ...(form.flavor === undefined ? {} : { flavor: form.flavor }),
    ...(form.tone === undefined ? {} : { tone: form.tone }),
    learned: form.id.startsWith("g:"),
  };
}
