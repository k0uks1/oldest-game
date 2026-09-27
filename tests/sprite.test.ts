import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { ARCHETYPES } from "../src/engine/types.ts";
import { MASKS } from "../src/render/masks.ts";
import { paletteFor } from "../src/render/palette.ts";
import { epx, renderSprite, upscalePasses } from "../src/render/sprite.ts";

const onto = coreOntology();

describe("sprites", () => {
  it("every archetype has a 16×16 mask with only known symbols", () => {
    for (const a of ARCHETYPES) {
      const m = MASKS[a];
      assert.equal(m.length, 16, a);
      for (const row of m) {
        assert.equal(row.length, 16, `${a}: ${row}`);
        assert.match(row, /^[.#+o*]+$/, a);
      }
    }
  });

  it("EPX doubles resolution, keeps interiors solid and rounds outer corners", () => {
    const g = epx([
      ["#", "#"],
      ["#", "#"],
    ]);
    assert.equal(g.length, 4);
    assert.equal(g[0]?.length, 4);
    for (const [x, y] of [[1, 1], [1, 2], [2, 1], [2, 2]] as const) assert.equal(g[y]?.[x], "#");
    assert.equal(g[0]?.[0], ".", "corner against empty space is rounded off");
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
