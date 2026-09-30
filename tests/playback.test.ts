/**
 * Regression: leaving the tab on a phone (socket lost) and coming back made forms vanish from the
 * arena – the form was in the game, but never shown again. The turn played before the drop waited
 * for its narration, which went down with the connection, and every later turn queued behind it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { GameState } from "../src/engine/types.ts";
import type { Turn } from "../src/game/resolver.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";
import { narrateEnd } from "../src/narrate/offline.ts";
import { arenaMatches, NO_NARRATION, Playback, standingForms } from "../src/online/playback.ts";
import type { ChronicleEntry, ServerMsg } from "../src/online/protocol.ts";
import { OnlineHub } from "../server/online.ts";

const core = loadPack(CORE_PACK_RAW);

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await tick();
}

/** A gate an animation waits at – like `requestAnimationFrame` in a hidden tab. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((r) => {
    open = r;
  });
  return { wait, open };
}

/**
 * What the page does with server messages, without the DOM: the arena as form ids per side, the
 * chronicle, the caption. Animations follow the arena's own rules (a win removes the loser, a
 * failed attempt removes the attacker).
 */
class Screen {
  state: GameState | null = null;
  arena: [string | null, string | null] = [null, null];
  chronicle: { name: string; text: string }[] = [];
  played = 0;
  /** While set, animations stop halfway (hidden tab). */
  hold: Promise<void> | null = null;
  readonly playback = new Playback<Turn>({
    play: async (turn, narration, current) => {
      this.played++;
      this.state = turn.state;
      this.arena[turn.actor] = turn.form.id;
      if (this.hold !== null) await this.hold;
      const other = turn.actor === 0 ? 1 : 0;
      if (turn.outcome.kind === "success") this.arena[other] = null;
      else this.arena[turn.actor] = null;
      if (!current()) return;
      const line = { name: turn.form.name, text: "…" };
      this.chronicle.push(line);
      line.text = await narration;
    },
    lateNarration: (index, text) => {
      const line = this.chronicle[index];
      if (line !== undefined) line.text = text;
    },
  });

  receive(m: ServerMsg): void {
    if (m.t === "welcome" && m.state !== null) this.adopt(m.state, m.chronicle, m.seq);
    else if (m.t === "start") this.adopt(m.state, [], m.seq);
    else if (m.t === "turn") void this.playback.turn(m.seq, m.turn);
    else if (m.t === "narration") this.playback.narration(m.seq, m.text);
  }

  private adopt(state: GameState, chronicle: readonly ChronicleEntry[], seq: number): void {
    this.state = state;
    this.chronicle = chronicle.map((e) => ({ name: e.name, text: e.text }));
    void this.playback.adopt(seq, chronicle.length, () => {
      const s = this.state;
      if (s === null || arenaMatches(this.arena, s)) return;
      const [a, b] = standingForms(s);
      this.arena = [a?.id ?? null, b?.id ?? null];
    });
  }

  /** The arena shows exactly what the game holds. */
  assertInSync(what: string): void {
    assert.ok(this.state !== null, what);
    assert.deepEqual(this.arena, standingForms(this.state).map((f) => f?.id ?? null), what);
  }
}

/** A connection whose messages go to a screen – and which can drop right after a given message. */
class Device {
  readonly screen: Screen;
  dropAfter: ServerMsg["t"] | null = null;
  onDrop: (() => void) | null = null;
  inbox: ServerMsg[] = [];
  closed = false;
  constructor(screen: Screen, readonly ip: string) {
    this.screen = screen;
  }
  send(msg: ServerMsg): void {
    if (this.closed) return;
    const m = JSON.parse(JSON.stringify(msg)) as ServerMsg;
    this.inbox.push(m);
    this.screen.receive(m);
    if (this.dropAfter === m.t) {
      this.dropAfter = null;
      this.closed = true;
      this.onDrop?.();
    }
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return this.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t).at(-1);
  }
}

function hub(): OnlineHub {
  const resolver = new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => DEFAULT_SETTINGS,
    debug: () => true,
    saveLearned: () => undefined,
    today: () => "2026-09-30",
  });
  return new OnlineHub(resolver, { limits: { moveGapMs: 0 }, claude: () => false, epilogue: (s) => Promise.resolve(narrateEnd(s)) });
}

function duel(h: OnlineHub): { a: Device; b: Device; ca: NonNullable<ReturnType<OnlineHub["attach"]>>; cb: NonNullable<ReturnType<OnlineHub["attach"]>>; room: string } {
  const a = new Device(new Screen(), "10.0.0.1");
  const b = new Device(new Screen(), "10.0.0.2");
  const ca = h.attach(a);
  const cb = h.attach(b);
  assert.ok(ca && cb);
  ca.receive(JSON.stringify({ t: "create", name: "Morpheus" }));
  const room = a.last("welcome")?.room ?? "";
  cb.receive(JSON.stringify({ t: "join", room, name: "Choronzon" }));
  return { a, b, ca, cb, room };
}

