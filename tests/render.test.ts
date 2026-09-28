import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { colorNum } from "../src/render/pixi-arena.ts";

describe("PixiJS arena helpers", () => {
  it("parses the colour strings the simulation uses", () => {
    assert.equal(colorNum("#ffb040"), 0xffb040);
    assert.equal(colorNum("#fff"), 0xffffff);
    assert.equal(colorNum("#ABC"), 0xaabbcc);
    assert.equal(colorNum("rgb(12, 34, 56)"), 0x0c2238);
    assert.equal(colorNum("rgb(255,0,128)"), 0xff0080);
    assert.equal(colorNum("unbekannt"), 0xffffff, "unknown → white, never a crash");
  });
});

describe("arena scenery (stage)", () => {
  it("isometric wall bricks stay on the walls, spare pillar and torches, crumble top-down", async () => {
    const { ISO, FLAT, TORCH_X, scatterStars } = await import("../src/render/stage.ts");
    const bricks = ISO.wallBricks();
    assert.ok(bricks.length > 150, `only ${String(bricks.length)} bricks`);
    for (const b of bricks) {
      assert.ok(b.threshold > 0 && b.threshold < 1);
      assert.ok(b.cols !== undefined && b.cols.length >= 3);
      for (const [x, y0, y1] of b.cols) {
        const floor = 120 + Math.round(Math.abs(x - 240) * 0.5);
        assert.ok(y1 <= floor && y0 >= floor - 170 && y1 > y0, `brick column ${String(x)} leaves the wall`);
        assert.ok(x < 225 || x >= 255, "the corner pillar stays");
      }
      assert.ok(!TORCH_X.some((tx) => b.x < tx + 4 && b.x + b.w > tx - 4 && b.y < 98 && b.y + b.h > 86), "torch brackets stay");
    }
    const avg = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const high = bricks.filter((b) => b.y + b.h / 2 < 60).map((b) => b.threshold);
    const low = bricks.filter((b) => b.y + b.h / 2 > 150).map((b) => b.threshold);
    assert.ok(avg(high) < avg(low), "upper bricks go first");
    for (const s of scatterStars(bricks)) {
      const col = bricks[s.brick]?.cols?.find(([x]) => x === s.x);
      assert.ok(col !== undefined && s.y >= col[1] && s.y < col[2], "stars sit inside their brick");
    }
    assert.equal(FLAT.wallBricks().every((b) => b.cols === undefined), true);
    assert.notDeepEqual(ISO.rune, FLAT.rune);
  });
});
