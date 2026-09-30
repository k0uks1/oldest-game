import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { findSession, forgetSession, listSessions, MAX_SESSIONS, rememberSession, SESSION_TTL_MS, setTabSeat, tabSeat, type Session } from "../src/online/sessions.ts";

/** In-memory Web Storage, like a browser tab. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(k: string): string | null {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.items.set(k, v);
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
}

const g = globalThis as Record<string, unknown>;
const duel = (room: string, seen: number): Session => ({ room, token: `t-${room}`, seats: [1], me: "Choronzon", foe: "Morpheus", seen, over: false });

describe("remembered online duels", () => {
  beforeEach(() => {
    g["localStorage"] = new MemoryStorage();
    g["sessionStorage"] = new MemoryStorage();
  });

  it("keeps several duels, newest first, and forgets expired ones", () => {
    const now = 10 * SESSION_TTL_MS;
    rememberSession(duel("AAAAA", now - SESSION_TTL_MS - 1), now);
    rememberSession(duel("BBBBB", now - 2), now);
    rememberSession(duel("CCCCC", now - 1), now);
    assert.deepEqual(listSessions(now).map((s) => s.room), ["CCCCC", "BBBBB"]);
    assert.equal(findSession("BBBBB", now)?.token, "t-BBBBB");
    for (let i = 0; i < MAX_SESSIONS + 3; i++) rememberSession(duel(`D${String(i).padStart(4, "2")}`, now + i), now + i);
    assert.equal(listSessions(now + 20).length, MAX_SESSIONS);
  });

  it("the tab's own duel is separate, and forgetting a room clears both", () => {
    const now = Date.now();
    rememberSession(duel("AAAAA", now), now);
    setTabSeat({ room: "AAAAA", token: "t-AAAAA" });
    assert.deepEqual(tabSeat(), { room: "AAAAA", token: "t-AAAAA" });
    forgetSession("AAAAA");
    assert.equal(tabSeat(), null);
    assert.deepEqual(listSessions(now), []);
  });

  it("survives broken or missing storage", () => {
    (g["localStorage"] as MemoryStorage).setItem("oldest-game:sessions", "{kaputt");
    assert.deepEqual(listSessions(), []);
    delete g["localStorage"];
    delete g["sessionStorage"];
    rememberSession(duel("AAAAA", Date.now()));
    assert.deepEqual(listSessions(), []);
    assert.equal(tabSeat(), null);
  });
});
