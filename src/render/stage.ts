/**
 * The arena's scenery ("Bühnenbild"): backdrop, the wall bricks that crumble into the void as
 * the duel escalates, and the floor geometry the rune circle sits on. Pure painting – the
 * simulation and both renderers only read it.
 *
 *   flat  the original straight-on dungeon wall (`?flat`)
 *   iso   an isometric dungeon room: two walls meeting in a corner pillar, diamond floor tiles
 */
import { rng } from "../engine/text.ts";

export const WIDTH = 480;
export const HEIGHT = 270;
export const FLOOR_Y = 172;
export const GROUND_Y = 222;
export const TORCH_X = [36, 444] as const;
export const TORCH_Y = 84;

export interface Brick {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 0..1 – the brick opens to the void once the cosmic factor passes this. */
  readonly threshold: number;
  /** Slanted (iso) bricks: 1-px columns [x, yTop, yBottom) – otherwise the rectangle is the brick. */
  readonly cols?: readonly (readonly [number, number, number])[];
}

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly brick: number;
  readonly phase: number;
  readonly color: string;
}

/** Rune circle on the floor: outer and inner ring, the orbit of its marks. */
export interface Rune {
  readonly cx: number;
  readonly cy: number;
  readonly outer: readonly [number, number];
  readonly inner: readonly [number, number];
  readonly orbit: readonly [number, number];
}

export interface StageLayout {
  readonly name: "flat" | "iso";
  paintBackground(): HTMLCanvasElement;
  wallBricks(): Brick[];
  readonly rune: Rune;
}

function newCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  return c;
}

/** Copy the void behind every open brick onto the backdrop. */
export function openBricks(ctx: CanvasRenderingContext2D, starfield: HTMLCanvasElement, br: Brick): void {
  if (br.cols === undefined) {
    ctx.drawImage(starfield, br.x, br.y, br.w, br.h, br.x, br.y, br.w, br.h);
    return;
  }
  for (const [x, y0, y1] of br.cols) if (y1 > y0) ctx.drawImage(starfield, x, y0, 1, y1 - y0, x, y0, 1, y1 - y0);
}

// ── flat ──────────────────────────────────────────────────────────────────

