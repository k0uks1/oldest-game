/**
 * Beleben mit eigenen Bewegungen: every form gets three moves that fit it – invented ones from their
 * classification, hand-written ones asked once and kept on the server. The client only ever names
 * a position (m0–m2); what the animator is told comes from the server.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { parsePack } from "../src/engine/ontology/pack.ts";
import type { Form } from "../src/engine/types.ts";
import { formFromLlm, movesOf } from "../src/llm/parser.ts";
import { animLabel, animPrompt, parseClientMsg } from "../src/online/protocol.ts";
import { AnimClient, type AnimTransport } from "../src/ui/anim-client.ts";
import { MoveStore } from "../server/lore-store.ts";

const onto = Ontology.compile([loadPack(CORE_PACK_RAW)]);
const lx = (id: string): Form => {
  const f = onto.formById(id);
  assert.ok(f, id);
  return f;
};
const HOWL = [
  { label: "heult den Mond an", action: "howling up at the moon, head raised" },
  { label: "schleicht geduckt", action: "sneaking low, paws stepping carefully" },
  { label: "fletscht die Zähne", action: "baring its teeth, growling" },
];

describe("Beleben – eigene Bewegungen", () => {
  it("Claude's moves are cleaned: one line each, bounded, at most three, no duplicates", () => {
    const m = movesOf([
      { label: "heult\nauf", action: "revving up,\u0007 chain spinning" },
      { label: "Heult auf", action: "again" },
      { label: "", action: "nothing" },
      { name: "sägt", aktion: "sawing the air" },
      { label: "x".repeat(80), action: "y".repeat(300) },
      { label: "vier", action: "four" },
    ]);
    assert.ok(m);
    assert.deepEqual(m[0], { label: "heult auf", action: "revving up, chain spinning" });
    assert.equal(m.length, 3);
    assert.equal(m.at(2)?.label.length, 32);
    assert.equal(m.at(2)?.action.length, 120);
    assert.equal(movesOf("nope"), undefined);
  });

  it("an invented form brings its moves from the classification", () => {
    const r = formFromLlm(
      onto,
      {
        name: "Motorsäge",
        base: null,
        scale: 2,
        plane: "materie",
        archetype: "weapon",
        properties: ["metall", "scharf", "laut"],
        mechanisms: ["zerschneidet"],
        weaknesses: ["metall"],
        intended_mechanism: null,
        bild: "a chainsaw",
        bewegungen: [
          { label: "heult auf", action: "revving up, chain spinning, smoke puffing" },
          { label: "sägt in die Luft", action: "sawing through the air" },
          { label: "tuckert im Leerlauf", action: "idling, shaking slightly" },
        ],
      },
      "Motorsäge",
    );
    assert.ok(r?.form, "classified");
    assert.deepEqual(r.form.moves?.map((m) => m.label), ["heult auf", "sägt in die Luft", "tuckert im Leerlauf"]);
  });

  it("the client names a position – the prompt comes from the form's own moves (or the general ones)", () => {
    assert.equal(animPrompt("m1", HOWL), "sneaking low, paws stepping carefully");
    assert.equal(animPrompt("m2", undefined), undefined, "unknown move: nothing is animated");
    assert.match(animPrompt("atmen", HOWL) ?? "", /breathing/);
    assert.equal(animLabel("m0", HOWL), "heult den Mond an");
    assert.deepEqual(parseClientMsg(JSON.stringify({ t: "animate", action: "m2" })), { t: "animate", action: "m2" });
    assert.equal(parseClientMsg(JSON.stringify({ t: "animate", action: "revving up" })), undefined, "free text never reaches the animator");
    assert.deepEqual(parseClientMsg(JSON.stringify({ t: "moves", id: "wolf" })), { t: "moves", id: "wolf" });
  });

  it("learned forms keep their moves in the pack; broken ones are refused", () => {
    const pack = {
      id: "gelernt",
      name: "Gelernt",
      version: "1",
      tags: [],
      verbs: [],
      modifiers: [],
      forms: [{ ...lx("wolf"), id: "g:heulwolf", name: "Heulwolf", aliases: ["heulwolf"], moves: HOWL, origin: undefined }],
    };
    const ok = parsePack(JSON.parse(JSON.stringify(pack)));
    assert.ok(ok.ok, ok.ok ? "" : ok.errors.join("; "));
    assert.deepEqual(Ontology.compile([loadPack(CORE_PACK_RAW), ok.pack]).formById("g:heulwolf")?.moves, HOWL);
    const bad = parsePack({ ...pack, forms: [{ ...pack.forms[0], moves: [{ label: "x" }] }] });
    assert.equal(bad.ok, false);
  });

  it("the server asks once per form, keeps it across restarts – a form's own moves win", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "moves-")), "moves.json");
    let calls = 0;
    const store = new MoveStore({
      write: () => {
        calls++;
        return Promise.resolve(HOWL);
      },
      file,
      perHour: 5,
    });
    const [a, b] = await Promise.all([store.get(lx("wolf")), store.get(lx("wolf"))]);
    assert.deepEqual(a, HOWL);
    assert.equal(a, b);
    assert.equal(calls, 1);
    const again = new MoveStore({ file, perHour: 0 });
    assert.deepEqual(again.known(lx("wolf")), HOWL);
    assert.equal(again.known(lx("hai")), undefined);
    const own = [{ label: "eigen", action: "own" }];
    assert.deepEqual(again.known({ ...lx("hai"), moves: own }), own);
  });

  it("the browser asks once, waits for the answer, and falls back to the general moves", async () => {
    const client = new AnimClient();
    const asked: string[] = [];
    const transport: AnimTransport = {
      ask: () => undefined,
      moves: (form) => {
        asked.push(form.id);
      },
    };
    client.setTransport(transport);
    const one = client.loadMoves(lx("wolf"));
    const two = client.loadMoves(lx("wolf"));
    client.receiveMoves("wolf", HOWL);
    assert.deepEqual(await one, HOWL);
    assert.deepEqual(await two, HOWL);
    assert.deepEqual(asked, ["wolf"]);
    assert.deepEqual(client.movesOf(lx("wolf")), HOWL);
    assert.deepEqual(await client.loadMoves(lx("hai"), 10), [], "no answer in time: the general ones");
  });
});
