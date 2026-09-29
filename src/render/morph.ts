/**
 * "Beschwörungsmatrix": while a picture is painted, shapes take form in purple flames and melt into
 * one another until the real one is there. Pure – masks of cells, a dissolve between two of them.
 * Masks are anchored at their bottom centre (where a form stands), so shapes of any size morph in
 * place.
 */
import type { PixelImage } from "./sprite.ts";

export interface Mask {
  /** Size in cells. */
  readonly w: number;
  readonly h: number;
  /** Row-major, 1 = solid. */
  readonly bits: Uint8Array;
}

export const EMPTY_MASK: Mask = { w: 0, h: 0, bits: new Uint8Array(0) };

/** A cell is solid when enough of its pixels are (coarse, but true to the outline). */
export function maskOf(img: PixelImage, cellPx: number): Mask {
  const c = Math.max(1, Math.round(cellPx));
  const w = Math.ceil(img.width / c);
  const h = Math.ceil(img.height / c);
  const bits = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      let solid = 0;
      let all = 0;
      for (let y = cy * c; y < Math.min(img.height, (cy + 1) * c); y++) {
        for (let x = cx * c; x < Math.min(img.width, (cx + 1) * c); x++) {
          all++;
          if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > 96) solid++;
        }
      }
      if (all > 0 && solid * 3 >= all) bits[cy * w + cx] = 1;
    }
  }
  return trim({ w, h, bits });
}

/** Without empty rows and columns around the shape. */
function trim(m: Mask): Mask {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.bits[y * m.w + x] !== 1) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return EMPTY_MASK;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) bits.set(m.bits.subarray((y + y0) * m.w + x0, (y + y0) * m.w + x0 + w), y * w);
  return { w, h, bits };
}

/** Scaled (nearest) to fit a w×h box, aspect kept – so every passing shape is about the size of the one to come. */
export function fitMask(m: Mask, w: number, h: number): Mask {
  if (m.w === 0 || m.h === 0) return EMPTY_MASK;
  const k = Math.min(w / m.w, h / m.h);
  const nw = Math.max(1, Math.round(m.w * k));
  const nh = Math.max(1, Math.round(m.h * k));
  const bits = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) bits[y * nw + x] = m.bits[Math.min(m.h - 1, Math.floor(y / k)) * m.w + Math.min(m.w - 1, Math.floor(x / k))] ?? 0;
  }
  return { w: nw, h: nh, bits };
}

/** Solid at (x, y) – cells relative to the bottom centre, y counts upwards from 0. */
export function solidAt(m: Mask, x: number, y: number): boolean {
  const col = x + Math.floor(m.w / 2);
  const row = m.h - 1 - y;
  return col >= 0 && col < m.w && row >= 0 && row < m.h && m.bits[row * m.w + col] === 1;
}

/** A stable 0..1 per cell: the order in which cells change over. */
export function cellOrder(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type Cell = "off" | "solid" | "edge";

/**
 * One cell while `from` melts into `to` (t 0..1). Cells change over in a stable scattered order,
 * weighted from the ground up, so the new shape grows out of the flames. Cells at the border of
 * the shape – and those just changing over – are "edge" (they burn brighter).
 */
export function morphCell(from: Mask, to: Mask, x: number, y: number, t: number, seed: number): Cell {
  const tall = Math.max(1, from.h, to.h);
  const order = (px: number, py: number): number => cellOrder(px, py, seed) * 0.7 + (py / tall) * 0.3;
  const on = (px: number, py: number): boolean => (order(px, py) < t ? solidAt(to, px, py) : solidAt(from, px, py));
  if (!on(x, y)) return "off";
  const changing = t > 0 && t < 1 && Math.abs(order(x, y) - t) < 0.08;
  return changing || !on(x - 1, y) || !on(x + 1, y) || !on(x, y + 1) || (y > 0 && !on(x, y - 1)) ? "edge" : "solid";
}
