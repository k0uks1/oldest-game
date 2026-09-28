import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, coreOntology, loadPack } from "../src/content/index.ts";
import { parsePack, type ContentPack } from "../src/engine/ontology/pack.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { findCounters } from "../src/engine/rules.ts";
import { emptyLearnedPack, findLearned, learn, readLearnedPack } from "../src/llm/learning.ts";
import { formFromLlm } from "../src/llm/parser.ts";

const core = loadPack(CORE_PACK_RAW);
const onto = Ontology.compile([core]);

const kaese = {
  name: "Stinkender Käse",
  base: null,
  scale: 2,
  plane: "materie",
  archetype: "blob",
  properties: ["fest", "Käse", "gierig"],
  mechanisms: ["übertönt"],
  weaknesses: ["Käse"],
  intended_mechanism: null,
  new_properties: [{ name: "Käse", parents: ["fest"], implies: ["brennbar"] }],
  new_mechanism: { label: "verpestet", family: "sinne", targets: ["atmet", "riecht nach nichts"], blocked_by: ["koerperlos"], hint: "Der Gestank raubt den Atem." },
};

describe("live learning", () => {
  it("turns Claude's proposal into a validated delta (new tag under existing parents, weak new verb)", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const tag = r.delta.tags[0];
    assert.ok(tag);
    assert.equal(tag.id, "g_kaese");
    assert.deepEqual(tag.parents, ["fest"]);
    const verb = r.delta.verbs[0];
    assert.ok(verb);
    assert.equal(verb.leverage, 2, "non-violent learned mechanisms get a small lever");
    assert.deepEqual(verb.targets, ["atmet"], "unknown targets are dropped");
    assert.ok(r.form.tags.includes("g_kaese"));
  });

  it("learns the form: it compiles, inherits rules through its parents and is counterable", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok, l.ok ? "" : l.reason);
    const { onto: o2, form } = l.value;
    assert.ok(o2.formHas(form, "fest"), "Käse ⊂ fest");
    assert.ok(o2.formHas(form, "brennbar"), "implication from the proposal");
    assert.ok(findCounters(o2, form).some((c) => c.verb === "verbrennt"), "fire burns cheese without any new rule");
    assert.ok(form.weak.length > 0);
    assert.equal(findLearned(o2, "Stinkender Käse")?.id, form.id, "same text → same form next time");
  });

  it("is idempotent for the same text", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const first = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(first.ok);
    const second = learn([core], first.value.pack, "stinkender Käse", r.form, r.delta);
    assert.ok(second.ok);
    assert.equal(second.value.isNew, false);
    assert.equal(second.value.pack.forms.length, 1);
  });

  it("rejects tags that do not hang under the taxonomy", () => {
    const r = formFromLlm(onto, { ...kaese, new_properties: [{ name: "Quirks", parents: ["völlig unbekannt"] }] }, "quirks");
    assert.ok(r);
    assert.equal(r.delta.tags.length, 0);
  });

  it("refuses unbeatable creations", () => {
    const godlike = formFromLlm(
      onto,
      { name: "Nichtsnutz", base: null, scale: 8, plane: "abstrakt", archetype: "void", properties: ["unsterblich", "körperlos"], mechanisms: ["beendet"], intended_mechanism: null },
      "absolut unbesiegbares allmächtiges ding",
    );
    assert.ok(godlike);
    const l = learn([core], emptyLearnedPack(), "absolut unbesiegbares allmächtiges ding", godlike.form, godlike.delta);
    if (l.ok) assert.ok(findCounters(l.value.onto, l.value.form).length > 0);
  });

  it("survives round-tripping through storage", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    const restored = readLearnedPack(JSON.parse(JSON.stringify(l.value.pack)));
    assert.equal(restored.forms.length, 1);
    assert.equal(readLearnedPack({ id: "fremd" }).forms.length, 0, "foreign packs are ignored");
  });
});

