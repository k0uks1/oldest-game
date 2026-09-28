/**
 * Generated sprite art ("Kunst"): pixel art made by an image service (PixelLab) once per form,
 * stored in a compact, pure format so the browser, the server and the single-file build all
 * decode it synchronously without a canvas or the network.
 *
 * Format (one string): `w.h.palette.data`
 *   - `palette`: concatenated `rrggbbaa` hex, index 0 is always transparent and not listed
 *   - `data`: base64 of run-length pairs `[run-1, index]` (runs up to 256) over the rows
 *
 * Pixel art has few colours and large empty areas, so a 64×64 sprite is typically 1–3 KB.
 */
import type { Form } from "../engine/types.ts";
import type { PixelImage } from "./sprite.ts";

/** Hard limits – art may come from learned packs (untrusted JSON). */
export const ART_MAX_SIDE = 256;
export const ART_MAX_LENGTH = 160_000;
const MAX_COLOURS = 255;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += (B64[(n >> 18) & 63] ?? "") + (B64[(n >> 12) & 63] ?? "");
    out += b === undefined ? "=" : (B64[(n >> 6) & 63] ?? "");
    out += c === undefined ? "=" : (B64[n & 63] ?? "");
  }
  return out;
}

function fromBase64(s: string): number[] | undefined {
  const clean = s.replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) return undefined;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

/**
 * RGBA → art string. Alpha below 128 counts as transparent (pixel art has no soft edges);
 * more than 255 colours are merged to the nearest kept colour.
 */
export function encodeArt(img: PixelImage): string {
  const { width: w, height: h, data } = img;
  const counts = new Map<number, number>();
  const key = (i: number): number => {
    if ((data[i + 3] ?? 0) < 128) return -1;
    return (((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0)) >>> 0;
  };
  for (let i = 0; i < w * h * 4; i += 4) {
    const k = key(i);
    if (k >= 0) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const kept = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, MAX_COLOURS).map(([k]) => k);
  const index = new Map(kept.map((k, i) => [k, i + 1]));
  const nearest = (k: number): number => {
    let best = 1;
    let bestD = Infinity;
    for (const [i, c] of kept.entries()) {
      const d = ((k >> 16) - (c >> 16)) ** 2 + (((k >> 8) & 255) - ((c >> 8) & 255)) ** 2 + ((k & 255) - (c & 255)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    }
    return best;
  };
  const runs: number[] = [];
  let prev = -1;
  let run = 0;
  const flush = (): void => {
    if (run > 0) runs.push(run - 1, prev);
  };
  for (let i = 0; i < w * h * 4; i += 4) {
    const k = key(i);
    const idx = k < 0 ? 0 : (index.get(k) ?? nearest(k));
    if (idx === prev && run < 256) run++;
    else {
      flush();
      prev = idx;
      run = 1;
    }
  }
  flush();
  const palette = kept.map((k) => `${k.toString(16).padStart(6, "0")}ff`).join("");
  return `${String(w)}.${String(h)}.${palette}.${toBase64(runs)}`;
}

/** Art string → RGBA, or undefined if malformed / too large (never throws). */
export function decodeArt(art: string): PixelImage | undefined {
  if (art.length > ART_MAX_LENGTH) return undefined;
  const m = /^(\d{1,3})\.(\d{1,3})\.((?:[0-9a-f]{8})*)\.([A-Za-z0-9+/]*={0,2})$/.exec(art);
  if (m === null) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const pal = m[3] ?? "";
  if (w < 1 || h < 1 || w > ART_MAX_SIDE || h > ART_MAX_SIDE) return undefined;
  const colours: number[][] = [[0, 0, 0, 0]];
  for (let i = 0; i < pal.length; i += 8) colours.push([0, 2, 4, 6].map((o) => Number.parseInt(pal.slice(i + o, i + o + 2), 16)));
  const runs = fromBase64(m[4] ?? "");
  if (runs === undefined || runs.length % 2 !== 0) return undefined;
  const data = new Uint8ClampedArray(w * h * 4);
  let p = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const n = (runs[i] ?? 0) + 1;
    const c = colours[runs[i + 1] ?? 0];
    if (c === undefined || p + n > w * h) return undefined;
    for (let k = 0; k < n; k++, p++) data.set(c, p * 4);
  }
  return p === w * h ? { width: w, height: h, data } : undefined;
}

/** Nearest-neighbour resample to any size (pixel art stays crisp; same size = unchanged). */
export function resample(img: PixelImage, width: number, height: number): PixelImage {
  if (width === img.width && height === img.height) return img;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / width));
      const s = (sy * img.width + sx) * 4;
      data.set(img.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Nearest-neighbour upscale by an integer factor (small art in a big sprite slot). */
export function upscale(img: PixelImage, factor: number): PixelImage {
  if (factor <= 1) return img;
  const w = img.width * factor;
  const h = img.height * factor;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
      data.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

/**
 * Bloom mask for art: the brightest, most saturated pixels glow (flames, eyes, gems);
 * for light-emitting forms the whole body glows faintly.
 */
export function artGlow(img: PixelImage, emissive: boolean): PixelImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] ?? 0;
    if (a === 0) continue;
    const r = img.data[i] ?? 0;
    const g = img.data[i + 1] ?? 0;
    const b = img.data[i + 2] ?? 0;
    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    const hot = max > 225 && sat > 0.45;
    const alpha = hot ? 200 : emissive && max > 150 ? 90 : 0;
    if (alpha === 0) continue;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return { width: img.width, height: img.height, data };
}

// ── Where art comes from ───────────────────────────────────────────────────

/**
 * Generated pictures carry this many pixels per sprite pixel: a 64 px sprite slot shows a 128 px
 * picture at half size – same size on screen, twice the detail (the arena renders at this density).
 */
export const ART_DENSITY = 2;

const decoded = new Map<string, PixelImage | null>();
/** Pictures received at runtime (from the game server), by form id. */
const received = new Map<string, string>();

function decodeOnce(raw: string): PixelImage | undefined {
  let img = decoded.get(raw);
  if (img === undefined) {
    img = decodeArt(raw) ?? null;
    decoded.set(raw, img);
  }
  return img ?? undefined;
}

/** Remember a picture the server sent for a form. Returns false if it does not decode. */
export function registerArt(formId: string, art: string): boolean {
  if (decodeOnce(art) === undefined) return false;
  received.set(formId, art);
  return true;
}

export function hasArt(form: Pick<Form, "id" | "art">): boolean {
  return received.has(form.id) || form.art !== undefined;
}

/** A form's picture: received from the server, else one stored in its (learned) spec. */
export function artFor(form: Pick<Form, "id" | "art">): PixelImage | undefined {
  const raw = received.get(form.id) ?? form.art;
  return raw === undefined ? undefined : decodeOnce(raw);
}
