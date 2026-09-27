import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { formCost } from "../src/engine/cost.ts";
import { attempt } from "../src/engine/attempt.ts";
import { createGame, evaluateForm, play } from "../src/engine/game.ts";
import { checkCounter as check, checkEscape, ESCAPE } from "../src/engine/rules.ts";
import type { Form } from "../src/engine/types.ts";

const onto = coreOntology();
const checkCounter = (a: Form, t: Form, v: string) => check(onto, a, t, v);

function lx(id: string): Form {
  const e = onto.formById(id);
  assert.ok(e, `lexicon entry ${id} missing`);
  return e;
}

describe("checkCounter – classic interactions", () => {
  it("Hoffnung trotzt dem Ende aller Dinge (the Sandman move)", () => {
    const c = checkCounter(lx("hoffnung"), lx("ende"), "trotzt");
    assert.equal(c.valid, true, c.steps.map((s) => s.text).join("\n"));
    assert.equal(c.weaknessHit, true);
  });

  it("Das Ende beendet keine Hoffnung", () => {
    const c = checkCounter(lx("ende"), lx("hoffnung"), "beendet");
    assert.equal(c.valid, false);
  });

  it("Wasser löscht Feuer – auch wenn es kleiner ist", () => {
    const c = checkCounter(lx("traene"), lx("funke"), "loescht");
    assert.equal(c.valid, true);
  });

  it("Rost besiegt einen Ritter über seine Rüstung", () => {
    const c = checkCounter(lx("rost"), lx("ritter"), "rostet");
    assert.equal(c.valid, true);
    assert.equal(c.hitTag, "eisen");
  });

  it("Ein Floh kann keinen Drachen zerreißen", () => {
    const c = checkCounter(lx("floh"), lx("drache"), "zerreisst");
    assert.equal(c.valid, false);
  });

  it("Brute force needs size: Wolf cannot zerschlagen a Golem", () => {
    const c = checkCounter(lx("wolf"), lx("golem"), "zerreisst");
    assert.equal(c.valid, false);
  });

  it("Supernova gegen Schlange ist maßlos und wird abgelehnt", () => {
    const c = checkCounter(lx("supernova"), lx("schlange"), "verbrennt");
    assert.equal(c.valid, false);
    assert.match(c.steps.at(-1)?.text ?? "", /Maßlos/);
  });

  it("Drache ist immun gegen Feuer", () => {
    const c = checkCounter(lx("fackel"), lx("drache"), "verbrennt");
    assert.equal(c.valid, false);
  });

  it("Ein Wort nennt den wahren Namen des Golems", () => {
    const c = checkCounter(lx("wort"), lx("golem"), "wahrer_name");
    assert.equal(c.valid, true);
  });

  it("verschlingt requires being bigger", () => {
    assert.equal(checkCounter(lx("wolf"), lx("ritter"), "verschlingt").valid, false);
    assert.equal(checkCounter(lx("drache"), lx("ritter"), "verschlingt").valid, true);
  });

  it("a form cannot use a mechanism it does not know", () => {
    const c = checkCounter(lx("katze"), lx("ratte"), "wahrer_name");
    assert.equal(c.valid, false);
  });

  it("tag grants give elemental forms their mechanisms", () => {
    // Kerze has tag feuer → verbrennt via grant
    const c = checkCounter(lx("kerze"), lx("buch"), "verbrennt");
    assert.equal(c.valid, true);
  });

  it("is deterministic", () => {
    const a = checkCounter(lx("liebe"), lx("minotaurus"), "befreundet");
    const b = checkCounter(lx("liebe"), lx("minotaurus"), "befreundet");
    assert.deepEqual(a, b);
  });
});

describe("escalation floor", () => {
  it("a tiny mythic form played late cannot lock the opponent out", () => {
    // Floor 4: answering "Ein Wort" (Stufe 1) with a Stufe-5 form is measured from the floor, not from 1.
    const c = check(onto, lx("lich"), lx("wort"), "entzieht_energie", undefined, 4);
    assert.ok(!(c.steps.at(-1)?.text ?? "").startsWith("Maßlos"), c.steps.map((s) => s.text).join("\n"));
    assert.equal(c.valid, true);
  });
});

describe("taxonomy", () => {
  it("rust works on steel (stahl ⊂ eisen) but not on gold", () => {
    assert.equal(checkCounter(lx("rost"), lx("schwert"), "rostet").valid, true);
    assert.equal(checkCounter(lx("rost"), lx("goldschatz"), "rostet").valid, false);
  });

  it("implications: a Mensch breathes, so it can be drowned", () => {
    assert.ok(onto.formHas(lx("ritter"), "atmet"));
    assert.ok(onto.formHas(lx("ritter"), "fest"), "stahl ⊂ eisen ⊂ metall ⊂ fest");
  });

  it("silver purifies the werewolf through its curse weakness", () => {
    const c = checkCounter(lx("silberkugel"), lx("werwolf"), "laeutert");
    assert.equal(c.valid, true, c.steps.map((s) => s.text).join("\n"));
    assert.equal(c.weaknessHit, true);
  });
});

describe("formCost", () => {
  it("cosmic forms are far more expensive than clever small ones", () => {
    assert.ok(formCost(onto, lx("supernova")).total > 3 * formCost(onto, lx("hoffnung")).total);
  });

  it("is never below 1", () => {
    for (const e of onto.lexicon) assert.ok(formCost(onto, e).total >= 1, e.id);
  });
});

describe("escape (Entkommen)", () => {
  const f = (id: string): Form => {
    const x = onto.formById(id);
    assert.ok(x, id);
    return x;
  };

  it("a hummingbird flies away from a lava flow", () => {
    const r = checkEscape(onto, f("kolibri"), f("lavastrom"));
    assert.ok(r.valid, r.steps.map((s) => s.text).join(" | "));
  });

  it("…but not from a dragon, which follows into the sky", () => {
    assert.equal(checkEscape(onto, f("kolibri"), f("drache")).valid, false);
  });

  it("…nor from a siren's song, which reaches it anywhere", () => {
    assert.equal(checkEscape(onto, f("kolibri"), f("sirene")).valid, false);
  });

  it("…nor from something as vast as the sun", () => {
    assert.equal(checkEscape(onto, f("kolibri"), f("sonne")).valid, false);
  });

  it("a mole burrows away from a charging bull", () => {
    assert.ok(checkEscape(onto, f("maulwurf"), f("stier")).valid);
  });

  it("is offered by the game layer, gives escape eleganz, no refund, and counts for echo", () => {
    let g = createGame(["A", "B"]);
    const opened = play(onto, g, f("wolf"), null);
    assert.ok(opened.ok);
    g = opened.value;
    const r = attempt(onto, g, f("kolibri"), ESCAPE);
    assert.ok(r.kind === "success", r.kind === "failure" ? r.failure.reason : "");
    assert.equal(r.move.verb, ESCAPE);
    assert.equal(r.move.eleganz, g.config.escapeEleganz);
    assert.equal(r.move.refund, 0);
    assert.equal(r.state.history.at(-1)?.form.id, "kolibri");
  });

  it("defeating is preferred over escaping when both work", () => {
    const g0 = play(onto, createGame(["A", "B"]), f("kolibri"), null);
    assert.ok(g0.ok);
    const opts = evaluateForm(onto, g0.value, f("adler")).filter((o) => o.playable);
    if (opts.length > 1) assert.notEqual(opts[0]?.verb, ESCAPE);
  });
});
