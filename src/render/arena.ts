import type { Ontology } from "../engine/ontology/ontology.ts";
import { loadImage, SCENERY, VOID } from "./scenery.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { paletteFor, type SpritePalette } from "./palette.ts";
import { alphaBox, artFor, artGlow, crop, figureSize, resample, unionBox, type Box } from "./art.ts";
import { EMPTY_MASK, fitMask, maskOf, type Mask } from "./morph.ts";
import { EFFECTS, type EffectKind } from "./effects.ts";
import { EFFECT_SHEETS } from "./effects/index.ts";
import { carriesField, chooseRoom, ROOM_MIN_SCALE, ROOMS } from "./rooms.ts";
import { ROOM_PICTURES } from "./rooms/index.ts";
import { FORM_ANIMS } from "./form-anims/index.ts";
import { displaySize, renderGlow, renderSprite, type PixelImage } from "./sprite.ts";
import { ISO } from "./stage-iso.ts";
import { acornImage, signatureFor, tattooImage, type Signature } from "./eichel.ts";
import { JOHNNY_NAME, NOTE_COLORS, noteImage } from "./johnny.ts";
import { FLOOR_Y, GROUND_Y, HEIGHT, openBricks, paintStarfield, scatterStars, TORCH_X, WIDTH, type Brick, type StageLayout, type Star } from "./stage.ts";

export { FLOOR_Y, GROUND_Y, HEIGHT, TORCH_X, WIDTH } from "./stage.ts";

/**
 * The scene is drawn at 480×270 into an offscreen buffer, then blown up by an
 * integer factor with nearest-neighbour. The browser only ever *downscales*
 * that large image to fit, which keeps every logical pixel the same size.
 */
export const UPSCALE = 4;
export const SIDE_X = [132, 348] as const;

export type Side = 0 | 1;

/** Moments the UI may want to underline with sound. */
export type ArenaCue = "summon" | "reveal" | "strike" | "impact" | "fizzle" | "discovery" | "boom";

/** Special spectacles for a few forms – pure show, no rules involved. */
export type EasterEgg = "nuke" | "meteor" | "rainbow" | "confetti" | "vortex" | "tattoo" | "eicheln" | "johnny";

const EGG_PATTERNS: readonly (readonly [RegExp, EasterEgg])[] = [
  // the Eichel figures: the gang shows its tattoo, the Eichelober arrives in a shower of acorns
  [/eichel\s*-?\s*(ober\s*-?\s*)?(gang|bande)/i, "tattoo"],
  [/eichel\s*-?\s*ober/i, "eicheln"],
  // Johnny Gnadenlos, the singing cactus, arrives in a burst of music notes
  [JOHNNY_NAME, "johnny"],
  [/atom|nuklear|kernwaffe|a-bombe|wasserstoffbombe|nuke/i, "nuke"],
  [/meteor|asteroid|komet|sternschnuppe/i, "meteor"],
  [/regenbogen|rainbow/i, "rainbow"],
  [/konfetti|party|karneval|fasching|geburtstag|feuerwerk|silvester/i, "confetti"],
  [/schwarzes loch|singularit|wurmloch|mahlstrom|strudel/i, "vortex"],
];

/** Which spectacle (if any) a form's name asks for. */
export function easterEggFor(name: string): EasterEgg | null {
  return EGG_PATTERNS.find(([re]) => re.test(name))?.[1] ?? null;
}



export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

export interface Eye {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly color: string;
}

export interface SpriteEntry {
  readonly image: HTMLCanvasElement;
  readonly glow: HTMLCanvasElement;
  /** Solid dark shape – what you see before the reveal. */
  readonly silhouette: HTMLCanvasElement;
  /** Only the outline, in the form's glow colour (drawn into the bloom layer). */
  readonly rim: HTMLCanvasElement;
  /** Grey, crumbling version (versteinert). */
  readonly stone: HTMLCanvasElement;
  /** The canvases' pixels (at the renderer's density). */
  readonly pixels: PixelImage;
  /** Size in arena pixels (layout, effects); the canvases are `density` times larger. */
  readonly width: number;
  readonly height: number;
  readonly palette: SpritePalette;
  /** Made from a generated picture (not the drawn fallback). */
  readonly art: boolean;
}

export interface Fighter {
  readonly form: Form;
  readonly sprite: SpriteEntry;
  /** 0..1 materialisation progress. */
  appear: number;
  /** 0 = unknown silhouette, 1 = fully revealed. */
  reveal: number;
  alpha: number;
  offsetX: number;
  offsetY: number;
  /** 1 = faces the opponent, -1 = turned away (fleeing). */
  facing: 1 | -1;
  /** 1 = normal height, 0 = squashed into the ground (sealed). */
  squash: number;
  /** 0..1 turned to stone. */
  stone: number;
  flash: number;
  readonly seed: number;
  readonly aura: Aura;
  readonly flying: boolean;
  /** "Belebt": frames of a generated animation, played in a loop into the fighter's own canvases. */
  anim?: FighterAnim;
}

export interface FighterAnim {
  readonly frames: readonly SpriteEntry[];
  readonly fps: number;
  /** Seconds since it started. */
  t: number;
  shown: number;
}

export interface Aura {
  readonly kind: "fire" | "sparkle" | "smoke" | "motes" | "wisps" | "none";
  readonly color: string;
}

/**
 * A picture drawn this frame (attack effects, room states): renderers put "backdrop" pictures right
 * over the room and "front" ones over the fighters, and feed `glow` of them into the bloom.
 */
export interface ImageDraw {
  readonly image: HTMLCanvasElement;
  /** Top-left and size in arena pixels (the canvas may carry more detail). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly flip: boolean;
  readonly alpha: number;
  /** 0..1 – how much of it also lights up the bloom layer. */
  readonly glow: number;
  readonly layer: "backdrop" | "front";
}

/** A painted animation cut into its frames (square, side by side in the bundled strip). */
interface Sheet {
  readonly frames: readonly HTMLCanvasElement[];
  /** Frame size in picture pixels. */
  readonly size: number;
}

/** One effect animation playing: frames over time, moving from `from` to `to` (projectiles). */
interface EffectPlay {
  readonly sheet: Sheet;
  t: number;
  readonly fps: number;
  /** Loops for `dur` seconds (a projectile in flight), else plays once. */
  readonly loop: boolean;
  readonly dur: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** Height on screen, arena pixels (centered on its path). */
  readonly size: number;
  readonly flip: boolean;
  readonly alpha: number;
}

/** "Beschwörungsmatrix" state – see {@link ArenaSim.startConjuring}. */
export interface Summoning {
  readonly side: Side;
  /** Arena pixels per mask cell. */
  readonly cell: number;
  readonly shapes: readonly Mask[];
  next: number;
  from: Mask;
  to: Mask;
  /** 0..1 through the current melt. */
  t: number;
  /** Seconds the current shape has stood. */
  hold: number;
  /** Settling on the real form – no more passing shapes. */
  final: boolean;
  seed: number;
}

/** Shapes that pass through the flames while a picture is painted (presentation only). */
const MORPH_SHAPES = ["wolf", "drache", "ritter", "katze", "adler", "baum", "schlange", "spinne", "loewe", "hai", "elefant", "grossmutter", "eule", "golem"];
const MORPH_SECONDS = 0.75;
const MORPH_HOLD = 0.7;
const FLAME = ["#b050ff", "#d890ff", "#8a3ce8", "#f0c8ff", "#6a20c0"];

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  /** Also drawn into the bloom layer. */
  glow: boolean;
}

/** A little picture flying through the arena (an acorn, the gang tattoo). */
export interface Prop {
  readonly image: HTMLCanvasElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly max: number;
  readonly gravity: number;
  /** Size in arena pixels (centered on x, y). */
  readonly w: number;
  readonly h: number;
  readonly flip: boolean;
  /** Seconds of fade-in and fade-out at the ends of its life. */
  readonly fade: number;
  readonly glow: number;
  /** Bursts into shards where its flight ends (an acorn hitting home). */
  readonly shatter?: boolean;
}

/** How an attack looks – chosen from the mechanism, see {@link attackStyle}. */
export type AttackStyle =
  | "slash" | "fire" | "water" | "earth" | "ice" | "bolt" | "wind" | "light"
  | "dark" | "poison" | "drain" | "sound" | "mind" | "rune" | "cosmic";

const STYLE_BY_VERB: Readonly<Record<string, AttackStyle>> = {
  verbrennt: "fire", schmilzt: "fire", verdampft: "fire",
  ertraenkt: "water", loescht: "water", erodiert: "water", loest_auf: "water",
  begraebt: "earth", versteinert: "earth", sprengt: "earth",
  gefriert: "ice",
  trifft_blitz: "bolt", kurzschluss: "bolt",
  verweht: "wind", erstickt: "wind",
  blendet: "light", durchleuchtet: "light", ueberstrahlt: "light", sonnenlicht: "light", laeutert: "light",
  verdunkelt: "dark", verflucht: "dark",
  vergiftet: "poison", infiziert: "poison", verrottet: "poison", zersetzt: "poison", rostet: "poison", zerfrisst: "poison", verdorrt: "poison", verhungern: "poison",
  saugt_aus: "drain", entzieht_energie: "drain",
  uebertoent: "sound", weckt: "sound", einschlaefern: "sound",
  bannt: "rune", erloest: "rune", entzaubert: "rune", wahrer_name: "rune", bricht_pakt: "rune", versiegelt: "rune", kaltes_eisen: "rune", spiegelt: "rune", verwandelt: "rune", heilt: "rune",
  ueberdauert: "cosmic", beendet: "cosmic", trotzt: "cosmic", fuellt: "cosmic", ordnet: "cosmic", entfesselt: "cosmic",
};

const STYLE_BY_FAMILY: Readonly<Record<string, AttackStyle>> = {
  gewalt: "slash", element: "fire", leben: "poison", sinne: "sound", geist: "mind", magie: "rune", kosmos: "cosmic",
};

/** What happens to the loser on screen – derived from the engine's victory kind. */
export type AttackOutcome = "destroy" | "flee" | "sleep" | "charm" | "peace" | "seal" | "petrify";

const OUTCOME_BY_KIND: Readonly<Record<string, AttackOutcome>> = {
  vernichtet: "destroy",
  vertrieben: "flee",
  verfuehrt: "charm",
  befriedet: "peace",
  eingeschlaefert: "sleep",
  gebannt: "seal",
  versteinert: "petrify",
};

export function attackOutcome(kind: string): AttackOutcome {
  return OUTCOME_BY_KIND[kind] ?? "destroy";
}

/** Visual style for a mechanism: specific verbs first, then its family. Unknown (learned) verbs follow their family. */
export function attackStyle(verbId: string, family: string): AttackStyle {
  return STYLE_BY_VERB[verbId] ?? STYLE_BY_FAMILY[family] ?? "slash";
}

const STYLE_COLORS: Readonly<Record<AttackStyle, readonly [string, string]>> = {
  slash: ["#f4f0ff", "#ffffff"],
  fire: ["#ff6a20", "#ffc64a"],
  water: ["#3f8fc9", "#bff0ff"],
  earth: ["#6a5040", "#c4a484"],
  ice: ["#7fc6e8", "#f0fcff"],
  bolt: ["#9ab0ff", "#ffffff"],
  wind: ["#b8c8d8", "#f4f8ff"],
  light: ["#fff0a0", "#ffffff"],
  dark: ["#2c1840", "#b050ff"],
  poison: ["#62b030", "#d8ff70"],
  drain: ["#b8263a", "#ff7a8a"],
  sound: ["#c8a0ff", "#f0e0ff"],
  mind: ["#e080ff", "#ffd0ff"],
  rune: ["#c8a0ff", "#fff0a0"],
  cosmic: ["#a0c0ff", "#ffffff"],
};

export interface Bolt {
  readonly points: readonly (readonly [number, number])[];
  life: number;
  readonly max: number;
  readonly color: string;
}

