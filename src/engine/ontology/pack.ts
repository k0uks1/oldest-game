import type { FormLook } from "../types.ts";

/**
 * Content pack format. Packs are plain JSON so they can be generated,
 * shipped separately or dropped in by players. Everything is referenced
 * by string id; the {@link Ontology} compiles packs into indexed form.
 */

export interface TagSpec {
  readonly id: string;
  readonly label: string;
  /** UI grouping only (material, element, …). */
  readonly group: string;
  /** is-a: `stahl` → `eisen` → `metall` → `fest`. Rules on a parent apply to all descendants. */
  readonly parents?: readonly string[];
  /** has-property: `mensch` ⇒ `atmet`, `blutet`, `denkt` … */
  readonly implies?: readonly string[];
  /** Mechanisms any carrier of this tag can use. */
  readonly grants?: readonly string[];
  /**
   * "Schreck": what startles a carrier – mechanism ids (a bang: `uebertoent`) or tags of the
   * attacker (`feuer`). A startled target counts as hit in its weakness and flees.
   */
  readonly startledBy?: readonly string[];
  /** Intensities (quality id → 0..6) every carrier has; the most specific tag wins. */
  readonly qualities?: Readonly<Record<string, number>>;
  readonly aliases?: readonly string[];
}

/**
 * "Intensität": a graded property. A `kraft` (hitze, naesse …) is what a mechanism brings,
 * a `schutz` (hitzefest, haerte …) is what resists it. Levels run 0..6.
 */
export interface QualitySpec {
  readonly id: string;
  readonly label: string;
  readonly kind: "kraft" | "schutz";
  /** Level a form has when nothing specifies it. Default 0. */
  readonly default?: number;
  readonly hint?: string;
}

/**
 * Attacker requirements of a mechanism, checked against the attacker's closure: at least one of
 * `any`, all of `all`, none of `none`; `qualities` count only where they are actually set (by a tag,
 * a combo or the form) – never through a quality's default.
 */
export interface RequiresSpec {
  readonly any?: readonly string[];
  readonly all?: readonly string[];
  readonly none?: readonly string[];
  /** Set intensity at least this (e.g. hitze 2: something hot, not just anything). `any` OR these. */
  readonly qualities?: Readonly<Record<string, number>>;
}

/** A mechanism requirement: the attacker's `by` must reach the target's `vs` (e.g. hitze vs hitzefest). */
export interface NeedSpec {
  readonly by: string;
  readonly vs: string;
}

/** Melee (`nah`) mechanisms cannot reach a flying target unless the attacker flies or towers over it. */
export const REACHES = ["nah", "fern"] as const;
export type Reach = (typeof REACHES)[number];

/**
 * "Kombination": if a closure carries all `if` tags and none of `unless`, add/remove tags and shift
 * qualities – wet wood does not burn, armour hardens, fire without body is weaker.
 */