describe("learned pack persistence (local server)", () => {
  it("validates and writes the pack file, then serves it back", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const server = await import("../server/learned.ts");
    const handleLearned = (req: Request, f: string) =>
      server.handleLearned(req, {
        base: [core],
        get: () => server.readLearnedFile([core], f),
        put: (pack) => {
          server.writeLearnedFile(f, pack);
          return pack;
        },
        writable: true,
      });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-learned-")), "pack.json");
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    const put = await handleLearned(new Request("http://x/api/learned", { method: "PUT", body: JSON.stringify(l.value.pack) }), file);
    assert.equal(put.status, 200);
    const get = await handleLearned(new Request("http://x/api/learned"), file);
    assert.equal(readLearnedPack(await get.json()).forms.length, 1);
    const bad = await handleLearned(new Request("http://x/api/learned", { method: "PUT", body: JSON.stringify({ ...l.value.pack, forms: [{ id: "x", name: "x", archetype: "orb", scale: 3, plane: "materie", tags: ["gibtsnicht"] }] }) }), file);
    assert.equal(bad.status, 400, "invalid packs are never written");
    const locked = await server.handleLearned(new Request("http://x/api/learned", { method: "PUT", body: "{}" }), { base: [core], get: emptyLearnedPack, put: (p) => p, writable: false });
    assert.equal(locked.status, 403, "public servers take no uploads");
    assert.ok(!fs.existsSync(`${file}.tmp`), "atomic write leaves no temp file");
  });
});

describe("learned weaknesses", () => {
  it("keeps a weakness that refers to a newly proposed tag", () => {
    const r = formFromLlm(onto, kaese, "stinkender Käse");
    assert.ok(r);
    assert.deepEqual(r.form.weak, ["g_kaese"]);
    const l = learn([core], emptyLearnedPack(), "stinkender Käse", r.form, r.delta);
    assert.ok(l.ok);
    assert.deepEqual(l.value.form.weak, ["g_kaese"]);
  });
});

describe("learned intensities", () => {
  const brenner = {
    name: "Schweißbrenner",
    base: null,
    scale: 2,
    plane: "materie",
    archetype: "weapon",
    properties: ["Feuer", "Stahl"],
    mechanisms: ["schmilzt"],
    weaknesses: ["Stahl"],
    intended_mechanism: null,
    intensitaet: { hitze: 9, hitzefest: 4, quatsch: 3 },
  };

  it("Claude's levels are clamped: forces at most scale + 2, unknown qualities dropped", () => {
    const r = formFromLlm(onto, brenner, "Schweißbrenner");
    assert.ok(r);
    assert.deepEqual(r.form.qualities, { hitze: 4, hitzefest: 4 });
  });

  it("a learned welding torch melts the anchor a torch cannot", async () => {
    const { checkCounter } = await import("../src/engine/rules.ts");
    const r = formFromLlm(onto, brenner, "Schweißbrenner");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "Schweißbrenner", r.form, r.delta);
    assert.ok(l.ok);
    const anker = l.value.onto.formById("anker");
    assert.ok(anker);
    assert.equal(l.value.onto.quality(l.value.form, "hitze"), 4);
    assert.equal(checkCounter(l.value.onto, l.value.form, anker, "schmilzt").valid, true);
  });

  it("learn() re-checks the cap whatever it is handed", () => {
    const r = formFromLlm(onto, brenner, "Schweißbrenner");
    assert.ok(r);
    const l = learn([core], emptyLearnedPack(), "Superbrenner", { ...r.form, qualities: { hitze: 6 } }, r.delta);
    assert.ok(l.ok);
    assert.equal(l.value.onto.quality(l.value.form, "hitze"), 4);
  });
});

