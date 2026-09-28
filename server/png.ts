/**
 * Minimal PNG decoder (Node only – uses node:zlib): 8-bit RGBA, RGB, grey(+alpha) and palette
 * images, non-interlaced. Enough for what image services return; anything else is rejected.
 */
import { inflateSync } from "node:zlib";

export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(buf: Uint8Array): Rgba | undefined {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) return undefined;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const name = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = body[8] ?? 0;
      type = body[9] ?? 0;
      interlace = body[12] ?? 0;
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") trns = body;
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number | undefined>)[type];
  if (channels === undefined || depth !== 8 || interlace !== 0 || width < 1 || height < 1 || width > 4096 || height > 4096) return undefined;
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return undefined;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= channels ? (px[y * stride + x - channels] ?? 0) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (px[(y - 1) * stride + x - channels] ?? 0) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + pred) & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let rgba: [number, number, number, number];
    if (type === 6) rgba = [px[s] ?? 0, px[s + 1] ?? 0, px[s + 2] ?? 0, px[s + 3] ?? 0];
    else if (type === 2) rgba = [px[s] ?? 0, px[s + 1] ?? 0, px[s + 2] ?? 0, 255];
    else if (type === 4) rgba = [px[s] ?? 0, px[s] ?? 0, px[s] ?? 0, px[s + 1] ?? 0];
    else if (type === 0) rgba = [px[s] ?? 0, px[s] ?? 0, px[s] ?? 0, 255];
    else {
      const k = px[s] ?? 0;
      rgba = [palette?.[k * 3] ?? 0, palette?.[k * 3 + 1] ?? 0, palette?.[k * 3 + 2] ?? 0, trns?.[k] ?? 255];
    }
    data.set(rgba, i * 4);
  }
  return { width, height, data };
}
