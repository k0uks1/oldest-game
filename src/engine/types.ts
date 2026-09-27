/**
 * Core domain types. The engine is pure and DOM-free: every function in
 * `src/engine` is deterministic for a given input.
 */

/** Magnitude of a form. 1 = mote/insect … 8 = cosmic. */
export type Scale = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

/** Plane of existence a form mainly lives on. */
export type Plane = "materie" | "leben" | "geist" | "abstrakt";

/** Visual archetype – selects the sprite silhouette. */
export type Archetype =
  | "humanoid"
  | "beast"
  | "serpent"
  | "bird"
  | "insect"
  | "swarm"
  | "blob"
  | "plant"
  | "tree"
  | "flame"
  | "wave"
  | "cloud"
  | "rock"
  | "crystal"
  | "orb"
  | "eye"
  | "star"
  | "planet"
  | "void"
  | "skull"
  | "ghost"
  | "weapon"
  | "tower"
  | "book"
  | "heart"
  | "hourglass"
  | "mask"
  | "key"
  | "fish"
  | "spider"
  | "dragon"
  | "giant";

export interface TagDef<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly group: TagGroup;
  /** Mechanisms granted to any form carrying this tag. */
  readonly grants?: readonly string[];
}

export type TagGroup = "material" | "element" | "koerper" | "geist" | "existenz";

export type VerbFamily =
  | "gewalt" // raw force – size matters
  | "element" // elemental interaction
  | "leben" // biology: poison, plague, hunger
  | "sinne" // senses: blind, deafen
  | "geist" // mind: fear, pride, greed, deceit
  | "magie" // holy, curse, true names, pacts
  | "kosmos"; // time, entropy, gravity, hope

export interface VerbDef<V extends string = string, T extends string = string> {
  readonly id: V;
  /** Present-tense phrase used in UI: "verbrennt". */
  readonly label: string;
  readonly family: VerbFamily;
  /** The target must carry at least one of these tags. */
  readonly targets: readonly T[];
  /** If the target carries any of these tags the mechanism cannot work. */
  readonly blockedBy: readonly T[];
  /**
   * Scale bonus. Brute force has 0 – the attacker must be at least as big.
   * Subtle mechanisms have high leverage: a key does not need to be bigger
   * than the door.
   */
  readonly leverage: number;
  /** Attacker must be at least this big relative to target (e.g. swallow). */
  readonly minRelativeScale?: number;
  /** Short explanation for tooltips / compendium. */
  readonly hint: string;
}

/** A fully resolved form ("Gestalt") that can appear in the arena. */
export interface Form {
  /** Stable id (lexicon id or derived from normalised name). */
  readonly id: string;
  readonly name: string;
  readonly archetype: Archetype;
  readonly scale: Scale;
  readonly plane: Plane;
  readonly tags: readonly string[];
  /** Mechanisms explicitly known by this form (tag grants are added on top). */
  readonly verbs: readonly string[];
  /** Mechanisms this form is specifically immune to. */
  readonly immune: readonly string[];
  /** Tags that are an exposed weakness (hitting them gives a bonus). */
  readonly weak: readonly string[];
  /** Where this form came from – lexicon entry, composed, or LLM. */
  readonly origin: "lexikon" | "komponiert" | "llm";
  readonly flavor?: string;
}

export type PlayerId = 0 | 1;

export interface Move {
  readonly player: PlayerId;
  readonly form: Form;
  /** Null only for the opening move. */
  readonly verb: string | null;
  readonly cost: number;
  readonly eleganz: number;
  readonly refund: number;
  readonly check: CounterCheck | null;
}

export interface PlayerState {
  readonly name: string;
  readonly wille: number;
  readonly eleganz: number;
}

export type GamePhase = "opening" | "playing" | "finished";

export interface GameConfig {
  readonly startWille: number;
  readonly maxWille: number;
  readonly regen: number;
  readonly maxOpeningScale: Scale;
  /** Hard cap: a counter may be at most this many steps above the target. */
  readonly maxScaleJump: number;
  /**
   * "Fallhöhe": a counter may be at most this many steps *below* its target –
   * unless its mechanism is mythic (leverage ≥ mythicLeverage).
   */
  readonly maxScaleDrop: number;
  readonly mythicLeverage: number;
  /** Extra regeneration every N rounds, so the duel escalates over time. */
  readonly regenGrowthEvery: number;
  /** "Eskalation": the minimum scale rises by one every N rounds (mythic mechanisms exempt). */
  readonly escalateEvery: number;
  /** Number of full rounds before the game is decided on eleganz. */
  readonly roundLimit: number;
  /** A mechanism used within the last N moves may not be repeated. */
  readonly echoWindow: number;
}

export interface GameState {
  readonly config: GameConfig;
  readonly phase: GamePhase;
  readonly players: readonly [PlayerState, PlayerState];
  readonly active: PlayerId;
  readonly history: readonly Move[];
  readonly usedFormIds: readonly string[];
  readonly winner: PlayerId | null;
  readonly endReason: EndReason | null;
}

export type EndReason = "pass" | "rounds" | "erschoepft";

/** One reason a mechanism does (not) work – shown to the players. */
export interface CheckStep {
  readonly ok: boolean;
  readonly text: string;
}

export interface CounterCheck {
  readonly verb: string;
  readonly valid: boolean;
  readonly steps: readonly CheckStep[];
  /** Tag of the target the mechanism acted on. */
  readonly hitTag: string | null;
  readonly weaknessHit: boolean;
  readonly power: number;
  readonly needed: number;
}
