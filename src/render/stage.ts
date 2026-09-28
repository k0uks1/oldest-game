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
  /** Top edge of the floor at column x (where it meets the wall). */
  floorTop(x: number): number;
  /** 0 at the floor's boundary (wall base, screen edge) … 1 well inside it. */
  floorEdge(x: number, y: number): number;
  /** Where water drips from the vault: [x, y where it lands]. */
  readonly drips: readonly (readonly [number, number])[];
  /** Low mist drifting over the floor. */
  readonly fog: boolean;
  /** Dark places for the watching eyes (left eye of each pair), in order of appearance. */
  readonly eyes?: readonly (readonly [number, number])[];
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
  floorTop: () => FLOOR_Y,
  floorEdge: (x) => Math.min(x, WIDTH - x) / (WIDTH / 2),
  drips: [],
  fog: false,
};

// ── isometric ─────────────────────────────────────────────────────────────

/** Where the walls meet the floor: the left wall rises to the corner, the right one falls away. */
const CORNER_X = 240;
const CORNER_Y = 120;
const WALL_H = 170;
const BRICK_W = 24;
const BRICK_H = 10;
const PILLAR = [CORNER_X - 13, CORNER_X + 13] as const;
const ISO_RUNE: Rune = { cx: 240, cy: 222, outer: [150, 50], inner: [136, 44], orbit: [143, 47] };

export function isoFloorY(x: number): number {
  return Math.round(CORNER_Y + Math.abs(x - CORNER_X) * 0.5);
}

/** Screen y of a point `v` pixels up the wall at column x. */
function wallY(x: number, v: number): number {
  return isoFloorY(x) - v;
}

type Px = (x: number, y: number, w: number, h: number, color: string) => void;

// Things on the walls – their bricks stay when the wall crumbles into the void.
const DOOR = { u0: 72, u1: 112, rect: 38, arch: 20 } as const;
const BANNERS = [
  { u0: 150, u1: 172, top: 150, len: 70, cloth: ["#26122f", "#3a1e4a", "#4e2a62"] },
  { u0: 308, u1: 330, top: 150, len: 70, cloth: ["#2e0f15", "#4a1a22", "#5e2430"] },
] as const;
const CHAINS = [
  { u: 392, top: 122, len: 58 },
  { u: 406, top: 122, len: 46 },
] as const;

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Screen box of a wall feature spanning columns u0..u1 and heights v0..v1. */
function wallBox(u0: number, u1: number, v0: number, v1: number): Box {
  const ys = [u0, u1].flatMap((x) => [wallY(x, v0), wallY(x, v1)]);
  return { x0: u0, x1: u1, y0: Math.min(...ys), y1: Math.max(...ys) };
}

const KEEP: readonly Box[] = [
  { x0: PILLAR[0] - 2, x1: PILLAR[1] + 2, y0: -99, y1: HEIGHT },
  ...TORCH_X.map((tx) => ({ x0: tx - 8, x1: tx + 8, y0: 80, y1: 100 })),
  wallBox(DOOR.u0 - 4, DOOR.u1 + 4, 0, DOOR.rect + DOOR.arch + 4),
  ...BANNERS.map((b) => wallBox(b.u0 - 3, b.u1 + 3, b.top - b.len, b.top + 2)),
  ...CHAINS.map((c) => wallBox(c.u - 3, c.u + 4, c.top - c.len - 4, c.top + 2)),
];

/** One wall brick as pixel columns (u = along the wall, v = height above the floor line). */
function isoBrickCols(u0: number, u1: number, v0: number, v1: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = Math.max(0, u0); x < Math.min(WIDTH, u1); x++) {
    const top = Math.max(wallY(x, WALL_H), wallY(x, v1));
    const bottom = wallY(x, v0);
    if (bottom > top) out.push([x, top, bottom]);
  }
  return out;
}

interface IsoBrick {
  readonly cols: [number, number, number][];
  readonly row: number;
  readonly right: boolean;
}

