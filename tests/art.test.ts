import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { coreOntology } from "../src/content/index.ts";
import artJson from "../src/content/core/art.json" with { type: "json" };
import promptsJson from "../src/content/core/art-prompts.json" with { type: "json" };
import { parsePack } from "../src/engine/ontology/pack.ts";
import { ART_MAX_SIDE, artFor, artGlow, decodeArt, encodeArt, upscale } from "../src/render/art.ts";
import type { PixelImage } from "../src/render/sprite.ts";
import { decodePng } from "../server/png.ts";

function image(w: number, h: number, colours: number): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((x + y) % 5 === 0) continue; // transparent holes
      const k = (x * 7 + y * 13) % colours;
      data.set([(k * 37) % 256, (k * 91) % 256, (k * 53) % 256, 255], i);
    }
  }
  return { width: w, height: h, data };
}

function png(img: PixelImage): Uint8Array {
  const crc = (b: Buffer): number => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (t: string, d: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 4 + 1)] = y % 2 === 0 ? 0 : 2; // mix "none" and "up" filters
    for (let x = 0; x < img.width * 4; x++) {
      const v = img.data[y * img.width * 4 + x] ?? 0;
      const up = y > 0 ? (img.data[(y - 1) * img.width * 4 + x] ?? 0) : 0;
      raw[y * (img.width * 4 + 1) + 1 + x] = y % 2 === 0 ? v : (v - up) & 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("art codec", () => {
  it("round-trips pixels exactly (few colours, transparency)", () => {
    const img = image(64, 64, 24);
    const back = decodeArt(encodeArt(img));
    assert.ok(back);
    assert.equal(back.width, 64);
    assert.deepEqual([...back.data], [...img.data]);
  });

  it("merges beyond 255 colours instead of failing", () => {
    const back = decodeArt(encodeArt(image(64, 64, 400)));
    assert.ok(back);
  });

  it("rejects malformed, oversized and truncated art", () => {
    assert.equal(decodeArt("hallo"), undefined);
    assert.equal(decodeArt(`${String(ART_MAX_SIDE + 1)}.1..AAAA`), undefined);
    const good = encodeArt(image(16, 16, 4));
    assert.equal(decodeArt(good.slice(0, -4)), undefined);
  });

  it("upscales by integer factors and finds glowing pixels", () => {
    const img = image(8, 8, 3);
    assert.equal(upscale(img, 2).width, 16);
    const hot: PixelImage = { width: 1, height: 1, data: new Uint8ClampedArray([255, 200, 40, 255]) };
    assert.equal(artGlow(hot, false).data[3], 200);
  });
});

describe("png decoder (server/scripts)", () => {
  it("decodes an RGBA png with filters", () => {
    const img = image(20, 12, 9);
    const back = decodePng(png(img));
    assert.ok(back);
    assert.deepEqual([...back.data], [...img.data]);
  });

  it("rejects what is not a png", () => {
    assert.equal(decodePng(new Uint8Array([1, 2, 3])), undefined);
  });
});

describe("core art", () => {
  const onto = coreOntology();
  it("every entry belongs to a lexicon form and decodes", () => {
    for (const [id, raw] of Object.entries(artJson as Record<string, string>)) {
      assert.ok(onto.formById(id), `art for unknown form ${id}`);
      assert.ok(decodeArt(raw), `art for ${id} does not decode`);
    }
  });

  it("every lexicon form has an image prompt (new forms need one too)", () => {
    const prompts = promptsJson as Record<string, string>;
    const missing = onto.lexicon.filter((f) => (prompts[f.id] ?? "").trim() === "").map((f) => f.id);
    assert.deepEqual(missing, []);
    for (const id of Object.keys(prompts)) assert.ok(onto.formById(id), `prompt for unknown form ${id}`);
  });

  it("a form's own art wins over the atlas", () => {
    const f = onto.formById("jaeger");
    assert.ok(f);
    const own = encodeArt(image(32, 32, 3));
    assert.equal(artFor({ ...f, art: own })?.width, 32);
  });

  it("learned packs cannot smuggle anything else in as art", () => {
    const pack = (art: unknown): unknown => ({
      id: "p", name: "p", version: "1", tags: [], verbs: [], modifiers: [],
      forms: [{ id: "f", name: "F", archetype: "orb", scale: 1, plane: "materie", tags: ["fest"], art }],
    });
    assert.equal(parsePack(pack("<script>")).ok, false);
    assert.equal(parsePack(pack(encodeArt(image(8, 8, 2)))).ok, true);
  });
});
