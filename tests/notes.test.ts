/**
 * Einwände mit Begründung: a player's reason for "Quatsch?" / "Hätte klappen müssen?" is kept in the
 * learned pack and heard by every later judgement involving either form. Claude is simulated.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { createGame } from "../src/engine/game.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { parsePack, type ContentPack, type NoteSpec } from "../src/engine/ontology/pack.ts";
import { Resolver } from "../src/game/resolver.ts";
import { DEFAULT_SETTINGS } from "../src/llm/client.ts";
import { addNote, emptyLearnedPack, notesAbout } from "../src/llm/learning.ts";
import { applyPackDelta, packDelta, parseClientMsg } from "../src/online/protocol.ts";
import { formatPack } from "../server/learned.ts";

const core = loadPack(CORE_PACK_RAW);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const blase = {
  name: "Seifenblasen-Drache",
  base: null,
  scale: 3,
  plane: "materie",
  archetype: "beast",
  properties: ["luft", "fliegt", "Seifenhaut"],
  mechanisms: ["blendet"],
  weaknesses: ["Seifenhaut"],
  intended_mechanism: null,
  new_properties: [{ name: "Seifenhaut", art: "ist", parents: ["fluessig"] }],
  new_qualities: [],
  new_mechanism: null,
};

/** Simulated Claude: every judgement's prompt is recorded. */
function fakeClaude(verdict: unknown): string[] {
  const judged: string[] = [];
  globalThis.fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { tools?: { name: string }[]; messages: { content: string }[] };
    const tool = body.tools?.[0]?.name ?? "text";
    const user = body.messages[0]?.content ?? "";
    if (tool === "urteil") judged.push(user);
    const input = tool === "urteil" ? verdict : blase;
    const content = tool === "text" ? [{ type: "text", text: "…" }] : [{ type: "tool_use", input }];
    return Promise.resolve(new Response(JSON.stringify({ content, usage: {} }), { status: 200 }));
  };
  return judged;
}

function resolver(debug = false): Resolver {
  return new Resolver(Ontology.compile([core]), [core], emptyLearnedPack(), {
    llm: () => ({ ...DEFAULT_SETTINGS, proxyUrl: "/api/claude" }),
    debug: () => debug,
    saveLearned: () => undefined,
    today: () => "2026-09-29",
  });
}

describe("Einwände mit Begründung", () => {
  it("the reason reaches the judge now – and every later judgement involving either form", async () => {
    const r = resolver();
    const judged = fakeClaude({ bester_weg: "Die Lanze.", sieg: true, begruendung: "Die Lanze trifft.", mechanismus: "durchbohrt" });
    await r.reconsider("ritter", "ratte", "durchbohrt", true, "Eine Lanze\u0007 trifft doch jede Ratte!");
    assert.match(judged[0] ?? "", /Begründung: „Eine Lanze trifft doch jede Ratte!“/);
    assert.deepEqual(r.learned.notes, [{ form: "ritter", other: "ratte", text: "Eine Lanze trifft doch jede Ratte!", failed: true }]);
    // a new pair with the knight: the judge hears the objection as an opinion
    const ritter = r.onto.formById("ritter");
    assert.ok(ritter);
    const first = await r.play(createGame(["A", "B"]), ritter, null, null);
    assert.equal(first.kind, "turn");
    await r.resolve(first.turn.state, "Seifenblasen-Drache");
    const later = judged.at(-1) ?? "";
    assert.match(later, /Einwände von Spielern/);
    assert.match(later, /Ritter gegen Ratte, hätte klappen sollen: „Eine Lanze trifft doch jede Ratte!“/);
  });

  it("kept without Claude too; bounded per pair; empty reasons keep nothing", async () => {
    const r = resolver(true);
    assert.equal(await r.reconsider("ritter", "ratte", "durchbohrt", false, "  "), undefined);
    const notes = (): readonly NoteSpec[] => r.learned.notes ?? [];
    assert.equal(notes().length, 0, "nothing to keep");
    for (const t of ["eins", "zwei", "drei"]) await r.reconsider("ritter", "ratte", "durchbohrt", false, t);
    assert.deepEqual(
      notes().map((n) => n.text),
      ["zwei", "drei"],
      "only the latest two per pair",
    );
    const long = addNote(emptyLearnedPack(), { form: "a", other: "b", text: "x".repeat(500) });
    assert.equal(long.notes?.at(0)?.text.length, 200);
    assert.deepEqual(notesAbout(long, ["b"]).length, 1);
    assert.deepEqual(notesAbout(long, ["c"]).length, 0);
  });

  it("travels in pack deltas and online reports, and survives the server's file", () => {
    const withNote = addNote(emptyLearnedPack(), { form: "ritter", other: "ratte", text: "Quatsch." });
    const d = packDelta(emptyLearnedPack(), withNote);
    assert.equal(d.notes?.length, 1);
    assert.deepEqual(applyPackDelta(emptyLearnedPack(), d).notes, withNote.notes);
    const msg = parseClientMsg(JSON.stringify({ t: "report", attacker: "Radio", target: "Marder", verb: "zersetzt", reason: "Ein Radio\nätzt nicht." }));
    assert.equal(msg?.t === "report" ? msg.reason : undefined, "Ein Radio ätzt nicht.");
  });
});

describe("the learned pack on disk", () => {
  it("keeps every list – learned qualities, Siegwege and notes were lost on save before", () => {
    const pack: ContentPack = {
      ...emptyLearnedPack(),
      qualities: [{ id: "q_klebrig", label: "Klebrigkeit", kind: "kraft", default: 0 }],
      extensions: [{ verb: "verbrennt", targets: ["papier"] }],
      notes: [{ form: "ritter", other: "ratte", text: "Quatsch." }],
    };
    const parsed = parsePack(JSON.parse(formatPack(pack)));
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
    assert.deepEqual(parsed.pack.qualities, pack.qualities);
    assert.deepEqual(parsed.pack.extensions, pack.extensions);
    assert.deepEqual(parsed.pack.notes, pack.notes);
  });
});
