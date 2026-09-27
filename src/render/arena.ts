import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { paletteFor } from "./palette.ts";
import { renderSprite, type PixelImage } from "./sprite.ts";

export const WIDTH = 480;
export const HEIGHT = 270;
/**
 * The scene is drawn at 480×270 into an offscreen buffer, then blown up by an
 * integer factor with nearest-neighbour. The browser only ever *downscales*
 * that large image to fit, which keeps every logical pixel the same size
 * (no uneven 2-px/3-px columns from fractional nearest-neighbour scaling).
 */
const UPSCALE = 4;
const FLOOR_Y = 172;
const GROUND_Y = 222;
const SIDE_X = [132, 348] as const;

export type Side = 0 | 1;

interface Fighter {
  form: Form;
  image: HTMLCanvasElement;
  pixels: PixelImage;
  /** 0..1 materialisation progress. */
  appear: number;
  alpha: number;
  offsetX: number;
  flash: number;
  seed: number;
  aura: Aura;
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
}

interface Projectile {
  from: number;
  to: number;
  t: number;
  duration: number;
  color: string;
  glow: string;
  family: string;
  done: () => void;
}

/** Pixel-art dungeon arena. Owns the render loop; all game logic lives elsewhere. */
export class Arena {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly display: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly background: HTMLCanvasElement;
  private readonly fighters: [Fighter | null, Fighter | null] = [null, null];
  private readonly particles: Particle[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly spriteCache = new Map<string, { image: HTMLCanvasElement; pixels: PixelImage }>();
  private shake = 0;
  private time = 0;
  private last = 0;
  private running = false;
  private readonly rand = rng(1234);

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onto: Ontology,
  ) {
    canvas.width = WIDTH * UPSCALE;
    canvas.height = HEIGHT * UPSCALE;
    const display = canvas.getContext("2d");
    this.buffer = document.createElement("canvas");
    this.buffer.width = WIDTH;
    this.buffer.height = HEIGHT;
    const ctx = this.buffer.getContext("2d");
    if (ctx === null || display === null) throw new Error("Canvas 2D nicht verfügbar");
    ctx.imageSmoothingEnabled = false;
    display.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.display = display;
    this.background = paintBackground();
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
  }

  /** Render a sprite for UI previews (DOM). */
  spriteCanvas(form: Form): HTMLCanvasElement {
    return this.sprite(form).image;
  }

  private sprite(form: Form): { image: HTMLCanvasElement; pixels: PixelImage } {
    const key = `${form.id}@${String(form.scale)}`;
    const cached = this.spriteCache.get(key);
    if (cached !== undefined) return cached;
    const pixels = renderSprite(this.onto, form);
    const image = document.createElement("canvas");
    image.width = pixels.width;
    image.height = pixels.height;
    const ictx = image.getContext("2d");
    if (ictx !== null) ictx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    const entry = { image, pixels };
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
    const { image, pixels } = this.sprite(form);
    this.fighters[side] = {
      form,
      image,
      pixels,
      appear: 0,
      alpha: 1,
      offsetX: 0,
      flash: 0,
      seed: hash32(form.id),
      aura: this.auraFor(form),
    };
    const color = paletteFor(this.onto, form).main[2];
    for (let i = 0; i < 40; i++) {
      this.particles.push({
        x: SIDE_X[side] + (this.rand() - 0.5) * pixels.width,
        y: GROUND_Y,
        vx: (this.rand() - 0.5) * 20,
        vy: -30 - this.rand() * 60,
        life: 0,
        max: 0.6 + this.rand() * 0.6,
        color,
        size: 1,
        gravity: 20,
      });
    }
    return wait(650);
  }

  /** Attacker on `side` strikes the fighter on the other side, which is destroyed. */
  async attack(side: Side, family: string, weaknessHit: boolean): Promise<void> {
    const attacker = this.fighters[side];
    const target = this.fighters[side === 0 ? 1 : 0];
    if (attacker === null) return;
    const pal = paletteFor(this.onto, attacker.form);
    const dir = side === 0 ? 1 : -1;
    // wind-up / lunge
    await this.tween(180, (t) => (attacker.offsetX = -dir * 6 * t));
    await this.tween(120, (t) => (attacker.offsetX = dir * (-6 + 22 * t)));
    await new Promise<void>((done) => {
      this.projectiles.push({
        from: SIDE_X[side] + dir * 20,
        to: SIDE_X[side === 0 ? 1 : 0],
        t: 0,
        duration: family === "gewalt" ? 0.18 : 0.45,
        color: pal.main[2],
        glow: pal.glow,
        family,
        done,
      });
    });
    void this.tween(250, (t) => (attacker.offsetX = dir * 16 * (1 - t)));
    if (target !== null) {
      target.flash = 1;
      this.shake = weaknessHit ? 7 : 4;
      this.burst(SIDE_X[side === 0 ? 1 : 0], GROUND_Y - target.pixels.height / 2, pal.glow, weaknessHit ? 70 : 40);
      await wait(260);
      this.disintegrate(side === 0 ? 1 : 0);
      await wait(700);
      this.fighters[side === 0 ? 1 : 0] = null;
    }
  }

