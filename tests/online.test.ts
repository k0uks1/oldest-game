import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { ContentPack } from "../src/engine/ontology/pack.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";
import { narrateEnd } from "../src/narrate/offline.ts";
import { applyPackDelta, normalizeRoom, packDelta, parseClientMsg, type AbsurdReport, type ServerMsg } from "../src/online/protocol.ts";
import { startServer } from "../server/local.ts";
import { OnlineHub, type HubLimits } from "../server/online.ts";

const core = loadPack(CORE_PACK_RAW);

/** A fake connection that records what the server sent. */
class FakePeer {
  readonly inbox: ServerMsg[] = [];
  closed = false;
  constructor(readonly ip = "1.2.3.4") {}
  send(msg: ServerMsg): void {
    // through JSON, like the wire
    this.inbox.push(JSON.parse(JSON.stringify(msg)) as ServerMsg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return this.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t).at(-1);
  }
}

function setup(
  opts: { accessCode?: string; limits?: Partial<HubLimits>; now?: () => number; claude?: boolean; report?: (r: AbsurdReport & { room: string }) => void } = {},
): { hub: OnlineHub; resolver: Resolver } {
  const resolver = new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => DEFAULT_SETTINGS,
    debug: () => true,
    saveLearned: () => undefined,
    today: () => "2026-09-28",
  });
  const hub = new OnlineHub(resolver, {
    ...(opts.accessCode === undefined ? {} : { accessCode: opts.accessCode }),
    limits: { moveGapMs: 0, ...opts.limits },
    claude: () => opts.claude === true,
    epilogue: (s) => Promise.resolve(narrateEnd(s)),
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.report === undefined ? {} : { report: opts.report }),
  });
  return { hub, resolver };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await tick();
}

function openRoom(hub: OnlineHub): { a: FakePeer; b: FakePeer; code: string; ca: NonNullable<ReturnType<OnlineHub["attach"]>>; cb: NonNullable<ReturnType<OnlineHub["attach"]>> } {
  const a = new FakePeer("10.0.0.1");
  const b = new FakePeer("10.0.0.2");
  const ca = hub.attach(a);
  const cb = hub.attach(b);
  assert.ok(ca && cb);
  ca.receive(JSON.stringify({ t: "create", name: "Morpheus" }));
  const w = a.last("welcome");
  assert.ok(w);
  assert.equal(w.state, null, "waiting for the second player");
  cb.receive(JSON.stringify({ t: "join", room: w.room.toLowerCase(), name: "Choronzon" }));
  return { a, b, code: w.room, ca, cb };
}

describe("online protocol", () => {
  it("validates every client frame", () => {
    assert.deepEqual(parseClientMsg('{"t":"move","text":"  Drache "}'), { t: "move", text: "Drache" });
    assert.equal(parseClientMsg('{"t":"move","text":""}'), undefined);
    assert.equal(parseClientMsg(JSON.stringify({ t: "move", text: "x".repeat(81) })), undefined);
    assert.equal(parseClientMsg('{"t":"create","name":"\\u0000\\u0007"}'), undefined, "control characters only");
    assert.deepEqual(parseClientMsg('{"t":"create","name":"  Ann\\u0000a  ","code":"x"}'), { t: "create", name: "Anna", code: "x" });
    assert.equal(parseClientMsg('{"t":"join","room":"AB0DE","name":"x"}'), undefined, "0 is not in the alphabet");
    assert.equal(parseClientMsg("[1]"), undefined);
    assert.equal(parseClientMsg("nope"), undefined);
    assert.deepEqual(parseClientMsg('{"t":"watch","room":"abcde"}'), { t: "watch", room: "ABCDE" });
    assert.equal(parseClientMsg('{"t":"hack"}'), undefined);
    assert.equal(normalizeRoom(" abcde "), "ABCDE");
  });

  it("learned deltas carry only what changed and rebuild the pack", () => {
    const before: ContentPack = { ...emptyLearnedPack(), rulings: [{ attacker: "a", target: "b", valid: true, verb: "x", reason: "r" }] };
    const after: ContentPack = {
      ...before,
      forms: [{ id: "neu", name: "Neu", archetype: "orb", scale: 2, plane: "materie", tags: ["stein"] }],
      rulings: [{ attacker: "a", target: "b", valid: false, verb: "x", reason: "anders" }],
    };
    const d = packDelta(before, after);
    assert.equal(d.forms.length, 1);
    assert.equal(d.rulings.length, 1);
    assert.equal(d.tags.length, 0);
    const rebuilt = applyPackDelta(before, d);
    assert.deepEqual(rebuilt.forms, after.forms);
    assert.deepEqual(rebuilt.rulings, after.rulings, "same pair is replaced, not duplicated");
  });
});

