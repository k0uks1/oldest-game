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
