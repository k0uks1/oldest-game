/**
 * Johnny Gnadenlos, the singing cactus – his own show: the five classics he always sings (he claims thirty),
 * the music notes he fires, and how he parrots what is said to him in a squeaky voice. Presentation only –
 * the engine decides the outcome as for every other form.
 */
import type { PixelImage } from "./sprite.ts";

/** Johnny by name – and anything that is plainly a singing or dancing cactus. */
export const JOHNNY_NAME = /jo?h?nny\s*-?\s*gnadenlos|(sing|tanz|sprech)ende?r?\s*kaktus|tanzkaktus|dancing\s*cactus/i;

export function isJohnny(name: string): boolean {
  return JOHNNY_NAME.test(name);
}

/** A melody: MIDI note and length in beats (0 = a rest of that length is written as note 0). */
export type Melody = readonly (readonly [number, number])[];

export interface Song {
  readonly title: string;
  /** What he sings along (public-domain songs only). */
  readonly line: string;
  readonly bpm: number;
  readonly notes: Melody;
}

/** The five classics – all of them. He says there are thirty. */
export const SONGS: readonly Song[] = [
  {
    title: "La Cucaracha",
    line: "La cucaracha, la cucaracha …",
    bpm: 200,
    notes: [[67, 0.5], [67, 0.5], [67, 0.5], [72, 1.5], [76, 1], [0, 0.5], [67, 0.5], [67, 0.5], [67, 0.5], [72, 1.5], [76, 1.5], [0, 0.5], [72, 1], [72, 0.5], [71, 0.5], [71, 0.5], [69, 0.5], [69, 0.5], [67, 2]],
  },
  {
    title: "Oh! Susanna",
    line: "Oh! Susanna, oh don't you cry for me …",
    bpm: 190,
    notes: [[60, 0.5], [62, 0.5], [64, 1], [67, 1], [67, 1.5], [69, 0.5], [67, 1], [64, 1], [60, 1.5], [62, 0.5], [64, 1], [64, 1], [62, 1], [60, 1], [62, 2]],
  },
  {
    title: "Alle meine Entchen",
    line: "Alle meine Entchen schwimmen auf dem See …",
    bpm: 170,
    notes: [[60, 1], [62, 1], [64, 1], [65, 1], [67, 2], [67, 2], [69, 1], [69, 1], [69, 1], [69, 1], [67, 3], [0, 1], [69, 1], [69, 1], [69, 1], [69, 1], [67, 3]],
  },
  {
    title: "Hänschen klein",
    line: "Hänschen klein ging allein …",
    bpm: 170,
    notes: [[67, 1], [64, 1], [64, 2], [65, 1], [62, 1], [62, 2], [60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [67, 1], [67, 2]],
  },
  {
    title: "Yankee Doodle",
    line: "Yankee Doodle went to town …",
    bpm: 200,
    notes: [[60, 1], [60, 1], [62, 1], [64, 1], [60, 1], [64, 1], [62, 2], [60, 1], [60, 1], [62, 1], [64, 1], [60, 2], [59, 2]],
  },
];

/** The n-th time Johnny sings (0-based): always one of the same five, in the same order. */
const FIRST: Song = SONGS[0] ?? { title: "", line: "", bpm: 120, notes: [] };

export function songFor(n: number): Song {
  return SONGS[((n % SONGS.length) + SONGS.length) % SONGS.length] ?? FIRST;
}

/** Seconds a melody takes. */
export function songSeconds(song: Song): number {
  return (song.notes.reduce((s, [, beats]) => s + beats, 0) * 60) / song.bpm;
}

/** What the banner cries: funny the first time round, then less and less. */
export function songCry(n: number): string {
  const song = songFor(n);
  const round = Math.floor(n / SONGS.length);
  if (round === 0) return `♪ „${song.title}“ – Lied ${String(n + 1)} von angeblich 30!`;
  if (round === 1) return `♪ Schon wieder „${song.title}“ …`;
  return `♪ NICHT SCHON WIEDER „${song.title.toUpperCase()}“!`;
}

/** How Johnny parrots what was said: the first vowel stretched, asked back, then sung out. */
export function parrot(text: string): string {
  const said = text.trim().replace(/[.!?…]+$/u, "");
  if (said === "") return "";
  const stretched = said.replace(/[aeiouäöüy]/iu, (v) => v + v.toLowerCase().repeat(2));
  return `„${said}?“ – „${stretched}!“ ♪`;
}

type Grid = readonly string[];

/** An eighth note ♪ and a pair of beamed notes ♫. */
const NOTE: Grid = [
  "....kk.",
  "....kwk",
  "....k.wk",
  "....k..k",
  "....k...",
  "....k...",
  ".kkkk...",
  "kwwwk...",
  "kwwwk...",
  ".kkk....",
];

const NOTES: Grid = [
  "....kkkkkkk",
  "....kwwwwwk",
  "....kkkkkkk",
  "....k.....k",
  "....k.....k",
  "....k.....k",
  ".kkkk..kkkk",
  "kwwwk.kwwwk",
  "kwwwk.kwwwk",
  ".kkk...kkk.",
];

function gridImage(grid: Grid, color: readonly [number, number, number]): PixelImage {
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [y, row] of grid.entries()) {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch !== "k" && ch !== "w") continue;
      const c: readonly [number, number, number] = ch === "k" ? [0x1a, 0x10, 0x20] : color;
      const i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The colours of Johnny's notes: the lights in the toy (green, pink, blue, gold). */
export const NOTE_COLORS: readonly (readonly [number, number, number])[] = [
  [0x8c, 0xe8, 0x5a],
  [0xf0, 0x6a, 0xb8],
  [0x6a, 0xc8, 0xf8],
  [0xf8, 0xd8, 0x48],
];

/** A music note to fly through the arena – single or beamed, in one of the toy's light colours. */
export function noteImage(beamed: boolean, color: readonly [number, number, number]): PixelImage {
  return gridImage(beamed ? NOTES : NOTE, color);
}
