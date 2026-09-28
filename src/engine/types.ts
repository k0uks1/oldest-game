import type { VictoryKind } from "./ontology/pack.ts";
/**
 * Core domain types. The engine is pure and DOM-free: every function in
 * `src/engine` is deterministic for a given input.
 */

/** Magnitude of a form. 1 = mote/insect … 8 = cosmic. */
export type Scale = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

export const PLANES = ["materie", "leben", "geist", "abstrakt"] as const;
/** Plane of existence a form mainly lives on. */
export type Plane = (typeof PLANES)[number];

export const ARCHETYPES = [
  "humanoid", "beast", "serpent", "bird", "insect", "swarm", "blob", "plant", "tree", "flame",
  "wave", "cloud", "rock", "crystal", "orb", "eye", "star", "planet", "void", "skull", "ghost",
  "weapon", "tower", "book", "heart", "hourglass", "mask", "key", "fish", "spider", "dragon", "giant",
  "cloth", "box", "bottle", "vehicle", "house", "cup",
] as const;
/** Visual archetype – selects the sprite silhouette. */
export type Archetype = (typeof ARCHETYPES)[number];

/** Victory kinds (see VerbSpec.outcome) plus the two ways of getting away. */
export type Outcome = VictoryKind | "entkommen" | "versteckt";

/** A fully resolved form ("Gestalt") that can appear in the arena. */
export interface Form {
  /** Stable id (lexicon id or derived from normalised name). */
  readonly id: string;
  readonly name: string;
  readonly archetype: Archetype;
  readonly scale: Scale;
  readonly plane: Plane;
  /** Declared tags – expanded by the ontology (parents + implications). */
  readonly tags: readonly string[];
  /** Tags removed after expansion (together with their descendants). */
  readonly not: readonly string[];
  /** Mechanisms explicitly known by this form (tag grants are added on top). */
  readonly verbs: readonly string[];
  /** Mechanisms this form is specifically immune to. */
  readonly immune: readonly string[];
  /** Tags that are an exposed weakness (hitting them gives a bonus). */
  readonly weak: readonly string[];
  /** Where this form came from – lexicon entry, composed, or LLM. */
  readonly origin: "lexikon" | "komponiert" | "llm";
  readonly flavor?: string;
  /** Custom 16×16 pixel art (validated, see engine/pixelart.ts) – drawn by Claude for brand-new forms. */
  readonly sprite?: readonly string[];
  /** SVG sketch (see render/svgsprite.ts) – rasterized to a 32×32 sprite when there is no `sprite`. */
  readonly sketch?: string;
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
  /** First time this form ever appeared (live learning) – earns discovery eleganz on success. */
  readonly discovery: boolean;
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
  /**
   * "Eskalation": the minimum scale rises by one every N *moves* (mythic mechanisms exempt).
   * N should be odd so that both players alternately face a new floor first – with an even
   * period the first player always hits every escalation step (measured: 27 % vs 73 % wins).
   */
  readonly escalateEveryMoves: number;
  /** Eleganz awarded for the opening move (small compensation for moving first). */
  readonly openingEleganz: number;
  /** Extra Wille lost when an attempt fails – blind guessing must not be free. */
  readonly failurePenalty: number;
  /** Number of full rounds before the game is decided on eleganz. */
  readonly roundLimit: number;
  /**
   * "Einfallsreichtum": eleganz for a successful move with a form the game has never seen before.
   * Whether a form is new is decided outside the engine (validated live learning) and passed in.
   */
  readonly discoveryEleganz: number;
  /**
   * "Entkommen": instead of defeating the target, a form may escape it – fly away from a lava
   * wave, dive under a fire, burrow beneath a stampede. Each route (a tag of the evader) is
   * closed by attacker tags that can follow (a flier follows fliers, lightning reaches the sky).
   * Only physical attacks (families in `physicalFamilies`) can be escaped this way.
   */
  readonly escapeRoutes: Readonly<Record<string, readonly string[]>>;
  readonly physicalFamilies: readonly string[];
  /** Nothing escapes a target of this scale or larger ("Welt", "kosmisch"). */
  readonly maxEscapeScale: number;
  readonly escapeEleganz: number;
  /** Escape routes that are hiding rather than running (outcome "versteckt"). */
  readonly hidingRoutes: readonly string[];
  /** "Gnade": extra eleganz for winning without harm (outcome in `mercyOutcomes`). */
  readonly mercyEleganz: number;
  readonly mercyOutcomes: readonly string[];
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
  /** "Schreck": the target was startled (counts as weakness; it flees rather than falls). */
  readonly startled?: true;
  /** How the target is beaten – or, for an escape, how the attacker got away. */
  readonly outcome: Outcome;
  /** Where the check failed – lets the engine judge how sure it is (see attempt.ts). */
  readonly failedAt?: "surface" | "blocked" | "immune" | "scale" | "power" | "other";
  /** Decided by a stored precedent ("Schiedsspruch") instead of the tag rules. */
  readonly ruling?: true;
  readonly power: number;
  readonly needed: number;
}