export interface Projectile {
  from: number;
  to: number;
  /** Ground line under the start and the end (the fighters may stand at different depths). */
  readonly groundFrom: number;
  readonly groundTo: number;
  t: number;
  duration: number;
  color: string;
  glow: string;
  style: AttackStyle;
  /** Stops short of the target (failed attempt hits a barrier). */
  stopShort: boolean;
  done: () => void;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  /** Growth in px/s (default 90). */
  grow?: number;
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D nicht verfügbar");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function toCanvas(img: PixelImage): HTMLCanvasElement {
  const c = canvas(img.width, img.height);
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

/**
 * Pixel-art dungeon arena – the simulation half. Owns the loop, the animation API the UI calls
 * (summon, reveal, attack …) and all moving state (fighters, particles, rings, bolts, the
 * crumbling wall). *How* a frame is drawn is up to a subclass:
 *
 *   PixiArena   (render/pixi-arena.ts)  WebGL scene graph, render textures, bloom filters
 *   CanvasArena (render/canvas-arena.ts) the original 2D-canvas renderer – fallback
 *
 * Both draw a 480×270 base and an emissive glow layer, blow the base up ×4 nearest-neighbour
 * and add two blurred bloom passes of the glow layer on top.
 */
export abstract class ArenaSim {
  protected readonly background: HTMLCanvasElement;
  protected readonly fighters: [Fighter | null, Fighter | null] = [null, null];
  protected readonly particles: Particle[] = [];
  /** Flying pictures (acorns, the gang tattoo). */
  protected readonly props: Prop[] = [];
  private eichelArt: { acorn: HTMLCanvasElement } | null = null;
  /** Johnny's music notes by colour and kind (render/johnny.ts). */
  private readonly noteArt = new Map<number, HTMLCanvasElement>();
  /** Standard animations that come with the game (`render/form-anims/`): strip name → frames. */
  private readonly formAnims = new Map<string, readonly PixelImage[]>();
  protected readonly projectiles: Projectile[] = [];
  protected readonly rings: Ring[] = [];
  protected readonly bolts: Bolt[] = [];
  protected readonly spriteCache = new Map<string, SpriteEntry>();
  protected shake = 0;
  protected flash = 0;
  protected flashColor = "#ffffff";
  protected thinking = 0;
  protected thinkingTarget = 0;
  /** "Beschwörung": 0..1 while a generated picture is being painted – the pentagram in the rune circle. */
  protected conjure = 0;
  protected conjureTarget = 0;
  /** Seconds since the current conjuring began (the pentagram traces itself in). */
  protected conjureAge = 0;
  /** Final burst when the picture arrives (1 → 0). */
  protected conjureBurst = 0;
  /** "Beschwörungsmatrix": shapes forming in purple flames where the form will stand. */
  protected summoning: Summoning | null = null;
  /** Painted attack animations (bundled strips, decoded once) and the ones playing now. */
  private readonly sheets = new Map<string, Sheet>();
  private readonly plays: EffectPlay[] = [];
  /** Painted room states: a still and (optionally) its animation loop, faded in and out. */
  private readonly rooms = new Map<string, { still: HTMLCanvasElement; frames: readonly HTMLCanvasElement[] }>();
  private readonly roomFade = new Map<string, number>();
  private room: string | null = null;
  private roomCheck = 0;
  /** Fields a big form brought: their room stays while they last. */
  private readonly latched = new Set<string>();
  /** Side of the newest fighter (its mood counts first). */
  private newest: Side = 0;
  protected time = 0;
  protected last = 0;
  protected running = false;
  protected readonly rand = rng(1234);
  protected readonly reducedMotion: boolean;
  /** Optional sound hook – the arena only says *when*, the UI decides *how*. */
  onCue: ((cue: ArenaCue) => void) | null = null;

  // Escalation mood: the wall dissolves brick by brick into a starfield.
  protected readonly bricks: readonly Brick[];
  protected readonly stars: readonly Star[];
  protected readonly starfield: HTMLCanvasElement;
  protected readonly backdrop: HTMLCanvasElement;
  protected cosmic = 0;
  protected cosmicTarget = 0;
  protected openBricks = 0;
  protected readonly open: Uint8Array;

  // Ambience: dust in the torchlight, eyes watching from the dark.
  protected readonly motes: Mote[] = [];
  protected readonly eyes: Eye[] = [];
  protected witnesses = 0;
  /** Rainbow arc fading over the arena. */
  protected rainbow = 0;
  /** Vortex pulling particles to a point. */
  protected vortex: { x: number; y: number; life: number } | null = null;
  /** Arena fields ("Nässe", "Glut" …) – intensity per field id, eased towards 0/1. */
  protected readonly fieldFx = new Map<string, { level: number; target: number }>();
  /** Discovery star floating above a fighter. */
  protected discoveryGlow: { side: Side; life: number } | null = null;
  /** Night life of the room: bats crossing the vault, now and then a rat along the wall. */
  protected readonly bats: { x: number; y: number; vx: number; readonly phase: number }[] = [];
  protected rat: { x: number; readonly dir: 1 | -1; pause: number } | null = null;
  /** Water drops falling from the vault (where the stage says it drips). */
  protected readonly drops: { x: number; y: number; vy: number; readonly land: number }[] = [];

  /**
   * Only the open bricks (the void showing through), transparent elsewhere – laid over the painted room states, which
   * would otherwise cover the crumbled wall: the decay stays when the room changes. Repainted with the backdrop.
   */
  protected readonly holes: HTMLCanvasElement;
  /** Bumped whenever the backdrop canvas was repainted (bricks fell) – renderers re-upload. */
  protected backdropVersion = 0;

  constructor(
    protected onto: Ontology,
    /** The scenery: flat wall or isometric room. */
    protected readonly stage: StageLayout = ISO,
    /**
     * Device pixels per arena pixel the renderer draws fighters at. Generated pictures carry
     * ART_DENSITY× detail; a renderer at density 2 shows all of it, at 1 it shows them reduced.
     */
    protected readonly density = 1,
  ) {
    this.background = stage.paintBackground();
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bricks = stage.wallBricks();
    this.open = new Uint8Array(this.bricks.length);
    this.starfield = paintStarfield();
    this.stars = scatterStars(this.bricks);
    this.backdrop = canvas(WIDTH, HEIGHT);
    this.holes = canvas(WIDTH, HEIGHT);
    ctx2d(this.backdrop).drawImage(this.background, 0, 0);
    void this.loadScenery();
    void this.loadEffects();
    void this.loadRooms();
    void this.loadFormAnims();
    const r = rng(4242);
    for (let i = 0; i < 38; i++) this.motes.push({ x: r() * WIDTH, y: 20 + r() * (GROUND_Y - 20), vx: (r() - 0.5) * 3, vy: (r() - 0.5) * 2, phase: r() * 10 });
    for (let i = 0; i < 12; i++) {
      // pairs of eyes in the dark – where the stage has dark places, otherwise high on the wall
      const [x, y] = stage.eyes?.[i] ?? [70 + Math.floor(r() * 340), 8 + Math.floor(r() * 40)];
      this.eyes.push({ x, y, phase: r() * 20, color: r() < 0.7 ? "#ff5a3c" : "#f0c850" });
    }
  }

  /**
   * Escalation made visible: `floor` is the arena's minimum scale. From tier 2 on
   * bricks start to fall away and reveal the void behind the wall.
   */
  setTier(floor: number): void {
    this.cosmicTarget = Math.max(0, Math.min(1, (floor - 1) / 5.5));
  }

  /** Which arena fields are active (ids from content/core/fields.json). Unknown ids are ignored. */
  setFields(ids: readonly string[]): void {
    for (const [id, fx] of this.fieldFx) if (!ids.includes(id)) fx.target = 0;
    for (const id of ids) {
      const fx = this.fieldFx.get(id);
      if (fx === undefined) this.fieldFx.set(id, { level: 0, target: 1 });
      else fx.target = 1;
    }
  }

  protected field(id: string): number {
    return this.fieldFx.get(id)?.level ?? 0;
  }

  /**
   * Play a spectacle for the form on `side`. The nuke really explodes: white-out, shock wave,
   * a mushroom cloud rising into the sky and the whole dungeon shaking.
   */
  async easterEgg(egg: EasterEgg, side: Side): Promise<void> {
    const f = this.fighters[side];
    const x = f === null ? 240 : SIDE_X[side];
    const r = this.rand;
    const rm = this.reducedMotion;
    switch (egg) {
      case "nuke": {
        this.onCue?.("boom");
        const gx = 240;
        const mid = (this.gy(0) + this.gy(1)) / 2;
        this.flash = 1;
        this.flashColor = "#ffffff";
        this.shake = rm ? 0 : 14;
        for (let k = 0; k < 4; k++) this.rings.push({ x: gx, y: mid, r: 4, life: -k * 0.12, max: 1.4, color: k % 2 === 0 ? "#fff3a0" : "#ff8a30", grow: 260 });
        // stem and cap of the mushroom cloud
        for (let i = 0; i < 760; i++) {
          const stem = i < 260;
          const t = r();
          const ang = r() * Math.PI * 2;
          const rad = Math.sqrt(r());
          const px = stem ? gx + (r() - 0.5) * (10 + t * 16) : gx + Math.cos(ang) * rad * 85;
          const py = stem ? mid - t * 110 : mid - 125 + Math.sin(ang) * rad * 32;
          const c = t < 0.15 ? "#ffffff" : t < 0.45 ? "#ffc64a" : t < 0.75 ? "#ff6a20" : "#7a3a2a";
          this.particles.push({ x: px, y: py, vx: (r() - 0.5) * (stem ? 6 : 24), vy: stem ? -10 - r() * 14 : -6 - r() * 10, life: -r() * 0.5, max: 2.8 + r() * 1.4, color: c, size: r() < 0.5 ? 3 : 2, gravity: 0, glow: t < 0.7 });
        }
        for (let i = 0; i < 160; i++) {
          const a = r() * Math.PI;
          this.particles.push({ x: gx, y: mid - 2, vx: Math.cos(a) * (120 + r() * 120), vy: -Math.sin(a) * 30, life: 0, max: 1 + r(), color: "#6a5040", size: 2, gravity: 40, glow: false });
        }
        this.cosmicTarget = Math.max(this.cosmicTarget, 0.35); // bricks blown out of the wall
        await wait(rm ? 200 : 1600);
        return;
      }
      case "meteor": {
        const tx = x;
        const steps = 30;
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const px = tx - 160 + 160 * t;
          const py = -10 + (this.gy(side) + 10) * t;
          this.particles.push({ x: px, y: py, vx: -20, vy: -10, life: -t * 0.6, max: 0.5, color: t > 0.8 ? "#ffffff" : "#ff8a30", size: 3, gravity: 0, glow: true });
        }
        await wait(rm ? 100 : 620);
        this.flash = 0.4;
        this.flashColor = "#ffc64a";
        this.shake = rm ? 0 : 7;
        this.burst(tx, this.gy(side) - 6, "#ff8a30", 70);
        this.rings.push({ x: tx, y: this.gy(side), r: 4, life: 0, max: 0.8, color: "#ffc64a" });
        await wait(300);
        return;
      }
      case "rainbow":
        this.rainbow = 1;
        await wait(rm ? 100 : 500);
        return;
      case "confetti": {
        const colors = ["#ff6a6a", "#ffd86a", "#7dff6a", "#7fc6e8", "#c8a0ff", "#ff9ad0"];
        for (let i = 0; i < 180; i++) {
          this.particles.push({ x: r() * WIDTH, y: -5 - r() * 40, vx: (r() - 0.5) * 30, vy: 20 + r() * 40, life: -r() * 0.8, max: 3 + r() * 2, color: colors[i % colors.length] ?? "#ffffff", size: r() < 0.5 ? 2 : 1, gravity: 10, glow: false });
        }
        await wait(rm ? 100 : 400);
        return;
      }
      case "vortex":
        this.vortex = { x, y: this.gy(side) - 40, life: 0 };
        await wait(rm ? 100 : 900);
        return;
      case "johnny": {
        // Johnny arrives: a burst of coloured notes from his pot, and he is already humming
        const top = this.gy(side) - (f?.sprite.height ?? 60);
        for (let i = 0; i < 14; i++) {
          const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
          const sp = 40 + r() * 60;
          this.props.push({ image: this.johnnyNote(), x, y: top + 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: -r() * 0.3, max: 1.4, gravity: -10, w: 8, h: 11, flip: false, fade: 0.25, glow: 0.7 });
        }
        this.rings.push({ x, y: this.gy(side), r: 4, life: 0, max: 0.9, color: "#8ce85a" });
        this.onCue?.("discovery");
        await wait(rm ? 100 : 900);
        return;
      }
      case "eicheln": {
        // the Eichelober arrives: acorns rain around him, clouds puff up where he lands
        const { acorn } = this.eichelProps();
        for (let i = 0; i < 16; i++) {
          this.props.push({ image: acorn, x: x + (r() - 0.5) * 120, y: -10 - r() * 50, vx: (r() - 0.5) * 20, vy: 40 + r() * 40, life: -r() * 0.6, max: 1.6, gravity: 180, w: 10, h: 13, flip: r() < 0.5, fade: 0.15, glow: 0 });
        }
        this.clouds(x, this.gy(side) - 2, 26);
        this.rings.push({ x, y: this.gy(side), r: 4, life: 0, max: 0.9, color: "#e8c040" });
        await wait(rm ? 100 : 900);
        return;
      }
      case "tattoo": {
        // the gang shows its colours: the Eichelober tattoo flares up in ink and light above them
        const tattoo = this.tattoo();
        if (tattoo === null) return;
        const top = this.gy(side) - (f?.sprite.height ?? 60) - 30;
        const h = 54;
        const w = Math.round((h * tattoo.width) / tattoo.height);
        this.props.push({ image: tattoo, x, y: top, vx: 0, vy: -6, life: 0, max: rm ? 0.6 : 2.2, gravity: 0, w, h, flip: side === 1, fade: 0.45, glow: 0.8 });
        this.rings.push({ x, y: top, r: 6, life: 0, max: 1, color: "#9ae8ff" });
        this.onCue?.("discovery");
        await wait(rm ? 150 : 1300);
        return;
      }
    }
  }

  /** How many eyes watch from the dark (grows with the duel). */
  setWitnesses(n: number): void {
    this.witnesses = Math.max(0, Math.min(this.eyes.length, n));
  }

  /** A first discovery: golden sparks spiral up, a star hangs over the new form. */
  async discover(side: Side): Promise<void> {
    const f = this.fighters[side];
    if (f === null) return;
    this.onCue?.("discovery");
    this.discoveryGlow = { side, life: 0 };
    const cx = SIDE_X[side];
    const top = this.gy(side) - f.sprite.height;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 6;
      const rr = 6 + (i / 70) * f.sprite.width * 0.6;
      this.particles.push({
        x: cx + Math.cos(a) * rr,
        y: this.gy(side) - (i / 70) * f.sprite.height,
        vx: -Math.sin(a) * 18,
        vy: -18 - this.rand() * 20,
        life: -i * 0.008,
        max: 0.9 + this.rand() * 0.5,
        color: this.rand() < 0.6 ? "#ffd86a" : "#fff4c8",
        size: 1,
        gravity: -4,
        glow: true,
      });
    }
    this.rings.push({ x: cx, y: top - 10, r: 2, life: 0, max: 0.9, color: "#ffd86a" });
    await wait(this.reducedMotion ? 100 : 700);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = this.last === 0 ? 16 : Math.min(50, now - this.last);
      this.last = now;
      this.update(dt / 1000);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  /** Draw the current state (called once per animation frame). */
  protected abstract render(): void;