function isoBrickGrid(): IsoBrick[] {
  const out: IsoBrick[] = [];
  for (const right of [false, true]) {
    for (let row = 0; row * BRICK_H < WALL_H; row++) {
      const off = row % 2 === 0 ? 0 : BRICK_W / 2;
      for (let k = -1; k * BRICK_W < CORNER_X + BRICK_W; k++) {
        const a = k * BRICK_W + off;
        // left wall runs 0 → corner, right wall corner → 480 (mirrored grid)
        const u0 = right ? CORNER_X + a : CORNER_X - a - BRICK_W;
        const lo = right ? Math.max(u0, CORNER_X) : u0;
        const hi = right ? u0 + BRICK_W : Math.min(u0 + BRICK_W, CORNER_X);
        if (hi - lo < 3) continue;
        out.push({ cols: isoBrickCols(lo, hi, row * BRICK_H, (row + 1) * BRICK_H), row, right });
      }
    }
  }
  return out;
}

function paintWalls(px: Px, rand: () => number): void {
  // mortar, then bricks; the right wall lies in shadow
  const left = ["#2a2438", "#2e2740", "#262033", "#302a44"];
  const right = ["#211c2e", "#241f33", "#1e192a", "#262137"];
  for (let x = 0; x < WIDTH; x++) px(x, wallY(x, WALL_H), 1, WALL_H, x < CORNER_X ? "#15111f" : "#110e1a");
  for (const b of isoBrickGrid()) {
    const pal = b.right ? right : left;
    const col = pal[Math.floor(rand() * pal.length)] ?? "#2a2438";
    const moss = rand() < 0.07;
    const crack = rand() < 0.12 ? 3 + Math.floor(rand() * 14) : -1;
    for (const [i, [x, y0, y1]] of b.cols.entries()) {
      if (i === 0 || i === b.cols.length - 1 || y1 - y0 < 3) continue; // mortar between bricks
      px(x, y0 + 1, 1, y1 - y0 - 2, col);
      px(x, y0 + 1, 1, 1, b.right ? "#2e2842" : "#3a3352");
      px(x, y1 - 2, 1, 1, "#1c1728");
      if (i === crack) px(x, y0 + 3, 1, 2, "#1c1728");
      if (moss && i > 2 && i < 8) px(x, y1 - 3, 1, 2, "#243a2a");
    }
  }
  // the walls darken upwards (dithered), the right one more
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let x = 0; x < WIDTH; x++) {
    const base = isoFloorY(x);
    for (let y = Math.max(0, base - WALL_H); y < base; y++) {
      const shade = Math.max(0, (base - y) / WALL_H - 0.35) * (x < CORNER_X ? 1.1 : 1.35);
      if ((bayer[(y % 4) * 4 + (x % 4)] ?? 0) / 16 < shade * 0.8) px(x, y, 1, 1, "rgba(8,6,14,0.55)");
    }
  }
}

