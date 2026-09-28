/**
 * Claude sketches a new form as a tiny SVG (it is far better at shapes than at raw pixel grids);
 * this turns the sketch into a 32×32 grid in the sprite symbol language, which the normal sprite
 * pipeline then colours by tags, shades, outlines and upscales – so it looks like every other form.
 *
 * The SVG is only ever drawn as an <img> (no scripts, no external loads – browsers sandbox SVG
 * images), after stripping anything that is not plain drawing markup.
 */

export const SKETCH_SIZE = 32;

/** The five fills Claude may use – each maps to one sprite symbol. */
export const SKETCH_FILLS: readonly { readonly hex: string; readonly symbol: string; readonly role: string }[] = [
  { hex: "#808080", symbol: "#", role: "Körper (Hauptfarbe)" },
  { hex: "#c0c0c0", symbol: "+", role: "zweite Farbe (Stoff, Glas, Bauch, Füllung)" },
  { hex: "#ffd400", symbol: "o", role: "Leuchten (Augen, Lampen, Displays, Kern)" },
  { hex: "#ffffff", symbol: "*", role: "Glanzlicht" },
  { hex: "#202020", symbol: ",", role: "dunkles Detail (Fugen, Griffe, Schlitze, Öffnungen)" },
];

const ALPHA_MIN = 110;

/** Remove everything that is not plain drawing markup; returns undefined if nothing usable is left. */
export function sanitizeSketch(raw: string): string | undefined {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start < 0 || end < start) return undefined;
  let svg = raw.slice(start, end + 6);
  svg = svg
    .replace(/<(script|style|foreignObject|image|use|a)\b[\s\S]*?(<\/\1>|\/>)/gi, "")
    .replace(/\s(on\w+|href|xlink:href|style)\s*=\s*("[^"]*"|'[^']*')/gi, "");
  // pin the drawing size; keep the model's viewBox (default 0 0 32 32)
  svg = svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const vb = /viewBox\s*=\s*("[^"]*"|'[^']*')/i.exec(tag)?.[1] ?? `"0 0 ${String(SKETCH_SIZE)} ${String(SKETCH_SIZE)}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox=${vb} width="${String(SKETCH_SIZE)}" height="${String(SKETCH_SIZE)}">`;
  });
  return svg.length > 12_000 ? undefined : svg;
}

function nearestSymbol(r: number, g: number, b: number): string {
  let best = "#";
  let bestD = Infinity;
  for (const f of SKETCH_FILLS) {
    const n = Number.parseInt(f.hex.slice(1), 16);
    const d = (r - ((n >> 16) & 255)) ** 2 + (g - ((n >> 8) & 255)) ** 2 + (b - (n & 255)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f.symbol;
    }
  }
  return best;
}

/** RGBA pixels (32×32) → symbol rows. Pure, so it is testable without a browser. */
export function pixelsToRows(data: Uint8ClampedArray, size = SKETCH_SIZE): string[] {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = data[i + 3] ?? 0;
      row += a < ALPHA_MIN ? "." : nearestSymbol(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    }
    rows.push(row);
  }
  return rows;
}

/** Browser only: draw the sanitized sketch and read it back as 32×32 symbol rows. */
export async function rasterizeSketch(raw: string): Promise<string[] | undefined> {
  const svg = sanitizeSketch(raw);
  if (svg === undefined || typeof document === "undefined") return undefined;
  // Render large first, then crop to the drawing and fit it into the frame: models often
  // draw too small or off-centre, and a sprite should always fill its space.
  const big = SKETCH_SIZE * 4;
  const img = new Image(big, big);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/width="\d+" height="\d+"/, `width="${String(big)}" height="${String(big)}"`))}`;
  try {
    await img.decode();
  } catch {
    return undefined;
  }
  const src = document.createElement("canvas");
  src.width = big;
  src.height = big;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (sctx === null) return undefined;
  sctx.drawImage(img, 0, 0, big, big);
  return fitSketch(sctx.getImageData(0, 0, big, big).data, big);
}

