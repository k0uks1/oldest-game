import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { validPixelArt } from "../src/engine/pixelart.ts";
import { formFromLlm } from "../src/llm/parser.ts";
import { opaqueBounds, pixelsToRows, sanitizeSketch, SKETCH_EXAMPLES } from "../src/render/svgsprite.ts";

const onto = coreOntology();

describe("SVG sketches for new things", () => {
  it("sanitizes: keeps drawing markup, drops scripts, handlers and links, pins the size", () => {
    const svg = sanitizeSketch(
      `Hier: <svg viewBox="0 0 32 32" onload="alert(1)"><script>alert(2)</script><rect x="1" y="1" width="9" height="9" fill="#808080" onclick="x()"/><a href="https://evil"><circle r="3"/></a><image href="https://x/y.png"/></svg> danke`,
    );
    assert.ok(svg);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'));
    assert.ok(svg.includes("<rect"));
    for (const bad of ["script", "onload", "onclick", "href", "<image", "evil"]) assert.ok(!svg.includes(bad), bad);
    assert.equal(sanitizeSketch("kein svg"), undefined);
  });

  it("maps pixels to the five symbol roles, transparent to '.'", () => {
    const px = new Uint8ClampedArray(32 * 32 * 4);
    const set = (x: number, y: number, rgb: readonly [number, number, number]): void => {
      const i = (y * 32 + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    };
    set(0, 0, [128, 128, 128]);
    set(1, 0, [190, 195, 190]);
    set(2, 0, [250, 210, 10]);
    set(3, 0, [255, 255, 255]);
    set(4, 0, [30, 30, 30]);
    const rows = pixelsToRows(px);
    assert.equal(rows.length, 32);
    assert.equal(rows[0]?.slice(0, 6), "#+o*,.");
    assert.deepEqual(opaqueBounds(px, 32), { x: 0, y: 0, w: 5, h: 1 });
  });

  it("32×32 grids are valid sprites", () => {
    const rows = Array.from({ length: 32 }, (_, y) => (y >= 4 && y < 28 ? `${".".repeat(8)}${"#".repeat(16)}${".".repeat(8)}` : ".".repeat(32)));
    assert.ok(validPixelArt(rows));
  });

  it("the parser keeps a sketch only for brand-new, non-living forms", () => {
    const thing = formFromLlm(onto, { name: "Zahnseide-Automat", base: null, scale: 1, plane: "materie", archetype: "box", properties: ["metall", "maschine"], mechanisms: ["fesselt"], skizze: SKETCH_EXAMPLES.kuehlschrank }, "Zahnseide-Automat");
    assert.ok(thing?.sketch?.includes("<rect"));
    const beast = formFromLlm(onto, { name: "Glitzerotter", base: null, scale: 2, plane: "leben", archetype: "beast", properties: ["saeugetier"], mechanisms: ["zerreisst"], skizze: SKETCH_EXAMPLES.kuehlschrank }, "Glitzerotter");
    assert.ok(beast);
    assert.equal(beast.sketch, undefined);
  });
});
