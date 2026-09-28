/**
 * Sprite contact sheet as PNG – for eyeballing sprites and the part library.
 *
 *   npm run sheet -- items                     every held item in a hunter's hands
 *   npm run sheet -- emblems geldsack+krone,waage   composed emblems (emblem+badge, comma-separated)
 *   npm run sheet -- jaeger,verrat,drache      lexicon forms by id
 *
 * Optional last argument: output path (default sheet.png).
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { coreOntology } from "../src/content/index.ts";
import { renderSprite, type PixelImage } from "../src/render/sprite.ts";
import type { Form } from "../src/engine/types.ts";
import { ITEM_IDS } from "../src/render/look.ts";

const o = coreOntology();
const mode = process.argv[2] ?? "items";
const forms: Form[] = [];
const base = (id: string): Form => { const f = o.formById(id); if (!f) throw new Error(id); return f; };
if (mode === "items") {
  for (const it of ITEM_IDS) forms.push({ ...base("jaeger"), id: `x_${it}`, look: { holds: it } });
} else if (mode === "emblems") {
  const pairs = (process.argv[3] ?? "").split(",").map((p) => p.split("+"));
  for (const [e, b] of pairs) {
    const h = base("hoffnung");
    const look = { emblem: e ?? "", ...(b === undefined ? {} : { badge: b }) };
    forms.push({ id: `e_${e ?? ""}_${b ?? ""}`, name: h.name, archetype: "orb", scale: h.scale, plane: h.plane, tags: h.tags, not: h.not, verbs: h.verbs, immune: h.immune, weak: h.weak, origin: "komponiert", look });
  }
} else {
  for (const id of mode.split(",")) forms.push(base(id));
}
const S = 3, cell = 70, cols = 10;
const imgs = forms.map((f) => renderSprite(o, f));
const W = cols * cell * S, H = Math.ceil(imgs.length / cols) * cell * S;
const buf = Buffer.alloc(W * H * 4, 0);
for (let i = 0; i < W * H; i++) { buf[i * 4] = 40; buf[i * 4 + 1] = 34; buf[i * 4 + 2] = 52; buf[i * 4 + 3] = 255; }
imgs.forEach((im: PixelImage, n) => {
  const k = Math.max(1, Math.floor((cell - 4) / Math.max(im.width, im.height)));
  const ox = (n % cols) * cell * S, oy = Math.floor(n / cols) * cell * S;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const a = im.data[(y * im.width + x) * 4 + 3] ?? 0; if (a < 128) continue;
    for (let dy = 0; dy < k * S; dy++) for (let dx = 0; dx < k * S; dx++) {
      const X = ox + x * k * S + dx, Y = oy + y * k * S + dy; if (X >= W || Y >= H) continue;
      for (let c = 0; c < 3; c++) buf[(Y * W + X) * 4 + c] = im.data[(y * im.width + x) * 4 + c] ?? 0;
    }
  }
});
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const crc = (b: Buffer): number => { let c = ~0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t: string, d: Buffer): Buffer => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync((mode === "emblems" ? process.argv[4] : process.argv[3]) ?? "sheet.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(forms.map((f) => f.look?.holds ?? f.look?.emblem ?? f.id).join(" "));
