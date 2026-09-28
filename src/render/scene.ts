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
import type { Pen, Pt } from "./pen.ts";
import { HEIGHT, TORCH_X, TORCH_Y, WIDTH } from "./stage.ts";

/** Bat frames (9×4): dark silhouettes; `o` = glowing eye. */
const BAT_UP = ["++.....++", ".#+...+#.", "..##o##..", "...#.#..."];
const BAT_DOWN = ["...#.#...", "..##o##..", ".#+...+#.", "++.....++"];
/** Rat facing right (7×3): body, lighter back, snout, eye. */
const RAT = [".+++...", "#####s,", "#.#.#.."];
const RAINBOW = ["#ff5a5a", "#ffa040", "#ffe060", "#70e060", "#60a0ff", "#9a6aff"];

export abstract class ArenaScene extends ArenaSim {
  /** Everything behind the fighters. */
  protected drawBack(base: Pen, glow: Pen): void {
    this.drawLights(base);
    this.drawStars(glow);
    this.drawFieldFloor(base);
    this.drawEyes(base, glow);
    this.drawTorchFlames(base, glow);
    this.stage.drawProps?.((x, y, w, h, color) => {
      base.rect(x, y, w, h, color);
    }, this.reducedMotion ? 0 : this.time);
    this.drawCritters(base, glow);
    this.drawMotes(base);
    this.drawDrops(base, glow);
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

  /** Soft things on the ground: torchlight, mist, light pools and shadows under the fighters. */
  private drawLights(base: Pen): void {
    for (const tx of TORCH_X) {
      const r = 50 + this.flicker(tx) * 4;
      base.light(tx, TORCH_Y, r, r, "#ffaa46", 0.32);
      // and a warm patch on the floor below
      base.light(tx, this.stage.floorTop(tx) + 8, r * 0.8, r * 0.22, "#ffaa46", 0.1);
    }
    if (this.stage.fog) this.drawFog(base);
    for (const [side, f] of this.fighters.entries()) {
      if (f === null || f.alpha <= 0) continue;
      const w = f.sprite.pixels.width;
      const x = SIDE_X[side as Side] + f.offsetX;
      const gy = this.gy(side as Side);
      base.light(x, gy, w * 0.9, w * 0.9 * 0.35, f.sprite.palette.glow, (f.sprite.palette.emissive ? 0.35 : 0.12) * f.appear);
      // what glows lights up the wall behind it
      if (f.sprite.palette.emissive) base.light(x, this.stage.floorTop(x) - 26, w * 0.9, 44, f.sprite.palette.glow, 0.13 * f.appear * f.reveal * f.alpha);
      // contact shadow: smaller and fainter under whatever hovers
      const k = f.flying ? 0.7 : 1;
      base.light(x, gy + 1, w * 0.5 * k, (w * 0.12 + 3) * k, "#000000", 0.6 * k * f.alpha * f.appear * f.squash);
    }
  }

  /** Low mist drifting across the floor – a few wide, faint banks at their own pace. */
  private drawFog(base: Pen): void {
    for (let i = 0; i < 7; i++) {
      const speed = this.reducedMotion ? 0 : 3 + (i % 3) * 2;
      const x = ((i * 97 + this.time * speed) % 620) - 70;
      const y = 176 + ((i * 37) % 84);
      const a = 0.09 + 0.04 * Math.sin(this.time * 0.3 + i);
      base.light(x, y, 60 + ((i * 13) % 30), 9 + (i % 4) * 2, "#3c3354", a);
    }
  }

  /** Bats (two wing frames, glowing eyes) and the rat. */
  private drawCritters(base: Pen, glow: Pen): void {
    for (const b of this.bats) {
      const up = Math.floor(this.time * 12 + b.phase) % 2 === 0;
      const frame = up ? BAT_UP : BAT_DOWN;
      const x0 = Math.round(b.x) - 4;
      const y0 = Math.round(b.y) - 2;
      for (const [j, row] of frame.entries()) {
        for (const [i, ch] of Array.from(row).entries()) {
          if (ch === "#") base.rect(x0 + i, y0 + j, 1, 1, "#150f1e");
          else if (ch === "+") base.rect(x0 + i, y0 + j, 1, 1, "#5a4a70");
          else if (ch === "o") {
            base.rect(x0 + i, y0 + j, 1, 1, "#ff5a3c");
            glow.rect(x0 + i, y0 + j, 1, 1, "#ff5a3c", 0.9);
          }
        }
      }
    }
    const rat = this.rat;
    if (rat !== null) {
      const x = Math.round(rat.x);
      const y = this.stage.floorTop(x) + 3;
      const d = rat.dir;
      const colors: Readonly<Record<string, string>> = { "#": "#6a5e6a", "+": "#8a7e8a", s: "#a89aa6", ",": "#ff9a6a" };
      for (const [j, row] of RAT.entries()) {
        for (const [i, ch] of Array.from(row).entries()) {
          const color = colors[ch];
          // legs trot while it runs
          if (color === undefined || (j === 2 && rat.pause <= 0 && Math.floor(this.time * 18 + i) % 2 === 0)) continue;
          base.rect(d > 0 ? x - 6 + i : x + 6 - i, y + j, 1, 1, color);
        }
      }
      // tail
      for (let k = 1; k <= 5; k++) base.rect(d > 0 ? x - 6 - k : x + 6 + k, y + 1 + (k > 3 ? 1 : 0), 1, 1, "#6a5058");
    }
  }

  private drawDrops(base: Pen, glow: Pen): void {
    for (const d of this.drops) {
      base.rect(d.x, Math.round(d.y), 1, 2, "#9fd8f0", 0.8);
      glow.rect(d.x, Math.round(d.y), 1, 2, "#9fd8f0", 0.35);
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

  /** Puddle shimmer, frost rim – on the floor (whatever its shape), before the fighters. */
  private drawFieldFloor(base: Pen): void {
    const st = this.stage;
    const top = Math.min(st.floorTop(0), st.floorTop(WIDTH / 2), st.floorTop(WIDTH));
    const nass = this.field("nass");
    if (nass > 0.01) {
      for (let y = top + 6; y < HEIGHT; y += 5) {
        const off = Math.round(Math.sin(this.time * 1.7 + y * 0.4) * 6);
        // in 16-px pieces, only where there is floor
        for (let x = 40; x < WIDTH - 40; x += 16) if (y >= st.floorTop(x + 8) + 3) base.rect(x + off, y, 16, 1, "#3f8fc9", 0.18 * nass);
      }
    }
    const frost = this.field("frost");
    if (frost > 0.01) {
      // rime creeping in from the edges of the floor, sparse in the middle
      for (let i = 0; i < 420; i++) {
        const x = (i * 7919) % WIDTH;
        const y = top + ((i * 104729) % (HEIGHT - top));
        if (y < st.floorTop(x) + 1) continue;
        const edge = st.floorEdge(x, y);
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
      if (f !== null && f.sprite.palette.emissive && f.reveal > 0.5) lights.push({ x: SIDE_X[side as Side], y: this.gy(side as Side) - f.sprite.pixels.height / 2, r: 60 });
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

  /** The rune circle on the floor – it charges while Claude is thinking and flares while a picture is conjured. */
  private drawRune(base: Pen, glow: Pen): void {
    const c = this.conjure;
    const pulse = Math.min(1, 0.22 + Math.sin(this.time * 1.5) * 0.06 + this.thinking * 0.5 + c * 0.55 + this.conjureBurst * 0.6);
    const spin = this.time * (0.3 + this.thinking * 2.5 + c * 1.2);
    const color = this.conjureBurst > 0.05 ? "#fff0d0" : c > 0.2 ? "#dcb8ff" : this.thinking > 0.2 ? "#c8a0ff" : "#8a62b0";
    const { cx, cy, outer, inner, orbit } = this.stage.rune;
    if (c > 0.05 || this.conjureBurst > 0) glow.light(cx, cy, outer[0] * 1.3, outer[1] * 1.3, "#b070ff", 0.18 * c + 0.4 * this.conjureBurst);
    for (const [pen, a] of [[base, pulse], [glow, pulse * 0.8]] as const) {
      pen.ring(cx, cy, outer[0], outer[1], color, a);
      pen.ring(cx, cy, inner[0], inner[1], color, a);
      for (let i = 0; i < 12; i++) {
        const ang = spin + (i / 12) * Math.PI * 2;
        pen.rect(Math.round(cx + Math.cos(ang) * orbit[0]), Math.round(cy + Math.sin(ang) * orbit[1]), 2, 1, color, a);
      }
    }
    if (c > 0.02 || this.conjureBurst > 0) this.drawPentagram(base, glow, Math.max(c, this.conjureBurst));
  }

  /**
   * "Beschwörung": a five-pointed star traces itself into the inner ring, then turns slowly;
   * a rune flickers at every point. Drawn on the floor ellipse, so it lies flat in the room.
   */
  private drawPentagram(base: Pen, glow: Pen, strength: number): void {
    const { cx, cy, inner } = this.stage.rune;
    const turn = this.reducedMotion ? 0 : this.time * 0.35;
    const points = Array.from({ length: 5 }, (_, k): Pt => {
      const ang = turn + (k / 5) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(ang) * inner[0] * 0.92, cy + Math.sin(ang) * inner[1] * 0.92];
    });
    // star order 0 → 2 → 4 → 1 → 3 → 0, traced in over ~1.4 s
    const centre: Pt = [cx, cy];
    const order = [0, 2, 4, 1, 3, 0].map((i): Pt => points[i] ?? centre);
    const traced = this.reducedMotion ? 1 : Math.min(1, this.conjureAge / 1.4 + (this.conjureBurst > 0 ? 1 : 0));
    const path = partialPath(order, traced);
    const burst = this.conjureBurst;
    const color = burst > 0.05 ? "#fff4dc" : "#e0c0ff";
    const shimmer = 0.75 + Math.sin(this.time * 6) * 0.15;
    for (const [pen, a] of [[base, 0.85 * strength * shimmer], [glow, strength * shimmer]] as const) {
      pen.line(path.map(([x, y]): Pt => [Math.round(x) + 0.5, Math.round(y) + 0.5]), color, a);
    }
    // runes at the points – each its own glyph, flickering out of phase
    for (const [k, [px, py]] of points.entries()) {
      if (traced < (k + 1) / 5) continue;
      const glyph = RUNES[k % RUNES.length] ?? [];
      const flicker = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 3.1 + k * 1.7));
      const a = Math.min(1, strength * flicker + burst);
      const gx = Math.round(px) - 2;
      const gy = Math.round(py) - 6;
      for (const [j, row] of glyph.entries()) {
        for (const [i, ch] of Array.from(row).entries()) {
          if (ch !== "#") continue;
          base.rect(gx + i, gy + j, 1, 1, burst > 0.05 ? "#fff4dc" : "#f0dcff", a);
          glow.rect(gx + i, gy + j, 1, 1, "#d8a8ff", a);
        }
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

/** Five small runes for the pentagram's points (5×5, "#" = lit). */
const RUNES: readonly (readonly string[])[] = [
  ["..#..", ".###.", "..#..", ".#.#.", "#...#"],
  ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  ["###..", "#..#.", "###..", "#.#..", "#..#."],
  ["..#..", ".#.#.", "#...#", ".#.#.", "..#.."],
  ["#.#.#", "#.#.#", ".###.", "..#..", "..#.."],
];

/** The first `t` (0..1) of a polyline, by length. */
function partialPath(points: readonly Pt[], t: number): Pt[] {
  if (t >= 1 || points.length < 2) return [...points];
  const segs = points.slice(1).map((p, i) => {
    const q = points[i] ?? p;
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  });
  let left = segs.reduce((a, b) => a + b, 0) * Math.max(0, t);
  const out: Pt[] = [points[0] ?? [0, 0]];
  for (const [i, len] of segs.entries()) {
    const a = points[i] ?? [0, 0];
    const b = points[i + 1] ?? a;
    if (left >= len) {
      out.push(b);
      left -= len;
      continue;
    }
    const f = len === 0 ? 0 : left / len;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    break;
  }
  return out;
}
