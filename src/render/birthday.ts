/**
 * The Birthday Boy – his own show: the red book he reads from and hurls, the pages that fly, the party when he
 * arrives and the birthday song. Presentation only – the engine decides the outcome as for every other form.
 */
import type { PixelImage } from "./sprite.ts";
import type { Song } from "./johnny.ts";

/** The Birthday Boy by name. */
export const BIRTHDAY_NAME = /birthday\s*-?\s*boy|\bkilian\b|geburtstagskind/i;

export function isBirthdayBoy(name: string): boolean {
  return BIRTHDAY_NAME.test(name);
}

/** His birthday (month 1–12, day) – the party plays on that day for everyone who enters a duel. */
export const BIRTHDAY: { readonly month: number; readonly day: number } | null = null;

export function isBirthday(now: Date): boolean {
  return BIRTHDAY !== null && now.getMonth() + 1 === BIRTHDAY.month && now.getDate() === BIRTHDAY.day;
}

/** "Happy Birthday to You" (public domain), in 3/4. */
export const BIRTHDAY_SONG: Song = {
  title: "Happy Birthday",
  line: "Happy Birthday, lieber Kilian …",
  bpm: 132,
  notes: [
    [67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2],
    [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
    [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 2],
    [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 3],
  ],
};

/** What the banner cries when he arrives on his day. */
export const BIRTHDAY_CRY = "ALLES GUTE, KILIAN!";

type Grid = readonly string[];

/** The thick red book, 11×13, gold lettering on the cover. */
const BOOK: Grid = [
  "kkkkkkkkkk.",
  "kRRRRRRRRkw",
  "kRrrrrrrRkw",
  "kRrYYYYrRkw",
  "kRrrrrrrRkw",
  "kRrYYYrrRkw",
  "kRrrrrrrRkw",
  "kRrrYrrrRkw",
  "kRrYYYrrRkw",
  "kRrrYrrrRkw",
  "kRrrrrrrRkw",
  "kRRRRRRRRkw",
  "kkkkkkkkkkk",
];

/** A loose page, 7×9, with lines of text. */
const PAGE: Grid = [
  "ppppppp",
  "pWWWWWp",
  "pWlllWp",
  "pWWWWWp",
  "pWllWWp",
  "pWWWWWp",
  "pWlllWp",
  "pWWWWWp",
  "ppppppp",
];

/** A party balloon on its string, 7×13. */
const BALLOON: Grid = [
  ".bbbbb.",
  "bBBBBBb",
  "bBhBBBb",
  "bBBBBBb",
  "bBBBBBb",
  ".bBBBb.",
  "..bbb..",
  "...b...",
  "...s...",
  "..s....",
  "...s...",
  "....s..",
  "...s...",
];

const COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  k: [0x3a, 0x0c, 0x0c],
  R: [0xd8, 0x28, 0x28],
  r: [0xb0, 0x18, 0x1c],
  Y: [0xf4, 0xcc, 0x50],
  w: [0xf0, 0xe8, 0xd0],
  p: [0x9a, 0x8c, 0x70],
  W: [0xfa, 0xf4, 0xe0],
  l: [0x6a, 0x60, 0x50],
  s: [0xe8, 0xe8, 0xe8],
  h: [0xff, 0xff, 0xff],
};

const BALLOON_COLORS: readonly (readonly [number, number, number])[] = [
  [0xff, 0x5a, 0x6a],
  [0xff, 0xd0, 0x4a],
  [0x6a, 0xc8, 0xff],
  [0x8a, 0xe8, 0x6a],
  [0xd0, 0x8a, 0xff],
];

function gridImage(grid: Grid, colors: Readonly<Record<string, readonly [number, number, number]>>): PixelImage {
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [y, row] of grid.entries()) {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row.charAt(x)];
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

export function bookImage(): PixelImage {
  return gridImage(BOOK, COLORS);
}

export function pageImage(): PixelImage {
  return gridImage(PAGE, COLORS);
}

/** A balloon in one of five party colours (`k` picks it). */
export function balloonImage(k: number): PixelImage {
  const base = BALLOON_COLORS[((k % BALLOON_COLORS.length) + BALLOON_COLORS.length) % BALLOON_COLORS.length] ?? [0xff, 0x5a, 0x6a];
  const dark: readonly [number, number, number] = [Math.round(base[0] * 0.6), Math.round(base[1] * 0.6), Math.round(base[2] * 0.6)];
  return gridImage(BALLOON, { ...COLORS, B: base, b: dark });
}