  clear(): void {
    this.fighters[0] = null;
    this.fighters[1] = null;
    this.particles.length = 0;
    this.projectiles.length = 0;
    this.bolts.length = 0;
    this.rings.length = 0;
    this.props.length = 0;
  }

  /** Which form stands on each side (ids) – to check the arena against the game state. */
  shownForms(): readonly [string | null, string | null] {
    return [this.fighters[0]?.form.id ?? null, this.fighters[1]?.form.id ?? null];
  }

  /** Swap in a grown ontology (live learning). Cached sprites stay valid – they depend on form ids. */
  setOntology(onto: Ontology): void {
    this.onto = onto;
    this.refreshArt();
  }

  /** A generated picture arrived: a form on stage that still shows its drawn sprite swaps with a flash. */
  refreshArt(): void {
    for (const side of [0, 1] as const) {
      const f = this.fighters[side];
      if (f === null || f.sprite.art) continue;
      const fresh = this.onto.formById(f.form.id) ?? f.form;
      if (artFor(fresh) === undefined) continue;
      const sprite = this.sprite(fresh);
      this.fighters[side] = { ...f, form: fresh, sprite, flash: 0.8 };
      this.rings.push({ x: SIDE_X[side], y: this.gy(side), r: 4, life: 0, max: 0.7, color: sprite.palette.glow });
    }
  }

  /**
   * "Beschwörung": a picture is being painted for `form`, about to appear on `side`. The rune
   * circle lights up and a pentagram of runes traces itself in; where the form will stand, a
   * summoning matrix rises, purple flames climb and shapes form inside them, melting from one into
   * the next – until {@link endConjuring}.
   */
  startConjuring(side?: Side, form?: Form): void {
    if (this.conjureTarget === 0) this.conjureAge = 0;
    this.conjureTarget = 1;
    if (side !== undefined && form !== undefined && this.summoning?.side !== side) this.summoning = this.summoningFor(side, form);
    this.onCue?.("summon");
  }

  /**
   * The picture is here (or will not come): the flames settle on the form's own outline, one
   * bright flare, then the circle calms down. With `form`, the final shape is taken from it.
   */
  async endConjuring(arrived: boolean, form?: Form): Promise<void> {
    if (this.conjureTarget === 0) return;
    const s = this.summoning;
    if (s !== null && form !== undefined) {
      const final = maskOf(this.sprite(form).pixels, s.cell * this.density);
      s.from = s.t >= 0.5 ? s.to : s.from;
      s.to = final;
      s.t = 0;
      s.hold = 0;
      s.final = true;
      s.seed++;
      if (!this.reducedMotion) await wait(MORPH_SECONDS * 1000 + 260);
    }
    this.conjureTarget = 0;
    const at = s === null ? null : { x: SIDE_X[s.side], y: this.gy(s.side) - (s.to.h * s.cell) / 2 };
    this.summoning = null;
    if (!arrived) return;
    this.conjureBurst = 1;
    this.flash = Math.max(this.flash, 0.45);
    this.flashColor = "#f4e0ff";
    const { cx, cy } = this.stage.rune;
    this.rings.push({ x: cx, y: cy, r: 6, life: 0, max: 0.9, color: "#f0d8ff" });
    this.burst(at?.x ?? cx, at?.y ?? cy - 4, "#e8c8ff", 70);
    this.onCue?.("reveal");
    await wait(this.reducedMotion ? 80 : 420);
  }

  /** Passing shapes, each fitted to about the size of the form to come (its drawn sprite). */
  private summoningFor(side: Side, form: Form): Summoning {
    // big enough to be recognised even when a flea is coming – the final shape shrinks to its size
    const drawn = renderSprite(this.onto, form);
    const boxW = Math.max(drawn.width, 72);
    const boxH = Math.max(drawn.height, 76);
    const cell = Math.max(2, Math.ceil(Math.max(boxW, boxH) / 44));
    const w = Math.ceil(boxW / cell);
    const h = Math.ceil(boxH / cell);
    const pool = MORPH_SHAPES.filter((id) => id !== form.id)
      .map((id) => this.onto.formById(id))
      .filter((f): f is Form => f !== undefined);
    const shapes: Mask[] = [];
    while (shapes.length < 5 && pool.length > 0) {
      const [pick] = pool.splice(Math.floor(this.rand() * pool.length), 1);
      if (pick === undefined) break;
      const m = fitMask(maskOf(renderSprite(this.onto, pick), cell), w, h);
      if (m.w > 0) shapes.push(m);
    }
    return { side, cell, shapes, next: 0, from: EMPTY_MASK, to: shapes[0] ?? EMPTY_MASK, t: 0, hold: 0, final: false, seed: hash32(form.id) };
  }

  /** Melt on; hold each shape a moment, then the next – the final one stays. */
  private stepSummoning(dt: number): void {
    const s = this.summoning;
    if (s === null) return;
    if (this.reducedMotion) {
      s.t = 1;
      return;
    }
    if (s.t < 1) {
      s.t = Math.min(1, s.t + dt / MORPH_SECONDS);
      return;
    }
    s.hold += dt;
    if (s.final || s.hold < MORPH_HOLD || s.shapes.length < 2) return;
    s.next = (s.next + 1) % s.shapes.length;
    s.from = s.to;
    s.to = s.shapes[s.next] ?? s.to;
    s.t = 0;
    s.hold = 0;
    s.seed++;
  }

  /** Purple flames climbing around (and through) the forming shape. */
  private emitSummoningFlames(dt: number): void {
    const s = this.summoning;
    if (s === null || this.reducedMotion) return;
    const x0 = SIDE_X[s.side];
    const gy = this.gy(s.side);
    const half = (Math.max(s.from.w, s.to.w, 8) * s.cell) / 2 + 6;
    const tall = Math.max(s.from.h, s.to.h, 10) * s.cell;
    const n = dt * 45 * this.conjure;
    for (let k = 0; k < Math.ceil(n); k++) {
      if (k + 1 > n && this.rand() > n - k) break;
      const inside = this.rand() < 0.15;
      this.particles.push({
        x: x0 + (this.rand() * 2 - 1) * half * (inside ? 0.6 : 1),
        y: inside ? gy - this.rand() * tall * 0.8 : gy - this.rand() * 3,
        vx: (this.rand() - 0.5) * 8,
        vy: -22 - this.rand() * 34,
        life: 0,
        max: 0.45 + this.rand() * 0.6,
        color: FLAME[Math.floor(this.rand() * FLAME.length)] ?? "#b050ff",
        size: this.rand() < 0.3 ? 2 : 1,
        gravity: -18,
        glow: true,
      });
    }
  }

  /** Sparks rising from the pentagram's points while conjuring. */
  private emitConjureSparks(dt: number): void {
    if (this.conjure < 0.15 || this.reducedMotion) return;
    const { cx, cy, inner } = this.stage.rune;
    const spin = this.time * 0.35;
    for (let k = 0; k < 5; k++) {
      if (this.rand() > dt * 9 * this.conjure) continue;
      const ang = spin + (k / 5) * Math.PI * 2 - Math.PI / 2;
      this.particles.push({
        x: cx + Math.cos(ang) * inner[0],
        y: cy + Math.sin(ang) * inner[1],
        vx: (this.rand() - 0.5) * 6,
        vy: -18 - this.rand() * 30,
        life: 0,
        max: 0.7 + this.rand() * 0.8,
        color: this.rand() < 0.5 ? "#d8b4ff" : "#ffe3a0",
        size: 1,
        gravity: -4,
        glow: true,
      });
    }
  }

  /** The rune circle charges while Claude is thinking. */
  setThinking(on: boolean): void {
    this.thinkingTarget = on ? 1 : 0;
  }

  /** Render a sprite for UI previews (DOM). */
  spriteCanvas(form: Form): HTMLCanvasElement {
    return this.sprite(form).image;
  }

  private sprite(form: Form): SpriteEntry {
    const art = artFor(form);
    // art may arrive later for a learned form – it gets its own cache slot
    const key = `${form.id}@${String(form.scale)}${art === undefined ? "" : "#art"}`;
    const cached = this.spriteCache.get(key);
    if (cached !== undefined) return cached;
    const palette = paletteFor(this.onto, form);
    const d = this.density;
    let entry: SpriteEntry;
    if (art === undefined) {
      // drawn sprite: layers at arena resolution, then scaled up unchanged to the renderer's density
      const pixels = renderSprite(this.onto, form);
      const up = (img: PixelImage): HTMLCanvasElement => toCanvas(resample(img, img.width * d, img.height * d));
      entry = {
        image: up(pixels),
        glow: up(renderGlow(this.onto, form)),
        silhouette: up(silhouetteOf(pixels, "#07050c")),
        rim: up(rimOf(pixels, palette.glow)),
        stone: up(stoneOf(pixels)),
        pixels: resample(pixels, pixels.width * d, pixels.height * d),
        width: pixels.width,
        height: pixels.height,
        palette,
        art: false,
      };
    } else {
      entry = this.pictureEntry(form, art, palette);
    }
    if (this.spriteCache.size > 200) this.spriteCache.clear();
    this.spriteCache.set(key, entry);
    return entry;
  }

  /** A generated picture (or animation frame) filling the form's sprite slot at the renderer's density. */
  private pictureEntry(form: Form, art: PixelImage, palette: SpritePalette, box?: Box): SpriteEntry {
    const d = this.density;
    // only the figure (it stands on the ground, no halo of empty pixels), at the picture's own
    // detail: ART_DENSITY picture pixels per arena pixel, so Pixi (density 2) shows it unstretched
    const cut = crop(art, box ?? alphaBox(art) ?? { x: 0, y: 0, w: art.width, h: art.height });
    // the figure itself fills the form's display size, slender ones a little more (see figureSize)
    const { w, h } = figureSize(cut.width, cut.height, displaySize(form.scale));
    const pixels = resample(cut, w * d, h * d);
    return {
      image: toCanvas(pixels),
      glow: toCanvas(artGlow(pixels, palette.emissive)),
      silhouette: toCanvas(silhouetteOf(pixels, "#07050c")),
      rim: toCanvas(rimOf(pixels, palette.glow)),
      stone: toCanvas(stoneOf(pixels)),
      pixels,
      width: w,
      height: h,
      palette,
      art: true,
    };
  }

  /**
   * "Beleben": play these frames (a generated animation of the form's picture) in a loop on every
   * fighter showing this form. The fighter gets its own canvases – the cached sprite stays still.
   * False when the form is not on stage.
   */
  animate(formId: string, frames: readonly PixelImage[], fps = 8): boolean {
    let any = false;
    // one crop for all frames: the figure moves inside it instead of the frame jumping
    const box = unionBox(frames.map((img) => alphaBox(img)));
    for (const side of [0, 1] as const) {
      if (this.fighters[side]?.form.id !== formId) continue;
      const f = this.runFrames(side, frames, fps, box);
      if (f === null) continue;
      f.flash = 0.6;
      this.rings.push({ x: SIDE_X[side], y: this.gy(side), r: 4, life: 0, max: 0.8, color: f.sprite.palette.glow });
      this.onCue?.("reveal");
      any = true;
    }
    return any;
  }

  /** Loop these frames on the fighter on `side` – in its own canvases, the cached sprite stays still. */
  private runFrames(side: Side, frames: readonly PixelImage[], fps: number, box: Box | undefined): Fighter | null {
    const f = this.fighters[side];
    if (f === null || frames.length < 2) return null;
    const entries = frames.map((img) => this.pictureEntry(f.form, img, f.sprite.palette, box));
    const first = entries[0];
    if (first === undefined) return null;
    // the fighter's own canvases, repainted frame by frame
    const own = (c: HTMLCanvasElement): HTMLCanvasElement => {
      const copy = canvas(c.width, c.height);
      ctx2d(copy).drawImage(c, 0, 0);
      return copy;
    };
    const live: SpriteEntry = { ...first, image: own(first.image), glow: own(first.glow), silhouette: own(first.silhouette), rim: own(first.rim), stone: own(first.stone) };
    const next: Fighter = { ...f, sprite: live, anim: { frames: entries, fps, t: 0, shown: 0 } };
    this.fighters[side] = next;
    return next;
  }

  /** One crop for a form's standard picture and all its animations, so switching between them never jumps. */
  private animBox(form: Form): Box | undefined {
    const art = artFor(form);
    const strips = [this.formAnims.get(form.id), this.formAnims.get(`${form.id}-attack`)].flatMap((x) => x ?? []);
    return unionBox([art, ...strips].map((img) => (img === undefined ? undefined : alphaBox(img))));
  }

  /**
   * A signature move with its own strip: its `-attack` strip loops (in the canvases its idle loop already owns)
   * while `run` plays, then the idle loop comes back. Just `run` when there is no strip.
   */
  private async withSignatureMove(side: Side, run: () => Promise<void>): Promise<void> {
    const f = this.fighters[side];
    const idle = f?.anim;
    const strip = f === null ? undefined : this.formAnims.get(`${f.form.id}-attack`);
    if (f === null || idle === undefined || strip === undefined || this.reducedMotion) {
      await run();
      return;
    }
    const box = this.animBox(f.form);
    f.anim = { frames: strip.map((img) => this.pictureEntry(f.form, img, f.sprite.palette, box)), fps: 12, t: 0, shown: -1 };
    await run();
    if (this.fighters[side] === f) f.anim = { ...idle, t: 0, shown: -1 };
  }