describe("online playback across a lost connection", () => {
  it("welcome and start say which turn their state holds", async () => {
    const h = hub();
    const { a, b, ca } = duel(h);
    assert.equal(a.last("start")?.seq, 0);
    assert.equal(b.last("welcome")?.seq, 0);
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    const token = b.last("welcome")?.token ?? "";
    const b2 = new Device(new Screen(), "10.0.0.2");
    h.attach(b2)?.receive(JSON.stringify({ t: "resume", room: a.last("welcome")?.room ?? "", token }));
    assert.equal(b2.last("welcome")?.seq, b.last("turn")?.seq);
  });

  it("tab left right after a move (narration lost): later forms still appear", async () => {
    const h = hub();
    const { a, b, ca, cb, room } = duel(h);
    const token = b.last("welcome")?.token ?? "";
    // B's phone goes to sleep between the turn and its narration: the socket is gone, the server hears of it
    b.dropAfter = "turn";
    b.onDrop = () => {
      queueMicrotask(() => { cb.closed(); });
    };
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    assert.equal(b.last("narration"), undefined, "the narration never reached B");
    // B comes back: a new socket on the same screen, resuming the seat
    const back = new Device(b.screen, "10.0.0.2");
    const cb2 = h.attach(back);
    cb2?.receive(JSON.stringify({ t: "resume", room, token }));
    await settle();
    b.screen.assertInSync("after the reconnect");
    assert.notEqual(b.screen.chronicle.at(-1)?.text, "…", "the chronicle has the words the server kept");
    // play on – every new form has to reach B's arena
    cb2?.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    b.screen.assertInSync("B's own next form");
    assert.equal(b.screen.arena[1], back.last("turn")?.turn.form.id);
    ca.receive(JSON.stringify({ t: "move", text: "Wasser" }));
    await settle();
    b.screen.assertInSync("the opponent's next form");
    assert.equal(b.screen.state?.history.length, a.screen.state?.history.length);
  });

  it("a turn that never gets its narration does not block the ones after it", async () => {
    const screen = new Screen();
    const { turns, adopted } = await playedTurns(3);
    const [t1, t2, t3] = turns;
    assert.ok(t1 && t2 && t3);
    void screen.playback.turn(1, t1);
    // narration 1 is lost; the reconnect brings the state after turn 1
    await tick();
    screen.state = adopted[0] ?? null;
    screen.chronicle = [{ name: "Ritter", text: "eins" }];
    void screen.playback.adopt(1, 1, () => undefined);
    void screen.playback.turn(2, t2);
    screen.playback.narration(2, "zwei");
    void screen.playback.turn(3, t3);
    screen.playback.narration(3, "drei");
    await settle();
    assert.equal(screen.played, 3);
    screen.assertInSync("all turns played");
    assert.deepEqual(screen.chronicle.map((l) => l.text), ["eins", "zwei", "drei"]);
  });

  it("turns the adopted state already holds are not played again, and the arena follows it", async () => {
    const screen = new Screen();
    const { turns, adopted } = await playedTurns(3);
    const hidden = gate();
    screen.hold = hidden.wait;
    // turn 1 is halfway (tab hidden), 2 and 3 are queued
    turns.forEach((t, i) => void screen.playback.turn(i + 1, t));
    await tick();
    // back: the server's state holds all three
    const last = adopted[2];
    assert.ok(last);
    screen.state = last;
    screen.chronicle = [{ name: "a", text: "1" }, { name: "b", text: "2" }, { name: "c", text: "3" }];
    void screen.playback.adopt(3, 3, () => {
      const [x, y] = standingForms(last);
      screen.arena = [x?.id ?? null, y?.id ?? null];
    });
    // the stale animation finishes afterwards – and must not have the last word
    screen.hold = null;
    hidden.open();
    await settle();
    assert.equal(screen.played, 1, "turns 2 and 3 are in the adopted state");
    assert.equal(screen.state, last, "no stale turn state");
    screen.assertInSync("after the stale animation");
    assert.equal(screen.chronicle.length, 3, "the stale turn adds no chronicle line");
  });

  it("a narration for a turn already in the adopted state fills in its chronicle line", async () => {
    const screen = new Screen();
    const { adopted } = await playedTurns(2);
    screen.state = adopted[1] ?? null;
    screen.chronicle = [{ name: "a", text: "eins" }, { name: "b", text: "…" }];
    void screen.playback.adopt(2, 2, () => undefined);
    screen.playback.narration(2, "zwei");
    assert.deepEqual(screen.chronicle.map((l) => l.text), ["eins", "zwei"]);
  });

  it("one broken animation does not stop the next", async () => {
    let shown = 0;
    const p = new Playback<string>({
      play: (turn) => {
        if (turn === "kaputt") return Promise.reject(new Error("boom"));
        shown++;
        return Promise.resolve();
      },
      lateNarration: () => undefined,
    });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await p.turn(1, "kaputt");
      p.narration(2, "x");
      await p.turn(2, "gut");
    } finally {
      console.error = quiet;
    }
    assert.equal(shown, 1);
  });

  it("a waiting turn gets the stand-in words when the connection is taken over", async () => {
    let words = "";
    const p = new Playback<string>({
      play: async (_t, narration) => {
        words = await narration;
      },
      lateNarration: () => undefined,
    });
    const played = p.turn(1, "x");
    await tick();
    await p.adopt(1, 1, () => undefined);
    await played;
    assert.equal(words, NO_NARRATION);
  });
});

/** A few real turns from the server (A, B, A …), with the state after each. */
async function playedTurns(n: number): Promise<{ turns: Turn[]; adopted: GameState[] }> {
  const h = hub();
  const { a, ca, cb } = duel(h);
  const words = ["Ritter", "Drache", "Wasser", "Feuer"];
  for (let i = 0; i < n; i++) {
    (i % 2 === 0 ? ca : cb).receive(JSON.stringify({ t: "move", text: words[i] ?? "Stein" }));
    await settle();
  }
  const turns = a.inbox.filter((m): m is Extract<ServerMsg, { t: "turn" }> => m.t === "turn").map((m) => m.turn);
  assert.equal(turns.length, n);
  return { turns, adopted: turns.map((t) => t.state) };
}
