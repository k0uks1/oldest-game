import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import type { Form } from "../src/engine/types.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { emptyLearnedPack } from "../src/llm/learning.ts";
import { narrateEnd } from "../src/narrate/offline.ts";
import { ANIMS_PER_PLAYER, parseClientMsg, type AnimItem, type ServerMsg } from "../src/online/protocol.ts";
import { encodeArt } from "../src/render/art.ts";
import { AnimClient, httpAnimTransport } from "../src/ui/anim-client.ts";
import { AnimService } from "../server/anim-service.ts";
import { OnlineHub, type HubAnim } from "../server/online.ts";
import type { Rgba } from "../server/png.ts";

const core = loadPack(CORE_PACK_RAW);
const img = (v: number): Rgba => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(v) });
const ART = encodeArt(img(200));

describe("Beleben – the animation store", () => {
  it("animates once per picture and action, merges parallel asks, keeps it on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anim-"));
    let calls = 0;
    const svc = new AnimService({
      animate: () => {
        calls++;
        return Promise.resolve([img(10), img(20), img(30)]);
      },
      monthlyLimit: 5,
      dir,
    });
    const done: string[] = [];
    svc.onDone((key) => done.push(key));
    const first = svc.lookup(ART, "idle");
    assert.equal(first.state, "pending");
    assert.equal(svc.lookup(ART, "idle").state, "pending");
    await svc.idle();
    assert.equal(calls, 1);
    assert.deepEqual(done, [first.key]);
    const ready = svc.lookup(ART, "idle");
    assert.ok(ready.state === "ready" && ready.frames.length === 3);
    assert.notEqual(svc.lookup(ART, "attack").key, first.key, "another action is another animation");
    assert.equal(new AnimService({ monthlyLimit: 0, dir }).lookup(ART, "idle").state, "ready", "survives a restart");
  });

  it("no key, no budget or a failure: none – and a failed key is not retried", async () => {
    assert.equal(new AnimService({ monthlyLimit: 5 }).lookup(ART, "idle").state, "none");
    let calls = 0;
    const svc = new AnimService({
      animate: () => {
        calls++;
        return Promise.reject(new Error("503"));
      },
      monthlyLimit: 1,
    });
    svc.lookup(ART, "idle");
    await svc.idle();
    assert.equal(svc.lookup(ART, "idle").state, "none");
    assert.equal(calls, 1);
    assert.equal(svc.lookup(ART, "other").state, "none", "budget spent");
  });
});

class Peer {
  readonly inbox: ServerMsg[] = [];
  closed = false;
  constructor(readonly ip: string) {}
  send(m: ServerMsg): void {
    this.inbox.push(m);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return this.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t).at(-1);
  }
}

function hubWith(anim: HubAnim): OnlineHub {
  const resolver = new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => DEFAULT_SETTINGS,
    debug: () => true,
    saveLearned: () => undefined,
    today: () => "2026-09-29",
  });
  return new OnlineHub(resolver, { limits: { moveGapMs: 0 }, claude: () => false, epilogue: (s) => Promise.resolve(narrateEnd(s)), anim });
}

describe("Beleben online", () => {
  it("three per player per duel, the room sees it, a failure gives the charge back", async () => {
    const jobs: { key: string; id: string }[] = [];
    let finish: ((key: string, frames: readonly string[] | undefined) => void) | undefined;
    const anim: HubAnim = {
      lookup: (form: Form, action) => {
        const key = `${form.id}:${action}`;
        jobs.push({ key, id: form.id });
        return { key, item: { id: form.id, action, state: "pending" } };
      },
      onDone: (l) => {
        finish = l;
        return () => undefined;
      },
    };
    const hub = hubWith(anim);
    const a = new Peer("10.0.0.1");
    const b = new Peer("10.0.0.2");
    const ca = hub.attach(a);
    const cb = hub.attach(b);
    assert.ok(ca && cb);
    ca.receive(JSON.stringify({ t: "create", name: "Ana" }));
    const room = a.last("welcome")?.room ?? "";
    cb.receive(JSON.stringify({ t: "join", room, name: "Ben" }));
    assert.deepEqual(a.last("welcome")?.anim?.left, [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER]);
    ca.receive(JSON.stringify({ t: "animate", action: "atmen" }));
    assert.equal(a.last("error")?.message, "Erst beschwören, dann beleben.");
    ca.receive(JSON.stringify({ t: "move", text: "Wolf" }));
    await new Promise((r) => setTimeout(r, 50));
    ca.receive(JSON.stringify({ t: "animate", action: "atmen" }));
    assert.deepEqual(b.last("anim"), { t: "anim", item: { id: "wolf", action: "atmen", state: "pending" }, left: [2, 3] }, "the opponent sees it too");
    assert.ok(finish);
    finish("wolf:atmen", undefined);
    assert.deepEqual(a.last("anim")?.left, [3, 3], "failed – the charge comes back");
    for (let i = 0; i < 3; i++) ca.receive(JSON.stringify({ t: "animate", action: "angriff" }));
    assert.deepEqual(a.last("anim")?.left, [0, 3]);
    ca.receive(JSON.stringify({ t: "animate", action: "triumph" }));
    assert.match(a.last("error")?.message ?? "", /3-mal belebt/);
    finish("wolf:angriff", ["2.2.ff0000ff.AwE=", "2.2.00ff00ff.AwE="]);
    const ready = b.last("anim")?.item;
    assert.ok(ready?.state === "ready" && ready.frames.length === 2);
    assert.equal(jobs.length, 4);
  });

  it("the protocol accepts known actions only", () => {
    assert.deepEqual(parseClientMsg(JSON.stringify({ t: "animate", action: "atmen", seat: 1 })), { t: "animate", action: "atmen", seat: 1 });
    assert.equal(parseClientMsg(JSON.stringify({ t: "animate", action: "tanzen" })), undefined);
  });
});

describe("Beleben im Browser", () => {
  it("frames are decoded and handed to the arena; hot-seat counts itself and refunds failures", async () => {
    const client = new AnimClient();
    const got: (number | undefined)[] = [];
    client.onUpdate = (_id, frames) => got.push(frames?.length);
    client.receive({ id: "wolf", action: "atmen", state: "ready", frames: [ART, ART] } satisfies AnimItem);
    assert.deepEqual(got, [2]);
    assert.equal(client.framesOf("wolf")?.length, 2);

    let answers: AnimItem["state"][] = ["pending", "none"];
    const fake = ((): Promise<Response> => {
      const state = answers.shift() ?? "none";
      return Promise.resolve(new Response(JSON.stringify({ id: "hai", action: "atmen", state }), { status: 200 }));
    }) as typeof fetch;
    client.setTransport(httpAnimTransport(fake, 5, 1000));
    const hai = Ontology.compile([core]).formById("hai");
    assert.ok(hai);
    const settled = new Promise<void>((resolve) => {
      client.onUpdate = () => {
        resolve();
      };
    });
    client.request(hai, "atmen", 1);
    await settled;
    assert.deepEqual(client.left, [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER], "counted while pending, given back when it failed");
    answers = [];
  });
});