  /** Advance animations; repaint a fighter's canvases when its frame changes. */
  private stepAnimations(dt: number): void {
    for (const f of this.fighters) {
      const a = f?.anim;
      if (f === null || a === undefined) continue;
      a.t += this.reducedMotion ? 0 : dt;
      const i = Math.floor(a.t * a.fps) % a.frames.length;
      if (i === a.shown) continue;
      a.shown = i;
      const frame = a.frames[i];
      if (frame === undefined) continue;
      for (const k of ["image", "glow", "silhouette", "rim", "stone"] as const) {
        const target = f.sprite[k];
        const g = ctx2d(target);
        g.clearRect(0, 0, target.width, target.height);
        g.drawImage(frame[k], 0, 0, target.width, target.height);
      }
      this.spriteRepainted(f.sprite);
    }
  }

  /** A fighter's canvases changed in place (animation) – renderers with textures refresh them. */
  protected abstract spriteRepainted(sprite: SpriteEntry): void;

  private auraFor(form: Form): Aura {
    const has = (t: string): boolean => this.onto.formHas(form, t);
    const glow = paletteFor(this.onto, form).glow;
    if (has("feuer")) return { kind: "fire", color: "#ffb040" };
    if (has("untot") || has("gift")) return { kind: "wisps", color: has("untot") ? "#7dff6a" : "#c8f060" };
    if (has("schatten") || has("daemonisch")) return { kind: "smoke", color: "#2c1840" };
    if (has("eis") || has("kristall") || has("heilig") || has("licht")) return { kind: "sparkle", color: glow };
    if (has("magisch") || form.plane === "abstrakt") return { kind: "motes", color: glow };
    return { kind: "none", color: glow };
  }

