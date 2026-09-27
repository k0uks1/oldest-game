import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEXICON_BY_ID } from "../src/content/forms.ts";
import { createGame, evaluateForm, pass, play } from "../src/engine/game.ts";
import { toForm } from "../src/engine/parse.ts";
import type { Form, GameState } from "../src/engine/types.ts";

function lx(id: string): Form {
  const e = LEXICON_BY_ID.get(id);
  assert.ok(e, id);
  return toForm(e);
}

function must(r: ReturnType<typeof play>): GameState {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
}

describe("game flow", () => {
  it("starts in opening phase with player 0", () => {
    const g = createGame(["A", "B"]);
    assert.equal(g.phase, "opening");
    assert.equal(g.active, 0);
  });

  it("opening must be small", () => {
    const g = createGame(["A", "B"]);
    const r = play(g, lx("drache"), null);
    assert.equal(r.ok, false);
  });

  it("plays a short Sandman-like duel", () => {
    let g = createGame(["Morpheus", "Choronzon"]);
    g = must(play(g, lx("wolf"), null));
    assert.equal(g.active, 1);
    g = must(play(g, lx("jaeger"), "durchbohrt"));
    g = must(play(g, lx("schlange"), "vergiftet"));
    assert.equal(g.phase, "playing");
    assert.equal(g.history.length, 3);
  });

  it("rejects repeated forms", () => {
    let g = createGame(["A", "B"]);
    g = must(play(g, lx("wolf"), null));
    g = must(play(g, lx("jaeger"), "durchbohrt"));
    const r = play(g, lx("wolf"), null);
    assert.equal(r.ok, false);
  });

  it("echo rule forbids repeating a mechanism immediately", () => {
    let g = createGame(["A", "B"]);
    g = must(play(g, lx("ritter"), null));
    g = must(play(g, lx("rost"), "rostet"));
    // Rost is metal-free, but let's play another rust-like move against an Uhrwerk later
    const opts = evaluateForm(g, lx("kerze"));
    assert.ok(opts.every((o) => o.verb !== "rostet"));
  });

  it("charges wille and refunds underdogs", () => {
    let g = createGame(["A", "B"]);
    g = must(play(g, lx("ritter"), null));
    const before = g.players[1].wille;
    g = must(play(g, lx("rost"), "rostet"));
    const move = g.history.at(-1);
    assert.ok(move);
    assert.ok(move.refund > 0, "rust (1) beating knight (3) should refund");
    assert.equal(g.players[1].wille, Math.min(30, before - move.cost + move.refund));
    assert.ok(g.players[1].eleganz > 0);
  });

  it("passing loses", () => {
    let g = createGame(["A", "B"]);
    g = must(play(g, lx("wolf"), null));
    g = pass(g);
    assert.equal(g.phase, "finished");
    assert.equal(g.winner, 0);
  });

  it("cannot afford cosmic forms from the start", () => {
    let g = createGame(["A", "B"]);
    g = must(play(g, lx("katze"), null));
    // A galaxy is too big anyway; check wille with something affordable-but-pricey
    const r = play(g, lx("vulkan"), null);
    assert.equal(r.ok, false);
  });
});
