/**
 * The original 2D-canvas renderer – kept as the fallback where WebGL is missing (and via
 * `?canvas`). Draws the simulation of {@link ArenaSim} exactly as before the PixiJS port.
 *
 *   base   (480×270)  background, light pools, fighters, particles
 *   glow   (480×270)  emissive only: torches, eyes, fire bodies, sparks, projectiles, runes
 *   bloom  glow → 240×135 (blur) and 120×68 (blur), upscaled bilinear, added with "lighter"
 *   display (1920×1080) = base ×4 nearest + bloom + impact flash
 */
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { StageLayout } from "./stage.ts";
import { ArenaSim, canvas, ctx2d, easeOut, FLOOR_Y, GROUND_Y, HEIGHT, hexA, SIDE_X, TORCH_X, UPSCALE, WIDTH, type Fighter, type Side } from "./arena.ts";

export class CanvasArena extends ArenaSim {
  private readonly display: CanvasRenderingContext2D;
  private readonly base: CanvasRenderingContext2D;
  private readonly glow: CanvasRenderingContext2D;
  private readonly bloomNear: CanvasRenderingContext2D;
  private readonly bloomFar: CanvasRenderingContext2D;

  constructor(target: HTMLCanvasElement, onto: Ontology, stage?: StageLayout) {
    super(onto, stage);
    target.width = WIDTH * UPSCALE;
    target.height = HEIGHT * UPSCALE;
    this.display = ctx2d(target);
    this.base = ctx2d(canvas(WIDTH, HEIGHT));
    this.glow = ctx2d(canvas(WIDTH, HEIGHT));
    this.bloomNear = ctx2d(canvas(WIDTH / 2, HEIGHT / 2));
    this.bloomFar = ctx2d(canvas(WIDTH / 4, Math.ceil(HEIGHT / 4)));
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

  protected render(): void {
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

  private drawLightPool(side: Side, f: Fighter): void {
    if (f.alpha <= 0) return;
    const strength = (f.sprite.palette.emissive ? 0.35 : 0.12) * f.appear;
    const ctx = this.base;
    const cx = SIDE_X[side] + f.offsetX;
    const r = f.sprite.pixels.width * 0.9;
    // an elliptical pool on the floor (a circle squashed to the floor's perspective)
    ctx.save();
    ctx.translate(cx, GROUND_Y);
    ctx.scale(1, 0.35);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
    grad.addColorStop(0, hexA(f.sprite.palette.glow, strength));
    grad.addColorStop(1, hexA(f.sprite.palette.glow, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
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
      const { cx, cy, outer, inner, orbit } = this.stage.rune;
      ctx.ellipse(cx, cy, outer[0], outer[1], 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, inner[0], inner[1], 0, 0, Math.PI * 2);
      ctx.stroke();
      // runes: small marks orbiting between the two rings
      ctx.fillStyle = ctx.strokeStyle;
      for (let i = 0; i < 12; i++) {
        const a = spin + (i / 12) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * orbit[0]), Math.round(cy + Math.sin(a) * orbit[1]), 2, 1);
      }
      ctx.globalAlpha = 1;
    }
  }
}
