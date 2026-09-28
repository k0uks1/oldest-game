import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { validPixelArt } from "../src/engine/pixelart.ts";
import { formFromLlm } from "../src/llm/parser.ts";
import { paletteFor } from "../src/render/palette.ts";
import { fitSketch, opaqueBounds, pixelsToRows, rasterizeSketch, sanitizeSketch, SKETCH_EXAMPLES, tintOf } from "../src/render/svgsprite.ts";

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

  it("fitSketch crops a small drawing and fits it into the frame, standing on the ground", () => {
    const size = 128;
    const px = new Uint8ClampedArray(size * size * 4);
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 20; x++) {
        const i = (y * size + x) * 4;
        px[i] = 128;
        px[i + 1] = 128;
        px[i + 2] = 128;
        px[i + 3] = 255;
      }
    }
    const rows = fitSketch(px, size);
    assert.ok(rows);
    assert.equal(rows.length, 32);
    assert.equal(rows.filter((r) => r.includes("#")).length, 30, "fills the height (32 − 2 margin)");
    assert.ok(rows[30]?.includes("#") === true && rows[31] === ".".repeat(32), "stands on the ground");
    assert.equal(fitSketch(new Uint8ClampedArray(size * size * 4), size), undefined);
  });

  it("32×32 grids are valid sprites", () => {
    const rows = Array.from({ length: 32 }, (_, y) => (y >= 4 && y < 28 ? `${".".repeat(8)}${"#".repeat(16)}${".".repeat(8)}` : ".".repeat(32)));
    assert.ok(validPixelArt(rows));
  });

  it("the parser keeps a sketch only for brand-new, non-living forms", () => {
    const thing = formFromLlm(onto, { name: "Zahnseide-Automat", base: null, scale: 1, plane: "materie", archetype: "box", properties: ["metall", "maschine", "bindend"], mechanisms: ["fesselt"], skizze: SKETCH_EXAMPLES.kuehlschrank }, "Zahnseide-Automat");
    assert.ok(thing?.sketch?.includes("<rect"));
    const beast = formFromLlm(onto, { name: "Glitzerotter", base: null, scale: 2, plane: "leben", archetype: "beast", properties: ["saeugetier", "klauen"], mechanisms: ["zerreisst"], skizze: SKETCH_EXAMPLES.kuehlschrank }, "Glitzerotter");
    assert.ok(beast);
    assert.equal(beast.sketch, undefined);
  });
});

describe("hand-drawn sketches for everyday things (core content)", () => {
  it("every sketch belongs to a core form, rasterizes to a valid sprite and wins over the archetype mask", async () => {
    const { default: sketches } = await import("../src/content/core/sketches.json", { with: { type: "json" } });
    const { buildGrid } = await import("../src/render/sprite.ts");
    const { MASKS } = await import("../src/render/masks.ts");
    const entries = Object.entries(sketches as Record<string, string>);
    assert.ok(entries.length >= 150);
    for (const [id, svg] of entries) {
      const form = onto.formById(id);
      assert.ok(form, `${id}: no such core form`);
      assert.equal(form.sketch, svg, `${id}: sketch reaches the form`);
      assert.equal(form.sprite, undefined, `${id}: has pixel art already`);
      const rows = validPixelArt(rasterizeSketch(svg));
      assert.ok(rows, `${id}: sketch does not rasterize`);
      const grid = buildGrid(onto, form);
      const { sketch: drawn, ...plain } = form;
      assert.ok(drawn);
      const mask = buildGrid(onto, plain);
      assert.notDeepEqual(grid, mask, `${id}: still drawn as the ${form.archetype} mask`);
      assert.ok(MASKS[form.archetype]);
    }
  });

  it("colour hints survive sanitizing and only accept hex", () => {
    const svg = sanitizeSketch('<svg viewBox="0 0 32 32" data-main="#C83028" data-second="red" onload="x()"><rect width="9" height="9"/></svg>');
    assert.ok(svg);
    assert.deepEqual(tintOf(svg), { main: "#c83028" });
    assert.ok(!svg.includes("onload"));
    assert.deepEqual(tintOf("<svg>"), {});
  });

  it("a tint colours the sprite (a tomato is red although it is a plant)", () => {
    const tomate = onto.formById("tomate");
    assert.ok(tomate?.sketch);
    const pal = paletteFor(onto, tomate);
    assert.equal(pal.main[2], "#d83020");
    const { sketch: drawn, ...plain } = tomate;
    assert.ok(drawn);
    assert.notEqual(paletteFor(onto, plain).main[2], "#d83020");
  });
});

describe("learned things keep their colour hints", () => {
  it("pixel art draws, the stored sketch still tints", async () => {
    const { learn, emptyLearnedPack } = await import("../src/llm/learning.ts");
    const { CORE_PACK_RAW, loadPack } = await import("../src/content/index.ts");
    const core = loadPack(CORE_PACK_RAW);
    const svg = sanitizeSketch(SKETCH_EXAMPLES.kuehlschrank.replace("<svg ", '<svg data-main="#3070c0" '));
    assert.ok(svg);
    const rows = validPixelArt(rasterizeSketch(svg));
    assert.ok(rows);
    const r = formFromLlm(onto, { name: "Blauer Zahnseide-Automat", base: null, scale: 1, plane: "materie", archetype: "box", properties: ["metall", "maschine", "bindend"], mechanisms: ["fesselt"], skizze: svg }, "Blauer Zahnseide-Automat");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "Blauer Zahnseide-Automat", { ...r.form, sprite: rows, sketch: svg }, r.delta);
    assert.ok(l.ok);
    const form = l.value.onto.formById(l.value.form.id);
    assert.ok(form?.sprite && form.sketch);
    assert.equal(paletteFor(l.value.onto, form).main[2], "#3070c0");
  });
});
