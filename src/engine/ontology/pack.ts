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
  readonly aliases?: readonly string[];
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
  readonly aliases?: readonly string[];
  readonly flavor?: string;
  /** Custom 16×16 pixel art (rows of . # + o * ,) – validated by the ontology compiler. */
  readonly sprite?: readonly string[];
  /** SVG sketch in the sketch colour roles (core content: `content/core/sketches.json`). */
  readonly sketch?: string;
  /** Live learning: who first summoned this form and when (ISO date). Purely informational. */
  readonly discoveredBy?: string;
  readonly discoveredAt?: string;
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
        ...opt("aliases", c.list(o, "aliases", w)),
        ...opt("flavor", c.optStr(o, "flavor", w)),
        ...opt("sprite", c.list(o, "sprite", w)),
        ...opt("sketch", c.optStr(o, "sketch", w)),
        ...opt("discoveredBy", c.optStr(o, "discoveredBy", w)),
        ...opt("discoveredAt", c.optStr(o, "discoveredAt", w)),
      };
    }),
    ...(input["rulings"] === undefined
      ? {}
      : {
          rulings: c.array(input, "rulings", id).map((o, i) => {
            const w = `${id}.rulings[${i}]`;
            const valid = o["valid"];
            if (typeof valid !== "boolean") c.errors.push(`${w}: "valid" muss true/false sein`);
            return { attacker: c.str(o, "attacker", w), target: c.str(o, "target", w), valid: valid === true, verb: c.str(o, "verb", w), reason: c.str(o, "reason", w) };
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
  };
  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, pack };
}
