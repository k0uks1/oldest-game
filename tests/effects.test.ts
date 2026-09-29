/**
 * Painted attacks and the living room: a fixed library of PixelLab animations, chosen for the
 * winner (mechanism, what it holds, what it is) and for the room's mood (arena field first, then
 * the forms on stage). Presentation only – these tests check the choice and the catalogs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { Form } from "../src/engine/types.ts";
import { ITEM_IDS } from "../src/render/look.ts";
import { chooseEffect, EFFECTS } from "../src/render/effects.ts";
import { chooseRoom, ROOMS } from "../src/render/rooms.ts";

const onto = Ontology.compile([loadPack(CORE_PACK_RAW)]);
const lx = (id: string): Form => {
  const f = onto.formById(id);
  assert.ok(f, id);
  return f;
};
const all = (): boolean => true;
const effect = (id: string, verb: string, available: (id: string) => boolean = all): string | undefined => chooseEffect(onto, lx(id), verb, available)?.id;

describe("Angriffe – the effect fits the winner", () => {
  it("what it holds and what it is sharpen the mechanism", () => {
    assert.equal(effect("jaeger", "durchbohrt"), "bullet", "the hunter's rifle fires");
    assert.equal(effect("ritter", "durchbohrt"), "pierce", "a knight pierces with the point – no gun, no bow");
    assert.equal(effect("ritter", "zerschneidet"), "slash", "and cuts with his sword");
    assert.equal(effect("drache", "verbrennt"), "fireball");
    assert.equal(effect("wolf", "zerreisst"), "claws");
    assert.equal(effect("jaeger", "fesselt"), "chains", "the mechanism outweighs the rifle");
  });

  it("only what is painted – else the drawn particles stay", () => {
    assert.equal(effect("jaeger", "durchbohrt", (id) => id !== "bullet"), "pierce");
    assert.equal(effect("wolf", "zerreisst", () => false), undefined);
  });

  it("every core mechanism has a painted effect; tags, items and verbs in the catalog exist", () => {
    for (const v of onto.verbs.values()) assert.ok(EFFECTS.some((e) => e.verbs.includes(v.spec.id)), `${v.spec.id}: kein Effekt in effects.json`);
    for (const e of EFFECTS) {
      for (const t of e.tags) assert.ok(onto.hasTag(t), `${e.id}: Eigenschaft ${t}`);
      for (const i of e.items) assert.ok(ITEM_IDS.includes(i), `${e.id}: Gegenstand ${i}`);
      for (const v of e.verbs) assert.ok(onto.verbs.has(v), `${e.id}: Mechanismus ${v}`);
    }
    assert.equal(new Set(EFFECTS.map((e) => e.id)).size, EFFECTS.length);
  });
});

describe("Lebender Raum – the room takes on the mood", () => {
  const room = (fields: readonly string[], ids: readonly string[], available: (id: string) => boolean = all): string | undefined =>
    chooseRoom(onto, fields, ids.map(lx), available)?.id;

  it("an arena field wins (the newest), then the forms on stage – newest first", () => {
    assert.equal(room(["nass"], ["drache"]), "flut", "the flood outranks the dragon's magic");
    assert.equal(room(["nass", "glut"], []), "brand");
    assert.equal(room([], ["zombie", "hexe"]), "gruft", "the newest form sets the mood");
    assert.equal(room([], ["hexe", "zombie"]), "arkan");
    assert.equal(room([], ["baecker"]), undefined, "a baker leaves the dungeon as it is");
  });

  it("only painted rooms; every field has one; the catalog's names exist", () => {
    assert.equal(room(["nass"], ["zombie"], (id) => id !== "flut"), "gruft");
    for (const f of onto.fields) assert.ok(ROOMS.some((r) => r.field === f.id), `Feld ${f.id} hat keinen Raum`);
    for (const r of ROOMS) for (const t of r.tags ?? []) assert.ok(onto.hasTag(t), `${r.id}: ${t}`);
  });
});
