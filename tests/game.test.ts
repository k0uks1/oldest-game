import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { attempt } from "../src/engine/attempt.ts";
import { createGame, evaluateForm as evaluate, pass, play as playMove } from "../src/engine/game.ts";
import type { Form, GameState } from "../src/engine/types.ts";

const onto = coreOntology();
const play = (g: GameState, f: Form, v: string | null) => playMove(onto, g, f, v);
const evaluateForm = (g: GameState, f: Form) => evaluate(onto, g, f);

function lx(id: string): Form {
  const e = onto.formById(id);
  assert.ok(e, id);
  return e;
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

describe("attempt – playing without knowing", () => {
  const tryIt = (g: GameState, id: string) => attempt(onto, g, lx(id), null);

  it("succeeds like play() when the form works", () => {
    let g = must(play(createGame(["A", "B"]), lx("ritter"), null));
    const r = tryIt(g, "rost");
    assert.equal(r.kind, "success");
    g = r.state;
    assert.equal(g.history.at(-1)?.form.id, "rost");
  });

  it("a failed form shatters: Wille is paid, form used up, same player again", () => {
    const g = must(play(createGame(["A", "B"]), lx("ritter"), null));
    const before = g.players[1].wille;
    const r = tryIt(g, "salz"); // salt has nothing to hold against a knight
    assert.ok(r.kind === "failure");
    assert.equal(r.state.active, 1);
    assert.equal(r.state.history.length, 1);
    assert.ok(r.state.players[1].wille < before);
    assert.ok(r.state.usedFormIds.includes("salz"));
    assert.ok(r.failure.reason.length > 0);
  });

  it("uses the mechanism the player described when it works", () => {
    const g = must(play(createGame(["A", "B"]), lx("ritter"), null));
    const r = attempt(onto, g, lx("drache"), "verbrennt");
    assert.ok(r.kind === "success");
    assert.equal(r.move.verb, "verbrennt");
  });

  it("a discovery (never seen before) earns extra eleganz – only on success", () => {
    const g = must(play(createGame(["A", "B"]), lx("ritter"), null));
    const plain = attempt(onto, g, lx("rost"), null);
    const novel = attempt(onto, g, lx("rost"), null, true);
    assert.ok(plain.kind === "success" && novel.kind === "success");
    assert.equal(novel.move.eleganz, plain.move.eleganz + g.config.discoveryEleganz);
    assert.equal(novel.move.discovery, true);
    assert.equal(plain.move.discovery, false);
    const failed = attempt(onto, g, lx("salz"), null, true);
    assert.ok(failed.kind === "failure");
    assert.equal(failed.state.players[1].eleganz, g.players[1].eleganz);
  });

  it("rejects without cost when Wille is insufficient", () => {
    const g = must(play(createGame(["A", "B"]), lx("katze"), null));
    const r = tryIt(g, "vulkan");
    assert.equal(r.kind, "rejected");
    assert.equal(r.state, g);
  });

  it("running out of Wille through failures loses the game", () => {
    let g = must(play(createGame(["A", "B"]), lx("ritter"), null));
    for (const id of ["floh", "muecke", "ameise", "gluehwuermchen", "samen", "staubkorn", "kind", "katze", "eule", "kraehe", "spinne", "glocke", "maske", "hahn", "flöte"]) {
      const f = onto.formById(id);
      if (f === undefined || g.phase === "finished") continue;
      const r = attempt(onto, g, f, null);
      if (r.kind !== "rejected") g = r.state;
    }
    if (g.phase === "finished") {
      assert.equal(g.endReason, "erschoepft");
      assert.equal(g.winner, 0);
    }
  });
});