/** Diamond tiles (2:1) with a little wear, cracks, and the rune circle carved into the stone. */
function paintFloor(px: Px, rand: () => number, rune: Rune): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (y < isoFloorY(x)) continue;
      const a = (x - CORNER_X) / 32 + (y - CORNER_Y) / 16;
      const b = (y - CORNER_Y) / 16 - (x - CORNER_X) / 32;
      const fa = a - Math.floor(a);
      const fb = b - Math.floor(b);
      const tile = Math.floor(a) * 7 + Math.floor(b) * 13;
      let col = (Math.floor(a) + Math.floor(b)) % 2 === 0 ? "#1d1729" : "#1a1425";
      if (tile % 11 === 0) col = "#171222"; // a worn, darker slab here and there
      if (fa < 0.06 || fb < 0.06) col = "#261f36";
      else if (fa < 0.12 || fb < 0.12) col = (tile & 1) === 0 ? "#211a2f" : col; // bevel
      else if ((x * 7 + y * 13) % 29 === 0) col = "#231c32";
      px(x, y, 1, 1, col);
    }
  }
  // cracks: short random walks
  for (let k = 0; k < 14; k++) {
    let x = 20 + Math.floor(rand() * (WIDTH - 40));
    let y = 150 + Math.floor(rand() * (HEIGHT - 150));
    for (let s = 0; s < 6 + rand() * 10; s++) {
      if (y >= isoFloorY(x) + 2) px(x, y, 1, 1, "#110d1a");
      x += rand() < 0.5 ? 1 : -1;
      y += rand() < 0.4 ? 1 : 0;
    }
  }
  // the rune circle's groove: dark cut, lit lower lip, glyphs between the rings
  const { cx, cy, outer, inner, orbit } = rune;
  for (const [rx, ry] of [outer, inner]) {
    for (let t = 0; t < 720; t++) {
      const ang = (t / 720) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * rx);
      const y = Math.round(cy + Math.sin(ang) * ry);
      px(x, y, 1, 1, "#110d1a");
      px(x, y + 1, 1, 1, "#2a2340");
    }
  }
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2 + 0.13;
    const x = Math.round(cx + Math.cos(ang) * orbit[0]);
    const y = Math.round(cy + Math.sin(ang) * orbit[1]);
    px(x - 1, y, 3, 1, "#130f1e");
    if (i % 3 === 0) px(x, y - 1, 1, 3, "#130f1e");
  }
  // skirting where wall meets floor
  for (let x = 0; x < WIDTH; x++) {
    const base = isoFloorY(x);
    px(x, base, 1, 2, "#0e0b16");
    px(x, base - 3, 1, 3, x < CORNER_X ? "#2c2640" : "#221d32");
  }
}

/** An arched doorway in the left wall, its portcullis half raised; darkness beyond. */
function paintDoor(px: Px): void {
  const { u0, u1, rect, arch } = DOOR;
  const mid = (u0 + u1) / 2;
  const half = (u1 - u0) / 2;
  const top = (x: number, grow: number): number => rect + (arch + grow) * Math.sqrt(Math.max(0, 1 - ((x - mid) / (half + grow)) ** 2));
  for (let x = u0 - 4; x < u1 + 4; x++) {
    // stone frame
    const vf = top(x, 4);
    px(x, wallY(x, vf), 1, Math.round(vf), "#3a3350");
    px(x, wallY(x, vf), 1, 1, "#4a4264");
    if (x < u0 || x >= u1) continue;
    // the dark beyond
    const v = top(x, 0);
    px(x, wallY(x, v), 1, Math.round(v), "#06040a");
    // portcullis: bars every 5 px, cross bars, spikes hanging at knee height
    if ((x - u0) % 5 === 2) px(x, wallY(x, v), 1, Math.round(v) - 8, "#3a3f4a");
    for (const h of [18, 32, 46]) if (h < v) px(x, wallY(x, h), 1, 1, "#4c5564");
    if ((x - u0) % 5 === 2) px(x, wallY(x, 8), 1, 2, "#5a6070");
  }
  // keystone
  px(Math.round(mid) - 2, wallY(Math.round(mid), rect + arch + 5), 5, 4, "#4a4264");
}

/** The game's sigil (ring, triangle, eye), 9×9. */
const SIGIL = ["..#####..", ".#.....#.", "#...#...#", "#..#.#..#", "#.#.o.#.#", "#.#####.#", "#.......#", ".#.....#.", "..#####.."];

function paintBanners(px: Px): void {
  for (const b of BANNERS) {
    const [dark, main, light] = b.cloth;
    const mid = (b.u0 + b.u1 - 1) / 2;
    for (let x = b.u0; x < b.u1; x++) {
      // swallow-tail hem
      const len = b.len - Math.round(Math.max(0, 5 - Math.abs(x - mid)) * 1.6);
      const edge = x === b.u0 || x === b.u1 - 1;
      const fold = (x - b.u0) % 7 === 5;
      px(x, wallY(x, b.top), 1, len, edge ? dark : fold ? dark : main);
      if (x === b.u0 + 1) px(x, wallY(x, b.top), 1, len, light);
      // gold border stripes
      if (x === b.u0 + 2 || x === b.u1 - 3) px(x, wallY(x, b.top) + 3, 1, len - 6, "#9a6e14");
      px(x, wallY(x, b.top) + 3, 1, 1, "#9a6e14");
    }
    // rod
    for (let x = b.u0 - 2; x < b.u1 + 2; x++) px(x, wallY(x, b.top) - 1, 1, 2, "#3a2210");
    // sigil, sheared onto the cloth
    const sx = Math.round(mid) - 4;
    for (const [j, row] of SIGIL.entries()) {
      for (const [i, ch] of Array.from(row).entries()) {
        if (ch === ".") continue;
        const x = sx + i;
        px(x, wallY(x, b.top) + 12 + j, 1, 1, ch === "o" ? "#ffd86a" : "#e0b030");
      }
    }
  }
}