describe("referee precedents (Schiedssprüche)", () => {
  it("a stored ruling decides the pair – deterministically, with the reason in the steps", async () => {
    const { addRuling: add } = await import("../src/llm/learning.ts");
    const { attempt } = await import("../src/engine/attempt.ts");
    const { createGame, play } = await import("../src/engine/game.ts");
    const core = parsePack(CORE_PACK_RAW);
    assert.ok(core.ok);
    const stored = add([core.pack], emptyLearnedPack(), { attacker: "samurai", target: "ritter", valid: true, verb: "zerschneidet", reason: "Die Klinge findet die Lücke in der Rüstung." });
    assert.ok(stored);
    const onto = stored.onto;
    const g = play(onto, createGame(["A", "B"]), need(onto.formById("ritter")), null);
    assert.ok(g.ok);
    const r = attempt(onto, g.value, need(onto.formById("samurai")), "zerschneidet");
    assert.ok(r.kind === "success", r.kind === "failure" ? r.failure.reason : r.kind);
    assert.equal(r.move.check?.ruling, true);
    assert.ok(r.move.check.steps.some((s) => s.text.includes("Lücke in der Rüstung")));
  });

  it("uncertain failures are flagged; a negative ruling stops further asking", async () => {
    const { addRuling: add } = await import("../src/llm/learning.ts");
    const { attempt } = await import("../src/engine/attempt.ts");
    const { createGame, play } = await import("../src/engine/game.ts");
    const core = parsePack(CORE_PACK_RAW);
    assert.ok(core.ok);
    const base = Ontology.compile([core.pack]);
    const g = play(base, createGame(["A", "B"]), need(base.formById("ritter")), null);
    assert.ok(g.ok);
    const r = attempt(base, g.value, need(base.formById("samurai")), null);
    assert.ok(r.kind === "failure");
    assert.ok(r.failure.uncertain !== undefined);
    const stored = add([core.pack], emptyLearnedPack(), { attacker: "samurai", target: "ritter", valid: false, verb: r.failure.closest?.verb ?? "zerschneidet", reason: "Stahl hält die Klinge ab." });
    assert.ok(stored);
    const g2 = play(stored.onto, createGame(["A", "B"]), need(stored.onto.formById("ritter")), null);
    assert.ok(g2.ok);
    const r2 = attempt(stored.onto, g2.value, need(stored.onto.formById("samurai")), null);
    assert.ok(r2.kind === "failure");
    assert.equal(r2.failure.uncertain, undefined);
  });

  it("a ruling cannot overturn proportions: scissors never cut a rock", async () => {
    const { addRuling: add } = await import("../src/llm/learning.ts");
    const { checkRuling } = await import("../src/engine/rules.ts");
    const core = parsePack(CORE_PACK_RAW);
    assert.ok(core.ok);
    const ruling = { attacker: "schere", target: "fels", valid: true, verb: "zerschneidet", reason: "Schere schlägt Stein." };
    const stored = add([core.pack], emptyLearnedPack(), ruling);
    assert.ok(stored);
    const check = checkRuling(stored.onto, need(stored.onto.formById("schere")), need(stored.onto.formById("fels")), ruling);
    assert.equal(check.valid, false);
    assert.equal(check.failedAt, "power");
  });

  it("referee answers are validated (unknown mechanism, missing reason → no ruling)", async () => {
    const { verdictFrom } = await import("../src/llm/referee.ts");
    const { attempt } = await import("../src/engine/attempt.ts");
    const { createGame, play } = await import("../src/engine/game.ts");
    const onto = coreOntology();
    const g = play(onto, createGame(["A", "B"]), need(onto.formById("ritter")), null);
    assert.ok(g.ok);
    const r = attempt(onto, g.value, need(onto.formById("samurai")), null);
    assert.ok(r.kind === "failure");
    assert.equal(verdictFrom(onto, r.failure, { sieg: true, mechanismus: "zaubert_alles_weg", begruendung: "" }), undefined);
    // a victory needs a mechanism the attacker actually has
    assert.equal(verdictFrom(onto, r.failure, { sieg: true, mechanismus: "zersetzt", begruendung: "Säure frisst Metall." }), undefined);
    const ok = verdictFrom(onto, r.failure, { sieg: true, mechanismus: "zerschneidet", begruendung: "Die Klinge findet die Fuge." });
    assert.equal(ok?.ruling.verb, "zerschneidet");
  });
});

function need<T>(x: T | undefined): T {
  assert.ok(x !== undefined);
  return x;
}

describe("learned pack after the core grew", () => {
  it("drops entries the core now defines and keeps the rest", async () => {
    const { reconcileLearned } = await import("../src/llm/learning.ts");
    const core = parsePack(CORE_PACK_RAW);
    assert.ok(core.ok);
    const stale: ContentPack = {
      ...emptyLearnedPack(),
      forms: [
        { id: "loeschdecke", name: "Löschdecke", archetype: "weapon", scale: 1, plane: "materie", tags: ["stoff"], verbs: ["erstickt"] },
        { id: "zauberkessel_x", name: "Zauberkessel X", archetype: "cup", scale: 2, plane: "materie", tags: ["eisen"], verbs: ["zerschlaegt"] },
        { id: "kaputt_x", name: "Kaputt X", archetype: "cup", scale: 2, plane: "materie", tags: ["gibt_es_nicht"], verbs: ["zerschlaegt"] },
      ],
    };
    assert.throws(() => Ontology.compile([core.pack, stale]));
    const fixed = reconcileLearned([core.pack], stale);
    assert.ok(fixed);
    assert.deepEqual(fixed.forms.map((f) => f.id), ["zauberkessel_x"]);
    const onto = Ontology.compile([core.pack, fixed]);
    assert.equal(onto.formById("loeschdecke")?.archetype, "cloth");
  });
});
