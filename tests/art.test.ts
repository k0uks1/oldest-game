import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { coreOntology } from "../src/content/index.ts";
import promptsJson from "../src/content/core/art-prompts.json" with { type: "json" };
import { parsePack } from "../src/engine/ontology/pack.ts";
import { ART_MAX_SIDE, artFor, artGlow, decodeArt, encodeArt, registerArt, resample, upscale } from "../src/render/art.ts";
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
  it("every lexicon form has an image prompt (new forms need one too)", () => {
    const prompts = promptsJson as Record<string, string>;
    const missing = onto.lexicon.filter((f) => (prompts[f.id] ?? "").trim() === "").map((f) => f.id);
    assert.deepEqual(missing, []);
    for (const id of Object.keys(prompts)) assert.ok(onto.formById(id), `prompt for unknown form ${id}`);
  });

  it("pictures from the server win over art stored in a (learned) spec", () => {
    const f = onto.formById("jaeger");
    assert.ok(f);
    assert.equal(artFor(f), undefined);
    assert.equal(artFor({ ...f, art: encodeArt(image(32, 32, 3)) })?.width, 32);
    assert.equal(registerArt("jaeger", encodeArt(image(128, 128, 5))), true);
    assert.equal(artFor({ ...f, art: encodeArt(image(32, 32, 3)) })?.width, 128);
    assert.equal(registerArt("jaeger", "kaputt"), false);
  });

  it("resamples nearest-neighbour to any size", () => {
    const img = image(8, 8, 3);
    const up = resample(img, 16, 16);
    assert.equal(up.width, 16);
    assert.deepEqual([...up.data.subarray(0, 4)], [...img.data.subarray(0, 4)]);
    assert.equal(resample(img, 8, 8), img);
    assert.equal(resample(up, 8, 8).width, 8);
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

describe("pictures fill their place", () => {
  it("transparent margins are cut away; animation frames share one crop", async () => {
    const { alphaBox, crop, trimmed, unionBox } = await import("../src/render/art.ts");
    const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    const dot = (x: number, y: number): void => {
      img.data[(y * 8 + x) * 4 + 3] = 255;
    };
    dot(2, 3);
    dot(5, 6);
    assert.deepEqual(alphaBox(img), { x: 2, y: 3, w: 4, h: 4 });
    assert.deepEqual([trimmed(img).width, trimmed(img).height], [4, 4]);
    assert.equal(crop(img, { x: 0, y: 0, w: 8, h: 8 }), img, "nothing to cut: same image");
    assert.deepEqual(unionBox([{ x: 2, y: 3, w: 4, h: 4 }, undefined, { x: 1, y: 5, w: 2, h: 3 }]), { x: 1, y: 3, w: 5, h: 5 });
    assert.equal(alphaBox({ width: 2, height: 2, data: new Uint8ClampedArray(16) }), undefined);
  });

  it("a finer size ladder: a cat is not a flea, a dragon not a knight – pictures made at exactly twice that", async () => {
    const { displaySize } = await import("../src/render/sprite.ts");
    const { artSize } = await import("../server/art-prompts.ts");
    const ladder = [1, 2, 3, 4, 5, 6, 7, 8].map(displaySize);
    for (let i = 1; i < ladder.length; i++) assert.ok((ladder[i] ?? 0) >= (ladder[i - 1] ?? 0));
    assert.ok(displaySize(2) > displaySize(1) && displaySize(5) > displaySize(3));
    assert.equal(displaySize(3), 64, "people keep their size (and their stored pictures)");
    for (let s = 1; s <= 8; s++) assert.ok(artSize(s) === displaySize(s) * 2 && artSize(s) <= 256);
  });
});
