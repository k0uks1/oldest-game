import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Form } from "../engine/types.ts";

/** Four-step ramp: shadow, base, light, highlight. */
export type Ramp = readonly [string, string, string, string];

export interface SpritePalette {
  readonly main: Ramp;
  readonly second: Ramp;
  readonly glow: string;
  readonly outline: string;
}

interface Swatch {
  readonly ramp: Ramp;
  readonly glow: string;
}

/**
 * The game's colour language. Tags are checked in priority order against the
 * form's *expanded* closure – so a new tag inheriting from `feuer` is drawn
 * in fire colours automatically.
 */
const SWATCHES: readonly (readonly [string, Swatch])[] = [
  ["daemonisch", { ramp: ["#2a0610", "#6e1024", "#b8263a", "#ff6a5a"], glow: "#ffdd33" }],
  ["untot", { ramp: ["#1e2418", "#4a5440", "#8a9478", "#d0d8b8"], glow: "#7dff6a" }],
  ["heilig", { ramp: ["#5a3d10", "#b48428", "#f0c850", "#fff6c0"], glow: "#ffffff" }],
  ["feuer", { ramp: ["#4a1208", "#a3300f", "#e8641c", "#ffc64a"], glow: "#fff3a0" }],
  ["eis", { ramp: ["#1b2a4a", "#3a6ea5", "#7fc6e8", "#e6fbff"], glow: "#ffffff" }],
  ["blitz", { ramp: ["#1a1a40", "#3c3cb0", "#7a8cff", "#e8f0ff"], glow: "#ffffff" }],
  ["schatten", { ramp: ["#12081c", "#2c1840", "#4f2e6e", "#8a62b0"], glow: "#d04dff" }],
  ["gift", { ramp: ["#10280e", "#2e6a1c", "#62b030", "#c8f060"], glow: "#f0ff80" }],
  ["traum", { ramp: ["#1a1030", "#4a2a7a", "#9a6ad0", "#f0c8ff"], glow: "#fff0ff" }],
  ["licht", { ramp: ["#5a4a20", "#b09a40", "#f0e080", "#fffbe0"], glow: "#ffffff" }],
  ["kristall", { ramp: ["#1c1440", "#4a3aa0", "#8a78e8", "#e8e0ff"], glow: "#ffffff" }],
  ["gold", { ramp: ["#4a3308", "#9a6e14", "#e0b030", "#fff0a0"], glow: "#ffffff" }],
  ["silber", { ramp: ["#303440", "#6a7488", "#b4bccc", "#f4f8ff"], glow: "#aef" }],
  ["metall", { ramp: ["#22262e", "#4c5564", "#8c97a8", "#dde4ee"], glow: "#ffe070" }],
  ["wasser", { ramp: ["#0e2240", "#1c4f8a", "#3f8fc9", "#9fe0f0"], glow: "#e0ffff" }],
  ["luft", { ramp: ["#3a4a5a", "#7a8ea4", "#b8c8d8", "#f4f8ff"], glow: "#ffffff" }],
  ["chaotisch", { ramp: ["#2a0a2a", "#7a1a6a", "#d0409a", "#ffa0d0"], glow: "#80ffea" }],
  ["stein", { ramp: ["#241f1c", "#4e4640", "#857a6e", "#c4b8a4"], glow: "#ffb040" }],
  ["holz", { ramp: ["#2a160a", "#5c3418", "#9a6232", "#d49a5c"], glow: "#ffd080" }],
  ["pflanze", { ramp: ["#0c2412", "#1f5a28", "#3f9a3c", "#9ae070"], glow: "#fff080" }],
  ["knochen", { ramp: ["#3a3428", "#7a7058", "#bcb294", "#f0ead0"], glow: "#ff5040" }],
  ["mensch", { ramp: ["#2a1c20", "#6a4640", "#b07a60", "#f0c8a0"], glow: "#ffe0a0" }],
  ["tier", { ramp: ["#2e1a12", "#6a4028", "#a8744a", "#e0b889"], glow: "#ffd040" }],
];

const PLANE_DEFAULT: Readonly<Record<Form["plane"], Swatch>> = {
  materie: { ramp: ["#22202a", "#4a4658", "#8a849c", "#d0cce0"], glow: "#ffe070" },
  leben: { ramp: ["#1a2a1a", "#3a5a3a", "#6a9a5a", "#c0e0a0"], glow: "#fff080" },
  geist: { ramp: ["#101c2c", "#2a4a6a", "#5a8ab8", "#bfe4ff"], glow: "#ffffff" },
  abstrakt: { ramp: ["#140c2a", "#3a2466", "#7a4ab8", "#d8a8ff"], glow: "#ffffff" },
};

export const OUTLINE = "#0b0812";

export function paletteFor(onto: Ontology, form: Form): SpritePalette {
  const matches = SWATCHES.filter(([tag]) => onto.formHas(form, tag)).map(([, s]) => s);
  const fallback = PLANE_DEFAULT[form.plane];
  const main = matches[0] ?? fallback;
  const second = matches[1] ?? (main === fallback ? PLANE_DEFAULT.abstrakt : fallback);
  return { main: main.ramp, second: second.ramp, glow: main.glow, outline: OUTLINE };
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = Array.from(h, (c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