function paintChains(px: Px): void {
  for (const c of CHAINS) {
    px(c.u - 1, wallY(c.u, c.top) - 1, 3, 3, "#4c5564");
    for (let v = 0; v < c.len; v++) {
      const y = wallY(c.u, c.top) + 2 + v;
      const link = Math.floor(v / 3) % 2 === 0;
      px(link ? c.u : c.u - 1, y, link ? 1 : 3, 1, v % 3 === 0 ? "#303440" : "#6a7488");
    }
    // shackle
    const y = wallY(c.u, c.top) + 2 + c.len;
    px(c.u - 2, y, 5, 1, "#6a7488");
    px(c.u - 2, y + 1, 1, 3, "#6a7488");
    px(c.u + 2, y + 1, 1, 3, "#303440");
    px(c.u - 2, y + 4, 5, 1, "#303440");
  }
}

function paintPillar(px: Px): void {
  const [p0, p1] = PILLAR;
  for (let x = p0; x < p1; x++) {
    const faceLeft = x < CORNER_X;
    const bottom = CORNER_Y + 7 - Math.round(Math.abs(x - CORNER_X) * 0.5);
    px(x, 0, 1, bottom, faceLeft ? "#3a3350" : "#2a2440");
    if (x === p0 || x === p0 + 1) px(x, 0, 1, bottom, "#4a4264");
    if (x === p1 - 1) px(x, 0, 1, bottom, "#1c1728");
    for (let y = 8; y < bottom; y += 16) px(x, y + Math.round((faceLeft ? CORNER_X - x : x - CORNER_X) * 0.5), 1, 1, "#251f36");
    // plinth
    px(x - (x === p0 ? 2 : 0), bottom - 6, x === p0 || x === p1 - 1 ? 3 : 1, 6, faceLeft ? "#2c2640" : "#211c32");
  }
  px(CORNER_X, 0, 1, CORNER_Y + 7, "#1f1a2e");
}

/** Rubble along the wall bases, a skull and a few bones. */
function paintDebris(px: Px, rand: () => number): void {
  const stones = ["#2e2740", "#262033", "#3a3352"];
  for (let k = 0; k < 22; k++) {
    const x = 8 + Math.floor(rand() * (WIDTH - 16));
    if (x > PILLAR[0] - 6 && x < PILLAR[1] + 6) continue;
    if (x > DOOR.u0 - 2 && x < DOOR.u1 + 2) continue;
    const base = isoFloorY(x) + 2;
    for (let s = 0; s < 3 + rand() * 4; s++) {
      const w = 1 + Math.floor(rand() * 3);
      px(x + Math.floor(rand() * 7) - 3, base + Math.floor(rand() * 4), w, 1 + Math.floor(rand() * 2), stones[Math.floor(rand() * stones.length)] ?? "#2e2740");
    }
  }
  const bone = "#bcb294";
  const boneShade = "#7a7058";
  // skull at the foot of the left wall
  const kx = 150;
  const ky = isoFloorY(kx) + 5;
  const skull = [".####.", "######", "#,##,#", "######", ".#.#.."];
  for (const [j, row] of skull.entries()) {
    for (const [i, ch] of Array.from(row).entries()) {
      if (ch !== ".") px(kx + i, ky + j, 1, 1, ch === "," ? "#1c1728" : j >= 3 ? boneShade : bone);
    }
  }
  // bones
  for (const [bx, dir] of [[162, 1], [336, -1], [352, 1]] as const) {
    const by = isoFloorY(bx) + 6;
    for (let i = 0; i < 6; i++) px(bx + i * dir, by + Math.floor(i / 2), 1, 1, i === 0 || i === 5 ? bone : boneShade);
    px(bx - dir, by, 1, 1, bone);
    px(bx + 6 * dir, by + 3, 1, 1, bone);
  }
}

