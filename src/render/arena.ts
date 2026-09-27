import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { paletteFor, type SpritePalette } from "./palette.ts";
import { renderGlow, renderSprite, type PixelImage } from "./sprite.ts";

export const WIDTH = 480;
export const HEIGHT = 270;
/**
 * The scene is drawn at 480×270 into an offscreen buffer, then blown up by an
 * integer factor with nearest-neighbour. The browser only ever *downscales*
 * that large image to fit, which keeps every logical pixel the same size.
 */
const UPSCALE = 4;
const FLOOR_Y = 172;
const GROUND_Y = 222;
const SIDE_X = [132, 348] as const;
const TORCH_X = [36, 444] as const;

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

interface Brick {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 0..1 – the brick opens to the void once the cosmic factor passes this. */
  readonly threshold: number;
}

interface Star {
  readonly x: number;
  readonly y: number;
  readonly brick: number;
  readonly phase: number;
  readonly color: string;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

interface Eye {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly color: string;
}

interface SpriteEntry {
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

interface Fighter {
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

interface Aura {
  readonly kind: "fire" | "sparkle" | "smoke" | "motes" | "wisps" | "none";
  readonly color: string;
}

interface Particle {
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

interface Bolt {
  readonly points: readonly (readonly [number, number])[];
  life: number;
  readonly max: number;
  readonly color: string;
}

interface Projectile {
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

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  /** Growth in px/s (default 90). */
  grow?: number;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
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
 * Pixel-art dungeon arena. Owns the render loop; all game logic lives elsewhere.
 *
 * Rendering pipeline per frame:
 *   base   (480×270)  background, light pools, fighters, particles
 *   glow   (480×270)  emissive only: torches, eyes, fire bodies, sparks, projectiles, runes
 *   bloom  glow → 240×135 (blur) and 120×68 (blur), upscaled bilinear, added with "lighter"
 *   display (1920×1080) = base ×4 nearest + bloom + impact flash
 */
export class Arena {
  private readonly display: CanvasRenderingContext2D;
  private readonly base: CanvasRenderingContext2D;
  private readonly glow: CanvasRenderingContext2D;
  private readonly bloomNear: CanvasRenderingContext2D;
  private readonly bloomFar: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private readonly fighters: [Fighter | null, Fighter | null] = [null, null];
  private readonly particles: Particle[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly rings: Ring[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly spriteCache = new Map<string, SpriteEntry>();
  private shake = 0;
  private flash = 0;
  private flashColor = "#ffffff";
  private thinking = 0;
  private thinkingTarget = 0;
  private time = 0;
  private last = 0;
  private running = false;
  private readonly rand = rng(1234);
  private readonly reducedMotion: boolean;
  /** Optional sound hook – the arena only says *when*, the UI decides *how*. */
  onCue: ((cue: ArenaCue) => void) | null = null;

  // Escalation mood: the wall dissolves brick by brick into a starfield.
  private readonly bricks: readonly Brick[];
  private readonly stars: readonly Star[];
  private readonly starfield: HTMLCanvasElement;
  private readonly backdrop: HTMLCanvasElement;
  private cosmic = 0;
  private cosmicTarget = 0;
  private openBricks = 0;
  private readonly open: Uint8Array;

  // Ambience: dust in the torchlight, eyes watching from the dark.
  private readonly motes: Mote[] = [];
  private readonly eyes: Eye[] = [];
  private witnesses = 0;
  /** Rainbow arc fading over the arena. */
  private rainbow = 0;
  /** Vortex pulling particles to a point. */
  private vortex: { x: number; y: number; life: number } | null = null;
  /** Arena fields ("Nässe", "Glut" …) – intensity per field id, eased towards 0/1. */
  private readonly fieldFx = new Map<string, { level: number; target: number }>();
  /** Discovery star floating above a fighter. */
  private discoveryGlow: { side: Side; life: number } | null = null;

  constructor(
    target: HTMLCanvasElement,
    private onto: Ontology,
  ) {
    target.width = WIDTH * UPSCALE;
    target.height = HEIGHT * UPSCALE;
    this.display = ctx2d(target);
    this.base = ctx2d(canvas(WIDTH, HEIGHT));
    this.glow = ctx2d(canvas(WIDTH, HEIGHT));
    this.bloomNear = ctx2d(canvas(WIDTH / 2, HEIGHT / 2));
    this.bloomFar = ctx2d(canvas(WIDTH / 4, Math.ceil(HEIGHT / 4)));
    this.background = paintBackground();
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bricks = wallBricks();
    this.open = new Uint8Array(this.bricks.length);
    this.starfield = paintStarfield();
    this.stars = scatterStars(this.bricks);
    this.backdrop = canvas(WIDTH, HEIGHT);
    ctx2d(this.backdrop).drawImage(this.background, 0, 0);
    const r = rng(4242);
    for (let i = 0; i < 38; i++) this.motes.push({ x: r() * WIDTH, y: 20 + r() * (GROUND_Y - 20), vx: (r() - 0.5) * 3, vy: (r() - 0.5) * 2, phase: r() * 10 });
    for (let i = 0; i < 12; i++) {
      // pairs of eyes in the dark upper wall, away from the torches
      const x = 70 + Math.floor(r() * 340);
      this.eyes.push({ x, y: 8 + Math.floor(r() * 40), phase: r() * 20, color: r() < 0.7 ? "#ff5a3c" : "#f0c850" });
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

  private field(id: string): number {
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
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

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
    if (outcome === "destroy") {
      this.disintegrate(other);
      await wait(700);
    } else await this.depart(other, outcome);
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
  async fizzle(side: Side, style: AttackStyle): Promise<void> {
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
    this.disintegrate(side);
    await wait(750);
    this.fighters[side] = null;
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
    if (this.thinking > 0.1 && this.rand() < dt * 40 * this.thinking) {
      const a = this.rand() * Math.PI * 2;
      this.particles.push({ x: 240 + Math.cos(a) * 144, y: 226 + Math.sin(a) * 20, vx: 0, vy: -20 - this.rand() * 25, life: 0, max: 0.9, color: "#c8a0ff", size: 1, gravity: 0, glow: true });
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

  /** Puddle shimmer, frost rim – drawn onto the floor before the fighters. */
  private drawFieldFloor(): void {
    const b = this.base;
    const nass = this.field("nass");
    if (nass > 0.01) {
      b.globalAlpha = 0.18 * nass;
      b.fillStyle = "#3f8fc9";
      for (let y = FLOOR_Y + 6; y < HEIGHT; y += 5) {
        const off = Math.round(Math.sin(this.time * 1.7 + y * 0.4) * 6);
        b.fillRect(40 + off, y, WIDTH - 80, 1);
      }
      b.globalAlpha = 1;
    }
    const frost = this.field("frost");
    if (frost > 0.01) {
      // rime creeping in from the edges of the floor, sparse in the middle
      b.fillStyle = "#dff4ff";
      for (let i = 0; i < 420; i++) {
        const x = (i * 7919) % WIDTH;
        const y = FLOOR_Y + ((i * 104729) % (HEIGHT - FLOOR_Y));
        const edge = Math.min(x, WIDTH - x) / (WIDTH / 2);
        if (edge > 0.25 + 0.75 * frost * ((i % 7) / 7)) continue;
        b.globalAlpha = 0.5 * frost * (1 - edge);
        b.fillRect(x, y, 1 + (i % 3 === 0 ? 1 : 0), 1);
      }
      b.globalAlpha = 1;
    }
  }

  /** Darkness, dust haze and silence over everything. */
  private drawFieldOverlay(): void {
    const b = this.base;
    const dark = this.field("finsternis");
    if (dark > 0.01) {
      b.globalAlpha = 0.45 * dark;
      b.fillStyle = "#020106";
      b.fillRect(-10, -10, WIDTH + 20, HEIGHT + 20);
      b.globalAlpha = 1;
    }
    const staub = this.field("staub");
    if (staub > 0.01) {
      b.globalAlpha = 0.12 * staub;
      b.fillStyle = "#6a5a44";
      b.fillRect(-10, -10, WIDTH + 20, HEIGHT + 20);
      b.globalAlpha = 1;
    }
    const still = this.field("stille");
    if (still > 0.01) {
      b.globalAlpha = 0.15 * still;
      b.fillStyle = "#1a2030";
      b.fillRect(-10, -10, WIDTH + 20, HEIGHT + 20);
      b.globalAlpha = 1;
    }
  }

  private drawRainbow(): void {
    if (this.rainbow <= 0.01) return;
    const colors = ["#ff5a5a", "#ffa040", "#ffe060", "#70e060", "#60a0ff", "#9a6aff"];
    for (const ctx of [this.base, this.glow]) {
      ctx.globalAlpha = Math.min(1, this.rainbow * 1.5) * (ctx === this.glow ? 0.5 : 0.8);
      for (const [i, c] of colors.entries()) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(240, GROUND_Y, 190 - i * 2, 150 - i * 2, 0, Math.PI, 2 * Math.PI);
        ctx.stroke();
      }
    }
    this.base.globalAlpha = 1;
    this.glow.globalAlpha = 1;
  }

  private drawBolts(): void {
    for (const bolt of this.bolts) {
      const a = Math.max(0, 1 - bolt.life / bolt.max) * (Math.floor(bolt.life * 30) % 2 === 0 ? 1 : 0.6);
      for (const ctx of [this.base, this.glow]) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = bolt.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [i, [px, py]] of bolt.points.entries()) {
          if (i === 0) ctx.moveTo(Math.round(px) + 0.5, Math.round(py) + 0.5);
          else ctx.lineTo(Math.round(px) + 0.5, Math.round(py) + 0.5);
        }
        ctx.stroke();
      }
    }
    this.base.globalAlpha = 1;
    this.glow.globalAlpha = 1;
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

  private draw(): void {
    const b = this.base;
    const g = this.glow;
    b.save();
    g.save();
    g.clearRect(0, 0, WIDTH, HEIGHT);
    const sx = Math.round((this.rand() - 0.5) * this.shake);
    const sy = Math.round((this.rand() - 0.5) * this.shake);
    b.translate(sx, sy);
    g.translate(sx, sy);
    b.drawImage(this.backdrop, 0, 0);
    this.drawStars();
    this.drawFieldFloor();
    this.drawEyes();
    this.drawTorches();
    this.drawMotes();
    this.drawRainbow();
    this.drawRune();
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawLightPool(side as Side, f);
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawFighter(side as Side, f);
    this.drawDiscoveryStar();
    this.drawBolts();
    for (const r of this.rings) {
      const a = Math.max(0, 1 - r.life / r.max);
      for (const ctx of [b, g]) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(r.x), Math.round(r.y), r.r, r.r * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const p of this.particles) {
      if (p.life < 0) continue;
      const fade = Math.max(0, 1 - p.life / p.max);
      b.globalAlpha = fade;
      b.fillStyle = p.color;
      b.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      if (p.glow) {
        g.globalAlpha = fade;
        g.fillStyle = p.color;
        g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    this.drawFieldOverlay();
    b.restore();
    g.restore();
    this.composite();
  }

  /** base ×4 nearest-neighbour, then two blurred bloom passes added on top. */
  private composite(): void {
    const d = this.display;
    const W = WIDTH * UPSCALE;
    const H = HEIGHT * UPSCALE;
    d.globalCompositeOperation = "source-over";
    d.globalAlpha = 1;
    d.imageSmoothingEnabled = false;
    d.drawImage(this.base.canvas, 0, 0, W, H);

    const near = this.bloomNear;
    near.clearRect(0, 0, near.canvas.width, near.canvas.height);
    near.imageSmoothingEnabled = true;
    near.filter = "blur(1.5px)";
    near.drawImage(this.glow.canvas, 0, 0, near.canvas.width, near.canvas.height);
    near.filter = "none";
    const far = this.bloomFar;
    far.clearRect(0, 0, far.canvas.width, far.canvas.height);
    far.imageSmoothingEnabled = true;
    far.filter = "blur(2px)";
    far.drawImage(this.glow.canvas, 0, 0, far.canvas.width, far.canvas.height);
    far.filter = "none";

    d.imageSmoothingEnabled = true;
    d.globalCompositeOperation = "lighter";
    d.globalAlpha = 0.9;
    d.drawImage(near.canvas, 0, 0, W, H);
    d.globalAlpha = 0.75;
    d.drawImage(far.canvas, 0, 0, W, H);
    // crisp emissive core on top
    d.imageSmoothingEnabled = false;
    d.globalAlpha = 0.35;
    d.drawImage(this.glow.canvas, 0, 0, W, H);
    if (this.flash > 0) {
      d.globalAlpha = this.flash;
      d.fillStyle = this.flashColor;
      d.fillRect(0, 0, W, H);
    }
    d.globalAlpha = 1;
    d.globalCompositeOperation = "source-over";
  }

  private fighterRect(side: Side, f: Fighter): { x: number; y: number; w: number; h: number } {
    const { width, height } = f.sprite.pixels;
    const bob = this.reducedMotion ? 0 : Math.round(Math.sin(this.time * (f.flying ? 2.2 : 1.6) + (f.seed % 7)) * (f.flying ? 3 : 1));
    const lift = f.flying ? 10 : 0;
    return { x: Math.round(SIDE_X[side] - width / 2 + f.offsetX), y: Math.round(GROUND_Y - height - lift + bob + f.offsetY), w: width, h: height };
  }

  private drawLightPool(side: Side, f: Fighter): void {
    if (f.alpha <= 0) return;
    const strength = (f.sprite.palette.emissive ? 0.35 : 0.12) * f.appear;
    const ctx = this.base;
    const cx = SIDE_X[side] + f.offsetX;
    const r = f.sprite.pixels.width * 0.9;
    const grad = ctx.createRadialGradient(cx, GROUND_Y, 2, cx, GROUND_Y, r);
    grad.addColorStop(0, hexA(f.sprite.palette.glow, strength));
    grad.addColorStop(1, hexA(f.sprite.palette.glow, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, GROUND_Y - r * 0.35, r * 2, r * 0.7);
  }

  private drawFighter(side: Side, f: Fighter): void {
    if (f.alpha <= 0) return;
    this.base.save();
    this.glow.save();
    this.base.globalAlpha = f.alpha;
    this.glow.globalAlpha = f.alpha * (1 - f.stone);
    if (f.squash < 1) {
      for (const ctx of [this.base, this.glow]) {
        ctx.translate(0, GROUND_Y);
        ctx.scale(1, Math.max(0.02, f.squash));
        ctx.translate(0, -GROUND_Y);
      }
    }
    this.drawFighterBody(side, f);
    this.base.restore();
    this.glow.restore();
  }

  private drawFighterBody(side: Side, f: Fighter): void {
    const b = this.base;
    const { x, y, w, h } = this.fighterRect(side, f);
    // shadow
    b.fillStyle = "rgba(0,0,0,0.45)";
    const shw = Math.round(w * 0.4);
    b.fillRect(SIDE_X[side] - shw + Math.round(f.offsetX), GROUND_Y - 1, shw * 2, 3);
    // materialise: reveal rows from bottom
    const visible = Math.ceil(h * easeOut(f.appear));
    const mirrored = (side === 1) !== (f.facing === -1);
    const blit = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement): void => {
      ctx.save();
      if (mirrored) {
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, h - visible, w, visible, 0, y + h - visible, w, visible);
      } else {
        ctx.drawImage(img, 0, h - visible, w, visible, x, y + h - visible, w, visible);
      }
      ctx.restore();
    };
    if (f.reveal < 1) {
      blit(b, f.sprite.silhouette);
      blit(this.glow, f.sprite.rim);
    }
    if (f.reveal > 0) {
      b.save();
      b.globalAlpha = f.reveal * f.alpha;
      blit(b, f.sprite.image);
      b.restore();
      this.glow.save();
      this.glow.globalAlpha = f.reveal * f.alpha;
      blit(this.glow, f.sprite.glow);
      this.glow.restore();
    }
    if (f.stone > 0) {
      b.save();
      b.globalAlpha = f.stone * f.alpha;
      blit(b, f.sprite.stone);
      b.restore();
    }
    // materialisation scanline
    if (f.appear < 1) {
      this.glow.fillStyle = f.sprite.palette.glow;
      this.glow.fillRect(x, y + h - visible, w, 1);
    }
    if (f.flash > 0) {
      b.save();
      b.globalAlpha = f.flash * f.alpha;
      b.globalCompositeOperation = "lighter";
      if (mirrored) {
        b.translate(x + w, 0);
        b.scale(-1, 1);
        b.drawImage(f.sprite.image, 0, y);
      } else b.drawImage(f.sprite.image, x, y);
      b.restore();
    }
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
      ctx.drawImage(this.starfield, br.x, br.y, br.w, br.h, br.x, br.y, br.w, br.h);
    }
    this.openBricks = n;
  }

  private drawStars(): void {
    if (this.openBricks === 0) return;
    const g = this.glow;
    for (const st of this.stars) {
      if (this.open[st.brick] !== 1) continue;
      const tw = this.reducedMotion ? 0.6 : 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 1.3 + st.phase));
      g.globalAlpha = tw;
      g.fillStyle = st.color;
      g.fillRect(st.x, st.y, 1, 1);
    }
    g.globalAlpha = 1;
  }

  private drawEyes(): void {
    if (this.witnesses === 0) return;
    for (let i = 0; i < this.witnesses; i++) {
      const e = this.eyes[i];
      if (e === undefined) continue;
      // blink: closed for a short moment every few seconds, each pair on its own rhythm
      const cycle = (this.time + e.phase) % (4 + (i % 3));
      if (cycle < 0.14) continue;
      const fadeIn = Math.min(1, cycle / 1.5);
      const look = this.fighters[this.lookSide()] === null ? 0 : this.lookSide() === 0 ? -1 : 1;
      for (const ctx of [this.base, this.glow]) {
        ctx.globalAlpha = (ctx === this.glow ? 0.45 : 0.8) * fadeIn;
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x + look, e.y, 1, 1);
        ctx.fillRect(e.x + 4 + look, e.y, 1, 1);
      }
    }
    this.base.globalAlpha = 1;
    this.glow.globalAlpha = 1;
  }

  /** The eyes follow whoever arrived last. */
  private lookSide(): Side {
    const a = this.fighters[0];
    const b = this.fighters[1];
    if (a === null) return 1;
    if (b === null) return 0;
    return a.appear < b.appear ? 0 : 1;
  }

  /** Dust in the air – only visible where light falls on it. */
  private drawMotes(): void {
    const lights: { x: number; y: number; r: number }[] = TORCH_X.map((x) => ({ x, y: 84, r: 70 }));
    for (const [side, f] of this.fighters.entries()) {
      if (f !== null && f.sprite.palette.emissive && f.reveal > 0.5) lights.push({ x: SIDE_X[side as Side], y: GROUND_Y - f.sprite.pixels.height / 2, r: 60 });
    }
    const b = this.base;
    b.fillStyle = "#ffd9a0";
    for (const m of this.motes) {
      let lit = 0;
      for (const l of lights) {
        const d = Math.hypot(m.x - l.x, (m.y - l.y) * 1.3);
        if (d < l.r) lit = Math.max(lit, 1 - d / l.r);
      }
      if (lit <= 0.05) continue;
      b.globalAlpha = lit * (0.4 + 0.3 * Math.sin(m.phase * 2));
      b.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    b.globalAlpha = 1;
  }

  private drawDiscoveryStar(): void {
    const d = this.discoveryGlow;
    if (d === null) return;
    const f = this.fighters[d.side];
    if (f === null) return;
    const { x, y, w } = this.fighterRect(d.side, f);
    const cx = x + Math.floor(w / 2);
    const cy = y - 12 + Math.round(Math.sin(this.time * 2) * 2);
    const a = Math.min(1, d.life * 3) * Math.min(1, (3.2 - d.life) / 0.8);
    const arm = 3 + Math.round(Math.sin(this.time * 5) + 1);
    for (const ctx of [this.base, this.glow]) {
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff4c8";
      ctx.fillRect(cx, cy - arm, 1, arm * 2 + 1);
      ctx.fillRect(cx - arm, cy, arm * 2 + 1, 1);
      ctx.fillStyle = "#ffd86a";
      ctx.fillRect(cx - 1, cy - 1, 3, 3);
    }
    this.base.globalAlpha = 1;
    this.glow.globalAlpha = 1;
  }

  private drawTorches(): void {
    const b = this.base;
    const g = this.glow;
    for (const tx of TORCH_X) {
      const flick = this.reducedMotion ? 0 : Math.sin(this.time * 17 + tx) * 0.5 + Math.sin(this.time * 7.3 + tx * 2) * 0.5;
      const r = 50 + flick * 4;
      const grad = b.createRadialGradient(tx, 84, 2, tx, 84, r);
      grad.addColorStop(0, "rgba(255,170,70,0.32)");
      grad.addColorStop(1, "rgba(255,120,40,0)");
      b.fillStyle = grad;
      b.fillRect(tx - r, 84 - r, r * 2, r * 2);
      const h = 7 + Math.round(flick * 2);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((h - i) * 0.6));
        const color = i < 2 ? "#fff3a0" : i < 4 ? "#ffb040" : "#e8641c";
        const fx = tx - Math.floor(w / 2) + Math.round(Math.sin(this.time * 9 + i) * (i / 4));
        for (const ctx of [b, g]) {
          ctx.fillStyle = color;
          ctx.fillRect(fx, 86 - i, w, 1);
        }
      }
      if (this.rand() < 0.15) {
        this.particles.push({ x: tx, y: 80, vx: (this.rand() - 0.5) * 8, vy: -20, life: 0, max: 0.8, color: "#ffb040", size: 1, gravity: -5, glow: true });
      }
    }
  }

  private drawRune(): void {
    const pulse = 0.22 + Math.sin(this.time * 1.5) * 0.06 + this.thinking * 0.5;
    const spin = this.time * (0.3 + this.thinking * 2.5);
    for (const ctx of [this.base, this.glow]) {
      ctx.globalAlpha = ctx === this.glow ? pulse * 0.8 : pulse;
      ctx.strokeStyle = this.thinking > 0.2 ? "#c8a0ff" : "#8a62b0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(240, 226, 150, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(240, 226, 138, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
      // runes: small marks orbiting between the two rings
      ctx.fillStyle = ctx.strokeStyle;
      for (let i = 0; i < 12; i++) {
        const a = spin + (i / 12) * Math.PI * 2;
        ctx.fillRect(Math.round(240 + Math.cos(a) * 144), Math.round(226 + Math.sin(a) * 20), 2, 1);
      }
      ctx.globalAlpha = 1;
    }
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

function rgbOf(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = Array.from(h, (c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexA(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = Array.from(h, (c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return `rgba(${String((n >> 16) & 255)},${String((n >> 8) & 255)},${String(n & 255)},${a.toFixed(3)})`;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Procedural dungeon backdrop, painted once. */
function paintBackground(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext("2d");
  if (ctx === null) return c;
  const rand = rng(99);
  const px = (x: number, y: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // wall
  px(0, 0, WIDTH, FLOOR_Y, "#15111f");
  const bricks = ["#2a2438", "#2e2740", "#262033", "#302a44"];
  for (let row = 0; row * 10 < FLOOR_Y; row++) {
    const off = row % 2 === 0 ? 0 : 12;
    for (let col = -1; col * 24 < WIDTH; col++) {
      const x = col * 24 + off;
      const y = row * 10;
      const base = bricks[Math.floor(rand() * bricks.length)] ?? "#2a2438";
      px(x + 1, y + 1, 22, 8, base);
      px(x + 1, y + 1, 22, 1, "#3a3352");
      px(x + 1, y + 8, 22, 1, "#1c1728");
      if (rand() < 0.12) px(x + 3 + Math.floor(rand() * 14), y + 2 + Math.floor(rand() * 5), 2, 1, "#1c1728");
      if (rand() < 0.07) px(x + 2 + Math.floor(rand() * 16), y + 7, 4, 2, "#243a2a");
    }
  }
  // darken wall toward top (dithered)
  for (let y = 0; y < FLOOR_Y; y++) {
    const shade = Math.max(0, 1 - y / (FLOOR_Y * 0.55));
    for (let x = 0; x < WIDTH; x++) {
      const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y % 4) * 4 + (x % 4)] ?? 0;
      if (b / 16 < shade * 0.8) px(x, y, 1, 1, "rgba(8,6,14,0.5)");
    }
  }
  // pillars
  for (const x0 of [20, 428]) {
    px(x0, 0, 32, FLOOR_Y, "#3a3350");
    px(x0, 0, 4, FLOOR_Y, "#4a4264");
    px(x0 + 28, 0, 4, FLOOR_Y, "#251f36");
    for (let y = 0; y < FLOOR_Y; y += 16) px(x0, y, 32, 1, "#251f36");
    px(x0 - 3, FLOOR_Y - 10, 38, 10, "#2c2640");
    px(x0 - 3, 0, 38, 8, "#2c2640");
    // torch bracket
    px(x0 + 12, 88, 8, 10, "#5c3418");
    px(x0 + 10, 86, 12, 3, "#3a2210");
  }
  // floor
  px(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y, "#1a1526");
  const vx = WIDTH / 2;
  const vy = 60;
  let y = FLOOR_Y;
  let gap = 4;
  let i = 0;
  while (y < HEIGHT) {
    px(0, Math.round(y), WIDTH, 1, i % 2 === 0 ? "#241e34" : "#221c30");
    y += gap;
    gap *= 1.28;
    i++;
  }
  ctx.strokeStyle = "#241e34";
  for (let k = -12; k <= 12; k++) {
    const bx = vx + k * 40;
    ctx.beginPath();
    ctx.moveTo(vx + (bx - vx) * ((FLOOR_Y - vy) / (HEIGHT - vy)), FLOOR_Y);
    ctx.lineTo(bx, HEIGHT);
    ctx.stroke();
  }
  px(0, FLOOR_Y, WIDTH, 2, "#0e0b16");
  // vignette
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 80, WIDTH / 2, HEIGHT / 2, 300);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return c;
}

/** Brick rectangles of the back wall (same grid as paintBackground), pillars excluded. */
function wallBricks(): Brick[] {
  const r = rng(77);
  const out: Brick[] = [];
  for (let row = 0; row * 10 < FLOOR_Y - 10; row++) {
    const off = row % 2 === 0 ? 0 : 12;
    for (let col = -1; col * 24 < WIDTH; col++) {
      const x = col * 24 + off;
      const y = row * 10;
      const x0 = Math.max(0, x);
      const x1 = Math.min(WIDTH, x + 24);
      if (x1 - x0 < 4) continue;
      // keep the pillars standing in the void
      if (x1 > 14 && x0 < 58) continue;
      if (x1 > 422 && x0 < 466) continue;
      // upper bricks go first, with noise so it looks like crumbling, not a wipe
      const height = y / FLOOR_Y;
      out.push({ x: x0, y, w: x1 - x0, h: 10, threshold: Math.min(0.98, 0.05 + height * 0.6 + r() * 0.35) });
    }
  }
  return out;
}

/** The void behind the wall: deep violet with a faint nebula band. */
function paintStarfield(): HTMLCanvasElement {
  const c = canvas(WIDTH, HEIGHT);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#05030b";
  ctx.fillRect(0, 0, WIDTH, FLOOR_Y);
  const neb = ctx.createLinearGradient(0, 20, WIDTH, 140);
  neb.addColorStop(0, "rgba(60,20,90,0)");
  neb.addColorStop(0.45, "rgba(80,30,120,0.35)");
  neb.addColorStop(0.6, "rgba(30,60,120,0.3)");
  neb.addColorStop(1, "rgba(20,10,40,0)");
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, WIDTH, FLOOR_Y);
  // dither the nebula into pixel noise
  const r = rng(5);
  for (let y = 0; y < FLOOR_Y; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (r() < 0.25) {
        ctx.fillStyle = "rgba(5,3,11,0.6)";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

function scatterStars(bricks: readonly Brick[]): Star[] {
  const r = rng(31);
  const colors = ["#ffffff", "#c8d8ff", "#ffe8c8", "#c8a0ff"];
  const out: Star[] = [];
  for (const [i, br] of bricks.entries()) {
    const n = r() < 0.5 ? 1 : r() < 0.5 ? 2 : 0;
    for (let k = 0; k < n; k++) {
      out.push({ x: br.x + 1 + Math.floor(r() * (br.w - 2)), y: br.y + 1 + Math.floor(r() * (br.h - 2)), brick: i, phase: r() * 20, color: colors[Math.floor(r() * colors.length)] ?? "#ffffff" });
    }
  }
  return out;
}
