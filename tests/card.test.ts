import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { Form } from "../src/engine/types.ts";
import { formCard, shortLabel } from "../src/game/card.ts";
import { emptyLearnedPack, learn } from "../src/llm/learning.ts";
import { formFromLlm, loreOf } from "../src/llm/parser.ts";
import { parseClientMsg } from "../src/online/protocol.ts";
import { LoreStore } from "../server/lore-store.ts";

const core = loadPack(CORE_PACK_RAW);
const onto = Ontology.compile([core]);
const lx = (id: string): Form => {
  const f = onto.formById(id);
  assert.ok(f);
  return f;
};

const gast = {
  name: "Ungeladener Gast mit Zwiebel-Atem",
  base: "mann",
  scale: 3,
  plane: "leben",
  archetype: "humanoid",
  properties: ["Zwiebel-Atem"],
  mechanisms: ["blendet"],
  weaknesses: [],
  intended_mechanism: null,
  zusaetze: ["ungeladen", "mit Zwiebel-Atem"],
  ton: "albern",
  geschichte: "Er kam zur Hochzeit, ohne Einladung, aber mit Zwiebeln. Seither meiden ihn Brautpaare und Vampire gleichermaßen. Man sagt, sein Hauch habe einmal eine Kerze gelöscht.",
  new_properties: [{ name: "Zwiebel-Atem", art: "kann", parents: ["reizend"] }],
};

describe("form card", () => {
  it("says what a form is, can do (and through what) and where it is weak", () => {
    const card = formCard(onto, lx("ritter"));
    assert.equal(card.scaleName, "menschengroß");
    assert.ok(card.is.includes("Stahl"));
    const pierce = card.can.find((a) => a.label === "durchbohrt");
    assert.equal(pierce?.via, "spitz", "the ability it comes from – without its explanation in brackets");
    assert.ok(card.weak.length > 0);
    assert.equal(shortLabel("scharf (Klinge, Schneide)"), "scharf");
  });

  it("modifications are visible: the base, the player's words and what changed", () => {
    const r = formFromLlm(onto, gast, "ungeladener Gast mit Zwiebel-Atem");
    assert.ok(r);
    assert.equal(r.form.base, "mann");
    assert.deepEqual(r.form.mods, ["ungeladen", "mit Zwiebel-Atem"]);
    assert.equal(r.form.tone, "albern");
    const l = learn([core], emptyLearnedPack(), "ungeladener Gast mit Zwiebel-Atem", r.form, r.delta);
    assert.ok(l.ok, l.ok ? "" : l.reason);
    const card = formCard(l.value.onto, l.value.form);
    assert.deepEqual(card.base, { id: "mann", name: "Mann" });
    assert.deepEqual(card.mods, ["ungeladen", "mit Zwiebel-Atem"]);
    assert.deepEqual(card.added, ["Zwiebel-Atem"]);
    assert.ok(card.can.some((a) => a.label === "blendet" && a.via === "Zwiebel-Atem"), "the modification does something");
    assert.match(card.lore ?? "", /Zwiebeln/);
    assert.equal(card.tone, "albern");
    assert.equal(card.learned, true);
  });

  it("a legend is clipped at a sentence end; too short is none", () => {
    assert.equal(loreOf("kurz"), undefined);
    const long = "Ein Satz über eine uralte Gestalt. ".repeat(20);
    const clipped = loreOf(long);
    assert.ok(clipped !== undefined && clipped.length <= 480 && clipped.endsWith("."));
  });
});

describe("legends on the server", () => {
  it("writes each legend once, merges parallel asks, keeps a budget and remembers across restarts", async () => {
    const dir = await import("node:fs").then((fs) => fs.mkdtempSync(`${(process.env["TMPDIR"] ?? "/tmp").replace(/\/$/, "")}/lore-`));
    const file = `${dir}/lore.json`;
    let calls = 0;
    const store = new LoreStore({
      write: (f) => {
        calls++;
        return Promise.resolve(`Die Legende von ${f.name}, erzählt am Feuer.`);
      },
      file,
      perHour: 2,
    });
    const [a, b] = await Promise.all([store.get(lx("wolf")), store.get(lx("wolf"))]);
    assert.equal(a, b);
    assert.equal(calls, 1);
    await store.get(lx("hai"));
    assert.equal(await store.get(lx("loewe")), undefined, "hourly budget spent");
    const again = new LoreStore({ file, perHour: 0 });
    assert.equal(await again.get(lx("wolf")), "Die Legende von Wolf, erzählt am Feuer.");
    assert.equal(await again.get({ ...lx("wolf"), lore: "eigene" }), "eigene", "a form's own legend wins");
  });

  it("the protocol carries lore requests", () => {
    assert.deepEqual(parseClientMsg(JSON.stringify({ t: "lore", id: "wolf" })), { t: "lore", id: "wolf" });
    assert.equal(parseClientMsg(JSON.stringify({ t: "lore", id: "" })), undefined);
  });
});