/**
 * Pure: a large square RGBA rendering (browser canvas or the server's SVG renderer) → 32×32
 * symbol rows. Crops to the drawing, fits it into the frame (centred, standing on the ground)
 * and averages the covered source pixels – identical results on client and server.
 */
export function fitSketch(data: Uint8ClampedArray, size: number): string[] | undefined {
  const box = opaqueBounds(data, size);
  if (box === undefined) return undefined;
  const N = SKETCH_SIZE;
  const k = (N - 2) / Math.max(box.w, box.h);
  const w = box.w * k;
  const h = box.h * k;
  const ox = (N - w) / 2;
  const oy = N - 1 - h;
  const out = new Uint8ClampedArray(N * N * 4);
  for (let dy = 0; dy < N; dy++) {
    for (let dx = 0; dx < N; dx++) {
      const sx0 = box.x + (dx - ox) / k;
      const sx1 = box.x + (dx + 1 - ox) / k;
      const sy0 = box.y + (dy - oy) / k;
      const sy1 = box.y + (dy + 1 - oy) / k;
      let n = 0;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = Math.max(box.y, Math.floor(sy0)); sy < Math.min(box.y + box.h, Math.ceil(sy1)); sy++) {
        for (let sx = Math.max(box.x, Math.floor(sx0)); sx < Math.min(box.x + box.w, Math.ceil(sx1)); sx++) {
          const i = (sy * size + sx) * 4;
          const al = data[i + 3] ?? 0;
          n++;
          a += al;
          r += (data[i] ?? 0) * al;
          g += (data[i + 1] ?? 0) * al;
          b += (data[i + 2] ?? 0) * al;
        }
      }
      if (n === 0 || a === 0) continue;
      const o = (dy * N + dx) * 4;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a / n;
    }
  }
  return pixelsToRows(out);
}

/** Bounding box of the clearly opaque pixels. */
export function opaqueBounds(data: Uint8ClampedArray, size: number): { x: number; y: number; w: number; h: number } | undefined {
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((data[(y * size + x) * 4 + 3] ?? 0) < ALPHA_MIN) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The drawing instructions, shared by the live parser prompt and offline batch tools. */
export const SKETCH_GUIDE = [
  `Zeichne die Gestalt als kleines SVG: <svg viewBox="0 0 ${String(SKETCH_SIZE)} ${String(SKETCH_SIZE)}">, Seitenansicht, Blick nach rechts.`,
  "Eine klare, sofort erkennbare Silhouette, die den Rahmen gut füllt (ca. 26–30 Einheiten groß), aus höchstens 14 einfachen Formen",
  "(rect, circle, ellipse, polygon, path). Kein Text, keine Verläufe, keine Linien dünner als 2 Einheiten, kein Hintergrund.",
  `Nutze als fill NUR diese Farben: ${SKETCH_FILLS.map((f) => `${f.hex} = ${f.role}`).join("; ")}.`,
  "Die echten Farben setzt das Spiel selbst ein – du wählst nur die Rolle jeder Fläche.",
].join(" ");

/** Two worked examples for the prompt (drawn to the rules above). */
export const SKETCH_EXAMPLES = {
  kuehlschrank:
    '<svg viewBox="0 0 32 32"><rect x="8" y="2" width="16" height="28" rx="2" fill="#808080"/><rect x="10" y="4" width="12" height="8" fill="#c0c0c0"/><rect x="10" y="14" width="12" height="14" fill="#c0c0c0"/><rect x="19" y="6" width="2" height="4" fill="#202020"/><rect x="19" y="16" width="2" height="6" fill="#202020"/><rect x="9" y="3" width="1" height="26" fill="#ffffff"/></svg>',
  regenschirm:
    '<svg viewBox="0 0 32 32"><path d="M2 14 Q16 0 30 14 Q26 11 23 14 Q19 11 16 14 Q13 11 9 14 Q6 11 2 14 Z" fill="#808080"/><rect x="15" y="13" width="2" height="14" fill="#202020"/><path d="M17 26 Q17 30 13 30 L13 28 Q15 28 15 26 Z" fill="#202020"/><path d="M6 10 Q10 6 14 5" stroke="#ffffff" stroke-width="2" fill="none"/></svg>',
} as const;
