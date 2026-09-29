/**
 * The Eichelober and his gang – their own show: the acorn they fire (drawn after
 * the Eichel of the Bavarian cards), the gang tattoo made from the Eichelober's picture, and which signature attack a
 * name asks for. Presentation only – the engine decides the outcome as for every other form.
 */
import type { PixelImage } from "./sprite.ts";

/** A signature attack that replaces the ordinary strike. */
export type Signature = "eichelkaese" | "eichelhagel";

/** The gang is checked first – "Eichelober-Gang" also contains "Eichelober". */
const SIGNATURE_PATTERNS: readonly (readonly [RegExp, Signature])[] = [
  [/eichel\s*-?\s*(ober\s*-?\s*)?(gang|bande)/i, "eichelhagel"],
  [/eichel\s*-?\s*ober|eichelk(ä|ae)se/i, "eichelkaese"],
];

/** Which signature attack (if any) a form's name asks for. */
export function signatureFor(name: string): Signature | null {
  return SIGNATURE_PATTERNS.find(([re]) => re.test(name))?.[1] ?? null;
}

/** What the banner cries when it happens. */
export const SIGNATURE_CRY: Readonly<Record<Signature, string>> = {
  eichelkaese: "EICHELKÄSEATTACKE!",
  eichelhagel: "EICHELHAGEL!",
};

type Grid = readonly string[];

/** Shaped like the Eichel of the Bavarian cards: yellow nut pointing up, green hatched cup, green stalk. */
const ACORN: Grid = [
  "....kk....",
  "...kYYk...",
  "..kYYyyk..",
  ".kYYyyyyk.",
  ".kYyyyyok.",
  ".kyyyyyok.",
  ".kyyyyook.",
  "kGgGgGgGgk",
  "kgGgGgGgGk",
  ".kgGgGgGk.",
  "..kgggk...",
  "....ks....",
  "....sk....",
];

const COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  k: [0x34, 0x24, 0x0e],
  Y: [0xfa, 0xe4, 0x78],
  y: [0xe2, 0xb8, 0x34],
  o: [0xb8, 0x82, 0x20],
  G: [0x78, 0xa8, 0x34],
  g: [0x48, 0x74, 0x20],
  s: [0x40, 0x78, 0x24],
};

function gridImage(grid: Grid): PixelImage {
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [y, row] of grid.entries()) {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      const c = COLORS[ch];
      if (c === undefined) continue;
      const i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** An acorn, 10×13 – what the Eichelober's acorn gun and the gang's slingshots fire. */
export function acornImage(): PixelImage {
  return gridImage(ACORN);
}

/**
 * The gang tattoo: the Eichelober's picture as ink on skin – dark lines where the picture is dark,
 * lighter ink in the middle tones, the brightest parts left out – and a glowing rim around it.
 */
export function tattooImage(art: PixelImage): PixelImage {
  const { width, height, data } = art;
  const out = new Uint8ClampedArray(width * height * 4);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && (data[(y * width + x) * 4 + 3] ?? 0) >= 128;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let rgb: readonly [number, number, number] | undefined;
      if (solid(x, y)) {
        const lum = 0.3 * (data[i] ?? 0) + 0.59 * (data[i + 1] ?? 0) + 0.11 * (data[i + 2] ?? 0);
        rgb = lum < 95 ? [0x1c, 0x34, 0x46] : lum < 150 ? [0x46, 0x6e, 0x7d] : undefined;
      } else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        rgb = [0x9a, 0xe8, 0xff];
      }
      if (rgb === undefined) continue;
      out[i] = rgb[0];
      out[i + 1] = rgb[1];
      out[i + 2] = rgb[2];
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}