  /**
   * Materialise a form on one side. With `hidden` it rises as a dark silhouette
   * and stays unknown until {@link reveal} is called.
   */
  summon(side: Side, form: Form, hidden = false): Promise<void> {
    this.newest = side;
    const sprite = this.sprite(form);
    this.fighters[side] = {
      form,
      sprite,
      appear: 0,
      reveal: hidden ? 0 : 1,
      alpha: 1,
      offsetX: 0,
      offsetY: 0,
      facing: 1,
      squash: 1,
      stone: 0,
      flash: 0,
      seed: hash32(form.id),
      aura: this.auraFor(form),
      flying: this.onto.formHas(form, "fliegt") || ["star", "orb", "ghost", "eye"].includes(form.archetype),
    };
    // a form with a standard animation comes alive at once (its bundled loop)
    const idle = this.formAnims.get(form.id);
    if (idle !== undefined && !this.reducedMotion) this.runFrames(side, idle, 8, this.animBox(form));
    const color = sprite.palette.glow;
    this.onCue?.("summon");
    this.rings.push({ x: SIDE_X[side], y: this.gy(side), r: 4, life: 0, max: 0.8, color });
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        x: SIDE_X[side] + (this.rand() - 0.5) * sprite.width,
        y: this.gy(side),
        vx: (this.rand() - 0.5) * 20,
        vy: -30 - this.rand() * 70,
        life: 0,
        max: 0.6 + this.rand() * 0.7,
        color: this.rand() < 0.5 ? color : sprite.palette.main[3],
        size: 1,
        gravity: 20,
        glow: true,
      });
    }
    return wait(this.reducedMotion ? 150 : hidden ? 1100 : 700);
  }

  /** Burst of light: the silhouette becomes the real thing. */
  async reveal(side: Side): Promise<void> {
    const f = this.fighters[side];
    if (f === null) return;
    const cy = this.gy(side) - f.sprite.height / 2;
    this.onCue?.("reveal");
    this.rings.push({ x: SIDE_X[side], y: cy, r: 4, life: 0, max: 0.6, color: f.sprite.palette.glow });
    this.burst(SIDE_X[side], cy, f.sprite.palette.glow, 60);
    this.flash = 0.25;
    this.flashColor = f.sprite.palette.glow;
    await this.tween(this.reducedMotion ? 50 : 380, (t) => (f.reveal = t));
    f.flash = 0.8;
    await wait(this.reducedMotion ? 50 : 350);
  }

  /** Attacker on `side` strikes the other side, which is destroyed. */
  /** `effect`: a painted attack animation (see `chooseEffect`) instead of the drawn one, if it is loaded. */
  /** `signature`: a figure's own attack instead of any other (Eichel figures, Johnny); `signatureSeconds`: how long Johnny sings. */
  async attack(side: Side, style: AttackStyle, weaknessHit: boolean, outcome: AttackOutcome = "destroy", effect?: string, signature?: Signature, signatureSeconds?: number): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const attacker = this.fighters[side];
    const target = this.fighters[other];
    if (attacker === null) return;
    if (signature === "eichelkaese") await this.withSignatureMove(side, () => this.eichelkaese(side));
    else if (signature === "eichelhagel") await this.withSignatureMove(side, () => this.eichelhagel(side));
    else if (signature === "klassiker") await this.withSignatureMove(side, () => this.klassiker(side, signatureSeconds));
    else await this.strike(side, style, false, effect);
    if (target === null) return;
    await this.suspense(other);
    this.onCue?.("impact");
    target.flash = 1;
    this.shake = weaknessHit ? 8 : 5;
    this.flash = weaknessHit ? 0.55 : 0.35;
    this.flashColor = attacker.sprite.palette.glow;
    this.burst(SIDE_X[other], this.gy(other) - target.sprite.height / 2, attacker.sprite.palette.glow, weaknessHit ? 90 : 50);
    this.rings.push({ x: SIDE_X[other], y: this.gy(other) - target.sprite.height / 2, r: 6, life: 0, max: 0.5, color: attacker.sprite.palette.glow });
    await wait(260);
    if (outcome === "destroy") await this.defeat(other, style);
    else await this.depart(other, outcome);
    this.fighters[other] = null;
  }

  /** The loser leaves without being destroyed: runs off, falls asleep, or drifts away charmed. */
  private async depart(side: Side, outcome: Exclude<AttackOutcome, "destroy">): Promise<void> {
    const f = this.fighters[side];
    if (f === null) return;
    const away = side === 0 ? -1 : 1;
    if (outcome === "flee") {
      f.facing = -1;
      for (let k = 0; k < 12; k++) this.particles.push({ x: SIDE_X[side], y: this.gy(side) - 2, vx: -away * (10 + this.rand() * 20), vy: -10 - this.rand() * 20, life: 0, max: 0.5, color: "#6a6080", size: 2, gravity: 40, glow: false });
      await this.tween(this.reducedMotion ? 50 : 750, (t) => {
        f.offsetX = away * 240 * t * t;
        f.offsetY = -Math.abs(Math.sin(t * 20)) * 3;
      });
    } else if (outcome === "sleep") {
      for (let k = 0; k < 3; k++) {
        this.particles.push({ x: SIDE_X[side] + 8, y: this.gy(side) - f.sprite.height, vx: 8, vy: -14, life: -k * 0.35, max: 1.2, color: "#c8d8ff", size: 2, gravity: 0, glow: true });
      }
      await this.tween(this.reducedMotion ? 50 : 1300, (t) => {
        f.offsetY = 4 * t;
        f.alpha = 1 - t * t;
      });
    } else if (outcome === "seal") {
      // pulled into a shrinking rune circle
      const cx = SIDE_X[side];
      for (let k = 0; k < 3; k++) this.rings.push({ x: cx, y: this.gy(side) - 2, r: 40 - k * 10, life: -k * 0.1, max: 1, color: "#c8a0ff" });
      await this.tween(this.reducedMotion ? 50 : 900, (t) => {
        f.squash = 1 - t;
        f.alpha = 1 - t * t;
      });
      this.burst(cx, this.gy(side) - 4, "#c8a0ff", 30);
    } else if (outcome === "petrify") {
      await this.tween(this.reducedMotion ? 50 : 700, (t) => (f.stone = t));
      await wait(500);
      this.disintegrate(side);
      await wait(600);
    } else {
      const gold = outcome === "peace";
      for (let k = 0; k < 24; k++) {
        const c = gold ? (this.rand() < 0.5 ? "#ffe890" : "#fffbe0") : this.rand() < 0.5 ? "#ff9ad0" : "#ffe0f0";
        this.particles.push({ x: SIDE_X[side] + (this.rand() - 0.5) * f.sprite.width, y: this.gy(side) - this.rand() * f.sprite.height, vx: 0, vy: -12 - this.rand() * 10, life: -this.rand() * 0.5, max: 1, color: c, size: 1, gravity: 0, glow: true });
      }
      await this.tween(this.reducedMotion ? 50 : 1100, (t) => {
        f.alpha = 1 - t;
        f.offsetY = -8 * t;
      });
    }
  }

  /** A failed attempt: the attacker's strike breaks on the target, then the attacker shatters. */
  /** `answer`: how the target strikes back – the failed attacker perishes by *that* (the wave washes the knight away). */
  async fizzle(side: Side, style: AttackStyle, answer: AttackStyle | null = null, effect?: string): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    await this.strike(side, style, true, effect);
    await this.suspense(other);
    const x = SIDE_X[other] + (side === 0 ? -1 : 1) * ((target?.sprite.width ?? 40) / 2 + 6);
    this.onCue?.("fizzle");
    this.rings.push({ x, y: this.gy(other) - 30, r: 3, life: 0, max: 0.45, color: "#e8e0f0" });
    this.burst(x, this.gy(other) - 30, "#e8e0f0", 24);
    this.shake = 3;
    await wait(250);
    const me = this.fighters[side];
    if (me !== null) me.flash = 1;
    await wait(200);
    if (answer === null) {
      this.disintegrate(side);
      await wait(750);
    } else await this.defeat(side, answer);
    this.fighters[side] = null;
  }

  /**
   * The loser perishes in the manner of what hit it: washed away, burnt up, buried, frozen and
   * shattered, blown away, dissolved – crumbling to dust only when nothing more specific fits.
   */
  private async defeat(side: Side, style: AttackStyle): Promise<void> {
    const f = this.fighters[side];
    if (f === null) return;
    const rm = this.reducedMotion;
    const away = side === 0 ? -1 : 1;
    const cx = SIDE_X[side];
    const h = f.sprite.height;
    const r = this.rand;
    switch (style) {
      case "water": {
        for (let k = 0; k < 60; k++) this.particles.push({ x: cx - away * 30 + r() * 20, y: this.gy(side) - r() * 14, vx: away * (80 + r() * 60), vy: -20 - r() * 30, life: -r() * 0.3, max: 0.8, color: r() < 0.6 ? "#3f8fc9" : "#bff0ff", size: 2, gravity: 90, glow: r() < 0.4 });
        await this.tween(rm ? 50 : 800, (t) => {
          f.offsetX = away * 90 * t;
          f.offsetY = -Math.sin(t * Math.PI) * 6;
          f.alpha = 1 - t;
        });
        return;
      }
      case "fire": {
        await this.tween(rm ? 50 : 900, (t) => {
          f.flash = 0.6 * (1 - t);
          f.squash = 1 - 0.6 * t;
          f.alpha = 1 - t * t;
          if (r() < 0.8) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.width, y: this.gy(side) - r() * h * (1 - 0.6 * t), vx: (r() - 0.5) * 10, vy: -30 - r() * 30, life: 0, max: 0.7, color: r() < 0.5 ? "#ff6a20" : "#ffc64a", size: 2, gravity: -10, glow: true });
        });
        for (let k = 0; k < 20; k++) this.particles.push({ x: cx + (r() - 0.5) * 20, y: this.gy(side) - 2, vx: (r() - 0.5) * 8, vy: -8 - r() * 10, life: 0, max: 1.6, color: "#3a3440", size: 2, gravity: -3, glow: false });
        return;
      }
      case "earth": {
        await this.tween(rm ? 50 : 800, (t) => {
          f.offsetY = h * t;
          f.alpha = 1 - t * 0.7;
          if (r() < 0.6) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.width, y: this.gy(side) - 2, vx: (r() - 0.5) * 30, vy: -30 - r() * 40, life: 0, max: 0.6, color: "#6a5040", size: 2, gravity: 160, glow: false });
        });
        return;
      }
      case "ice": {
        await this.tween(rm ? 50 : 500, (t) => (f.stone = t * 0.8));
        f.flash = 0.8;
        await wait(250);
        this.disintegrate(side);
        this.burst(cx, this.gy(side) - h / 2, "#e6fbff", 40);
        await wait(500);
        return;
      }
      case "wind": {
        await this.tween(rm ? 50 : 900, (t) => {
          f.offsetX = away * 200 * t * t;
          f.offsetY = -40 * t;
          f.alpha = 1 - t;
        });
        return;
      }
      case "poison":
      case "drain":
      case "dark": {
        const c = style === "poison" ? "#62b030" : style === "drain" ? "#b8263a" : "#2c1840";
        await this.tween(rm ? 50 : 1000, (t) => {
          f.squash = 1 - t;
          f.alpha = 1 - t * t;
          if (r() < 0.7) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.width, y: this.gy(side) - r() * h * (1 - t), vx: 0, vy: -6 - r() * 8, life: 0, max: 0.9, color: c, size: 2, gravity: 0, glow: style !== "dark" });
        });
        return;
      }
      case "bolt":
      case "light":
      case "cosmic": {
        f.flash = 1;
        await this.tween(rm ? 50 : 600, (t) => (f.alpha = 1 - t));
        this.burst(cx, this.gy(side) - h / 2, "#ffffff", 50);
        return;
      }
      case "slash":
      case "sound":
      case "mind":
      case "rune":
        this.disintegrate(side);
        await wait(700);
        return;
    }
  }

  /**
   * An escape: the target lashes out, the evader slips away (up into the air or down
   * into water/earth), the blow hits nothing and the target withdraws into the dark.
   */
  async evade(side: Side, targetStyle: AttackStyle, direction: "up" | "down" | "hide"): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const evader = this.fighters[side];
    const target = this.fighters[other];
    if (evader === null) return;
    const dy = direction === "up" ? -30 : direction === "down" ? 16 : 0;
    const dodge = this.tween(this.reducedMotion ? 50 : 420, (t) => {
      if (direction === "hide") evader.alpha = 1 - 0.85 * t;
      else evader.offsetY = dy * Math.sin(t * Math.PI * 0.5);
    });
    if (target !== null) await this.strike(other, targetStyle, true);
    await dodge;
    this.onCue?.("fizzle");
    this.burst(SIDE_X[side], this.gy(side) - 30 + dy, evader.sprite.palette.glow, 20);
    await wait(250);
    await this.tween(this.reducedMotion ? 50 : 500, (t) => {
      if (direction === "hide") evader.alpha = 0.15 + 0.85 * t;
      else evader.offsetY = dy * (1 - t);
    });
    if (target !== null) {
      await this.tween(this.reducedMotion ? 50 : 700, (t) => (target.alpha = 1 - t));
      this.fighters[other] = null;
    }
  }

  /** The held breath before the outcome: the hit hangs in the air, the target trembles. */
  private async suspense(side: Side): Promise<void> {
    if (this.reducedMotion) return;
    const f = this.fighters[side];
    const t0 = this.time;
    this.shake = 1.5;
    while (this.time - t0 < 0.55) {
      if (f !== null) f.offsetX = Math.round(Math.sin((this.time - t0) * 60)) * 1;
      await wait(16);
    }
    if (f !== null) f.offsetX = 0;
  }

  private async strike(side: Side, style: AttackStyle, stopShort: boolean, effect?: string): Promise<void> {
    const kind = EFFECTS.find((e) => e.id === effect)?.kind;
    if (effect !== undefined && kind !== undefined && this.sheets.has(effect)) {
      await this.strikeWith(effect, kind, side, stopShort);
      return;
    }
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const [color, glow] = STYLE_COLORS[style];
    const tx = SIDE_X[other];
    const reachX = stopShort ? SIDE_X[side] + (tx - SIDE_X[side]) * 0.72 : tx;
    const ty = this.gy(other) - (target?.sprite.height ?? 40) / 2;
    await this.tween(180, (t) => (attacker.offsetX = -dir * 6 * t));
    this.onCue?.("strike");
    const back = (): void => void this.tween(250, (t) => (attacker.offsetX = attacker.offsetX * (1 - t)));

    switch (style) {
      case "slash": {
        // a real lunge: the attacker crosses the arena and cuts
        const gap = Math.abs(tx - SIDE_X[side]) - (attacker.sprite.width + (target?.sprite.width ?? 30)) / 2 - 4;
        const dist = Math.max(10, stopShort ? gap * 0.7 : gap);
        await this.tween(this.reducedMotion ? 40 : 150, (t) => (attacker.offsetX = dir * (-6 + (dist + 6) * t * t)));
        this.slashArc(stopShort ? reachX : tx, ty, dir, stopShort);
        await wait(140);
        void this.tween(320, (t) => (attacker.offsetX = dir * dist * (1 - t)));
        return;
      }
      case "bolt": {
        const x = stopShort ? tx - dir * 26 : tx;
        this.bolts.push(makeBolt(x, stopShort ? this.gy(other) - 4 : ty, this.rand, glow));
        this.flash = 0.3;
        this.flashColor = glow;
        await wait(90);
        this.bolts.push(makeBolt(x + 2, stopShort ? this.gy(other) - 4 : ty, this.rand, color));
        this.burst(x, stopShort ? this.gy(other) - 4 : ty, glow, 30);
        await wait(160);
        back();
        return;
      }
      case "light": {
        this.bolts.push({ points: [[SIDE_X[side] + dir * 14, ty - 6], [reachX, ty - 6]], life: 0, max: 0.45, color: glow });
        this.bolts.push({ points: [[SIDE_X[side] + dir * 14, ty - 5], [reachX, ty - 5]], life: 0, max: 0.45, color });
        this.flash = 0.2;
        this.flashColor = glow;
        await wait(380);
        back();
        return;
      }
      case "earth": {
        const x0 = reachX;
        for (let k = 0; k < 7; k++) {
          const x = x0 + (k - 3) * 6 + (this.rand() - 0.5) * 3;
          for (let j = 0; j < 8; j++) {
            this.particles.push({ x, y: this.gy(other), vx: (this.rand() - 0.5) * 6, vy: -60 - this.rand() * 70 - j * 6, life: -k * 0.04, max: 0.7, color: this.rand() < 0.6 ? color : glow, size: 2, gravity: 180, glow: false });
          }
        }
        this.shake = 3;
        await wait(420);
        back();
        return;
      }
      case "drain": {
        // life flows from the target back to the attacker
        for (let k = 0; k < 60; k++) {
          const from = { x: reachX + (this.rand() - 0.5) * 20, y: ty + (this.rand() - 0.5) * 30 };
          const dur = 0.5 + this.rand() * 0.3;
          this.particles.push({ x: from.x, y: from.y, vx: (SIDE_X[side] - from.x) / dur, vy: (this.gy(side) - 30 - from.y) / dur - 20, life: -k * 0.008, max: dur, color: this.rand() < 0.5 ? color : glow, size: 1, gravity: 40, glow: true });
        }
        await wait(650);
        back();
        return;
      }
      case "rune": {
        const x = reachX;
        for (let k = 0; k < 3; k++) this.rings.push({ x, y: this.gy(other) - 2, r: 30 - k * 8, life: -k * 0.12, max: 0.8, color: k === 1 ? glow : color });
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2;
          this.particles.push({ x: x + Math.cos(ang) * 26, y: ty + Math.sin(ang) * 18, vx: -Math.cos(ang) * 30, vy: -Math.sin(ang) * 22, life: -0.2, max: 0.8, color: glow, size: 2, gravity: 0, glow: true });
        }
        await wait(700);
        back();
        return;
      }
      case "cosmic": {
        for (let k = 0; k < 90; k++) {
          const ang = this.rand() * Math.PI * 2;
          const r = 140 + this.rand() * 80;
          const dur = 0.6 + this.rand() * 0.3;
          const sx = reachX + Math.cos(ang) * r;
          const sy = ty + Math.sin(ang) * r * 0.6;
          this.particles.push({ x: sx, y: sy, vx: (reachX - sx) / dur, vy: (ty - sy) / dur, life: -this.rand() * 0.2, max: dur, color: this.rand() < 0.3 ? color : glow, size: 1, gravity: 0, glow: true });
        }
        await wait(820);
        this.flash = 0.35;
        this.flashColor = glow;
        back();
        return;
      }
      case "fire":
      case "water":
      case "ice":
      case "wind":
      case "dark":
      case "poison":
      case "sound":
      case "mind":
        break;
    }
    // travelling effects: fire, water, ice, wind, dark, poison, sound, mind
    await this.tween(120, (t) => (attacker.offsetX = dir * (-6 + 22 * t)));
    const duration: Record<string, number> = { fire: 0.45, water: 0.6, ice: 0.22, wind: 0.5, dark: 0.7, poison: 0.8, sound: 0.45, mind: 0.9 };
    await new Promise<void>((done) => {
      this.projectiles.push({
        from: SIDE_X[side] + dir * 20,
        to: tx,
        groundFrom: this.gy(side),
        groundTo: this.gy(other),
        t: 0,
        duration: duration[style] ?? 0.5,
        color,
        glow,
        style,
        stopShort,
        done,
      });
    });
    back();
  }

  private slashArc(x: number, y: number, dir: number, blocked: boolean): void {
    const [c, g] = STYLE_COLORS.slash;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const ang = -1.1 + t * 2.2;
        const r = 16 + k * 4;
        this.particles.push({ x: x - dir * 6 + Math.cos(ang) * r * dir * 0.5, y: y + Math.sin(ang) * r, vx: dir * 30, vy: 0, life: -t * 0.08 - k * 0.03, max: 0.22, color: k === 0 ? g : c, size: 1, gravity: 0, glow: true });
      }
    }
    if (blocked) this.burst(x, y, "#e8e0f0", 16);
  }


  private disintegrate(side: Side): void {
    const f = this.fighters[side];
    if (f === null) return;
    const { width, height, data } = f.sprite.pixels;
    // sample the (density-scaled) pixels, place the dust in arena pixels
    const d = width / f.sprite.width;
    const x0 = SIDE_X[side] - f.sprite.width / 2;
    const y0 = this.gy(side) - f.sprite.height;
    const step = Math.max(1, Math.round((f.sprite.width > 64 ? 3 : 2) * d));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const sx = side === 1 ? width - 1 - x : x;
        const i = (y * width + sx) * 4;
        if ((data[i + 3] ?? 0) === 0) continue;
        this.particles.push({
          x: x0 + x / d,
          y: y0 + y / d,
          vx: (this.rand() - 0.5) * 50 + (side === 0 ? -20 : 20),
          vy: -this.rand() * 50,
          life: 0,
          max: 0.5 + this.rand() * 0.9,
          color: `rgb(${String(data[i])},${String(data[i + 1])},${String(data[i + 2])})`,
          size: step,
          gravity: 80,
          glow: this.rand() < 0.15,
        });
      }
    }
    f.alpha = 0;
  }

  private burst(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 30 + this.rand() * 130;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.3 + this.rand() * 0.5, color, size: this.rand() < 0.3 ? 2 : 1, gravity: 40, glow: true });
    }
  }

  private tween(ms: number, fn: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / ms);
        fn(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // ── Simulation ──────────────────────────────────────────────────────────

  private update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 20);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.thinking += (this.thinkingTarget - this.thinking) * Math.min(1, dt * 4);
    this.conjure += (this.conjureTarget - this.conjure) * Math.min(1, dt * (this.conjureTarget > this.conjure ? 2.5 : 5));
    this.conjureAge = this.conjureTarget > 0 ? this.conjureAge + dt : 0;
    this.conjureBurst = Math.max(0, this.conjureBurst - dt * 1.6);
    this.emitConjureSparks(dt);
    this.stepSummoning(dt);
    this.emitSummoningFlames(dt);
    this.stepAnimations(dt);
    this.stepEffects(dt);
    this.stepProps(dt);
    this.emitEichelRain(dt);
    this.emitHumming(dt);
    this.stepRoom(dt);
    this.updateCosmos(dt);
    for (const fx of this.fieldFx.values()) fx.level += (fx.target - fx.level) * Math.min(1, dt * 1.5);
    this.emitFieldParticles(dt);
    this.rainbow = Math.max(0, this.rainbow - dt * 0.12);
    if (this.vortex !== null) {
      const v = this.vortex;
      v.life += dt;
      if (v.life > 2.5) this.vortex = null;
      else {
        for (const p of this.particles) {
          const dx = v.x - p.x;
          const dy = v.y - p.y;
          const d = Math.max(8, Math.hypot(dx, dy));
          p.vx += (dx / d) * 260 * dt - (dy / d) * 120 * dt;
          p.vy += (dy / d) * 260 * dt + (dx / d) * 120 * dt;
        }
        if (this.rand() < dt * 60) {
          const a = this.rand() * Math.PI * 2;
          this.particles.push({ x: v.x + Math.cos(a) * 120, y: v.y + Math.sin(a) * 60, vx: 0, vy: 0, life: 0, max: 1.2, color: this.rand() < 0.5 ? "#c8a0ff" : "#2c1840", size: 1, gravity: 0, glow: true });
        }
      }
    }
    for (const m of this.motes) {
      m.phase += dt;
      m.x += (m.vx + Math.sin(m.phase * 0.7) * 2) * dt;
      m.y += (m.vy + Math.cos(m.phase * 0.5) * 1.5) * dt;
      if (m.x < 0) m.x += WIDTH;
      if (m.x > WIDTH) m.x -= WIDTH;
      if (m.y < 10) m.y = GROUND_Y;
      if (m.y > GROUND_Y) m.y = 10;
    }
    if (this.discoveryGlow !== null) {
      this.discoveryGlow.life += dt;
      if (this.discoveryGlow.life > 3.2 || this.fighters[this.discoveryGlow.side] === null) this.discoveryGlow = null;
    }
    for (const [side, f] of this.fighters.entries()) {
      if (f === null) continue;
      f.appear = Math.min(1, f.appear + dt * 1.8);
      f.flash = Math.max(0, f.flash - dt * 3);
      if (f.alpha > 0 && f.aura.kind !== "none" && this.rand() < dt * 18) this.emitAura(side as Side, f);
    }
    this.updateDrops(dt);
    this.updateCritters(dt);
    for (const tx of TORCH_X) {
      if (this.rand() < 0.15) this.particles.push({ x: tx, y: 80, vx: (this.rand() - 0.5) * 8, vy: -20, life: 0, max: 0.8, color: "#ffb040", size: 1, gravity: -5, glow: true });
    }
    if (this.thinking > 0.1 && this.rand() < dt * 40 * this.thinking) {
      const a = this.rand() * Math.PI * 2;
      const { cx, cy, orbit } = this.stage.rune;
      this.particles.push({ x: cx + Math.cos(a) * orbit[0], y: cy + Math.sin(a) * orbit[1], vx: 0, vy: -20 - this.rand() * 25, life: 0, max: 0.9, color: "#c8a0ff", size: 1, gravity: 0, glow: true });
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p === undefined) continue;
      p.life += dt;
      if (p.life < 0) continue; // delayed spawn
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life > p.max) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r === undefined) continue;
      r.life += dt;
      r.r += dt * (r.grow ?? 90);
      if (r.life > r.max) this.rings.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr === undefined) continue;
      pr.t += dt / pr.duration;
      const reach = pr.stopShort ? 0.72 : 1;
      const t = Math.min(reach, pr.t);
      this.emitProjectile(pr, t, dt);
      if (pr.t >= reach) {
        this.projectiles.splice(i, 1);
        pr.done();
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      if (bolt === undefined) continue;
      bolt.life += dt;
      if (bolt.life > bolt.max) this.bolts.splice(i, 1);
    }

  }

  private updateCritters(dt: number): void {
    if (!this.stage.critters || this.reducedMotion) return;
    const r = this.rand;
    if (this.bats.length === 0 && r() < dt / 11) {
      // a small flock crosses the vault
      const dir = r() < 0.5 ? 1 : -1;
      const y = 10 + r() * 70;
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        this.bats.push({ x: (dir > 0 ? -10 : WIDTH + 10) - dir * k * (12 + r() * 10), y: y + (r() - 0.5) * 14, vx: dir * (60 + r() * 30), phase: r() * 10 });
      }
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      if (b === undefined) continue;
      b.x += b.vx * dt;
      b.y += Math.sin(this.time * 5 + b.phase) * 16 * dt;
      if (b.x < -40 || b.x > WIDTH + 40) this.bats.splice(i, 1);
    }
    // a rat scurries along the foot of the right wall, stopping to sniff
    if (this.rat === null && r() < dt / 23) this.rat = r() < 0.5 ? { x: WIDTH - 4, dir: -1, pause: 0 } : { x: 262, dir: 1, pause: 0 };
    const rat = this.rat;
    if (rat !== null) {
      if (rat.pause > 0) rat.pause -= dt;
      else {
        rat.x += rat.dir * 75 * dt;
        if (r() < dt * 0.9) rat.pause = 0.25 + r() * 0.7;
      }
      if (rat.x < 258 || rat.x > WIDTH) this.rat = null;
    }
  }

  /** Drops fall from the dark vault and ring out on the floor. */
  private updateDrops(dt: number): void {
    if (!this.reducedMotion) for (const [x, land] of this.stage.drips) if (this.rand() < dt * 0.3) this.drops.push({ x, y: -2, vy: 0, land });
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d === undefined) continue;
      d.vy += 320 * dt;
      d.y += d.vy * dt;
      if (d.y < d.land) continue;
      this.drops.splice(i, 1);
      this.rings.push({ x: d.x, y: d.land, r: 1, life: 0, max: 0.8, color: "#7fc6e8", grow: 12 });
      for (let k = 0; k < 3; k++) this.particles.push({ x: d.x, y: d.land - 1, vx: (this.rand() - 0.5) * 30, vy: -20 - this.rand() * 25, life: 0, max: 0.35, color: "#9fd8f0", size: 1, gravity: 240, glow: false });
    }
  }

  /** Particles along a travelling attack, shaped by its style. */
  private emitProjectile(pr: Projectile, t: number, dt: number): void {
    const r = this.rand;
    const x = pr.from + (pr.to - pr.from) * t;
    const dir = Math.sign(pr.to - pr.from);
    const ground = pr.groundFrom + (pr.groundTo - pr.groundFrom) * t;
    const air = ground - 40 - Math.sin(t * Math.PI) * 14;
    const push = (px: number, py: number, vx: number, vy: number, max: number, size: number, gravity: number, color: string, glow = true): void => {
      this.particles.push({ x: px, y: py, vx, vy, life: 0, max, color, size, gravity, glow });
    };
    switch (pr.style) {
      case "fire":
        for (let k = 0; k < 6; k++) push(x + (r() - 0.5) * 6, air + (r() - 0.5) * 6, -dir * 20 + (r() - 0.5) * 20, -20 - r() * 30, 0.3 + r() * 0.3, r() < 0.4 ? 2 : 1, -10, r() < 0.5 ? pr.color : pr.glow);
        push(x, air, 0, 0, 0.06, 4, 0, pr.glow);
        break;
      case "water":
        for (let k = 0; k < 5; k++) push(x + (r() - 0.5) * 10, ground - 2 - r() * 10, dir * 10, -30 - r() * 50, 0.4 + r() * 0.3, r() < 0.5 ? 2 : 1, 160, r() < 0.6 ? pr.color : pr.glow, r() < 0.5);
        break;
      case "ice":
        for (let k = 0; k < 3; k++) push(x - dir * k * 3, air + (r() - 0.5) * 8, dir * 40, 0, 0.12, 1, 0, r() < 0.5 ? pr.color : pr.glow);
        if (r() < dt * 30) push(x, air, (r() - 0.5) * 40, (r() - 0.5) * 40, 0.3, 1, 60, pr.glow);
        break;
      case "wind": {
        const wob = Math.sin(t * 18) * 10;
        for (let k = 0; k < 3; k++) push(x, air + wob + (r() - 0.5) * 4, -dir * 30, Math.cos(t * 18) * 30, 0.35, 1, 0, r() < 0.5 ? pr.color : pr.glow, r() < 0.4);
        break;
      }
      case "dark":
        for (let k = 0; k < 3; k++) push(x + (r() - 0.5) * 10, air + (r() - 0.5) * 10, (r() - 0.5) * 10, -5 - r() * 8, 0.6 + r() * 0.4, 3, 0, pr.color, false);
        if (r() < 0.6) push(x + (r() - 0.5) * 8, air + (r() - 0.5) * 8, 0, -6, 0.5, 1, 0, pr.glow);
        break;
      case "poison":
        if (r() < 0.8) push(x + (r() - 0.5) * 12, ground - 2, (r() - 0.5) * 6, -8 - r() * 16, 0.7 + r() * 0.5, r() < 0.3 ? 2 : 1, -6, r() < 0.6 ? pr.color : pr.glow);
        break;
      case "sound":
        if (r() < dt * 22) this.rings.push({ x, y: air, r: 3, life: 0, max: 0.35, color: pr.glow });
        break;
      case "mind": {
        const wob = Math.sin(t * 9) * 16;
        for (let k = 0; k < 2; k++) push(x, air - 10 + wob, (r() - 0.5) * 8, (r() - 0.5) * 8, 0.6, 1, 0, r() < 0.5 ? pr.color : pr.glow);
        break;
      }
      case "slash":
      case "earth":
      case "bolt":
      case "light":
      case "drain":
      case "rune":
      case "cosmic":
        for (let k = 0; k < 4; k++) push(x, air + (r() - 0.5) * 6, (r() - 0.5) * 30, (r() - 0.5) * 30, 0.25 + r() * 0.3, 1 + Math.floor(r() * 2), 0, r() < 0.5 ? pr.color : pr.glow);
    }
  }

  private emitFieldParticles(dt: number): void {
    if (this.reducedMotion) return;
    const r = this.rand;
    const glut = this.field("glut");
    if (glut > 0.05 && r() < dt * 30 * glut) {
      this.particles.push({ x: r() * WIDTH, y: GROUND_Y + r() * (HEIGHT - GROUND_Y), vx: (r() - 0.5) * 6, vy: -12 - r() * 18, life: 0, max: 1 + r(), color: r() < 0.5 ? "#ff8a30" : "#ffc64a", size: 1, gravity: -4, glow: true });
    }
    const nass = this.field("nass");
    if (nass > 0.05 && r() < dt * 8 * nass) {
      this.rings.push({ x: 20 + r() * (WIDTH - 40), y: FLOOR_Y + 8 + r() * (HEIGHT - FLOOR_Y - 12), r: 1, life: 0, max: 0.9, color: "#7fc6e8", grow: 14 });
    }
    const sturm = this.field("sturm");
    if (sturm > 0.05 && r() < dt * 40 * sturm) {
      this.particles.push({ x: -4, y: 20 + r() * (GROUND_Y - 20), vx: 180 + r() * 120, vy: (r() - 0.5) * 10, life: 0, max: 3, color: "#c8d0e0", size: 1, gravity: 0, glow: false });
    }
    const staub = this.field("staub");
    if (staub > 0.05 && r() < dt * 20 * staub) {
      this.particles.push({ x: r() * WIDTH, y: r() * GROUND_Y, vx: (r() - 0.5) * 4, vy: 2 + r() * 4, life: 0, max: 2.5, color: "#8a7a64", size: 1, gravity: 0, glow: false });
    }
  }

  private emitAura(side: Side, f: Fighter): void {
    const w = f.sprite.width;
    const h = f.sprite.height;
    const x = SIDE_X[side] + (this.rand() - 0.5) * w * 0.8;
    const y = this.gy(side) - this.rand() * h;
    const k = f.aura.kind;
    this.particles.push({
      x,
      y,
      vx: k === "motes" ? (this.rand() - 0.5) * 16 : (this.rand() - 0.5) * 6,
      vy: k === "fire" ? -30 - this.rand() * 20 : k === "smoke" ? -8 : k === "wisps" ? -14 : -4,
      life: 0,
      max: k === "sparkle" ? 0.35 : 0.9,
      color: k === "fire" && this.rand() < 0.5 ? "#ff6a20" : f.aura.color,
      size: k === "smoke" ? 3 : 1,
      gravity: 0,
      glow: k !== "smoke",
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** The ground line a side stands on – the stage may place the duellists at different depths. */
  protected gy(side: Side): number {
    return this.stage.ground[side];
  }

  protected fighterRect(side: Side, f: Fighter): { x: number; y: number; w: number; h: number } {
    // layout in arena pixels – `pixels` carry the renderer's density (2× in Pixi)
    const { width, height } = f.sprite;
    const bob = this.reducedMotion ? 0 : Math.round(Math.sin(this.time * (f.flying ? 2.2 : 1.6) + (f.seed % 7)) * (f.flying ? 3 : 1));
    const lift = f.flying ? 10 : 0;
    return { x: Math.round(SIDE_X[side] - width / 2 + f.offsetX), y: Math.round(this.gy(side) - height - lift + bob + f.offsetY), w: width, h: height };
  }

  /** Open bricks one by one as the cosmic factor rises; each falls away as dust. */
  private updateCosmos(dt: number): void {
    if (this.cosmic === this.cosmicTarget) return;
    const speed = this.reducedMotion ? 10 : 0.12;
    this.cosmic = this.cosmic < this.cosmicTarget ? Math.min(this.cosmicTarget, this.cosmic + dt * speed) : Math.max(this.cosmicTarget, this.cosmic - dt * 2);
    let changed = false;
    for (const [i, br] of this.bricks.entries()) {
      const want = this.cosmic > br.threshold ? 1 : 0;
      if (this.open[i] === want) continue;
      this.open[i] = want;
      changed = true;
      if (want === 1 && !this.reducedMotion) {
        for (let k = 0; k < 6; k++) {
          this.particles.push({ x: br.x + this.rand() * br.w, y: br.y + this.rand() * br.h, vx: (this.rand() - 0.5) * 10, vy: 5 + this.rand() * 10, life: 0, max: 1 + this.rand(), color: "#2e2740", size: 2, gravity: 60, glow: false });
        }
      }
    }
    if (!changed) return;
    this.repaintBackdrop();
  }

  /** Background plus the void behind every open brick → the backdrop renderers show. */
  private repaintBackdrop(): void {
    const ctx = ctx2d(this.backdrop);
    ctx.drawImage(this.background, 0, 0);
    const holes = ctx2d(this.holes);
    holes.clearRect(0, 0, WIDTH, HEIGHT);
    let n = 0;
    for (const [i, br] of this.bricks.entries()) {
      if (this.open[i] !== 1) continue;
      n++;
      openBricks(ctx, this.starfield, br);
      openBricks(holes, this.starfield, br);
    }
    this.openBricks = n;
    this.backdropVersion++;
  }

  /** Swap the procedural room and void for the painted ones once they are decoded. */
  /** Decode the bundled effect strips into frames (the drawn particles stand in until then). */
  private async loadEffects(): Promise<void> {
    await Promise.all(
      Object.entries(EFFECT_SHEETS).map(async ([id, url]) => {
        const img = await loadImage(url);
        if (img === undefined || img.height === 0) return;
        const size = img.height;
        const frames = Array.from({ length: Math.floor(img.width / size) }, (_, k) => {
          const c = canvas(size, size);
          ctx2d(c).drawImage(img, k * size, 0, size, size, 0, 0, size, size);
          return c;
        });
        if (frames.length >= 2) this.sheets.set(id, { frames, size });
      }),
    );
  }

  /** Decode the standard animation strips (square frames side by side) into pictures. */
  private async loadFormAnims(): Promise<void> {
    await Promise.all(
      Object.entries(FORM_ANIMS).map(async ([id, url]) => {
        const img = await loadImage(url);
        if (img === undefined || img.height === 0) return;
        const size = img.height;
        const c = canvas(img.width, size);
        const g = ctx2d(c);
        g.drawImage(img, 0, 0);
        const frames = Array.from({ length: Math.floor(img.width / size) }, (_, k): PixelImage => ({ width: size, height: size, data: g.getImageData(k * size, 0, size, size).data }));
        if (frames.length >= 2) this.formAnims.set(id, frames);
      }),
    );
  }

  /** Decode the painted room states (the plain room shows until then; only the default iso room has them). */
  private async loadRooms(): Promise<void> {
    if (this.stage !== ISO) return;
    const ids = Object.keys(ROOM_PICTURES).filter((k) => !k.endsWith("-anim"));
    await Promise.all(
      ids.map(async (id) => {
        const [still, anim] = await Promise.all([loadImage(ROOM_PICTURES[id] ?? ""), loadImage(ROOM_PICTURES[`${id}-anim`] ?? "")]);
        if (still === undefined) return;
        const s = canvas(still.width, still.height);
        ctx2d(s).drawImage(still, 0, 0);
        // the loop: frames of the room's shape side by side
        const fw = anim === undefined ? 0 : Math.round((anim.height * WIDTH) / HEIGHT);
        const frames =
          anim === undefined || fw === 0
            ? []
            : Array.from({ length: Math.floor(anim.width / fw) }, (_, k) => {
                const c = canvas(fw, anim.height);
                ctx2d(c).drawImage(anim, k * fw, 0, fw, anim.height, 0, 0, fw, anim.height);
                return c;
              });
        this.rooms.set(id, { still: s, frames });
      }),
    );
  }

  /** Which room state fits now – checked a few times a second; the change fades over ~1.5 s. */
  private stepRoom(dt: number): void {
    this.roomCheck -= dt;
    if (this.roomCheck <= 0) {
      this.roomCheck = 0.25;
      const fields = [...this.fieldFx].filter(([, fx]) => fx.target > 0).map(([id]) => id);
      const older: Side = this.newest === 0 ? 1 : 0;
      const forms = [this.fighters[this.newest], this.fighters[older]].flatMap((f) => (f === null ? [] : [f.form]));
      // a field a big form brought keeps its room while it lasts (the fire burns on after the dragon)
      for (const id of this.latched) if (!fields.includes(id)) this.latched.delete(id);
      for (const id of fields) if (forms.some((f) => f.scale >= ROOM_MIN_SCALE && carriesField(this.onto, f, id))) this.latched.add(id);
      this.room = chooseRoom(this.onto, fields, forms, (id) => this.rooms.has(id), this.latched)?.id ?? null;
    }
    // the Eichel-Arena rolls in at once, the other moods take their time
    const speed = this.reducedMotion ? 10 : this.room === "eichel" ? 3 : 0.7;
    for (const id of this.rooms.keys()) {
      const now = this.roomFade.get(id) ?? 0;
      const want = id === this.room ? 1 : 0;
      if (now !== want) this.roomFade.set(id, want > now ? Math.min(1, now + dt * speed) : Math.max(0, now - dt * speed));
    }
  }

  /** Move the flying pictures; the spent ones go. */
  private stepProps(dt: number): void {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      if (p === undefined) continue;
      p.life += dt;
      if (p.life >= p.max) {
        this.props.splice(i, 1);
        if (p.shatter === true) {
          for (let k = 0; k < 6; k++) this.particles.push({ x: p.x, y: p.y, vx: (this.rand() - 0.5) * 110, vy: -20 - this.rand() * 70, life: 0, max: 0.3 + this.rand() * 0.3, color: k % 3 === 0 ? "#78a834" : "#e2b834", size: 1, gravity: 260, glow: false });
        }
        continue;
      }
      if (p.life < 0) continue;
      // a fired acorn draws a glowing tracer behind it
      if (p.shatter === true) this.particles.push({ x: p.x, y: p.y, vx: -p.vx * 0.05, vy: -p.vy * 0.05, life: 0, max: 0.14, color: this.rand() < 0.5 ? "#fff0a0" : "#ffb838", size: 2, gravity: 0, glow: true });
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /**
   * Eichel-Arena: while the Eichelober or his gang stands in the arena – at any tier – acorns and oak
   * leaves keep falling from the vault (the room itself turns into the acorn hall, see rooms.json).
   */
  private emitEichelRain(dt: number): void {
    const eichel = (name: string): boolean => {
      const s = signatureFor(name);
      return s === "eichelkaese" || s === "eichelhagel";
    };
    if (this.reducedMotion || !this.fighters.some((f) => f !== null && f.alpha > 0 && eichel(f.form.name))) return;
    const r = this.rand;
    if (r() < dt * 2.2) {
      const { acorn } = this.eichelProps();
      const land = GROUND_Y + r() * 20;
      const vy = 20 + r() * 30;
      const g = 140;
      // falls until it reaches the floor, then bounces off as a few crumbs
      const t = (-vy + Math.sqrt(vy * vy + 2 * g * (land + 12))) / g;
      this.props.push({ image: acorn, x: 20 + r() * (WIDTH - 40), y: -12, vx: (r() - 0.5) * 12, vy, life: 0, max: t, gravity: g, w: 10, h: 13, flip: r() < 0.5, fade: 0.1, glow: 0 });
    }
    if (r() < dt * 9) {
      const c = ["#c86a20", "#e0a030", "#8a4a1a", "#6e7828"][Math.floor(r() * 4)] ?? "#c86a20";
      this.particles.push({ x: r() * WIDTH, y: -4, vx: (r() - 0.5) * 24, vy: 14 + r() * 12, life: 0, max: 5 + r() * 3, color: c, size: 2, gravity: 2, glow: false });
    }
  }

  /** Johnny never stops humming: now and then a note rises from his pot while he stands in the arena. */
  private emitHumming(dt: number): void {
    if (this.reducedMotion) return;
    for (const side of [0, 1] as const) {
      const f = this.fighters[side];
      if (f === null || f.alpha <= 0 || signatureFor(f.form.name) !== "klassiker" || this.rand() >= dt * 0.9) continue;
      const top = this.gy(side) - f.sprite.height * 0.75;
      const dir = side === 0 ? 1 : -1;
      this.props.push({ image: this.johnnyNote(), x: SIDE_X[side] + f.offsetX + dir * 6, y: top, vx: dir * (6 + this.rand() * 10), vy: -14 - this.rand() * 8, life: 0, max: 2.2, gravity: 0, w: 7, h: 10, flip: false, fade: 0.5, glow: 0.5 });
    }
  }

  /** One of Johnny's notes, single or beamed, in a light colour of the toy. */
  private johnnyNote(): HTMLCanvasElement {
    const k = Math.floor(this.rand() * NOTE_COLORS.length * 2);
    let c = this.noteArt.get(k);
    if (c === undefined) {
      c = toCanvas(noteImage(k % 2 === 1, NOTE_COLORS[k >> 1] ?? [255, 255, 255]));
      this.noteArt.set(k, c);
    }
    return c;
  }

  /**
   * "Der Klassiker": Johnny belts out one of his five songs – rings of sound pulse from his pot and a stream of
   * notes dances over to the opponent, who squirms more with every bar; a big beamed note ends it.
   */
  private async klassiker(side: Side, seconds = 4): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const rm = this.reducedMotion;
    const r = this.rand;
    const tx = SIDE_X[other];
    const th = target?.sprite.height ?? 40;
    const ty = this.gy(other) - th / 2;
    const mouth = (): [number, number] => [SIDE_X[side] + attacker.offsetX + dir * attacker.sprite.width * 0.1, this.gy(side) - attacker.sprite.height * 0.72];
    const total = rm ? 0.6 : Math.max(2, Math.min(6, seconds));
    const step = 0.13;
    const flight = 0.9;
    let beat = 0;
    for (let t = 0; t < total; t += step) {
      const [mx, my] = mouth();
      const hx = tx + (r() - 0.5) * (target?.sprite.width ?? 30) * 0.7;
      const hy = ty + (r() - 0.5) * th * 0.6;
      // an arc over the arena: up first, then down onto the opponent
      const lift = 60 + r() * 50;
      this.props.push({ image: this.johnnyNote(), x: mx, y: my, vx: (hx - mx) / flight, vy: (hy - my) / flight - lift, life: 0, max: flight, gravity: (2 * lift) / flight, w: 8, h: 11, flip: false, fade: 0.08, glow: 0.8 });
      if (t >= beat) {
        beat += 0.5;
        this.rings.push({ x: mx, y: my, r: 3, life: 0, max: 0.5, color: "#8ce85a", grow: 70 });
        this.onCue?.("strike");
      }
      // the opponent squirms – more with every bar
      if (target !== null && t > flight) {
        const annoyed = Math.min(1, (t - flight) / Math.max(0.5, total - flight));
        target.offsetX = (r() - 0.5) * 2 * (1 + annoyed * 4);
        if (r() < 0.15) target.flash = 0.3;
      }
      await wait(step * 1000);
    }
    await wait(flight * 1000);
    // the finale: one big beamed note
    const [mx, my] = mouth();
    const big = rm ? 0.15 : 0.45;
    this.props.push({ image: this.johnnyNote(), x: mx, y: my, vx: (tx - mx) / big, vy: (ty - my) / big, life: 0, max: big, gravity: 0, w: 24, h: 22, flip: false, fade: 0, glow: 0.9 });
    await wait(big * 1000);
    if (target !== null) target.offsetX = 0;
    this.flash = 0.4;
    this.flashColor = "#f06ab8";
    this.shake = rm ? 0 : 6;
    for (let k = 0; k < 3; k++) this.rings.push({ x: tx, y: ty, r: 4, life: -k * 0.1, max: 0.8, color: ["#8ce85a", "#f06ab8", "#6ac8f8"][k] ?? "#ffffff", grow: 120 });
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      this.props.push({ image: this.johnnyNote(), x: tx, y: ty, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0, max: 1, gravity: 120, w: 8, h: 11, flip: false, fade: 0.3, glow: 0.6 });
    }
  }

  private eichelProps(): { acorn: HTMLCanvasElement } {
    this.eichelArt ??= { acorn: toCanvas(acornImage()) };
    return this.eichelArt;
  }

  /** The gang tattoo, made from the Eichelober's own picture (none without it). */
  private tattoo(): HTMLCanvasElement | null {
    const rider = this.onto.formById("eichelober");
    const art = rider === undefined ? undefined : artFor(rider);
    return art === undefined ? null : toCanvas(tattooImage(art));
  }

  /** Puffy white clouds with a grey rim – what the flying acorn leaves behind. */
  private clouds(x: number, y: number, n: number, drift = 0): void {
    for (let i = 0; i < n; i++) {
      const rim = this.rand() < 0.3;
      this.particles.push({ x: x + (this.rand() - 0.5) * 30, y: y + (this.rand() - 0.5) * 8, vx: drift + (this.rand() - 0.5) * 16, vy: -4 - this.rand() * 8, life: -this.rand() * 0.2, max: 0.7 + this.rand() * 0.6, color: rim ? "#b8ae9c" : "#f6f0e0", size: rim ? 2 : 3, gravity: -4, glow: false });
    }
  }

  /**
   * "Eichelkäseattacke": the Eichelober rises on his acorn and opens fire – an acorn gun rattles
   * from the tip of his acorn, a stream of acorns hammers the opponent (muzzle flashes, spent caps
   * flying back, shards on every hit), and a last, giant acorn ends it with a blast.
   */
  private async eichelkaese(side: Side): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const rm = this.reducedMotion;
    const r = this.rand;
    const tx = SIDE_X[other];
    const tw = target?.sprite.width ?? 30;
    const th = target?.sprite.height ?? 40;
    const ty = this.gy(other) - th / 2;
    const { acorn } = this.eichelProps();
    // wind-up: he rises, the gun spins up with a golden glint
    await this.tween(rm ? 40 : 320, (t) => {
      attacker.offsetX = -dir * 6 * t;
      attacker.offsetY = -8 * t;
    });
    const muzzle = (): [number, number] => [SIDE_X[side] + attacker.offsetX + dir * attacker.sprite.width * 0.48, this.gy(side) + attacker.offsetY - attacker.sprite.height * 0.28];
    const [mx0, my0] = muzzle();
    this.rings.push({ x: mx0, y: my0, r: 2, life: 0, max: 0.4, color: "#ffe680" });
    await wait(rm ? 30 : 200);
    // the barrage
    const shots = rm ? 6 : 34;
    const flight = rm ? 0.12 : 0.24;
    for (let i = 0; i < shots; i++) {
      if (i % 3 === 0) this.onCue?.("strike");
      const [mx, my] = muzzle();
      const hx = tx + (r() - 0.5) * tw * 0.7;
      const hy = ty + (r() - 0.5) * th * 0.7;
      this.props.push({ image: acorn, x: mx, y: my, vx: (hx - mx) / flight, vy: (hy - my) / flight, life: 0, max: flight, gravity: 0, w: 12, h: 16, flip: false, fade: 0, glow: 0.6, shatter: true });
      // muzzle flash and a spent green cap flying back
      for (let k = 0; k < 5; k++) this.particles.push({ x: mx, y: my, vx: dir * (40 + r() * 90), vy: (r() - 0.5) * 60, life: 0, max: 0.08 + r() * 0.08, color: k < 2 ? "#ffffff" : "#ffd84a", size: k === 0 ? 4 : 2, gravity: 0, glow: true });
      this.rings.push({ x: mx, y: my, r: 2, life: 0, max: 0.1, color: "#fff0a0", grow: 60 });
      this.particles.push({ x: mx - dir * 6, y: my, vx: -dir * (30 + r() * 40), vy: -50 - r() * 40, life: 0, max: 0.6, color: r() < 0.5 ? "#78a834" : "#487420", size: 2, gravity: 260, glow: false });
      // recoil
      attacker.offsetX = -dir * (6 + (i % 2) * 2);
      this.shake = Math.max(this.shake, rm ? 0 : 1.5);
      if (target !== null && i % 4 === 3) target.flash = 0.5;
      await wait(rm ? 40 : 42);
    }
    await wait(flight * 1000);
    // the finale: one giant acorn
    const [mx, my] = muzzle();
    const big = rm ? 0.15 : 0.4;
    this.props.push({ image: acorn, x: mx, y: my, vx: (tx - mx) / big, vy: (ty - my) / big, life: 0, max: big, gravity: 0, w: 30, h: 39, flip: false, fade: 0, glow: 0.3 });
    for (let k = 0; k < 20; k++) this.particles.push({ x: mx, y: my, vx: dir * (60 + r() * 140), vy: (r() - 0.5) * 90, life: 0, max: 0.15 + r() * 0.1, color: k % 2 === 0 ? "#ffffff" : "#ffd84a", size: 3, gravity: 0, glow: true });
    this.shake = rm ? 0 : 5;
    await wait(big * 1000);
    this.onCue?.("boom");
    this.flash = 0.6;
    this.flashColor = "#ffe680";
    this.shake = rm ? 0 : 12;
    for (let k = 0; k < 3; k++) this.rings.push({ x: tx, y: ty, r: 4, life: -k * 0.1, max: 0.9, color: k === 1 ? "#fff4c0" : "#e2b834", grow: 160 });
    const bits = ["#e2b834", "#fae478", "#b88220", "#78a834", "#487420"];
    for (let i = 0; i < 120; i++) {
      const a = r() * Math.PI * 2;
      const sp = 40 + r() * 180;
      this.particles.push({ x: tx, y: ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.6 + r() * 0.8, color: bits[i % bits.length] ?? "#e2b834", size: r() < 0.4 ? 2 : 1, gravity: 240, glow: i % 4 === 0 });
    }
    // whole acorns bounce out of the blast
    for (let i = 0; i < 8; i++) this.props.push({ image: acorn, x: tx, y: ty, vx: (r() - 0.5) * 200, vy: -100 - r() * 120, life: 0, max: 1.3, gravity: 320, w: 10, h: 13, flip: r() < 0.5, fade: 0.2, glow: 0 });
    await wait(rm ? 60 : 300);
    const ox = attacker.offsetX;
    const oy = attacker.offsetY;
    void this.tween(rm ? 40 : 420, (t) => {
      attacker.offsetX = ox * (1 - t);
      attacker.offsetY = oy * (1 - t);
    });
  }
  /**
   * "Eichelhagel": the gang fires acorns with slingshots – from their own side and from the dark
   * corners where more of them hide – in three volleys that rattle down on the opponent.
   */
  private async eichelhagel(side: Side): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const rm = this.reducedMotion;
    const r = this.rand;
    const { acorn } = this.eichelProps();
    const tx = SIDE_X[other];
    const th = target?.sprite.height ?? 40;
    const g = 320;
    const flight = rm ? 0.2 : 0.62;
    const ax = SIDE_X[side] + dir * attacker.sprite.width * 0.4;
    const ay = this.gy(side) - attacker.sprite.height * 0.6;
    // the hidden members shoot from the far corners of the room
    const corners: readonly (readonly [number, number])[] = [
      [side === 0 ? 8 : WIDTH - 8, 60],
      [SIDE_X[side], 20],
    ];
    await this.tween(rm ? 30 : 220, (t) => (attacker.offsetX = -dir * 5 * t));
    for (let wave = 0; wave < 3; wave++) {
      this.onCue?.("strike");
      const hits: [number, number][] = [];
      const shooters: readonly (readonly [number, number])[] = [[ax, ay], [ax - dir * 10, ay + 10], ...(wave > 0 ? corners : [])];
      for (const [sx, sy] of shooters) {
        const hx = tx + (r() - 0.5) * (target?.sprite.width ?? 30) * 0.8;
        const hy = this.gy(other) - th * (0.2 + r() * 0.7);
        const vx = (hx - sx) / flight;
        const vy = (hy - sy - 0.5 * g * flight * flight) / flight;
        this.props.push({ image: acorn, x: sx, y: sy, vx, vy, life: 0, max: flight, gravity: g, w: 10, h: 13, flip: dir < 0, fade: 0, glow: 0 });
        // the slingshot's snap
        this.rings.push({ x: sx, y: sy, r: 1, life: 0, max: 0.25, color: "#c83a28", grow: 40 });
        hits.push([hx, hy]);
      }
      attacker.offsetX = -dir * 5;
      void this.tween(120, (t) => (attacker.offsetX = -dir * 5 + dir * 8 * Math.sin(t * Math.PI)));
      await wait(flight * 1000);
      this.shake = Math.max(this.shake, rm ? 0 : 3 + wave * 2);
      for (const [hx, hy] of hits) {
        // shards of shell and cap, and a little dust
        for (let k = 0; k < 10; k++) this.particles.push({ x: hx, y: hy, vx: (r() - 0.5) * 120, vy: -20 - r() * 80, life: 0, max: 0.4 + r() * 0.4, color: k % 3 === 0 ? "#c8a040" : "#8a4a1a", size: k % 4 === 0 ? 2 : 1, gravity: 260, glow: false });
        this.rings.push({ x: hx, y: hy, r: 2, life: 0, max: 0.3, color: "#ffe0b0" });
      }
      if (target !== null) target.flash = 0.6;
      this.onCue?.("impact");
      await wait(rm ? 30 : 140);
    }
    void this.tween(200, (t) => (attacker.offsetX = attacker.offsetX * (1 - t)));
  }

  /** Is this painted effect ready to play? */
  hasEffect(id: string): boolean {
    return this.sheets.has(id);
  }

  /** Advance the playing effects; the finished ones go. */
  private stepEffects(dt: number): void {
    for (const p of this.plays) p.t += dt;
    for (let i = this.plays.length - 1; i >= 0; i--) {
      const p = this.plays[i];
      if (p !== undefined && p.t >= (p.loop ? p.dur : p.sheet.frames.length / p.fps)) this.plays.splice(i, 1);
    }
  }

  /** Start one effect animation; resolves when it has played (or flown). */
  private play(id: string, opts: { from: readonly [number, number]; to?: readonly [number, number]; size: number; flip: boolean; fly?: number; fps?: number; alpha?: number }): Promise<void> {
    const sheet = this.sheets.get(id);
    if (sheet === undefined) return Promise.resolve();
    const fps = opts.fps ?? 14;
    const loop = opts.fly !== undefined;
    const dur = this.reducedMotion ? 0.12 : (opts.fly ?? sheet.frames.length / fps);
    this.plays.push({ sheet, t: 0, fps, loop, dur, from: opts.from, to: opts.to ?? opts.from, size: opts.size, flip: opts.flip, alpha: opts.alpha ?? 1 });
    return wait(dur * 1000);
  }

  /** How much of the drawn wall banners shows: a room with banners of its own fades them out. */
  protected bannersAlpha(): number {
    let hidden = 0;
    for (const [id, level] of this.roomFade) if (level > 0 && ROOMS.some((r) => r.id === id && r.hideBanners === true)) hidden = Math.max(hidden, easeOut(level));
    return 1 - hidden;
  }

  /** Everything painted this frame: room states behind, effects in front of the fighters. */
  protected imageDraws(): ImageDraw[] {
    const out: ImageDraw[] = [];
    for (const [id, level] of this.roomFade) {
      const r = this.rooms.get(id);
      if (r === undefined || level <= 0) continue;
      const a = easeOut(level);
      // the loop (made from this very still) when there is one – the still alone otherwise
      const frame = r.frames.length === 0 || this.reducedMotion ? undefined : r.frames[Math.floor(this.time * 7) % r.frames.length];
      out.push({ image: frame ?? r.still, x: 0, y: 0, w: WIDTH, h: HEIGHT, flip: false, alpha: a, glow: 0, layer: "backdrop" });
      // the crumbled wall stays crumbled in every room: the void shows through the painted wall as well
      if (this.openBricks > 0) out.push({ image: this.holes, x: 0, y: 0, w: WIDTH, h: HEIGHT, flip: false, alpha: a, glow: 0, layer: "backdrop" });
    }
    for (const p of this.plays) {
      const n = p.sheet.frames.length;
      const k = p.loop ? Math.floor(p.t * p.fps) % n : Math.min(n - 1, Math.floor(p.t * p.fps));
      const image = p.sheet.frames[k];
      if (image === undefined) continue;
      const u = p.loop ? Math.min(1, p.t / Math.max(0.01, p.dur)) : 1;
      const x = p.from[0] + (p.to[0] - p.from[0]) * u;
      const y = p.from[1] + (p.to[1] - p.from[1]) * u;
      // the last frames of a one-shot fade out
      const fade = p.loop ? 1 : Math.min(1, (n - p.t * p.fps) / 2);
      out.push({ image, x: Math.round(x - p.size / 2), y: Math.round(y - p.size / 2), w: p.size, h: p.size, flip: p.flip, alpha: p.alpha * Math.max(0, fade), glow: 0.55, layer: "front" });
    }
    for (const p of this.props) {
      if (p.life < 0) continue;
      const alpha = p.fade <= 0 ? 1 : Math.max(0, Math.min(1, p.life / p.fade, (p.max - p.life) / p.fade));
      out.push({ image: p.image, x: Math.round(p.x - p.w / 2), y: Math.round(p.y - p.h / 2), w: p.w, h: p.h, flip: p.flip, alpha, glow: p.glow, layer: "front" });
    }
    return out;
  }

  /**
   * A victory (or a near miss, `stopShort`) with a painted effect: a projectile flies from the
   * winner and bursts on the loser, a strike happens right at the loser, a drain flows back.
   */
  private async strikeWith(id: string, kind: EffectKind, side: Side, stopShort: boolean): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const th = target?.sprite.height ?? 40;
    const ty = this.gy(other) - th / 2;
    const tx = stopShort ? SIDE_X[side] + (SIDE_X[other] - SIDE_X[side]) * 0.72 : SIDE_X[other];
    const ax = SIDE_X[side] + dir * (attacker.sprite.width / 2);
    const ay = this.gy(side) - attacker.sprite.height * 0.55;
    const flip = side === 1;
    await this.tween(160, (t) => (attacker.offsetX = -dir * 6 * t));
    this.onCue?.("strike");
    const back = (): void => void this.tween(250, (t) => (attacker.offsetX = attacker.offsetX * (1 - t)));
    const burstSize = Math.max(60, Math.min(120, th * 1.2));
    if (kind === "projectile") {
      back();
      await this.play(id, { from: [ax, ay], to: [tx, ty], size: 36, flip, fly: 0.42 });
      this.shake = Math.max(this.shake, 3);
      if (this.sheets.has(`${id}-impact`)) void this.play(`${id}-impact`, { from: [tx, ty], size: stopShort ? burstSize * 0.6 : burstSize, flip, alpha: stopShort ? 0.7 : 1 });
      else this.burst(tx, ty, "#ffe0b0", 30);
      await wait(this.reducedMotion ? 60 : 260);
      return;
    }
    if (kind === "drain") {
      back();
      await this.play(id, { from: [tx, ty], to: [ax, ay], size: 30, flip: !flip, fly: 0.6 });
      this.burst(ax, ay, "#ff6a6a", 24);
      return;
    }
    // strike: a short lunge, and it happens at the loser
    await this.tween(this.reducedMotion ? 40 : 120, (t) => (attacker.offsetX = dir * (-6 + 18 * t)));
    back();
    this.shake = Math.max(this.shake, stopShort ? 2 : 4);
    await this.play(id, { from: [tx, ty], size: stopShort ? burstSize * 0.7 : burstSize * 1.15, flip, alpha: stopShort ? 0.75 : 1 });
  }

  private async loadScenery(): Promise<void> {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("drawn")) return;
    const [room, space] = await Promise.all([loadImage(SCENERY[this.stage.name]), loadImage(VOID)]);
    const paint = (target: HTMLCanvasElement, img: HTMLImageElement | undefined): void => {
      if (img === undefined) return;
      const g = ctx2d(target);
      g.clearRect(0, 0, target.width, target.height);
      g.drawImage(img, 0, 0, target.width, target.height);
    };
    paint(this.background, room);
    paint(this.starfield, space);
    this.repaintBackdrop();
  }

  /** The eyes follow whoever arrived last. */
  protected lookSide(): Side {
    const a = this.fighters[0];
    const b = this.fighters[1];
    if (a === null) return 1;
    if (b === null) return 0;
    return a.appear < b.appear ? 0 : 1;
  }

}