export interface ComboSpec {
  readonly id: string;
  readonly if: readonly string[];
  readonly unless?: readonly string[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
  /** Quality deltas. */
  readonly qualities?: Readonly<Record<string, number>>;
  readonly hint: string;
}

export interface VerbSpec {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly leverage: number;
  /** Target must carry (or descend from) at least one of these tags. */
  readonly targets: readonly string[];
  /** Target carrying (or descending from) any of these is unaffected. */
  readonly blockedBy?: readonly string[];
  readonly minRelativeScale?: number;
  readonly hint: string;
  /** Sentence template, `{B}` = target. Defaults to "<label> {B}". */
  readonly phrase?: string;
  /** How the loser is beaten ("Siegart"). Default: vernichtet. */
  readonly outcome?: VictoryKind;
  /** Intensity requirements; all must hold. Surplus ≥ 2 on each adds +1 power. */
  readonly needs?: readonly NeedSpec[];
  /**
   * "Affordanz": what the *attacker* must be to use this at all – whoever it was assigned to.
   * A radio cannot corrode, a hat cannot deceive. See {@link RequiresSpec}.
   */
  readonly requires?: RequiresSpec;
  /** Default `fern`. */
  readonly reach?: Reach;
  readonly aliases?: readonly string[];
}

/** Ways to win: not every victory destroys. */
export const VICTORY_KINDS = ["vernichtet", "vertrieben", "verfuehrt", "befriedet", "eingeschlaefert", "gebannt", "versteinert"] as const;
export type VictoryKind = (typeof VICTORY_KINDS)[number];

function isVictoryKind(x: string): x is VictoryKind {
  return (VICTORY_KINDS as readonly string[]).includes(x);
}

function victoryKind(raw: string | undefined, where: string, errors: string[]): VictoryKind | undefined {
  if (raw === undefined) return undefined;
  if (isVictoryKind(raw)) return raw;
  errors.push(`${where}.outcome: unbekannte Siegart „${raw}“ (erlaubt: ${VICTORY_KINDS.join(", ")}).`);
  return undefined;
}

function reach(raw: string | undefined, where: string, errors: string[]): Reach | undefined {
  if (raw === undefined) return undefined;
  if ((REACHES as readonly string[]).includes(raw)) return raw as Reach;
  errors.push(`${where}.reach: „nah“ oder „fern“ erwartet, nicht „${raw}“.`);
  return undefined;
}

export interface ModifierSpec {
  readonly id: string;
  readonly label: string;
  /** Adjective stems – "riesig" matches "riesiger", "riesigen" … */
  readonly words?: readonly string[];
  /** Compound prefixes – "eis" in "Eiswolf". */
  readonly prefixes?: readonly string[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
  readonly verbs?: readonly string[];
  readonly immune?: readonly string[];
  readonly weak?: readonly string[];
  readonly scale?: number;
}

export interface FormSpec {
  readonly id: string;
  readonly name: string;
  readonly archetype: string;
  readonly scale: number;
  readonly plane: string;
  readonly tags: readonly string[];
  /** Tags removed after expansion (with descendants), e.g. an undead human is not `lebendig`. */
  readonly not?: readonly string[];
  readonly verbs?: readonly string[];
  readonly immune?: readonly string[];
  readonly weak?: readonly string[];
  /** Intensity overrides (quality id → 0..6), beat anything inherited from tags. */
  readonly qualities?: Readonly<Record<string, number>>;
  readonly aliases?: readonly string[];
  readonly flavor?: string;
  /** Custom 16×16 pixel art (rows of . # + o * ,) – validated by the ontology compiler. */
  readonly sprite?: readonly string[];
  /** SVG sketch in the sketch colour roles (core content: `content/core/sketches.json`). */
  readonly sketch?: string;
  /** Sprite assembled from library parts – see {@link FormLook}. */
  readonly look?: FormLook;
  /** Generated pixel art, `w.h.palette.runs` (see render/art.ts). */
  readonly art?: string;
  /** English picture description the art is (to be) generated from. */
  readonly artPrompt?: string;
  /** Live learning: who first summoned this form and when (ISO date). Purely informational. */
  readonly discoveredBy?: string;
  readonly discoveredAt?: string;
  /** Presentation (see {@link Form}): the varied lexicon form, modifications, legend and tone. */
  readonly base?: string;
  readonly mods?: readonly string[];
  readonly lore?: string;
  readonly tone?: string;
}

/**
 * "Arena-Zustand": a move leaves a trace in the arena for a few moves – water makes it wet,
 * fire leaves embers. While active, some mechanisms grow stronger or weaker.
 */
export interface FieldSpec {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** How many following moves it lasts. */
  readonly duration: number;
  /** Triggered by a successful move using one of these mechanisms, or by an attacker carrying one of these tags. */
  readonly from: readonly string[];
  /** Power changes: `on` lists mechanism ids or families (gewalt, element, …). */
  readonly effects: readonly { readonly on: readonly string[]; readonly delta: number }[];
}

/** A precedent for one exact pair of forms – decided once (by Claude as referee), then replayed deterministically. */
export interface RulingSpec {
  readonly attacker: string;
  readonly target: string;
  readonly valid: boolean;
  /** Mechanism the victory uses (existing id). */
  readonly verb: string;
  readonly reason: string;
  /**
   * Who ruled: the referee settles a near miss inside the engine's proportions; the judge weighed
   * the whole pair (size included) and is trusted – its "yes" is not vetoed by reach, intensity
   * or the power budget again (only the outright size limit stays).
   */
  readonly by?: "judge" | "referee";
}

/**
 * A player's objection to a verdict, in their own words („Quatsch – ein Radio zersetzt nichts“). Kept
 * for Claude: the next judgement involving either form hears it. The engine never reads notes.
 */
export interface NoteSpec {
  /** The attacker of the objected pair … */
  readonly form: string;
  /** … and its target. */
  readonly other: string;
  readonly text: string;
  /** The objection was "should have worked" (a failure), not "nonsense" (a win). */
  readonly failed?: boolean;
}

/**
 * A learned widening of a mechanism ("Siegweg"): generalised from precedents, it lets a mechanism
 * reach more tags (`targets`) or be stopped by more (`blockedBy`). Only ever adds.
 */
export interface VerbExtensionSpec {
  readonly verb: string;
  readonly targets?: readonly string[];
  readonly blockedBy?: readonly string[];
  /** The precedents it was learned from ("attacker>target"). */
  readonly evidence?: readonly string[];
}

export interface ContentPack {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tags: readonly TagSpec[];
  readonly verbs: readonly VerbSpec[];
  readonly modifiers: readonly ModifierSpec[];
  readonly forms: readonly FormSpec[];
  readonly fields?: readonly FieldSpec[];
  readonly rulings?: readonly RulingSpec[];
  readonly extensions?: readonly VerbExtensionSpec[];
  readonly qualities?: readonly QualitySpec[];
  readonly combos?: readonly ComboSpec[];
  /** Players' objections (learned pack only) – for Claude, never for the engine. */
  readonly notes?: readonly NoteSpec[];
}

// ── Runtime shape validation (packs may come from untrusted JSON) ─────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class ShapeChecker {
  readonly errors: string[] = [];

