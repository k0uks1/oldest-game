import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseColor, parseTransform, pathToSubpaths, rasterizeSvg } from "../src/render/svgraster.ts";
import { rasterizeSketch, SKETCH_EXAMPLES } from "../src/render/svgsprite.ts";

/** Opaque pixels as a set of "x,y" – easy to compare shapes. */
function opaque(px: Uint8ClampedArray, size: number): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((px[(y * size + x) * 4 + 3] ?? 0) > 0) out.add(`${String(x)},${String(y)}`);
  return out;
}

function rgbAt(px: Uint8ClampedArray, size: number, x: number, y: number): number[] {
  const i = (y * size + x) * 4;
  return [px[i] ?? -1, px[i + 1] ?? -1, px[i + 2] ?? -1, px[i + 3] ?? -1];
}

const svg = (body: string, vb = "0 0 32 32"): string => `<svg viewBox="${vb}">${body}</svg>`;

describe("SVG rasterizer (pure, identical in browser and server)", () => {
  it("fills a rect exactly on pixel centres, honouring the viewBox scale", () => {
    const px = rasterizeSvg(svg('<rect x="2" y="4" width="10" height="6" fill="#808080"/>'), 64);
    assert.ok(px);
    const o = opaque(px, 64);
    assert.equal(o.size, 20 * 12, "10×6 units at scale 2");
    assert.ok(o.has("4,8") && o.has("23,19") && !o.has("24,19") && !o.has("3,8"));
    assert.deepEqual(rgbAt(px, 64, 10, 10), [128, 128, 128, 255]);
  });

  it("centres a non-square viewBox (xMidYMid meet) and offsets its origin", () => {
    const px = rasterizeSvg(svg('<rect x="10" y="0" width="10" height="10" fill="#fff"/>', "10 0 20 10"), 20);
    assert.ok(px);
    const o = opaque(px, 20);
    // 20×10 → scale 1, centred vertically (+5)
    assert.equal(o.size, 100);
    assert.ok(o.has("0,5") && o.has("9,14") && !o.has("0,4"));
  });

  it("circles and ellipses cover about πr²", () => {
    const c = opaque(rasterizeSvg(svg('<circle cx="16" cy="16" r="12"/>'), 128) ?? new Uint8ClampedArray(), 128).size;
    const expect = Math.PI * 48 * 48;
    assert.ok(Math.abs(c - expect) / expect < 0.02, `circle ${String(c)} vs ${String(expect)}`);
    const e = opaque(rasterizeSvg(svg('<ellipse cx="16" cy="16" rx="12" ry="6"/>'), 128) ?? new Uint8ClampedArray(), 128).size;
    assert.ok(Math.abs(e - expect / 2) / (expect / 2) < 0.02);
  });

  it("paths: lines, relative commands, curves, arcs and implicit repeats", () => {
    const tri = pathToSubpaths("M0 0 L10 0 l0 10 z");
    assert.deepEqual(tri.closed, [true]);
    assert.deepEqual(tri.paths[0]?.at(-1), [0, 0]);
    const rep = pathToSubpaths("M0 0 10 0 10 10");
    assert.deepEqual(rep.paths[0], [[0, 0], [10, 0], [10, 10]], "numbers after M are line-tos");
    const hv = pathToSubpaths("M1 1 H5 v4 h-4 Z");
    assert.deepEqual(hv.paths[0]?.slice(0, 4), [[1, 1], [5, 1], [5, 5], [1, 5]]);
    // half disc via arc: area ≈ πr²/2
    const half = opaque(rasterizeSvg(svg('<path d="M4 20 A12 12 0 0 1 28 20 Z"/>'), 128) ?? new Uint8ClampedArray(), 128).size;
    const expect = (Math.PI * 48 * 48) / 2;
    assert.ok(Math.abs(half - expect) / expect < 0.03, `arc ${String(half)} vs ${String(expect)}`);
    const q = pathToSubpaths("M0 0 Q5 10 10 0 T20 0");
    assert.deepEqual(q.paths[0]?.at(-1), [20, 0]);
    const cs = pathToSubpaths("M0 0 C0 5 5 5 5 0 S10 -5 10 0");
    assert.deepEqual(cs.paths[0]?.at(-1), [10, 0]);
  });

  it("non-zero fill keeps holes of opposite winding", () => {
    const d = "M0 0 H32 V32 H0 Z M8 8 V24 H24 V8 Z";
    const o = opaque(rasterizeSvg(svg(`<path d="${d}"/>`), 32) ?? new Uint8ClampedArray(), 32);
    assert.equal(o.size, 32 * 32 - 16 * 16);
    assert.ok(!o.has("16,16"));
  });

  it("transforms compose through groups and inherit fill", () => {
    const px = rasterizeSvg(svg('<g fill="#ffd400" transform="translate(10 0)"><g transform="scale(2)"><rect width="2" height="2"/></g></g>'), 32);
    assert.ok(px);
    const o = opaque(px, 32);
    assert.equal(o.size, 16);
    assert.ok(o.has("10,0") && o.has("13,3"));
    assert.deepEqual(rgbAt(px, 32, 11, 1), [255, 212, 0, 255]);
    const rot = parseTransform("rotate(90 16 16)");
    assert.ok(Math.abs(rot[4] - 32) < 1e-9 && Math.abs(rot[5]) < 1e-9);
  });

  it("strokes: butt caps by default, round and square on request; fill none", () => {
    const line = (cap: string): number =>
      opaque(rasterizeSvg(svg(`<line x1="8" y1="16" x2="24" y2="16" stroke="#202020" stroke-width="4"${cap}/>`), 32) ?? new Uint8ClampedArray(), 32).size;
    assert.equal(line(""), 16 * 4);
    assert.equal(line(' stroke-linecap="square"'), 20 * 4);
    assert.ok(line(' stroke-linecap="round"') > 16 * 4);
    const ring = opaque(rasterizeSvg(svg('<rect x="4" y="4" width="24" height="24" fill="none" stroke="#fff" stroke-width="2"/>'), 32) ?? new Uint8ClampedArray(), 32);
    assert.ok(ring.has("4,16") && !ring.has("16,16"), "outline only");
  });

  it("hidden and translucent shapes are skipped; colours parse", () => {
    assert.equal(rasterizeSvg(svg('<rect width="9" height="9" opacity="0.2"/><circle r="3" display="none"/>'), 32), undefined);
    assert.equal(rasterizeSvg(svg('<rect width="9" height="9" fill="none"/>'), 32), undefined);
    assert.equal(rasterizeSvg("kein svg", 32), undefined);
    assert.deepEqual(parseColor("#fd0"), [255, 221, 0]);
    assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3]);
    assert.equal(parseColor("none"), null);
    assert.equal(parseColor(undefined), undefined);
  });

  it("the prompt's examples become the expected sprites", () => {
    const fridge = rasterizeSketch(SKETCH_EXAMPLES.kuehlschrank);
    assert.ok(fridge);
    assert.equal(fridge.length, 32);
    assert.equal(fridge[31], ".".repeat(32), "stands on the ground");
    assert.equal(fridge.filter((r) => r.includes("#")).length, 30, "fills the height");
    const joined = fridge.join("");
    for (const sym of ["#", "+", ",", "*"]) assert.ok(joined.includes(sym), sym);
    const umbrella = rasterizeSketch(SKETCH_EXAMPLES.regenschirm);
    assert.ok(umbrella?.some((r) => r.startsWith("..#") || r.includes("###########")));
    assert.ok(umbrella?.join("").includes(","), "the dark handle survives");
  });

  it("is deterministic and bounded for hostile input", () => {
    const a = rasterizeSketch(SKETCH_EXAMPLES.regenschirm);
    const b = rasterizeSketch(SKETCH_EXAMPLES.regenschirm);
    assert.deepEqual(a, b);
    const huge = svg(`<path d="M0 0 L1e9 1e9 L-1e9 1e9 Z"/><circle cx="16" cy="16" r="1e12"/>`);
    const t = Date.now();
    rasterizeSvg(huge, 128);
    assert.ok(Date.now() - t < 500);
  });
});