/** Procedural dungeon backdrop, painted once. */
function paintFlat(): HTMLCanvasElement {
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
function flatBricks(): Brick[] {
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
export function paintStarfield(): HTMLCanvasElement {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  if (ctx === null) return c;
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

export function scatterStars(bricks: readonly Brick[]): Star[] {
  const r = rng(31);
  const colors = ["#ffffff", "#c8d8ff", "#ffe8c8", "#c8a0ff"];
  const out: Star[] = [];
  for (const [i, br] of bricks.entries()) {
    const n = r() < 0.5 ? 1 : r() < 0.5 ? 2 : 0;
    for (let k = 0; k < n; k++) {
      const color = colors[Math.floor(r() * colors.length)] ?? "#ffffff";
      const phase = r() * 20;
      const col = br.cols?.[1 + Math.floor(r() * Math.max(1, br.cols.length - 2))];
      if (br.cols !== undefined) {
        if (col === undefined || col[2] - col[1] < 3) continue;
        out.push({ x: col[0], y: col[1] + 1 + Math.floor(r() * (col[2] - col[1] - 2)), brick: i, phase, color });
      } else out.push({ x: br.x + 1 + Math.floor(r() * (br.w - 2)), y: br.y + 1 + Math.floor(r() * (br.h - 2)), brick: i, phase, color });
    }
  }
  return out;
}

export const FLAT: StageLayout = {
  name: "flat",
  paintBackground: paintFlat,
  wallBricks: flatBricks,
  rune: { cx: 240, cy: 226, outer: [150, 22], inner: [138, 18], orbit: [144, 20] },
};

// ── isometric ─────────────────────────────────────────────────────────────

/** Where the walls meet the floor: the left wall rises to the corner, the right one falls away. */
const CORNER_X = 240;
const CORNER_Y = 120;
const WALL_H = 170;

function isoFloorY(x: number): number {
  return Math.round(CORNER_Y + Math.abs(x - CORNER_X) * 0.5);
}

const BRICK_W = 24;
const BRICK_H = 10;
const PILLAR = [CORNER_X - 13, CORNER_X + 13] as const;

/** One wall brick as pixel columns (u = along the wall, v = height above the floor line). */
function isoBrickCols(u0: number, u1: number, v0: number, v1: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = Math.max(0, u0); x < Math.min(WIDTH, u1); x++) {
    const base = isoFloorY(x);
    const top = Math.max(base - WALL_H, base - v1);
    const bottom = base - v0;
    if (bottom > top) out.push([x, top, bottom]);
  }
  return out;
}

function isoBrickGrid(): { cols: [number, number, number][]; row: number; right: boolean; u0: number }[] {
  const out: { cols: [number, number, number][]; row: number; right: boolean; u0: number }[] = [];
  for (const right of [false, true]) {
    for (let row = 0; row * BRICK_H < WALL_H; row++) {
      const off = row % 2 === 0 ? 0 : BRICK_W / 2;
      for (let k = -1; k * BRICK_W < CORNER_X + BRICK_W; k++) {
        const a = k * BRICK_W + off;
        // left wall runs 0 → corner, right wall corner → 480 (mirrored grid)
        const u0 = right ? CORNER_X + a : CORNER_X - a - BRICK_W;
        const u1 = u0 + BRICK_W;
        const lo = right ? Math.max(u0, CORNER_X) : u0;
        const hi = right ? u1 : Math.min(u1, CORNER_X);
        if (hi - lo < 3) continue;
        out.push({ cols: isoBrickCols(lo, hi, row * BRICK_H, (row + 1) * BRICK_H), row, right, u0: lo });
      }
    }
  }
  return out;
}

function paintIso(): HTMLCanvasElement {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  if (ctx === null) return c;
  const rand = rng(99);
  const px = (x: number, y: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // darkness above the walls (the vault is lost in shadow)
  px(0, 0, WIDTH, HEIGHT, "#0b0812");
  // walls: mortar, then bricks; the right wall lies in shadow
  const left = ["#2a2438", "#2e2740", "#262033", "#302a44"];
  const right = ["#211c2e", "#241f33", "#1e192a", "#262137"];
  for (let x = 0; x < WIDTH; x++) {
    const base = isoFloorY(x);
    px(x, base - WALL_H, 1, WALL_H, x < CORNER_X ? "#15111f" : "#110e1a");
  }
  for (const b of isoBrickGrid()) {
    const pal = b.right ? right : left;
    const col = pal[Math.floor(rand() * pal.length)] ?? "#2a2438";
    const moss = rand() < 0.07;
    const crack = rand() < 0.12 ? 3 + Math.floor(rand() * 14) : -1;
    for (const [i, [x, y0, y1]] of b.cols.entries()) {
      if (i === 0 || i === b.cols.length - 1) continue; // mortar between bricks
      if (y1 - y0 < 3) continue;
      px(x, y0 + 1, 1, y1 - y0 - 2, col);
      px(x, y0 + 1, 1, 1, b.right ? "#2e2842" : "#3a3352");
      px(x, y1 - 2, 1, 1, "#1c1728");
      if (i === crack) px(x, y0 + 3, 1, 2, "#1c1728");
      if (moss && i > 2 && i < 8) px(x, y1 - 3, 1, 2, "#243a2a");
    }
  }
  // wall darkens upwards (dithered), stronger on the right wall
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let x = 0; x < WIDTH; x++) {
    const base = isoFloorY(x);
    for (let y = Math.max(0, base - WALL_H); y < base; y++) {
      const up = (base - y) / WALL_H;
      const shade = Math.max(0, up - 0.35) * (x < CORNER_X ? 1.1 : 1.35);
      const b = bayer[(y % 4) * 4 + (x % 4)] ?? 0;
      if (b / 16 < shade * 0.8) px(x, y, 1, 1, "rgba(8,6,14,0.55)");
    }
  }
  // floor: diamond tiles (2:1), a little lighter where the duel happens
  const tileA = "#1d1729";
  const tileB = "#1a1425";
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (y < isoFloorY(x)) continue;
      const a = (x - CORNER_X) / 32 + (y - CORNER_Y) / 16;
      const b = (y - CORNER_Y) / 16 - (x - CORNER_X) / 32;
      const fa = a - Math.floor(a);
      const fb = b - Math.floor(b);
      const edge = fa < 0.06 || fb < 0.06;
      let col = edge ? "#261f36" : (Math.floor(a) + Math.floor(b)) % 2 === 0 ? tileA : tileB;
      if (!edge && ((x * 7 + y * 13) % 29 === 0)) col = "#231c32";
      px(x, y, 1, 1, col);
    }
  }
  // skirting where wall meets floor
  for (let x = 0; x < WIDTH; x++) {
    const base = isoFloorY(x);
    px(x, base, 1, 2, "#0e0b16");
    px(x, base - 3, 1, 3, x < CORNER_X ? "#2c2640" : "#221d32");
  }
  // corner pillar
  const [p0, p1] = PILLAR;
  for (let x = p0; x < p1; x++) {
    const faceLeft = x < CORNER_X;
    const top = 0;
    const bottom = CORNER_Y + 7 - Math.round(Math.abs(x - CORNER_X) * 0.5);
    px(x, top, 1, bottom - top, faceLeft ? "#3a3350" : "#2a2440");
    if (x === p0 || x === p0 + 1) px(x, top, 1, bottom - top, "#4a4264");
    if (x === p1 - 1) px(x, top, 1, bottom - top, "#1c1728");
    for (let y = 8; y < bottom; y += 16) px(x, y + Math.round((faceLeft ? CORNER_X - x : x - CORNER_X) * 0.5), 1, 1, "#251f36");
    px(x, bottom - 4, 1, 4, "#2c2640");
  }
  px(CORNER_X, 0, 1, CORNER_Y + 7, "#1f1a2e");
  // torch brackets on the walls
  for (const tx of TORCH_X) {
    px(tx - 4, 88, 8, 10, "#5c3418");
    px(tx - 6, 86, 12, 3, "#3a2210");
  }
  // vignette
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.62, 90, WIDTH / 2, HEIGHT * 0.62, 310);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return c;
}

