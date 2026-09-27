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

interface SpriteEntry {
  readonly image: HTMLCanvasElement;
  readonly glow: HTMLCanvasElement;
  readonly pixels: PixelImage;
  readonly palette: SpritePalette;
}

interface Fighter {
  readonly form: Form;
  readonly sprite: SpriteEntry;
  /** 0..1 materialisation progress. */
  appear: number;
  alpha: number;
  offsetX: number;
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

interface Projectile {
  from: number;
  to: number;
  t: number;
  duration: number;
  color: string;
  glow: string;
  family: string;
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

  constructor(
    target: HTMLCanvasElement,
    private readonly onto: Ontology,
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
    this.rings.length = 0;
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
    const entry: SpriteEntry = {
      image: toCanvas(pixels),
      glow: toCanvas(renderGlow(this.onto, form)),
      pixels,
      palette: paletteFor(this.onto, form),
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

  /** Materialise a form on one side. */
  summon(side: Side, form: Form): Promise<void> {
    const sprite = this.sprite(form);
    this.fighters[side] = {
      form,
      sprite,
      appear: 0,
      alpha: 1,
      offsetX: 0,
      flash: 0,
      seed: hash32(form.id),
      aura: this.auraFor(form),
      flying: this.onto.formHas(form, "fliegt") || ["star", "orb", "ghost", "eye"].includes(form.archetype),
    };
    const color = sprite.palette.glow;
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
    return wait(this.reducedMotion ? 150 : 700);
  }

  /** Attacker on `side` strikes the other side, which is destroyed. */
  async attack(side: Side, family: string, weaknessHit: boolean): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const attacker = this.fighters[side];
    const target = this.fighters[other];
    if (attacker === null) return;
    await this.strike(side, family, false);
    if (target === null) return;
    target.flash = 1;
    this.shake = weaknessHit ? 8 : 5;
    this.flash = weaknessHit ? 0.55 : 0.35;
    this.flashColor = attacker.sprite.palette.glow;
    this.burst(SIDE_X[other], GROUND_Y - target.sprite.pixels.height / 2, attacker.sprite.palette.glow, weaknessHit ? 90 : 50);
    this.rings.push({ x: SIDE_X[other], y: GROUND_Y - target.sprite.pixels.height / 2, r: 6, life: 0, max: 0.5, color: attacker.sprite.palette.glow });
    await wait(260);
    this.disintegrate(other);
    await wait(700);
    this.fighters[other] = null;
  }

  /** A failed attempt: the attacker's strike breaks on the target, then the attacker shatters. */
  async fizzle(side: Side, family: string): Promise<void> {
    const other: Side = side === 0 ? 1 : 0;
    const target = this.fighters[other];
    await this.strike(side, family, true);
    const x = SIDE_X[other] + (side === 0 ? -1 : 1) * ((target?.sprite.pixels.width ?? 40) / 2 + 6);
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

  private async strike(side: Side, family: string, stopShort: boolean): Promise<void> {
    const attacker = this.fighters[side];
    if (attacker === null) return;
    const dir = side === 0 ? 1 : -1;
    await this.tween(180, (t) => (attacker.offsetX = -dir * 6 * t));
    await this.tween(120, (t) => (attacker.offsetX = dir * (-6 + 22 * t)));
    await new Promise<void>((done) => {
      this.projectiles.push({
        from: SIDE_X[side] + dir * 20,
        to: SIDE_X[side === 0 ? 1 : 0],
        t: 0,
        duration: family === "gewalt" ? 0.2 : 0.5,
        color: attacker.sprite.palette.main[2],
        glow: attacker.sprite.palette.glow,
        family,
        stopShort,
        done,
      });
    });
    void this.tween(250, (t) => (attacker.offsetX = dir * 16 * (1 - t)));
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
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life > p.max) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r === undefined) continue;
      r.life += dt;
      r.r += dt * 90;
      if (r.life > r.max) this.rings.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr === undefined) continue;
      pr.t += dt / pr.duration;
      const reach = pr.stopShort ? 0.78 : 1;
      const t = Math.min(reach, pr.t);
      const x = pr.from + (pr.to - pr.from) * t;
      const y = GROUND_Y - 40 - Math.sin(t * Math.PI) * (pr.family === "kosmos" ? 40 : 14);
      for (let k = 0; k < 4; k++) {
        this.particles.push({ x, y: y + (this.rand() - 0.5) * 6, vx: (this.rand() - 0.5) * 30, vy: (this.rand() - 0.5) * 30, life: 0, max: 0.25 + this.rand() * 0.3, color: this.rand() < 0.5 ? pr.color : pr.glow, size: 1 + Math.floor(this.rand() * 2), gravity: 0, glow: true });
      }
      if (pr.t >= reach) {
        this.projectiles.splice(i, 1);
        pr.done();
      }
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
    b.drawImage(this.background, 0, 0);
    this.drawTorches();
    this.drawRune();
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawLightPool(side as Side, f);
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawFighter(side as Side, f);
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
    return { x: Math.round(SIDE_X[side] - width / 2 + f.offsetX), y: Math.round(GROUND_Y - height - lift + bob), w: width, h: height };
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
    const b = this.base;
    const { x, y, w, h } = this.fighterRect(side, f);
    // shadow
    b.fillStyle = "rgba(0,0,0,0.45)";
    const shw = Math.round(w * 0.4);
    b.fillRect(SIDE_X[side] - shw + Math.round(f.offsetX), GROUND_Y - 1, shw * 2, 3);
    // materialise: reveal rows from bottom
    const visible = Math.ceil(h * easeOut(f.appear));
    const blit = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement): void => {
      ctx.save();
      if (side === 1) {
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, h - visible, w, visible, 0, y + h - visible, w, visible);
      } else {
        ctx.drawImage(img, 0, h - visible, w, visible, x, y + h - visible, w, visible);
      }
      ctx.restore();
    };
    blit(b, f.sprite.image);
    blit(this.glow, f.sprite.glow);
    // materialisation scanline
    if (f.appear < 1) {
      this.glow.fillStyle = f.sprite.palette.glow;
      this.glow.fillRect(x, y + h - visible, w, 1);
    }
    if (f.flash > 0) {
      b.save();
      b.globalAlpha = f.flash;
      b.globalCompositeOperation = "lighter";
      if (side === 1) {
        b.translate(x + w, 0);
        b.scale(-1, 1);
        b.drawImage(f.sprite.image, 0, y);
      } else b.drawImage(f.sprite.image, x, y);
      b.restore();
    }
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