  str(o: Obj, key: string, where: string): string {
    const v = o[key];
    if (typeof v !== "string" || v === "") {
      this.errors.push(`${where}: "${key}" muss ein nicht-leerer String sein`);
      return "";
    }
    return v;
  }

  num(o: Obj, key: string, where: string): number {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.errors.push(`${where}: "${key}" muss eine Zahl sein`);
      return 0;
    }
    return v;
  }

  optNum(o: Obj, key: string, where: string): number | undefined {
    return o[key] === undefined ? undefined : this.num(o, key, where);
  }

  optStr(o: Obj, key: string, where: string): string | undefined {
    return o[key] === undefined ? undefined : this.str(o, key, where);
  }

  list(o: Obj, key: string, where: string, required = false): string[] | undefined {
    const v = o[key];
    if (v === undefined) {
      if (required) this.errors.push(`${where}: "${key}" fehlt`);
      return required ? [] : undefined;
    }
    if (!Array.isArray(v) || !v.every((x): x is string => typeof x === "string")) {
      this.errors.push(`${where}: "${key}" muss eine Liste von Strings sein`);
      return [];
    }
    return v;
  }

  requires(o: Obj, key: string, where: string): RequiresSpec | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.errors.push(`${where}: "${key}" muss ein Objekt sein`);
      return undefined;
    }
    const w = `${where}.${key}`;
    return {
      ...opt("any", this.list(v, "any", w)),
      ...opt("all", this.list(v, "all", w)),
      ...opt("none", this.list(v, "none", w)),
      ...opt("qualities", this.levels(v, "qualities", w)),
    };
  }

  /** A short single-line picture description. */
  artPrompt(o: Obj, key: string, where: string): string | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v === "string" && v.length <= 240 && !/[\p{Cc}]/u.test(v)) return v;
    this.errors.push(`${where}: "${key}" muss eine kurze Bildbeschreibung sein`);
    return undefined;
  }

  /** Generated art: shape-checked here, fully decoded (and dropped if broken) by the renderer. */
  art(o: Obj, key: string, where: string): string | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v === "string" && v.length <= 160_000 && /^\d{1,3}\.\d{1,3}\.(?:[0-9a-f]{8})*\.[A-Za-z0-9+/]*={0,2}$/.test(v)) return v;
    this.errors.push(`${where}: "${key}" ist kein gültiges Bild`);
    return undefined;
  }

  /** Sprite blueprint: short ids and #rrggbb colours only. */
  look(o: Obj, key: string, where: string): FormLook | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.errors.push(`${where}: "${key}" muss ein Objekt sein`);
      return undefined;
    }
    const id = (k: string): string | undefined => {
      const x = v[k];
      if (x === undefined) return undefined;
      if (typeof x === "string" && /^[a-z0-9_]{1,40}$/.test(x)) return x;
      this.errors.push(`${where}.${key}.${k}: Bauteil-ID erwartet`);
      return undefined;
    };
    const hex = (k: string): string | undefined => {
      const x = v[k];
      if (x === undefined) return undefined;
      if (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x)) return x.toLowerCase();
      this.errors.push(`${where}.${key}.${k}: Farbe #rrggbb erwartet`);
      return undefined;
    };
    return { ...opt("holds", id("holds")), ...opt("emblem", id("emblem")), ...opt("badge", id("badge")), ...opt("main", hex("main")), ...opt("second", hex("second")) };
  }

  /** `{ id: number }` map, e.g. quality levels. */
  levels(o: Obj, key: string, where: string): Record<string, number> | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (!isObj(v) || !Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x))) {
      this.errors.push(`${where}: "${key}" muss ein Objekt { id: Zahl } sein`);
      return {};
    }
    return v as Record<string, number>;
  }

  array(o: Obj, key: string, where: string): Obj[] {
    const v = o[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.errors.push(`${where}: "${key}" muss eine Liste sein`);
      return [];
    }
    return v.filter((x, i): x is Obj => {
      if (!isObj(x)) this.errors.push(`${where}.${key}[${i}]: Objekt erwartet`);
      return isObj(x);
    });
  }
}