function isoBricks(): Brick[] {
  const r = rng(77);
  const out: Brick[] = [];
  for (const b of isoBrickGrid()) {
    const inner = b.cols.slice(1, -1).filter(([, y0, y1]) => y1 - y0 >= 3);
    if (inner.length < 3) continue;
    const xs = inner.map(([x]) => x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) + 1;
    // the pillar and the torches stay in the void
    if (x1 > PILLAR[0] - 2 && x0 < PILLAR[1] + 2) continue;
    if (TORCH_X.some((tx) => x1 > tx - 8 && x0 < tx + 8 && inner.some(([, y0, y1]) => y1 > 80 && y0 < 100))) continue;
    const y0 = Math.min(...inner.map(([, a]) => a));
    const y1 = Math.max(...inner.map(([, , c]) => c));
    const height = b.row / (WALL_H / BRICK_H);
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, threshold: Math.min(0.98, 0.05 + (1 - height) * 0.6 + r() * 0.35), cols: inner });
  }
  return out;
}

export const ISO: StageLayout = {
  name: "iso",
  paintBackground: paintIso,
  wallBricks: isoBricks,
  rune: { cx: 240, cy: 222, outer: [150, 50], inner: [136, 44], orbit: [143, 47] },
};

export function stageFor(search: string): StageLayout {
  return new URLSearchParams(search).has("flat") ? FLAT : ISO;
}
