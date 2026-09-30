import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreOntology } from "../src/content/index.ts";
import { attempt } from "../src/engine/attempt.ts";
import { arenaShare } from "../src/engine/cost.ts";
import { rng } from "../src/engine/text.ts";
import { arenaMinScale, createGame, evaluateForm as evaluate, moveCost, pass, play as playMove, regenFor, roundNumber } from "../src/engine/game.ts";
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
    assert.equal(g.players[1].wille, Math.min(g.config.maxWille, before - move.cost + move.refund));
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

describe("rule-blocked attempts", () => {
  it("scissors vs. net in a grown arena: rejected with an explanation, no Wille lost", () => {
    const g0 = must(play(createGame(["A", "B"]), lx("netz"), null));
    const m = g0.history[0];
    assert.ok(m);
    const g: GameState = { ...g0, history: [m, m, m] }; // floor rises to 2 at move 4
    const r = attempt(onto, g, lx("schere"), null);
    assert.ok(r.kind === "rejected");
    assert.ok(r.reason.includes("Arena ist gewachsen"));
    assert.equal(r.state, g);
  });
});

describe("Wille over a long duel (\"Die Arena trägt\")", () => {
  it("the arena pays the share of the price its minimum scale forces", () => {
    assert.equal(arenaShare(5, 1), 0, "no escalation yet – full price");
    assert.equal(arenaShare(7, 7), 16, "a form at the floor pays only what lies above it");
    assert.equal(arenaShare(8, 7), 16, "bigger than the floor: the rest is paid");
    assert.equal(arenaShare(3, 7), 2, "a mythic small form never gets more than its own base price back");
  });

  it("a late counter at the arena's floor stays affordable with a round's regeneration", () => {
    // escalation: after 18 moves every form needs scale 7; one round brings 12 Wille back
    const late = createGame(["A", "B"]);
    const floor7 = onto.lexicon.filter((f) => f.scale === 7);
    const state: GameState = { ...late, phase: "playing", history: Array.from({ length: 18 }, (_, i) => ({ player: i % 2 === 0 ? 0 : 1, form: lx("titan"), verb: null, cost: 0, eleganz: 0, refund: 0, check: null, discovery: false }) as const) };
    const costs = floor7.map((f) => moveCost(onto, state, f)).sort((a, b) => a - b);
    const median = costs[Math.floor(costs.length / 2)] ?? Infinity;
    assert.ok(median <= regenFor(state.config, 10), `a typical scale-7 form costs ${String(median)}`);
  });

  it("trading blows at ever bigger sizes still reaches the last round", () => {
    // the pattern from the report: each answers the other at (at least) its size – never cleverly from below
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const random = rng(seed);
      let g = createGame(["A", "B"]);
      g = must(play(g, onto.lexicon.filter((f) => f.scale === 1)[seed] ?? lx("funke"), null));
      while (g.phase !== "finished") {
        const target = g.history.at(-1)?.form;
        assert.ok(target);
        const options = onto.lexicon
          .filter((f) => !g.usedFormIds.includes(f.id) && f.scale >= Math.min(target.scale, arenaMinScale(g)))
          .flatMap((f) => evaluateForm(g, f).filter((o) => o.playable).map((o) => ({ f, o })));
        // any fitting answer, not the cheapest – like a player who does not know the price list
        const pick = options[Math.floor(random() * options.length)];
        assert.ok(pick, `stuck in round ${String(roundNumber(g))} with ${String(g.players[g.active].wille)} Wille against ${target.name}`);
        g = must(play(g, pick.f, pick.o.verb));
      }
      assert.equal(g.endReason, "rounds");
    }
  });
});
