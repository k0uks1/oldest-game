import type { Ontology } from "../engine/ontology/ontology.ts";
import { hash32, rng } from "../engine/text.ts";
import type { Form } from "../engine/types.ts";
import { ATTIRE, FIGURES, VARIANTS, type VariantWhen } from "./figures.ts";
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
  const rough = ["stein", "erde", "holz", "knochen", "pflanze", "sand"].some((t) => onto.formHas(form, t));
  return renderGrid(buildGrid(onto, form), paletteFor(onto, form), hash32(form.id), rough ? 0.13 : 0.05);
}

/**
 * Emissive mask for the bloom layer: glowing eyes/cores at full strength, accents
 * bright, and – for light-emitting forms – the whole body faintly.
 */
export function renderGlow(onto: Ontology, form: Form): PixelImage {
  const grid = buildGrid(onto, form);
  const pal = paletteFor(onto, form);
  const gh = grid.length;
  const gw = grid[0]?.length ?? 0;
  const width = gw + 2;
  const height = gh + 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const glow = hexToRgb(pal.glow);
  const accent = hexToRgb(pal.main[3]);
  const body = hexToRgb(pal.main[2]);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = grid[y]?.[x] ?? ".";
      const [rgb, a] =
        c === "o" ? [glow, 255] : c === "*" ? [accent, 190] : c !== "." && pal.emissive ? [body, 90] : [null, 0];
      if (rgb === null) continue;
      const i = ((y + 1) * width + (x + 1)) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

/** Final sprite edge length in pixels: 32 (tiny/small), 64 (medium–huge), 128 (landscape+). */
export function spriteSize(scale: number): number {
  return 16 * 2 ** upscalePasses(scale);
}

/**
 * The sprite's symbol grid: a detailed 32×32 figure dressed by its tags if the
 * archetype has one, otherwise the 16×16 mask – then EPX up to the target size.
 */
export function buildGrid(onto: Ontology, form: Form): Grid {
  const figure = variantFor(onto, form) ?? FIGURES[form.archetype];
  let grid = figure === undefined ? toGrid(MASKS[form.archetype]) : dress(onto, form, toGrid(figure));
  const target = spriteSize(form.scale);
  while (grid.length < target) grid = epx(grid);
  return grid;
}

/** The first shape variant of the form's archetype whose condition holds. */
export function variantFor(onto: Ontology, form: Form): readonly string[] | undefined {
  const list = VARIANTS[form.archetype];
  if (list === undefined) return undefined;
  const verbs = new Set(onto.compileForm(form).verbs);
  const ok = (w: VariantWhen): boolean =>
    (w.all ?? []).every((t) => onto.formHas(form, t)) &&
    !(w.none ?? []).some((t) => onto.formHas(form, t)) &&
    (w.anyVerb === undefined || w.anyVerb.some((v) => verbs.has(v))) &&
    (w.allVerb ?? []).every((v) => verbs.has(v)) &&
    !(w.noVerb ?? []).some((v) => verbs.has(v)) &&
    form.scale >= (w.minScale ?? 0);
  return list.find((v) => ok(v.when))?.rows;
}

/** Apply every attire overlay whose tag condition the form's closure satisfies. */
export function dress(onto: Ontology, form: Form, base: Grid): Grid {
  const grid = base.map((row) => [...row]);
  for (const a of ATTIRE) {
    if (!a.overlay.on.includes(form.archetype)) continue;
    if (!a.all.every((t) => onto.formHas(form, t))) continue;
    if (a.none.some((t) => onto.formHas(form, t))) continue;
    for (const [y, row] of a.overlay.rows.entries()) {
      const target = grid[y];
      if (target === undefined) continue;
      for (const [x, c] of Array.from(row).entries()) {
        if (c === "." || x >= target.length) continue;
        if (c === "_") target[x] = ".";
        else if (a.overlay.mode === "over" || target[x] === ".") target[x] = c;
      }
    }
  }
  return grid;
}

/**
 * Shade a symbol grid. Volume comes from a distance field: every silhouette is
 * treated as a soft dome, lit from the upper left, quantised to the four-step
 * ramp with a light ordered dither. Region borders get a crease, and the
 * outline is selective: dark ramp colour on the lit side, near-black in shadow.
 */
export function renderGrid(grid: Grid, pal: SpritePalette, seed: number, roughness = 0.06): PixelImage {
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
  const sym = (x: number, y: number): string => grid[y]?.[x] ?? ".";
  const filled = (x: number, y: number): boolean => sym(x, y) !== ".";
  const put = (x: number, y: number, rgb: readonly [number, number, number]): void => {
    const i = ((y + 1) * width + (x + 1)) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  };

  // Chamfer distance to the nearest empty pixel (3 = orthogonal, 4 = diagonal).
  const dist = new Float32Array(gw * gh);
  const INF = 1e6;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) dist[y * gw + x] = filled(x, y) ? INF : 0;
  const d = (x: number, y: number): number => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : (dist[y * gw + x] ?? 0));
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if ((dist[i] ?? 0) === 0) continue;
      dist[i] = Math.min(dist[i] ?? INF, d(x - 1, y) + 3, d(x, y - 1) + 3, d(x - 1, y - 1) + 4, d(x + 1, y - 1) + 4);
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if ((dist[i] ?? 0) === 0) continue;
      dist[i] = Math.min(dist[i] ?? INF, d(x + 1, y) + 3, d(x, y + 1) + 3, d(x + 1, y + 1) + 4, d(x - 1, y + 1) + 4);
    }
  }
  // Dome height: rises over R pixels from the edge, then flat.
  const R = Math.max(2, gw / 9);
  const heightAt = (x: number, y: number): number => {
    const t = Math.min(1, d(x, y) / 3 / R);
    return Math.sqrt(1 - (1 - t) * (1 - t));
  };
  const L = [-0.52, -0.62, 0.58] as const;

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const c = sym(x, y);
      if (c === ".") continue;
      if (c === "o") {
        put(x, y, glow);
        continue;
      }
      const ramp = c === "+" ? second : main;
      if (c === ",") {
        put(x, y, main[0] ?? outline);
        continue;
      }
      const hx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * R * 0.9;
      const hy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * R * 0.9;
      const nl = Math.hypot(hx, hy, 1);
      const lambert = Math.max(0, (-hx * L[0] - hy * L[1] + L[2]) / nl);
      let light = 0.18 + 0.82 * lambert - 0.16 * (y / gh);
      light += noiseAt(x, y) * roughness * 2;
      const bayer = BAYER4[y % 4]?.[x % 4] ?? 0;
      light += (bayer / 16 - 0.5) * 0.1;
      // crease where two regions meet (belt, sleeve, armour plates)
      const below = sym(x, y + 1);
      const right = sym(x + 1, y);
      if ((below !== "." && below !== c && below !== "o") || (right !== "." && right !== c && right !== "o")) light -= 0.22;
      if (c === "*") light = Math.max(light + 0.25, 0.78);
      const step = light < 0.3 ? 0 : light < 0.55 ? 1 : light < 0.8 ? 2 : 3;
      put(x, y, ramp[step] ?? [255, 0, 255]);
    }
  }
  // Selective outline: the lit side (top/left) takes the neighbour's darkest ramp colour.
  for (let y = -1; y <= gh; y++) {
    for (let x = -1; x <= gw; x++) {
      if (filled(x, y)) continue;
      const litFrom = filled(x + 1, y) ? sym(x + 1, y) : filled(x, y + 1) ? sym(x, y + 1) : null;
      const shadowFrom = filled(x - 1, y) || filled(x, y - 1);
      if (litFrom === null && !shadowFrom) continue;
      if (litFrom !== null && !shadowFrom) {
        const ramp = litFrom === "+" ? second : main;
        put(x, y, ramp[0] ?? outline);
      } else put(x, y, outline);
    }
  }
  return { width, height, data };
}
