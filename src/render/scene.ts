/**
 * What the arena shows around the fighters – written once, drawn by any renderer.
 *
 *   ArenaSim   (arena.ts)  state and motion
 *   ArenaScene (here)      back layer (lights, stars, floor fields, eyes, torches, dust, rune)
 *                          and front layer (discovery star, bolts, rings, particles, overlays),
 *                          each on a base pen and an emissive glow pen
 *   renderers              pens, fighters and compositing (canvas-arena.ts, pixi-arena.ts)
 */
import { ArenaSim, GROUND_Y, SIDE_X, type Side } from "./arena.ts";
import type { Pen } from "./pen.ts";
import { FLOOR_Y, HEIGHT, TORCH_X, TORCH_Y, WIDTH } from "./stage.ts";

const RAINBOW = ["#ff5a5a", "#ffa040", "#ffe060", "#70e060", "#60a0ff", "#9a6aff"];

export abstract class ArenaScene extends ArenaSim {
  /** Everything behind the fighters. */
  protected drawBack(base: Pen, glow: Pen): void {
    this.drawLights(base);
    this.drawStars(glow);
    this.drawFieldFloor(base);
    this.drawEyes(base, glow);
    this.drawTorchFlames(base, glow);
    this.drawMotes(base);
    this.drawRainbow(base, glow);
    this.drawRune(base, glow);
  }

  /** Everything in front of the fighters. */
  protected drawFront(base: Pen, glow: Pen): void {
    this.drawDiscoveryStar(base, glow);
    for (const bolt of this.bolts) {
      const a = Math.max(0, 1 - bolt.life / bolt.max) * (Math.floor(bolt.life * 30) % 2 === 0 ? 1 : 0.6);
      const pts = bolt.points.map(([x, y]) => [Math.round(x) + 0.5, Math.round(y) + 0.5] as const);
      for (const pen of [base, glow]) pen.line(pts, bolt.color, a);
    }
    for (const r of this.rings) {
      if (r.life < 0) continue;
      const a = Math.max(0, 1 - r.life / r.max);
      for (const pen of [base, glow]) pen.ring(Math.round(r.x), Math.round(r.y), r.r, r.r * 0.35, r.color, a);
    }
    for (const p of this.particles) {
      if (p.life < 0) continue;
      const fade = Math.max(0, 1 - p.life / p.max);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      base.rect(x, y, p.size, p.size, p.color, fade);
      if (p.glow) glow.rect(x, y, p.size, p.size, p.color, fade);
    }
    this.drawFieldOverlay(base);
  }

  /** Torchlight on the walls and a pool of light under every fighter. */
  private drawLights(base: Pen): void {
    for (const tx of TORCH_X) {
      const r = 50 + this.flicker(tx) * 4;
      base.light(tx, TORCH_Y, r, r, "#ffaa46", 0.32);
    }
    for (const [side, f] of this.fighters.entries()) {
      if (f === null || f.alpha <= 0) continue;
      const r = f.sprite.pixels.width * 0.9;
      base.light(SIDE_X[side as Side] + f.offsetX, GROUND_Y, r, r * 0.35, f.sprite.palette.glow, (f.sprite.palette.emissive ? 0.35 : 0.12) * f.appear);
    }
  }

  protected flicker(tx: number): number {
    return this.reducedMotion ? 0 : Math.sin(this.time * 17 + tx) * 0.5 + Math.sin(this.time * 7.3 + tx * 2) * 0.5;
  }