describe("online rooms (authoritative server)", () => {
  it("two players: code, join, alternating moves resolved on the server", async () => {
    const { hub } = setup();
    const { a, b, ca, cb } = openRoom(hub);
    assert.ok(b.last("welcome")?.state, "joiner gets the running game");
    assert.ok(a.last("start"), "host learns the duel started");
    assert.deepEqual(a.last("presence")?.players.map((p) => p?.online), [true, true]);
    assert.deepEqual(b.last("welcome")?.seats, [1]);

    cb.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    assert.equal(b.last("error")?.code, "turn", "not your turn");

    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    const t1 = b.last("turn");
    assert.ok(t1, "the opponent sees the move");
    assert.equal(t1.turn.form.name, "Ritter");
    assert.equal(t1.turn.state.active, 1);
    assert.equal(b.last("narration")?.seq, t1.seq, "narration follows the turn");

    ca.receive(JSON.stringify({ t: "move", text: "Wasser" }));
    await settle();
    assert.equal(a.last("error")?.code, "turn");

    cb.receive(JSON.stringify({ t: "move", text: "blubbergrütz" }));
    await settle();
    assert.ok(b.last("rejected"), "unknown words are rejected for the mover only");
    assert.equal(a.last("rejected"), undefined);
    assert.equal(a.last("tried")?.text, "blubbergrütz", "…but the opponent learns it did not count");
    assert.equal(a.last("tried")?.seat, 1);

    cb.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    assert.equal(a.last("turn")?.turn.form.name, "Drache");

    ca.receive(JSON.stringify({ t: "move", text: "Seife" }));
    await settle();
    const lost = b.last("turn");
    assert.ok(lost);
    assert.equal(lost.turn.form.name, "Seife", "a failed attempt reaches the opponent too");
    assert.equal(lost.turn.outcome.kind, "failure");
  });

  it("reconnect with the seat token restores state and chronicle", async () => {
    const { hub } = setup();
    const { a, b, code, ca } = openRoom(hub);
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    const token = a.last("welcome")?.token;
    assert.ok(token);
    ca.closed();
    assert.deepEqual(b.last("presence")?.players.map((p) => p?.online), [false, true], "the opponent sees the drop");
    const a2 = new FakePeer("10.0.0.1");
    const c2 = hub.attach(a2);
    c2?.receive(JSON.stringify({ t: "resume", room: code, token: "falsch" }));
    assert.equal(a2.last("error")?.code, "noroom", "a wrong token gets nothing");
    c2?.receive(JSON.stringify({ t: "resume", room: code, token }));
    const w = a2.last("welcome");
    assert.ok(w);
    assert.deepEqual(w.seats, [0]);
    assert.equal(w.state?.history.length, 1);
    assert.equal(w.chronicle[0]?.name, "Ritter");
    assert.notEqual(w.chronicle[0].text, "…", "narration was stored");
    assert.deepEqual(b.last("presence")?.players.map((p) => p?.online), [true, true]);
  });

  it("one device: both seats, and a full room stays closed", async () => {
    const { hub } = setup();
    const p = new FakePeer();
    const c = hub.attach(p);
    c?.receive(JSON.stringify({ t: "create", name: "Anna", name2: "Ben" }));
    const w = p.last("welcome");
    assert.ok(w?.state);
    assert.deepEqual(w.seats, [0, 1]);
    c?.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    c?.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    assert.equal(p.last("turn")?.turn.actor, 1);
    const q = new FakePeer("9.9.9.9");
    hub.attach(q)?.receive(JSON.stringify({ t: "join", room: w.room, name: "Eve" }));
    assert.equal(q.last("error")?.code, "full");
  });

  it("resign, epilogue and rematch (loser opens)", async () => {
    const { hub } = setup();
    const { a, b, ca, cb } = openRoom(hub);
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    cb.receive(JSON.stringify({ t: "pass" }));
    await settle();
    const r = a.last("resigned");
    assert.equal(r?.seat, 1);
    assert.equal(r.state.winner, 0);
    assert.ok(a.last("epilogue")?.text);
    cb.receive(JSON.stringify({ t: "rematch" }));
    const wb = b.last("welcome");
    assert.deepEqual(wb?.seats, [0], "the loser moves first now");
    assert.equal(wb.state?.players[0].name, "Choronzon");
    assert.deepEqual(a.last("welcome")?.seats, [1]);
    assert.equal(wb.chronicle.length, 0);
  });

  it("access code, rate limits, room limits and sweeping", () => {
    let now = 1_000_000;
    const { hub } = setup({ accessCode: "geheim", now: () => now, limits: { roomsPerIpPerHour: 2, messagesPerBurst: 5, connectionsPerIp: 2 } });
    const p = new FakePeer();
    const c = hub.attach(p);
    c?.receive(JSON.stringify({ t: "create", name: "A" }));
    assert.equal(p.last("error")?.code, "access");
    c?.receive(JSON.stringify({ t: "create", name: "A", code: "falsch" }));
    assert.equal(p.last("error")?.code, "access");
    c?.receive(JSON.stringify({ t: "create", name: "A", code: "geheim" }));
    assert.ok(p.last("welcome"));
    c?.receive(JSON.stringify({ t: "create", name: "A", code: "geheim" }));
    c?.receive(JSON.stringify({ t: "create", name: "A", code: "geheim" }));
    assert.equal(p.last("error")?.code, "limit", "rooms per IP and hour");
    c?.receive("{}");
    assert.equal(p.last("error")?.code, "limit", "message burst");
    hub.attach(new FakePeer());
    const third = new FakePeer();
    assert.equal(hub.attach(third), undefined, "connections per IP");
    assert.ok(third.closed);
    assert.equal(hub.roomCount, 2);
    now += 2 * 60 * 60_000;
    hub.sweep();
    assert.equal(hub.roomCount, 0, "nobody joined – rooms are swept");
  });

  it("caps Claude-resolved moves per hour across all rooms", async () => {
    const { hub } = setup({ claude: true, limits: { claudeMovesPerHour: 1 } });
    const { a, ca, cb, b } = openRoom(hub);
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    assert.ok(b.last("turn"));
    cb.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    assert.equal(b.last("error")?.code, "limit");
    assert.equal(a.last("turn")?.turn.form.name, "Ritter", "the second move was not played");
  });

  it("spectators see everything, change nothing, and come back after a reload", async () => {
    const { hub } = setup({ limits: { watchersPerRoom: 1 } });
    const { a, ca, code } = openRoom(hub);
    const w = new FakePeer("10.0.0.9");
    const cw = hub.attach(w);
    cw?.receive(JSON.stringify({ t: "watch", room: code }));
    const welcome = w.last("welcome");
    assert.ok(welcome?.state, "a running duel is shown at once");
    assert.deepEqual(welcome.seats, [], "no seat");
    assert.equal(a.last("presence")?.watchers, 1, "the players see the spectator");
    ca.receive(JSON.stringify({ t: "move", text: "Ritter" }));
    await settle();
    assert.equal(w.last("turn")?.turn.form.name, "Ritter");
    assert.ok(w.last("narration"));
    const turns = a.inbox.filter((m) => m.t === "turn").length;
    cw?.receive(JSON.stringify({ t: "move", text: "Drache" }));
    await settle();
    assert.equal(w.last("error")?.code, "turn", "spectators cannot move");
    cw?.receive(JSON.stringify({ t: "pass" }));
    cw?.receive(JSON.stringify({ t: "rematch" }));
    assert.equal(a.last("resigned"), undefined, "nor give up for someone");
    assert.equal(a.inbox.filter((m) => m.t === "turn").length, turns);
    // a second spectator is over the limit
    const w2 = new FakePeer("10.0.0.10");
    hub.attach(w2)?.receive(JSON.stringify({ t: "watch", room: code }));
    assert.equal(w2.last("error")?.code, "full");
    // reload: resume with the spectator token
    cw?.closed();
    const w3 = new FakePeer("10.0.0.9");
    hub.attach(w3)?.receive(JSON.stringify({ t: "resume", room: code, token: welcome.token }));
    assert.deepEqual(w3.last("welcome")?.seats, []);
    assert.equal(w3.last("welcome")?.chronicle[0]?.name, "Ritter");
  });

  it("learned things reach every connected client as a delta", () => {
    const { hub, resolver } = setup();
    const { a, b } = openRoom(hub);
    resolver.setLearned({
      ...emptyLearnedPack(),
      rulings: [{ attacker: "ritter", target: "drache", valid: true, verb: resolver.onto.compileForm(resolver.onto.formById("ritter") ?? assert.fail()).verbs[0] ?? "", reason: "Test" }],
    });
    hub.learnedChanged();
    for (const p of [a, b]) assert.equal(p.last("learned")?.delta.rulings.length, 1);
  });
});