/** Assign optional props without violating `exactOptionalPropertyTypes`. */
function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
}

export type PackResult = { ok: true; pack: ContentPack } | { ok: false; errors: string[] };

/** Validate the *shape* of a pack. Cross references are checked by the ontology compiler. */
export function parsePack(input: unknown): PackResult {
  const c = new ShapeChecker();
  if (!isObj(input)) return { ok: false, errors: ["Pack muss ein Objekt sein"] };
  const id = c.str(input, "id", "pack");
  const pack: ContentPack = {
    id,
    name: c.str(input, "name", "pack"),
    version: c.str(input, "version", "pack"),
    tags: c.array(input, "tags", id).map((o, i) => {
      const w = `${id}.tags[${i}]`;
      return {
        id: c.str(o, "id", w),
        label: c.str(o, "label", w),
        group: c.str(o, "group", w),
        ...opt("parents", c.list(o, "parents", w)),
        ...opt("implies", c.list(o, "implies", w)),
        ...opt("grants", c.list(o, "grants", w)),
        ...opt("startledBy", c.list(o, "startledBy", w)),
        ...opt("qualities", c.levels(o, "qualities", w)),
        ...opt("aliases", c.list(o, "aliases", w)),
      };
    }),
    verbs: c.array(input, "verbs", id).map((o, i) => {
      const w = `${id}.verbs[${i}]`;
      return {
        id: c.str(o, "id", w),
        label: c.str(o, "label", w),
        family: c.str(o, "family", w),
        leverage: c.num(o, "leverage", w),
        targets: c.list(o, "targets", w, true) ?? [],
        hint: c.str(o, "hint", w),
        ...opt("blockedBy", c.list(o, "blockedBy", w)),
        ...opt("minRelativeScale", c.optNum(o, "minRelativeScale", w)),
        ...opt("phrase", c.optStr(o, "phrase", w)),
        ...opt("outcome", victoryKind(c.optStr(o, "outcome", w), w, c.errors)),
        ...opt("needs", o["needs"] === undefined ? undefined : c.array(o, "needs", w).map((n, j) => ({ by: c.str(n, "by", `${w}.needs[${j}]`), vs: c.str(n, "vs", `${w}.needs[${j}]`) }))),
        ...opt("reach", reach(c.optStr(o, "reach", w), w, c.errors)),
        ...opt("requires", c.requires(o, "requires", w)),
        ...opt("aliases", c.list(o, "aliases", w)),
      };
    }),
    modifiers: c.array(input, "modifiers", id).map((o, i) => {
      const w = `${id}.modifiers[${i}]`;
      return {
        id: c.str(o, "id", w),
        label: c.str(o, "label", w),
        ...opt("words", c.list(o, "words", w)),
        ...opt("prefixes", c.list(o, "prefixes", w)),
        ...opt("add", c.list(o, "add", w)),
        ...opt("remove", c.list(o, "remove", w)),
        ...opt("verbs", c.list(o, "verbs", w)),
        ...opt("immune", c.list(o, "immune", w)),
        ...opt("weak", c.list(o, "weak", w)),
        ...opt("scale", c.optNum(o, "scale", w)),
      };
    }),
    forms: c.array(input, "forms", id).map((o, i) => {
      const w = `${id}.forms[${i}]`;
      return {
        id: c.str(o, "id", w),
        name: c.str(o, "name", w),
        archetype: c.str(o, "archetype", w),
        scale: c.num(o, "scale", w),
        plane: c.str(o, "plane", w),
        tags: c.list(o, "tags", w, true) ?? [],
        ...opt("not", c.list(o, "not", w)),
        ...opt("verbs", c.list(o, "verbs", w)),
        ...opt("immune", c.list(o, "immune", w)),
        ...opt("weak", c.list(o, "weak", w)),
        ...opt("qualities", c.levels(o, "qualities", w)),
        ...opt("aliases", c.list(o, "aliases", w)),
        ...opt("flavor", c.optStr(o, "flavor", w)),
        ...opt("sprite", c.list(o, "sprite", w)),
        ...opt("sketch", c.optStr(o, "sketch", w)),
        ...opt("look", c.look(o, "look", w)),
        ...opt("art", c.art(o, "art", w)),
        ...opt("artPrompt", c.artPrompt(o, "artPrompt", w)),
        ...opt("discoveredBy", c.optStr(o, "discoveredBy", w)),
        ...opt("discoveredAt", c.optStr(o, "discoveredAt", w)),
        ...opt("base", c.optStr(o, "base", w)),
        ...opt("mods", c.list(o, "mods", w)),
        ...opt("lore", c.optStr(o, "lore", w)),
        ...opt("tone", c.optStr(o, "tone", w)),
      };
    }),
    ...(input["extensions"] === undefined
      ? {}
      : {
          extensions: c.array(input, "extensions", id).map((o, i) => {
            const w = `${id}.extensions[${i}]`;
            return {
              verb: c.str(o, "verb", w),
              ...opt("targets", c.list(o, "targets", w)),
              ...opt("blockedBy", c.list(o, "blockedBy", w)),
              ...opt("evidence", c.list(o, "evidence", w)),
            };
          }),
        }),
    ...(input["rulings"] === undefined
      ? {}
      : {
          rulings: c.array(input, "rulings", id).map((o, i) => {
            const w = `${id}.rulings[${i}]`;
            const valid = o["valid"];
            if (typeof valid !== "boolean") c.errors.push(`${w}: "valid" muss true/false sein`);
            return {
              attacker: c.str(o, "attacker", w),
              target: c.str(o, "target", w),
              valid: valid === true,
              verb: c.str(o, "verb", w),
              reason: c.str(o, "reason", w),
              ...(o["by"] === "judge" || o["by"] === "referee" ? { by: o["by"] } : {}),
            };
          }),
        }),
    ...(input["notes"] === undefined
      ? {}
      : {
          notes: c.array(input, "notes", id).map((o, i) => {
            const w = `${id}.notes[${i}]`;
            return {
              form: c.str(o, "form", w),
              other: c.str(o, "other", w),
              text: c.str(o, "text", w),
              ...(o["failed"] === true ? { failed: true } : {}),
            };
          }),
        }),
    ...(input["fields"] === undefined
      ? {}
      : {
          fields: c.array(input, "fields", id).map((o, i) => {
            const w = `${id}.fields[${i}]`;
            return {
              id: c.str(o, "id", w),
              label: c.str(o, "label", w),
              hint: c.str(o, "hint", w),
              duration: c.num(o, "duration", w),
              from: c.list(o, "from", w, true) ?? [],
              effects: c.array(o, "effects", w).map((e, j) => ({ on: c.list(e, "on", `${w}.effects[${j}]`, true) ?? [], delta: c.num(e, "delta", `${w}.effects[${j}]`) })),
            };
          }),
        }),
    ...(input["qualities"] === undefined
      ? {}
      : {
          qualities: c.array(input, "qualities", id).map((o, i) => {
            const w = `${id}.qualities[${i}]`;
            const kind = c.str(o, "kind", w);
            if (kind !== "kraft" && kind !== "schutz") c.errors.push(`${w}.kind: „kraft“ oder „schutz“ erwartet`);
            return {
              id: c.str(o, "id", w),
              label: c.str(o, "label", w),
              kind: kind === "schutz" ? ("schutz" as const) : ("kraft" as const),
              ...opt("default", c.optNum(o, "default", w)),
              ...opt("hint", c.optStr(o, "hint", w)),
            };
          }),
        }),
    ...(input["combos"] === undefined
      ? {}
      : {
          combos: c.array(input, "combos", id).map((o, i) => {
            const w = `${id}.combos[${i}]`;
            return {
              id: c.str(o, "id", w),
              if: c.list(o, "if", w, true) ?? [],
              hint: c.str(o, "hint", w),
              ...opt("unless", c.list(o, "unless", w)),
              ...opt("add", c.list(o, "add", w)),
              ...opt("remove", c.list(o, "remove", w)),
              ...opt("qualities", c.levels(o, "qualities", w)),
            };
          }),
        }),
  };
  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, pack };
}
