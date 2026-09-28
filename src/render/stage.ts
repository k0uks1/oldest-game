/**
 * The arena's scenery ("Bühnenbild"): backdrop, the wall bricks that crumble into the void as
 * the duel escalates, and the floor geometry the rune circle sits on. Pure painting – the
 * simulation and both renderers only read it.
 *
 *   stage-flat.ts  the original straight-on dungeon wall (`?flat`)
 *   stage-iso.ts   an isometric dungeon room (default)
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
  /** Ground line of each side: equal on a flat stage, staggered in depth in the iso room. */
  readonly ground: readonly [number, number];
  /** Animated scenery drawn every frame behind the fighters (banners in a draught), time in s. */
  drawProps?(px: (x: number, y: number, w: number, h: number, color: string) => void, time: number): void;
  /** Bats in the vault, a rat along the walls. */
  readonly critters: boolean;
  /** Low mist drifting over the floor. */
  readonly fog: boolean;
  /** Dark places for the watching eyes (left eye of each pair), in order of appearance. */
  readonly eyes?: readonly (readonly [number, number])[];
}

export function newCanvas(): HTMLCanvasElement {
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
