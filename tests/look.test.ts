import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { parsePack } from "../src/engine/ontology/pack.ts";
import type { Form } from "../src/engine/types.ts";
import { lookOf } from "../src/llm/parser.ts";
import { heldItem, ITEM_IDS, ITEMS, itemRows, knownLook, sketchOf, symbolSvg } from "../src/render/look.ts";
import { paletteFor } from "../src/render/palette.ts";
import { buildGrid } from "../src/render/sprite.ts";
import { tintOf } from "../src/render/svgsprite.ts";

const onto = coreOntology();

function lx(id: string): Form {
  const f = onto.formById(id);
  assert.ok(f, `lexicon entry ${id} missing`);
  return f;
}

const has = (grid: readonly (readonly string[])[], c: string): boolean => grid.some((row) => row.includes(c));

describe("part library", () => {
  it("every item names a symbol that exists", () => {
    for (const it of ITEMS.values()) assert.ok(symbolSvg(it.symbol), `${it.id} → ${it.symbol}`);
  });

  it("every look in the core content names known parts", () => {
    let n = 0;
    for (const f of onto.lexicon) {
      if (f.look === undefined) continue;
      n++;
      assert.deepEqual(knownLook(f.look), f.look, f.id);
    }
    assert.ok(n > 80, `only ${String(n)} forms have a look`);
  });

  it("a held item sits in the right hand, in the item's own colour symbols", () => {
    const rows = itemRows("harke");
    assert.ok(rows);
    const cells = rows.flatMap((r, y) => Array.from(r).flatMap((c, x) => (c === "m" || c === "n" ? [{ x, y }] : [])));
    assert.ok(cells.length > 20);
    assert.ok(cells.every((p) => p.x >= 14), "nothing on the left half");
    assert.ok(cells.some((p) => p.y >= 22 && p.y <= 25 && p.x >= 20 && p.x <= 24), "reaches the hand");
  });
});

describe("people hold things (Kiki: Jäger → Flinte, Gärtner → Harke, Bäcker → Brot)", () => {
  it("the hunter, the gardener and the baker carry their tools", () => {
    for (const [id, item] of [["jaeger", "flinte"], ["gaertnerin", "harke"], ["baecker", "brot"]] as const) {
      const f = lx(id);
      assert.equal(heldItem(f)?.id, item);
      assert.ok(has(buildGrid(onto, f), "m"), `${id} shows its ${item}`);
      assert.ok(paletteFor(onto, f).item, `${id} has item colours`);
    }
  });

  it("only people and giants have hands", () => {
    const f: Form = { ...lx("wolf"), look: { holds: "flinte" } };
    assert.equal(heldItem(f), undefined);
    assert.ok(!has(buildGrid(onto, f), "m"));
  });
});

describe("concepts become emblems", () => {
  it("emblem + badge compose into one sketch; the badge brings the second colour", () => {
    const f: Form = { ...lx("hoffnung"), id: "x_korruption", look: { emblem: "geldsack", badge: "krone" } };
    const svg = sketchOf(f);
    assert.ok(svg);
    const tint = tintOf(svg);
    assert.equal(tint.main, "#b08850");
    assert.equal(tint.second, "#e0b030");
  });

  it("an explicit colour wins over the symbol's own", () => {
    const svg = sketchOf({ ...lx("hoffnung"), look: { emblem: "geldsack", main: "#123456" } });
    assert.ok(svg);
    assert.equal(tintOf(svg).main, "#123456");
  });

  it("the core concepts without own art use emblems (Verrat: Maske und Dolch)", () => {
    assert.deepEqual(lx("verrat").look, { emblem: "theatermaske", badge: "dolch" });
    assert.ok(sketchOf(lx("verrat")));
  });
});

describe("validation", () => {
  it("Claude's aussehen keeps only known parts", () => {
    assert.deepEqual(lookOf({ haelt: "flinte", emblem: "gibtsnicht", farbe: "rot" }), { holds: "flinte" });
    assert.equal(lookOf({ emblem: "gibtsnicht" }), undefined);
    assert.deepEqual(lookOf({ emblem: "geldsack", abzeichen: "krone", farbe: "#AABBCC" }), { emblem: "geldsack", badge: "krone", main: "#aabbcc" });
  });

  it("packs reject malformed looks", () => {
    const pack = (look: unknown): unknown => ({
      id: "p", name: "p", version: "1", tags: [], verbs: [], modifiers: [],
      forms: [{ id: "f", name: "F", archetype: "orb", scale: 1, plane: "materie", tags: ["fest"], look }],
    });
    assert.equal(parsePack(pack({ emblem: "<svg>" })).ok, false);
    assert.equal(parsePack(pack({ main: "red" })).ok, false);
    assert.equal(parsePack(pack({ emblem: "krone", main: "#AA0000" })).ok, true);
  });

  it("the prompt offers every item", () => {
    assert.ok(ITEM_IDS.includes("flinte") && ITEM_IDS.includes("harke") && ITEM_IDS.includes("brot"));
  });
});
