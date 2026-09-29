import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { EMPTY_MASK, fitMask, maskOf, morphCell, solidAt, type Mask } from "../src/render/morph.ts";
import { renderSprite, type PixelImage } from "../src/render/sprite.ts";

/** A w×h picture, solid where `solid(x, y)`. */
function picture(w: number, h: number, solid: (x: number, y: number) => boolean): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
}

const count = (m: Mask): number => m.bits.reduce((a, b) => a + b, 0);

function shownCells(from: Mask, to: Mask, t: number): Set<string> {
  const out = new Set<string>();
  const w = Math.max(from.w, to.w);
  for (let y = 0; y < Math.max(from.h, to.h); y++) {
    for (let x = -w; x <= w; x++) if (morphCell(from, to, x, y, t, 7) !== "off") out.add(`${String(x)},${String(y)}`);
  }
  return out;
}

function solidCells(m: Mask): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < m.h; y++) for (let x = -m.w; x <= m.w; x++) if (solidAt(m, x, y)) out.add(`${String(x)},${String(y)}`);
  return out;
}

describe("Beschwörungsmatrix – shapes melting into one another", () => {
  it("a mask is the figure's outline in cells, without empty margins", () => {
    // a 4×8 block in a 20×20 picture, cells of 2 px
    const m = maskOf(picture(20, 20, (x, y) => x >= 6 && x < 10 && y >= 10 && y < 18), 2);
    assert.deepEqual([m.w, m.h, count(m)], [2, 4, 8]);
    assert.equal(maskOf(picture(8, 8, () => false), 2), EMPTY_MASK);
  });

  it("stands on its bottom centre: the lowest row is y 0", () => {
    const m = maskOf(picture(6, 6, (x, y) => y === 5 || x === 3), 1);
    assert.ok(solidAt(m, 0, 0) && solidAt(m, 0, 5));
    assert.ok(!solidAt(m, 0, 6) && !solidAt(m, 9, 0));
  });

  it("passing shapes are fitted to the size of the one to come, aspect kept", () => {
    const tall = maskOf(picture(10, 40, () => true), 1);
    const f = fitMask(tall, 20, 20);
    assert.deepEqual([f.w, f.h], [5, 20]);
  });

  it("starts as the old shape, ends as the new one, and grows from the ground up", () => {
    const a = maskOf(picture(6, 12, () => true), 1);
    const b = maskOf(picture(12, 6, () => true), 1);
    assert.deepEqual(shownCells(a, b, 0), solidCells(a));
    assert.deepEqual(shownCells(a, b, 1), solidCells(b));
    const grow = (y: number): number => [...shownCells(EMPTY_MASK, a, 0.35)].filter((k) => k.endsWith(`,${String(y)}`)).length;
    assert.ok(grow(0) > grow(11), "the bottom row comes first");
  });

  it("the border burns: edge cells outline the shape", () => {
    const a = maskOf(picture(8, 8, () => true), 1);
    assert.equal(morphCell(a, a, 0, 3, 1, 1), "solid");
    assert.equal(morphCell(a, a, -4, 3, 1, 1), "edge");
    assert.equal(morphCell(a, a, 0, 7, 1, 1), "edge");
  });

  it("real sprites give usable shapes", () => {
    const onto = coreOntology();
    const wolf = onto.formById("wolf");
    assert.ok(wolf);
    const m = maskOf(renderSprite(onto, wolf), 2);
    assert.ok(m.w > 4 && m.h > 4 && count(m) > 10);
  });
});
