import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { paletteFor, type SpritePalette } from "./palette.ts";
import { renderGlow, renderSprite, type PixelImage } from "./sprite.ts";
import { ISO } from "./stage-iso.ts";
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
export type EasterEgg = "nuke" | "meteor" | "rainbow" | "confetti" | "vortex";

const EGG_PATTERNS: readonly (readonly [RegExp, EasterEgg])[] = [
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
  readonly pixels: PixelImage;
  readonly palette: SpritePalette;
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
}

export interface Aura {
  readonly kind: "fire" | "sparkle" | "smoke" | "motes" | "wisps" | "none";
  readonly color: string;
}

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
  protected readonly projectiles: Projectile[] = [];
  protected readonly rings: Ring[] = [];
  protected readonly bolts: Bolt[] = [];
  protected readonly spriteCache = new Map<string, SpriteEntry>();
  protected shake = 0;
  protected flash = 0;
  protected flashColor = "#ffffff";
  protected thinking = 0;
  protected thinkingTarget = 0;
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
  /** Water drops falling from the vault (where the stage says it drips). */
  protected readonly drops: { x: number; y: number; vy: number; readonly land: number }[] = [];

  /** Bumped whenever the backdrop canvas was repainted (bricks fell) – renderers re-upload. */
  protected backdropVersion = 0;

  constructor(
    protected onto: Ontology,
    /** The scenery: flat wall or isometric room. */
    protected readonly stage: StageLayout = ISO,
  ) {
    this.background = stage.paintBackground();
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bricks = stage.wallBricks();
    this.open = new Uint8Array(this.bricks.length);
    this.starfield = paintStarfield();
    this.stars = scatterStars(this.bricks);
    this.backdrop = canvas(WIDTH, HEIGHT);
    ctx2d(this.backdrop).drawImage(this.background, 0, 0);
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
        this.flash = 1;
        this.flashColor = "#ffffff";
        this.shake = rm ? 0 : 14;
        for (let k = 0; k < 4; k++) this.rings.push({ x: gx, y: GROUND_Y, r: 4, life: -k * 0.12, max: 1.4, color: k % 2 === 0 ? "#fff3a0" : "#ff8a30", grow: 260 });
        // stem and cap of the mushroom cloud
        for (let i = 0; i < 760; i++) {
          const stem = i < 260;
          const t = r();
          const ang = r() * Math.PI * 2;
          const rad = Math.sqrt(r());
          const px = stem ? gx + (r() - 0.5) * (10 + t * 16) : gx + Math.cos(ang) * rad * 85;
          const py = stem ? GROUND_Y - t * 110 : GROUND_Y - 125 + Math.sin(ang) * rad * 32;
          const c = t < 0.15 ? "#ffffff" : t < 0.45 ? "#ffc64a" : t < 0.75 ? "#ff6a20" : "#7a3a2a";
          this.particles.push({ x: px, y: py, vx: (r() - 0.5) * (stem ? 6 : 24), vy: stem ? -10 - r() * 14 : -6 - r() * 10, life: -r() * 0.5, max: 2.8 + r() * 1.4, color: c, size: r() < 0.5 ? 3 : 2, gravity: 0, glow: t < 0.7 });
        }
        for (let i = 0; i < 160; i++) {
          const a = r() * Math.PI;
          this.particles.push({ x: gx, y: GROUND_Y - 2, vx: Math.cos(a) * (120 + r() * 120), vy: -Math.sin(a) * 30, life: 0, max: 1 + r(), color: "#6a5040", size: 2, gravity: 40, glow: false });
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
          const py = -10 + (GROUND_Y + 10) * t;
          this.particles.push({ x: px, y: py, vx: -20, vy: -10, life: -t * 0.6, max: 0.5, color: t > 0.8 ? "#ffffff" : "#ff8a30", size: 3, gravity: 0, glow: true });
        }
        await wait(rm ? 100 : 620);
        this.flash = 0.4;
        this.flashColor = "#ffc64a";
        this.shake = rm ? 0 : 7;
        this.burst(tx, GROUND_Y - 6, "#ff8a30", 70);
        this.rings.push({ x: tx, y: GROUND_Y, r: 4, life: 0, max: 0.8, color: "#ffc64a" });
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
        this.vortex = { x, y: GROUND_Y - 40, life: 0 };
        await wait(rm ? 100 : 900);
        return;
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
    const top = GROUND_Y - f.sprite.pixels.height;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 6;
      const rr = 6 + (i / 70) * f.sprite.pixels.width * 0.6;
      this.particles.push({
        x: cx + Math.cos(a) * rr,
        y: GROUND_Y - (i / 70) * f.sprite.pixels.height,
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
  }

  /** Swap in a grown ontology (live learning). Cached sprites stay valid – they depend on form ids. */
  setOntology(onto: Ontology): void {
    this.onto = onto;
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
    const key = `${form.id}@${String(form.scale)}`;
    const cached = this.spriteCache.get(key);
    if (cached !== undefined) return cached;
    const pixels = renderSprite(this.onto, form);
    const palette = paletteFor(this.onto, form);
    const entry: SpriteEntry = {
      image: toCanvas(pixels),
      glow: toCanvas(renderGlow(this.onto, form)),
      silhouette: toCanvas(silhouetteOf(pixels, "#07050c")),
      rim: toCanvas(rimOf(pixels, palette.glow)),
      stone: toCanvas(stoneOf(pixels)),
      pixels,
      palette,
    };
    if (this.spriteCache.size > 200) this.spriteCache.clear();
    this.spriteCache.set(key, entry);
    return entry;
  }

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
    const color = sprite.palette.glow;
    this.onCue?.("summon");
    this.rings.push({ x: SIDE_X[side], y: GROUND_Y, r: 4, life: 0, max: 0.8, color });
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        x: SIDE_X[side] + (this.rand() - 0.5) * sprite.pixels.width,
        y: GROUND_Y,
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
    const cy = GROUND_Y - f.sprite.pixels.height / 2;
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
  async attack(side: Side, style: AttackStyle, weaknessHit: boolean, outcome: AttackOutcome = "destroy"): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const attacker = this.fighters[side];
    const target = this.fighters[other];
    if (attacker === null) return;
    await this.strike(side, style, false);
    if (target === null) return;
    await this.suspense(other);
    this.onCue?.("impact");
    target.flash = 1;
    this.shake = weaknessHit ? 8 : 5;
    this.flash = weaknessHit ? 0.55 : 0.35;
    this.flashColor = attacker.sprite.palette.glow;
    this.burst(SIDE_X[other], GROUND_Y - target.sprite.pixels.height / 2, attacker.sprite.palette.glow, weaknessHit ? 90 : 50);
    this.rings.push({ x: SIDE_X[other], y: GROUND_Y - target.sprite.pixels.height / 2, r: 6, life: 0, max: 0.5, color: attacker.sprite.palette.glow });
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
      for (let k = 0; k < 12; k++) this.particles.push({ x: SIDE_X[side], y: GROUND_Y - 2, vx: -away * (10 + this.rand() * 20), vy: -10 - this.rand() * 20, life: 0, max: 0.5, color: "#6a6080", size: 2, gravity: 40, glow: false });
      await this.tween(this.reducedMotion ? 50 : 750, (t) => {
        f.offsetX = away * 240 * t * t;
        f.offsetY = -Math.abs(Math.sin(t * 20)) * 3;
      });
    } else if (outcome === "sleep") {
      for (let k = 0; k < 3; k++) {
        this.particles.push({ x: SIDE_X[side] + 8, y: GROUND_Y - f.sprite.pixels.height, vx: 8, vy: -14, life: -k * 0.35, max: 1.2, color: "#c8d8ff", size: 2, gravity: 0, glow: true });
      }
      await this.tween(this.reducedMotion ? 50 : 1300, (t) => {
        f.offsetY = 4 * t;
        f.alpha = 1 - t * t;
      });
    } else if (outcome === "seal") {
      // pulled into a shrinking rune circle
      const cx = SIDE_X[side];
      for (let k = 0; k < 3; k++) this.rings.push({ x: cx, y: GROUND_Y - 2, r: 40 - k * 10, life: -k * 0.1, max: 1, color: "#c8a0ff" });
      await this.tween(this.reducedMotion ? 50 : 900, (t) => {
        f.squash = 1 - t;
        f.alpha = 1 - t * t;
      });
      this.burst(cx, GROUND_Y - 4, "#c8a0ff", 30);
    } else if (outcome === "petrify") {
      await this.tween(this.reducedMotion ? 50 : 700, (t) => (f.stone = t));
      await wait(500);
      this.disintegrate(side);
      await wait(600);
    } else {
      const gold = outcome === "peace";
      for (let k = 0; k < 24; k++) {
        const c = gold ? (this.rand() < 0.5 ? "#ffe890" : "#fffbe0") : this.rand() < 0.5 ? "#ff9ad0" : "#ffe0f0";
        this.particles.push({ x: SIDE_X[side] + (this.rand() - 0.5) * f.sprite.pixels.width, y: GROUND_Y - this.rand() * f.sprite.pixels.height, vx: 0, vy: -12 - this.rand() * 10, life: -this.rand() * 0.5, max: 1, color: c, size: 1, gravity: 0, glow: true });
      }
      await this.tween(this.reducedMotion ? 50 : 1100, (t) => {
        f.alpha = 1 - t;
        f.offsetY = -8 * t;
      });
    }
  }

  /** A failed attempt: the attacker's strike breaks on the target, then the attacker shatters. */
  /** `answer`: how the target strikes back – the failed attacker perishes by *that* (the wave washes the knight away). */
  async fizzle(side: Side, style: AttackStyle, answer: AttackStyle | null = null): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    await this.strike(side, style, true);
    await this.suspense(other);
    const x = SIDE_X[other] + (side === 0 ? -1 : 1) * ((target?.sprite.pixels.width ?? 40) / 2 + 6);
    this.onCue?.("fizzle");
    this.rings.push({ x, y: GROUND_Y - 30, r: 3, life: 0, max: 0.45, color: "#e8e0f0" });
    this.burst(x, GROUND_Y - 30, "#e8e0f0", 24);
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
    const h = f.sprite.pixels.height;
    const r = this.rand;
    switch (style) {
      case "water": {
        for (let k = 0; k < 60; k++) this.particles.push({ x: cx - away * 30 + r() * 20, y: GROUND_Y - r() * 14, vx: away * (80 + r() * 60), vy: -20 - r() * 30, life: -r() * 0.3, max: 0.8, color: r() < 0.6 ? "#3f8fc9" : "#bff0ff", size: 2, gravity: 90, glow: r() < 0.4 });
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
          if (r() < 0.8) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.pixels.width, y: GROUND_Y - r() * h * (1 - 0.6 * t), vx: (r() - 0.5) * 10, vy: -30 - r() * 30, life: 0, max: 0.7, color: r() < 0.5 ? "#ff6a20" : "#ffc64a", size: 2, gravity: -10, glow: true });
        });
        for (let k = 0; k < 20; k++) this.particles.push({ x: cx + (r() - 0.5) * 20, y: GROUND_Y - 2, vx: (r() - 0.5) * 8, vy: -8 - r() * 10, life: 0, max: 1.6, color: "#3a3440", size: 2, gravity: -3, glow: false });
        return;
      }
      case "earth": {
        await this.tween(rm ? 50 : 800, (t) => {
          f.offsetY = h * t;
          f.alpha = 1 - t * 0.7;
          if (r() < 0.6) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.pixels.width, y: GROUND_Y - 2, vx: (r() - 0.5) * 30, vy: -30 - r() * 40, life: 0, max: 0.6, color: "#6a5040", size: 2, gravity: 160, glow: false });
        });
        return;
      }
      case "ice": {
        await this.tween(rm ? 50 : 500, (t) => (f.stone = t * 0.8));
        f.flash = 0.8;
        await wait(250);
        this.disintegrate(side);
        this.burst(cx, GROUND_Y - h / 2, "#e6fbff", 40);
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
          if (r() < 0.7) this.particles.push({ x: cx + (r() - 0.5) * f.sprite.pixels.width, y: GROUND_Y - r() * h * (1 - t), vx: 0, vy: -6 - r() * 8, life: 0, max: 0.9, color: c, size: 2, gravity: 0, glow: style !== "dark" });
        });
        return;
      }
      case "bolt":
      case "light":
      case "cosmic": {
        f.flash = 1;
        await this.tween(rm ? 50 : 600, (t) => (f.alpha = 1 - t));
        this.burst(cx, GROUND_Y - h / 2, "#ffffff", 50);
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
    this.burst(SIDE_X[side], GROUND_Y - 30 + dy, evader.sprite.palette.glow, 20);
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

  private async strike(side: Side, style: AttackStyle, stopShort: boolean): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    const dir = side === 0 ? 1 : -1;
    const [color, glow] = STYLE_COLORS[style];
    const tx = SIDE_X[other];
    const reachX = stopShort ? SIDE_X[side] + (tx - SIDE_X[side]) * 0.72 : tx;
    const ty = GROUND_Y - (target?.sprite.pixels.height ?? 40) / 2;
    await this.tween(180, (t) => (attacker.offsetX = -dir * 6 * t));
    this.onCue?.("strike");
    const back = (): void => void this.tween(250, (t) => (attacker.offsetX = attacker.offsetX * (1 - t)));

    switch (style) {
      case "slash": {
        // a real lunge: the attacker crosses the arena and cuts
        const gap = Math.abs(tx - SIDE_X[side]) - (attacker.sprite.pixels.width + (target?.sprite.pixels.width ?? 30)) / 2 - 4;
        const dist = Math.max(10, stopShort ? gap * 0.7 : gap);
        await this.tween(this.reducedMotion ? 40 : 150, (t) => (attacker.offsetX = dir * (-6 + (dist + 6) * t * t)));
        this.slashArc(stopShort ? reachX : tx, ty, dir, stopShort);
        await wait(140);
        void this.tween(320, (t) => (attacker.offsetX = dir * dist * (1 - t)));
        return;
      }
      case "bolt": {
        const x = stopShort ? tx - dir * 26 : tx;
        this.bolts.push(makeBolt(x, stopShort ? GROUND_Y - 4 : ty, this.rand, glow));
        this.flash = 0.3;
        this.flashColor = glow;
        await wait(90);
        this.bolts.push(makeBolt(x + 2, stopShort ? GROUND_Y - 4 : ty, this.rand, color));
        this.burst(x, stopShort ? GROUND_Y - 4 : ty, glow, 30);
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
            this.particles.push({ x, y: GROUND_Y, vx: (this.rand() - 0.5) * 6, vy: -60 - this.rand() * 70 - j * 6, life: -k * 0.04, max: 0.7, color: this.rand() < 0.6 ? color : glow, size: 2, gravity: 180, glow: false });
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
          this.particles.push({ x: from.x, y: from.y, vx: (SIDE_X[side] - from.x) / dur, vy: (GROUND_Y - 30 - from.y) / dur - 20, life: -k * 0.008, max: dur, color: this.rand() < 0.5 ? color : glow, size: 1, gravity: 40, glow: true });
        }
        await wait(650);
        back();
        return;
      }
      case "rune": {
        const x = reachX;
        for (let k = 0; k < 3; k++) this.rings.push({ x, y: GROUND_Y - 2, r: 30 - k * 8, life: -k * 0.12, max: 0.8, color: k === 1 ? glow : color });
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
    const x0 = SIDE_X[side] - width / 2;
    const y0 = GROUND_Y - height;
    const step = width > 64 ? 3 : 2;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const sx = side === 1 ? width - 1 - x : x;
        const i = (y * width + sx) * 4;
        if ((data[i + 3] ?? 0) === 0) continue;
        this.particles.push({
          x: x0 + x,
          y: y0 + y,
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
    const air = GROUND_Y - 40 - Math.sin(t * Math.PI) * 14;
    const push = (px: number, py: number, vx: number, vy: number, max: number, size: number, gravity: number, color: string, glow = true): void => {
      this.particles.push({ x: px, y: py, vx, vy, life: 0, max, color, size, gravity, glow });
    };
    switch (pr.style) {
      case "fire":
        for (let k = 0; k < 6; k++) push(x + (r() - 0.5) * 6, air + (r() - 0.5) * 6, -dir * 20 + (r() - 0.5) * 20, -20 - r() * 30, 0.3 + r() * 0.3, r() < 0.4 ? 2 : 1, -10, r() < 0.5 ? pr.color : pr.glow);
        push(x, air, 0, 0, 0.06, 4, 0, pr.glow);
        break;
      case "water":
        for (let k = 0; k < 5; k++) push(x + (r() - 0.5) * 10, GROUND_Y - 2 - r() * 10, dir * 10, -30 - r() * 50, 0.4 + r() * 0.3, r() < 0.5 ? 2 : 1, 160, r() < 0.6 ? pr.color : pr.glow, r() < 0.5);
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
        if (r() < 0.8) push(x + (r() - 0.5) * 12, GROUND_Y - 2, (r() - 0.5) * 6, -8 - r() * 16, 0.7 + r() * 0.5, r() < 0.3 ? 2 : 1, -6, r() < 0.6 ? pr.color : pr.glow);
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
    const w = f.sprite.pixels.width;
    const h = f.sprite.pixels.height;
    const x = SIDE_X[side] + (this.rand() - 0.5) * w * 0.8;
    const y = GROUND_Y - this.rand() * h;
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

  protected fighterRect(side: Side, f: Fighter): { x: number; y: number; w: number; h: number } {
    const { width, height } = f.sprite.pixels;
    const bob = this.reducedMotion ? 0 : Math.round(Math.sin(this.time * (f.flying ? 2.2 : 1.6) + (f.seed % 7)) * (f.flying ? 3 : 1));
    const lift = f.flying ? 10 : 0;
    return { x: Math.round(SIDE_X[side] - width / 2 + f.offsetX), y: Math.round(GROUND_Y - height - lift + bob + f.offsetY), w: width, h: height };
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
    const ctx = ctx2d(this.backdrop);
    ctx.drawImage(this.background, 0, 0);
    let n = 0;
    for (const [i, br] of this.bricks.entries()) {
      if (this.open[i] !== 1) continue;
      n++;
      openBricks(ctx, this.starfield, br);
    }
    this.openBricks = n;
    this.backdropVersion++;
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
