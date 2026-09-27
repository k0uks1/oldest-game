import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { ARCHETYPES } from "../src/engine/types.ts";
import { ATTIRE, FIGURES, VARIANTS } from "../src/render/figures.ts";
import { MASKS } from "../src/render/masks.ts";
import { paletteFor } from "../src/render/palette.ts";
import { buildGrid, epx, renderSprite, upscalePasses } from "../src/render/sprite.ts";

const onto = coreOntology();

describe("sprites", () => {
  it("every archetype has a 16×16 mask with only known symbols", () => {
    for (const a of ARCHETYPES) {
      const m = MASKS[a];
      assert.equal(m.length, 16, a);
      for (const row of m) {
        assert.equal(row.length, 16, `${a}: ${row}`);
        assert.match(row, /^[.#+o*,]+$/, a);
      }
    }
  });

  it("detailed figures and attire overlays are 32 wide with known symbols", () => {
    for (const [a, rows] of Object.entries(FIGURES)) {
      assert.equal(rows.length, 32, a);
      for (const row of rows) assert.match(row, /^[.#+o*,]{32}$/, `${a}: ${row}`);
    }
    for (const at of ATTIRE) {
      assert.ok(at.overlay.rows.length <= 32, at.name);
      for (const row of at.overlay.rows) assert.match(row, /^[.#+o*,_]{32}$/, `${at.name}: ${row}`);
    }
  });

  it("weapon variants are valid 32×32 figures, and hammer ≠ sword ≠ spear", () => {
    for (const list of Object.values(VARIANTS)) {
      for (const v of list) {
        assert.equal(v.rows.length, 32, v.name);
        for (const row of v.rows) assert.match(row, /^[.#+o*,]{32}$/, `${v.name}: ${row}`);
      }
    }
    const shape = (id: string): string => {
      const f = onto.formById(id);
      assert.ok(f, id);
      return buildGrid(onto, { ...f, scale: 4 }).map((r) => r.join("")).join("\n");
    };
    const ids = ["kriegshammer", "schwert", "speer", "axt", "bogen", "zauberstab"];
    assert.equal(new Set(ids.map(shape)).size, ids.length);
  });

  it("people are dressed by their tags (knight ≠ farmer ≠ mage)", () => {
    const grid = (id: string): string => {
      const f = onto.formById(id);
      assert.ok(f, id);
      return buildGrid(onto, f).map((r) => r.join("")).join("\n");
    };
    const ids = ["bauer", "ritter", "magier", "erzengel", "koenig"];
    const grids = new Set(ids.map((id) => grid(id).replace(/[#+]/g, "x")));
    assert.equal(grids.size, ids.length);
  });

  it("EPX doubles resolution, keeps interiors solid and rounds outer corners", () => {
    const g = epx([
      ["#", "#"],
      ["#", "#"],
    ]);
    assert.equal(g.length, 4);
    const row0 = g[0];
    assert.ok(row0);
    assert.equal(row0.length, 4);
    for (const [x, y] of [[1, 1], [1, 2], [2, 1], [2, 2]] as const) assert.equal(g[y]?.[x], "#");
    assert.equal(row0[0], ".", "corner against empty space is rounded off");
  });

  it("sprite size follows scale with constant pixel size", () => {
    const wolf = onto.formById("wolf");
    const sun = onto.formById("sonne");
    assert.ok(wolf && sun);
    assert.equal(renderSprite(onto, wolf).width, 16 * 2 ** upscalePasses(wolf.scale) + 2);
    assert.ok(renderSprite(onto, sun).width > renderSprite(onto, wolf).width);
  });

  it("is deterministic", () => {
    const f = onto.formById("drache");
    assert.ok(f);
    assert.deepEqual(renderSprite(onto, f).data, renderSprite(onto, f).data);
  });

  it("palette follows the expanded closure (fire forms look fiery)", () => {
    const f = onto.formById("feuerelementar");
    assert.ok(f);
    assert.equal(paletteFor(onto, f).main[1], "#a3300f");
  });
});

describe("pixel art drawn by Claude", () => {
  const blanket = [
    "................",
    "................",
    "..############..",
    ".#++++++++++++#.",
    ".#+,++++++,+++#.",
    ".##############.",
    ".#++++++++++++#.",
    ".#++,+++++,+++#.",
    ".##############.",
    "..#++++++++++#..",
    "..#++,++++,++#..",
    "...##########...",
    "................",
    "................",
    "................",
    "................",
  ];

  it("accepts one clear shape, tolerates spaces and stray symbols", async () => {
    const { validPixelArt } = await import("../src/engine/pixelart.ts");
    assert.ok(validPixelArt(blanket));
    assert.ok(validPixelArt(blanket.map((r) => r.replaceAll(".", " "))));
    assert.equal(validPixelArt(blanket.map((r) => r.replaceAll("#", "X")))?.[2], "..############..");
  });

  it("rejects wrong sizes, empty frames and scattered noise", async () => {
    const { validPixelArt } = await import("../src/engine/pixelart.ts");
    assert.equal(validPixelArt(blanket.slice(1)), undefined);
    assert.equal(validPixelArt(Array.from({ length: 16 }, () => ".".repeat(16))), undefined);
    const noise = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => ((x + y) % 2 === 0 ? "#" : ".")).join(""));
    assert.equal(validPixelArt(noise), undefined);
  });

  it("a form with custom pixel art is drawn from it, not from its archetype", () => {
    const sword = onto.formById("schwert");
    assert.ok(sword);
    const custom = { ...sword, id: "g:loeschdecke", name: "Löschdecke", sprite: blanket };
    const a = buildGrid(onto, custom).map((r) => r.join("")).join("");
    const b = buildGrid(onto, sword).map((r) => r.join("")).join("");
    assert.notEqual(a, b);
  });
});