/** Broken columns in the front corners – frame the room without hiding anyone. */
function paintStumps(px: Px, rand: () => number): void {
  const shade = ["#1c1728", "#251f36", "#3a3350", "#4a4264", "#3a3350", "#2c2640"];
  for (const [cx, top] of [[12, 222], [468, 214]] as const) {
    const r = 20;
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= WIDTH) continue;
      const t = (x - cx) / r; // −1 … 1 across the cylinder, lit from the left
      const lit = Math.round((1 - Math.abs(t + 0.35)) * (shade.length - 1));
      const col = shade[Math.max(0, Math.min(shade.length - 1, lit))] ?? "#251f36";
      const cap = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 6);
      const jag = Math.floor(rand() * 4);
      px(x, top - cap + jag, 1, HEIGHT - top + cap - jag, col);
      // fluting
      if (Math.round((t + 1) * 5) % 2 === 0 && Math.abs(t) < 0.9) px(x, top + 8, 1, HEIGHT - top - 8, "#211b30");
      // broken top face
      px(x, top - cap + jag, 1, 2, "#5a5278");
    }
    // a fallen chunk beside it
    const fx = cx < WIDTH / 2 ? cx + 26 : cx - 34;
    px(fx, 258, 9, 5, "#3a3350");
    px(fx, 258, 9, 1, "#5a5278");
    px(fx + 6, 259, 3, 4, "#251f36");
  }
}

function paintIso(): HTMLCanvasElement {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  if (ctx === null) return c;
  const rand = rng(99);
  const px: Px = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  px(0, 0, WIDTH, HEIGHT, "#0b0812"); // the vault above is lost in darkness
  paintWalls(px, rand);
  paintFloor(px, rand, ISO_RUNE);
  paintDoor(px);
  paintBanners(px);
  paintChains(px);
  paintPillar(px);
  for (const tx of TORCH_X) {
    px(tx - 4, 88, 8, 10, "#5c3418");
    px(tx - 6, 86, 12, 3, "#3a2210");
  }
  paintDebris(px, rand);
  paintStumps(px, rand);
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
    const x0 = Math.min(...inner.map(([x]) => x));
    const x1 = Math.max(...inner.map(([x]) => x)) + 1;
    const y0 = Math.min(...inner.map(([, a]) => a));
    const y1 = Math.max(...inner.map(([, , z]) => z));
    // the pillar, torches, door, banners and chains stay in the void
    if (KEEP.some((k) => x1 > k.x0 && x0 < k.x1 && y1 > k.y0 && y0 < k.y1)) continue;
    const height = b.row / (WALL_H / BRICK_H);
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, threshold: Math.min(0.98, 0.05 + (1 - height) * 0.6 + r() * 0.35), cols: inner });
  }
  return out;
}

export const ISO: StageLayout = {
  name: "iso",
  paintBackground: paintIso,
  wallBricks: isoBricks,
  rune: ISO_RUNE,
  floorTop: isoFloorY,
  floorEdge: (x, y) => Math.max(0, Math.min(1, (y - isoFloorY(x)) / 70, Math.min(x, WIDTH - x) / 60)),
  drips: [
    [196, 158],
    [288, 150],
    [420, 236],
  ],
  fog: true,
  // the first witness stares from behind the portcullis, the others from the black vault
  eyes: [
    [90, 168],
    [40, 18],
    [420, 14],
    [14, 32],
    [446, 30],
    [64, 8],
    [404, 4],
    [100, 6],
    [456, 48],
    [22, 48],
    [372, 6],
    [452, 10],
  ],
};

export function stageFor(search: string): StageLayout {
  return new URLSearchParams(search).has("flat") ? FLAT : ISO;
}