  private drawStars(glow: Pen): void {
    if (this.openBricks === 0) return;
    for (const st of this.stars) {
      if (this.open[st.brick] !== 1) continue;
      const tw = this.reducedMotion ? 0.6 : 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 1.3 + st.phase));
      glow.rect(st.x, st.y, 1, 1, st.color, tw);
    }
  }

  /** Puddle shimmer, frost rim – on the floor, before the fighters. */
  private drawFieldFloor(base: Pen): void {
    const nass = this.field("nass");
    if (nass > 0.01) {
      for (let y = FLOOR_Y + 6; y < HEIGHT; y += 5) {
        const off = Math.round(Math.sin(this.time * 1.7 + y * 0.4) * 6);
        base.rect(40 + off, y, WIDTH - 80, 1, "#3f8fc9", 0.18 * nass);
      }
    }
    const frost = this.field("frost");
    if (frost > 0.01) {
      // rime creeping in from the edges of the floor, sparse in the middle
      for (let i = 0; i < 420; i++) {
        const x = (i * 7919) % WIDTH;
        const y = FLOOR_Y + ((i * 104729) % (HEIGHT - FLOOR_Y));
        const edge = Math.min(x, WIDTH - x) / (WIDTH / 2);
        if (edge > 0.25 + 0.75 * frost * ((i % 7) / 7)) continue;
        base.rect(x, y, 1 + (i % 3 === 0 ? 1 : 0), 1, "#dff4ff", 0.5 * frost * (1 - edge));
      }
    }
  }

  /** Darkness, dust haze and silence over everything. */
  private drawFieldOverlay(base: Pen): void {
    const cover = (color: string, a: number): void => {
      if (a > 0.004) base.rect(-10, -10, WIDTH + 20, HEIGHT + 20, color, a);
    };
    cover("#020106", 0.45 * this.field("finsternis"));
    cover("#6a5a44", 0.12 * this.field("staub"));
    cover("#1a2030", 0.15 * this.field("stille"));
  }

  /** Pairs of eyes in the dark, blinking, looking at whoever arrived last. */
  private drawEyes(base: Pen, glow: Pen): void {
    for (let i = 0; i < this.witnesses; i++) {
      const e = this.eyes[i];
      if (e === undefined) continue;
      const cycle = (this.time + e.phase) % (4 + (i % 3));
      if (cycle < 0.14) continue;
      const fadeIn = Math.min(1, cycle / 1.5);
      const look = this.fighters[this.lookSide()] === null ? 0 : this.lookSide() === 0 ? -1 : 1;
      for (const [pen, a] of [[base, 0.8], [glow, 0.45]] as const) {
        pen.rect(e.x + look, e.y, 1, 1, e.color, a * fadeIn);
        pen.rect(e.x + 4 + look, e.y, 1, 1, e.color, a * fadeIn);
      }
    }
  }

  private drawTorchFlames(base: Pen, glow: Pen): void {
    for (const tx of TORCH_X) {
      const h = 7 + Math.round(this.flicker(tx) * 2);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((h - i) * 0.6));
        const color = i < 2 ? "#fff3a0" : i < 4 ? "#ffb040" : "#e8641c";
        const fx = tx - Math.floor(w / 2) + Math.round(Math.sin(this.time * 9 + i) * (i / 4));
        for (const pen of [base, glow]) pen.rect(fx, TORCH_Y + 2 - i, w, 1, color);
      }
    }
  }

  /** Dust in the air – only visible where light falls on it. */
  private drawMotes(base: Pen): void {
    const lights: { x: number; y: number; r: number }[] = TORCH_X.map((x) => ({ x, y: TORCH_Y, r: 70 }));
    for (const [side, f] of this.fighters.entries()) {
      if (f !== null && f.sprite.palette.emissive && f.reveal > 0.5) lights.push({ x: SIDE_X[side as Side], y: GROUND_Y - f.sprite.pixels.height / 2, r: 60 });
    }
    for (const m of this.motes) {
      let lit = 0;
      for (const l of lights) {
        const d = Math.hypot(m.x - l.x, (m.y - l.y) * 1.3);
        if (d < l.r) lit = Math.max(lit, 1 - d / l.r);
      }
      if (lit > 0.05) base.rect(Math.round(m.x), Math.round(m.y), 1, 1, "#ffd9a0", lit * (0.4 + 0.3 * Math.sin(m.phase * 2)));
    }
  }

  private drawRainbow(base: Pen, glow: Pen): void {
    if (this.rainbow <= 0.01) return;
    for (const [pen, k] of [[base, 0.8], [glow, 0.5]] as const) {
      const a = Math.min(1, this.rainbow * 1.5) * k;
      for (const [i, c] of RAINBOW.entries()) {
        const rx = 190 - i * 2;
        const ry = 150 - i * 2;
        const arc = Array.from({ length: 49 }, (_, s) => {
          const t = Math.PI + (s / 48) * Math.PI;
          return [240 + Math.cos(t) * rx, GROUND_Y + Math.sin(t) * ry] as const;
        });
        pen.line(arc, c, a, 2);
      }
    }
  }

  /** The rune circle on the floor – it charges while Claude is thinking. */
  private drawRune(base: Pen, glow: Pen): void {
    const pulse = 0.22 + Math.sin(this.time * 1.5) * 0.06 + this.thinking * 0.5;
    const spin = this.time * (0.3 + this.thinking * 2.5);
    const color = this.thinking > 0.2 ? "#c8a0ff" : "#8a62b0";
    const { cx, cy, outer, inner, orbit } = this.stage.rune;
    for (const [pen, a] of [[base, pulse], [glow, pulse * 0.8]] as const) {
      pen.ring(cx, cy, outer[0], outer[1], color, a);
      pen.ring(cx, cy, inner[0], inner[1], color, a);
      for (let i = 0; i < 12; i++) {
        const ang = spin + (i / 12) * Math.PI * 2;
        pen.rect(Math.round(cx + Math.cos(ang) * orbit[0]), Math.round(cy + Math.sin(ang) * orbit[1]), 2, 1, color, a);
      }
    }
  }

  private drawDiscoveryStar(base: Pen, glow: Pen): void {
    const d = this.discoveryGlow;
    const f = d === null ? null : this.fighters[d.side];
    if (d === null || f === null) return;
    const { x, y, w } = this.fighterRect(d.side, f);
    const cx = x + Math.floor(w / 2);
    const cy = y - 12 + Math.round(Math.sin(this.time * 2) * 2);
    const a = Math.min(1, d.life * 3) * Math.min(1, (3.2 - d.life) / 0.8);
    const arm = 3 + Math.round(Math.sin(this.time * 5) + 1);
    for (const pen of [base, glow]) {
      pen.rect(cx, cy - arm, 1, arm * 2 + 1, "#fff4c8", a);
      pen.rect(cx - arm, cy, arm * 2 + 1, 1, "#fff4c8", a);
      pen.rect(cx - 1, cy - 1, 3, 3, "#ffd86a", a);
    }
  }
}