describe("online server (real WebSocket)", () => {
  it("two sockets play through the Node server; public mode locks the proxy and uploads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "og-online-"));
    const srv = startServer({
      port: 0,
      host: "0.0.0.0",
      html: () => "<!doctype html><p>ok</p>",
      env: { apiKey: "", model: "m", maxTokens: 10 },
      learnedFile: join(dir, "pack.json"),
      quiet: true,
      limits: { moveGapMs: 0 },
    });
    const port = await srv.ready;
    try {
      const health = (await (await fetch(`http://127.0.0.1:${String(port)}/api/health`)).json()) as Record<string, unknown>;
      assert.equal(health["online"], true);
      assert.equal(health["proxy"], false, "public server: no browser proxy");
      assert.equal((await fetch(`http://127.0.0.1:${String(port)}/api/claude`, { method: "POST", body: "{}" })).status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${String(port)}/api/learned`, { method: "PUT", body: "{}" })).status, 403);

      const open = (): Promise<{ ws: WebSocket; inbox: ServerMsg[]; next: (t: ServerMsg["t"]) => Promise<ServerMsg> }> =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
          const inbox: ServerMsg[] = [];
          const waiters: { t: string; fn: (m: ServerMsg) => void }[] = [];
          ws.on("message", (d) => {
            const m = JSON.parse(Buffer.isBuffer(d) ? d.toString("utf8") : "") as ServerMsg;
            const w = waiters.findIndex((x) => x.t === m.t);
            if (w >= 0) waiters.splice(w, 1)[0]?.fn(m);
            else inbox.push(m);
          });
          const next = (t: ServerMsg["t"]): Promise<ServerMsg> => {
            const i = inbox.findIndex((m) => m.t === t);
            if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0] ?? assert.fail());
            return new Promise((r) => waiters.push({ t, fn: r }));
          };
          ws.on("open", () => {
            resolve({ ws, inbox, next });
          });
          ws.on("error", reject);
        });
      const A = await open();
      const B = await open();
      A.ws.send(JSON.stringify({ t: "create", name: "A" }));
      const w = await A.next("welcome");
      assert.equal(w.t, "welcome");
      B.ws.send(JSON.stringify({ t: "join", room: w.room, name: "B" }));
      await B.next("welcome");
      await A.next("start");
      A.ws.send(JSON.stringify({ t: "move", text: "Ritter" }));
      const t = await B.next("turn");
      assert.ok(t.t === "turn" && t.turn.form.name === "Ritter");
      const n = await B.next("narration");
      assert.ok(n.t === "narration" && n.text.length > 0);
      A.ws.send("x".repeat(20_000));
      await new Promise<void>((r) => A.ws.on("close", () => {
        r();
      }));
      assert.ok(true, "oversized frames drop the connection");
      B.ws.close();
    } finally {
      await srv.close();
    }
  });
});

describe("Quatsch-Meldungen", () => {
  it("a player in a room can report an absurd win; junk is refused", () => {
    const got: (AbsurdReport & { room: string })[] = [];
    const { hub } = setup({ report: (r) => got.push(r) });
    const { ca, code } = openRoom(hub);
    ca.receive(JSON.stringify({ t: "report", attacker: "Klebeband", target: "Ritter", verb: "fesselt" }));
    ca.receive(JSON.stringify({ t: "report", attacker: "", target: "Ritter", verb: "fesselt" }));
    assert.deepEqual(got, [{ attacker: "Klebeband", target: "Ritter", verb: "fesselt", room: code }]);
    assert.equal(parseClientMsg(JSON.stringify({ t: "report", attacker: "x".repeat(500), target: "y", verb: "z" }))?.t, "report");
  });
});