  private disintegrate(side: Side): void {
    const f = this.fighters[side];
    if (f === null) return;
    const { width, height, data } = f.pixels;
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
        });
      }
    }
    f.alpha = 0;
  }

  private burst(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 30 + this.rand() * 120;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.3 + this.rand() * 0.5, color, size: this.rand() < 0.3 ? 2 : 1, gravity: 40 });
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
    for (const [side, f] of this.fighters.entries()) {
      if (f === null) continue;
      f.appear = Math.min(1, f.appear + dt * 1.8);
      f.flash = Math.max(0, f.flash - dt * 3);
      if (f.alpha > 0 && f.aura.kind !== "none" && this.rand() < dt * 18) this.emitAura(side as Side, f);
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
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr === undefined) continue;
      pr.t += dt / pr.duration;
      const x = pr.from + (pr.to - pr.from) * Math.min(1, pr.t);
      const y = GROUND_Y - 40 - Math.sin(Math.min(1, pr.t) * Math.PI) * (pr.family === "kosmos" ? 40 : 14);
      for (let k = 0; k < 3; k++) {
        this.particles.push({ x, y: y + (this.rand() - 0.5) * 6, vx: (this.rand() - 0.5) * 30, vy: (this.rand() - 0.5) * 30, life: 0, max: 0.25 + this.rand() * 0.3, color: this.rand() < 0.5 ? pr.color : pr.glow, size: 1 + Math.floor(this.rand() * 2), gravity: 0 });
      }
      if (pr.t >= 1) {
        this.projectiles.splice(i, 1);
        pr.done();
      }
    }
  }

  private emitAura(side: Side, f: Fighter): void {
    const w = f.pixels.width;
    const h = f.pixels.height;
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
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    const sx = Math.round((this.rand() - 0.5) * this.shake);
    const sy = Math.round((this.rand() - 0.5) * this.shake);
    ctx.translate(sx, sy);
    ctx.drawImage(this.background, 0, 0);
    this.drawTorches();
    this.drawRune();
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawFighter(side as Side, f);
    for (const p of this.particles) {
      const fade = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.display.drawImage(this.buffer, 0, 0, WIDTH * UPSCALE, HEIGHT * UPSCALE);
  }

  private drawFighter(side: Side, f: Fighter): void {
    if (f.alpha <= 0) return;
    const ctx = this.ctx;
    const { width, height } = f.pixels;
    const flying = this.onto.formHas(f.form, "fliegt") || f.form.archetype === "star" || f.form.archetype === "orb" || f.form.archetype === "ghost";
    const bob = Math.round(Math.sin(this.time * (flying ? 2.2 : 1.6) + (f.seed % 7)) * (flying ? 3 : 1));
    const lift = flying ? 10 : 0;
    const x = Math.round(SIDE_X[side] - width / 2 + f.offsetX);
    const y = Math.round(GROUND_Y - height - lift + bob);
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    const shw = Math.round(width * 0.4);
    ctx.fillRect(SIDE_X[side] - shw + Math.round(f.offsetX), GROUND_Y - 1, shw * 2, 3);
    // materialise: reveal rows from bottom
    const visible = Math.ceil(height * easeOut(f.appear));
    ctx.save();
    if (side === 1) {
      ctx.translate(x + width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(f.image, 0, height - visible, width, visible, 0, y + height - visible, width, visible);
    } else {
      ctx.drawImage(f.image, 0, height - visible, width, visible, x, y + height - visible, width, visible);
    }
    ctx.restore();
    if (f.flash > 0) {
      ctx.globalAlpha = f.flash;
      ctx.globalCompositeOperation = "lighter";
      ctx.save();
      if (side === 1) {
        ctx.translate(x + width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(f.image, 0, y);
      } else ctx.drawImage(f.image, x, y);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  private drawTorches(): void {
    const ctx = this.ctx;
    for (const tx of [36, 444]) {
      const flick = Math.sin(this.time * 17 + tx) * 0.5 + Math.sin(this.time * 7.3 + tx * 2) * 0.5;
      const r = 46 + flick * 4;
      const g = ctx.createRadialGradient(tx, 84, 2, tx, 84, r);
      g.addColorStop(0, "rgba(255,170,70,0.35)");
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(tx - r, 84 - r, r * 2, r * 2);
      // flame pixels
      const h = 7 + Math.round(flick * 2);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((h - i) * 0.6));
        ctx.fillStyle = i < 2 ? "#fff3a0" : i < 4 ? "#ffb040" : "#e8641c";
        ctx.fillRect(tx - Math.floor(w / 2) + Math.round(Math.sin(this.time * 9 + i) * (i / 4)), 86 - i, w, 1);
      }
      if (this.rand() < 0.15) {
        this.particles.push({ x: tx, y: 80, vx: (this.rand() - 0.5) * 8, vy: -20, life: 0, max: 0.8, color: "#ffb040", size: 1, gravity: -5 });
      }
    }
  }

  private drawRune(): void {
    const ctx = this.ctx;
    const pulse = 0.25 + Math.sin(this.time * 1.5) * 0.08;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#8a62b0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(240, 226, 150, 22, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(240, 226, 138, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
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
