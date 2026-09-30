import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { checkCounter, findCounters } from "../src/engine/rules.ts";
import { namedForm } from "../src/engine/parse.ts";
import { signatureFor } from "../src/render/eichel.ts";
import { artFor, alphaBox, figureSize, SLENDER_MAX } from "../src/render/art.ts";
import { displaySize } from "../src/render/sprite.ts";
import { chooseRoom } from "../src/render/rooms.ts";
import { isJohnny, parrot, songCry, songFor, SONGS } from "../src/render/johnny.ts";

describe("Johnny Gnadenlos, the singing cactus", () => {
  const onto = coreOntology();
  const f = (id: string) => onto.formById(id) ?? assert.fail(id);

  it("is in the grimoire from the start, brings his picture and can still be beaten", () => {
    const johnny = f("johnny_gnadenlos");
    assert.ok(onto.lexicon.includes(johnny));
    assert.ok(artFor(johnny) !== undefined, "picture");
    assert.ok(findCounters(onto, johnny).length > 0, "counterable");
  });

  it("annoys, shows off, ridicules and mirrors – anything spoken or sung", () => {
    const verbs = onto.compileForm(f("johnny_gnadenlos")).verbs;
    for (const v of ["nervt", "stellt_zur_schau", "zieht_ins_laecherliche", "aefft_nach"]) assert.ok(verbs.includes(v), v);
    assert.ok(checkCounter(onto, f("johnny_gnadenlos"), f("witz"), "aefft_nach").valid, "mirrors a joke");
    assert.ok(checkCounter(onto, f("johnny_gnadenlos"), f("wiegenlied"), "nervt").valid, "annoys a lullaby");
    assert.ok(!checkCounter(onto, f("johnny_gnadenlos"), f("drache"), "aefft_nach").valid, "a dragon is no word");
    // the mimicry needs the ability – a plain cactus cannot do it
    assert.ok(!onto.compileForm(f("kaktus")).verbs.includes("aefft_nach"));
  });

  it("beats the eloquent: Martin Luther's theses are parroted and ridiculed", () => {
    const johnny = f("johnny_gnadenlos");
    for (const v of ["zieht_ins_laecherliche", "aefft_nach", "nervt", "stellt_zur_schau"]) assert.ok(checkCounter(onto, johnny, f("martin_luther"), v).valid, v);
    for (const id of ["politiker", "priester", "dichter", "anwalt"]) assert.ok(findCounters(onto, f(id)).some((c) => c.form === johnny), id);
    assert.equal(namedForm(onto, "Martin Luther")?.id, "martin_luther");
    assert.equal(namedForm(onto, "Luther")?.id, "martin_luther");
  });

  it("the name picks the show", () => {
    assert.equal(signatureFor("Johnny Gnadenlos"), "klassiker");
    assert.equal(signatureFor("ein singender Kaktus"), "klassiker");
    assert.equal(signatureFor("Kaktus"), null);
    assert.ok(isJohnny("Jonny"));
  });

  it("claims thirty songs, sings the same five in a row – and gets more tiresome", () => {
    assert.equal(SONGS.length, 5);
    assert.equal(songFor(0), songFor(5));
    assert.notEqual(songFor(0), songFor(1));
    assert.match(songCry(0), /30/);
    assert.match(songCry(5), /Schon wieder/);
    assert.match(songCry(12), /NICHT SCHON WIEDER/);
  });

  it("parrots what was said, first vowel stretched", () => {
    assert.equal(parrot("Drache"), "„Drache?“ – „Draaache!“ ♪");
    assert.equal(parrot("Echo"), "„Echo?“ – „Eeecho!“ ♪");
    assert.equal(parrot("  "), "");
  });

  it("the cactus arena comes with any cactus, at once", () => {
    const all = (): boolean => true;
    assert.equal(chooseRoom(onto, [], [f("johnny_gnadenlos")], all)?.id, "kaktus");
    assert.equal(chooseRoom(onto, [], [f("kaktus")], all)?.id, "kaktus", "the plain cactus is only scale 2");
    for (const id of ["cowboy", "kojote", "klapperschlange", "wueste"]) assert.equal(chooseRoom(onto, [], [f(id)], all)?.id, "kaktus", `${id}: Wild West`);
  });

  it("stands tall in the arena: the figure, not the picture with its margins, sets the size", () => {
    const art = artFor(f("johnny_gnadenlos")) ?? assert.fail();
    const box = alphaBox(art) ?? assert.fail();
    const size = figureSize(box.w, box.h, displaySize(3));
    assert.ok(size.h > displaySize(3), `slender Johnny grows: ${String(size.h)}`);
    assert.ok(size.h <= Math.round(displaySize(3) * SLENDER_MAX));
  });
});

describe("figureSize", () => {
  it("a sturdy figure fills its display size on the long side, whatever the picture's margins", () => {
    assert.deepEqual(figureSize(100, 100, 64), { w: 64, h: 64 });
    assert.deepEqual(figureSize(50, 40, 64), { w: 64, h: 51 });
  });
  it("a slender one grows, but never past SLENDER_MAX", () => {
    const s = figureSize(20, 100, 64);
    assert.equal(s.h, Math.round(64 * SLENDER_MAX));
  });
});
