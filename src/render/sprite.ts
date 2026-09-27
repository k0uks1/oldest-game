import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { MASKS } from "./masks.ts";
import { hexToRgb, paletteFor, type SpritePalette } from "./palette.ts";

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major. */
  readonly data: Uint8ClampedArray;
}

type Grid = string[][];

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** How many EPX passes a scale gets: 1–2 → 32 px, 3–5 → 64 px, 6–8 → 128 px. */
export function upscalePasses(scale: number): number {
  return scale <= 2 ? 1 : scale <= 5 ? 2 : 3;
}

/** EPX / Scale2x: doubles resolution while keeping diagonals smooth. */
export function epx(grid: Grid): Grid {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const at = (x: number, y: number): string => grid[y]?.[x] ?? ".";
  const out: Grid = Array.from({ length: h * 2 }, () => new Array<string>(w * 2).fill("."));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const row0 = out[y * 2];
      const row1 = out[y * 2 + 1];
      if (row0 === undefined || row1 === undefined) continue;
      row0[x * 2] = c === a && c !== d && a !== b ? a : p;
      row0[x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
      row1[x * 2] = d === c && d !== b && c !== a ? c : p;
      row1[x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out;
}

function toGrid(rows: readonly string[]): Grid {
  return rows.map((r) => Array.from(r));
}

/**
 * Deterministically render a form to pixels: silhouette by archetype,
 * colours by (expanded) tags, texture seeded by the form id.
 */
export function renderSprite(onto: Ontology, form: Form): PixelImage {
  return renderGrid(buildGrid(form), paletteFor(onto, form), hash32(form.id));
}

export function buildGrid(form: Form): Grid {
  let grid = toGrid(MASKS[form.archetype]);
  for (let i = 0; i < upscalePasses(form.scale); i++) grid = epx(grid);
  return grid;
}

export function renderGrid(grid: Grid, pal: SpritePalette, seed: number): PixelImage {
  const gh = grid.length;
  const gw = grid[0]?.length ?? 0;
  const width = gw + 2;
  const height = gh + 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const rand = rng(seed);
  const main = pal.main.map(hexToRgb);
  const second = pal.second.map(hexToRgb);
  const glow = hexToRgb(pal.glow);
  const outline = hexToRgb(pal.outline);
  const blockNoise = new Map<number, number>();
  const blockSize = gw >= 64 ? 3 : 2;
  const noiseAt = (x: number, y: number): number => {
    const key = Math.floor(y / blockSize) * 1024 + Math.floor(x / blockSize);
    let v = blockNoise.get(key);
    if (v === undefined) {
      v = rand() - 0.5;
      blockNoise.set(key, v);
    }
    return v;
  };

  const filled = (x: number, y: number): boolean => {
    const c = grid[y]?.[x];
    return c !== undefined && c !== ".";
  };
  const put = (x: number, y: number, rgb: readonly [number, number, number]): void => {
    const i = ((y + 1) * width + (x + 1)) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  };

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = grid[y]?.[x] ?? ".";
      if (c === ".") continue;
      if (c === "o") {
        put(x, y, glow);
        continue;
      }
      let light = 0.62 - 0.42 * (y / gh) + 0.12 * (0.5 - x / gw);
      if (!filled(x, y - 1) || !filled(x - 1, y)) light += 0.3;
      if (!filled(x, y + 1) || !filled(x + 1, y)) light -= 0.3;
      light += noiseAt(x, y) * 0.16;
      const bayer = BAYER4[y % 4]?.[x % 4] ?? 0;
      light += (bayer / 16 - 0.5) * 0.16;
      const ramp = c === "+" ? second : main;
      if (c === "*") light = Math.max(light, 0.8);
      if (c === "+") light += 0.1;
      const step = light < 0.3 ? 0 : light < 0.55 ? 1 : light < 0.8 ? 2 : 3;
      put(x, y, ramp[step] ?? [255, 0, 255]);
    }
  }
  // 1-px outline around the silhouette (in the padded border too)
  for (let y = -1; y <= gh; y++) {
    for (let x = -1; x <= gw; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) put(x, y, outline);
    }
  }
  return { width, height, data };
}