/** A jagged lightning path from the top of the arena down to (x, y). */
function makeBolt(x: number, y: number, rand: () => number, color: string): Bolt {
  const points: [number, number][] = [];
  let cx = x + (rand() - 0.5) * 30;
  for (let py = 0; py < y; py += 8 + rand() * 8) {
    points.push([cx, py]);
    cx += (rand() - 0.5) * 14;
    cx += (x - cx) * 0.25;
  }
  points.push([x, y]);
  return { points, life: 0, max: 0.35, color };
}

function silhouetteOf(img: PixelImage, color: string): PixelImage {
  const [r, g, b] = rgbOf(color);
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    if ((img.data[i + 3] ?? 0) === 0) continue;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

/** Greyscale with a stony tint and a little grain. */
function stoneOf(img: PixelImage): PixelImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = img.data[i + 3] ?? 0;
    if (a === 0) continue;
    const l = 0.3 * (img.data[i] ?? 0) + 0.59 * (img.data[i + 1] ?? 0) + 0.11 * (img.data[i + 2] ?? 0);
    const grain = ((i * 2654435761) >>> 28) - 8;
    const v = Math.max(20, Math.min(200, l * 0.7 + 40 + grain));
    data[i] = v + 6;
    data[i + 1] = v + 2;
    data[i + 2] = v - 4;
    data[i + 3] = a;
  }
  return { width: img.width, height: img.height, data };
}

/** Outline pixels = opaque pixels with a transparent 4-neighbour. */
function rimOf(img: PixelImage, color: string): PixelImage {
  const [r, g, b] = rgbOf(color);
  const { width: w, height: h } = img;
  const alpha = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (img.data[(y * w + x) * 4 + 3] ?? 0));
  const data = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha(x, y) === 0) continue;
      if (alpha(x - 1, y) > 0 && alpha(x + 1, y) > 0 && alpha(x, y - 1) > 0 && alpha(x, y + 1) > 0) continue;
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 200;
    }
  }
  return { width: w, height: h, data };
}

export function rgbOf(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = Array.from(h, (c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
