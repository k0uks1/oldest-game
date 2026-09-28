/**
 * Joke forms, taken half seriously: the punchline is the classification. The engine needs
 * nothing special – traits, abilities, a new force and a contest mechanism carry the joke.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology } from "../src/engine/ontology/ontology.ts";
import { checkCounter, intensity } from "../src/engine/rules.ts";
import type { Form } from "../src/engine/types.ts";
import { emptyLearnedPack, learn } from "../src/llm/learning.ts";
import { formFromLlm } from "../src/llm/parser.ts";

const core = loadPack(CORE_PACK_RAW);
const coreOnto = Ontology.compile([core]);

const alkoholiker = {
  name: "Der achtarmige Alkoholiker",
  base: null,
  scale: 3,
  plane: "leben",
  archetype: "humanoid",
  properties: ["mensch", "vielarmig", "betrunken", "trinkt"],
  mechanisms: ["säuft unter den Tisch"],
  weaknesses: ["betrunken"],
  intended_mechanism: "säuft unter den Tisch",
  ton: "albern",
  intensitaet: { Trinkfestigkeit: 6 },
  new_properties: [{ name: "trinkt", art: "merkmal", parents: ["isst"] }],
  new_qualities: [{ name: "Trinkfestigkeit", art: "kraft", hint: "Limo 0, Stammtisch 3, Wikinger 5." }],
  new_mechanism: { label: "säuft unter den Tisch", family: "geist", targets: ["trinkt"], braucht: ["trinkt"], kraft: "Trinkfestigkeit", gegen: "Trinkfestigkeit", hint: "Wer weniger verträgt, liegt zuerst." },
};

function learned(): { onto: Ontology; alk: Form; schlucker: Form; zecher: Form } {
  const a = formFromLlm(coreOnto, alkoholiker, "der achtarmige Alkoholiker");
  assert.ok(a);
  const l1 = learn([core], emptyLearnedPack(), "der achtarmige Alkoholiker", a.form, a.delta);
  assert.ok(l1.ok, l1.ok ? "" : l1.reason);
  const o1 = l1.value.onto;
  const s = formFromLlm(o1, { name: "Armer Schlucker", base: null, scale: 3, plane: "leben", archetype: "humanoid", properties: ["mensch", "trinkt"], mechanisms: ["befreundet"], weaknesses: ["trinkt"], intended_mechanism: null, intensitaet: { Trinkfestigkeit: 1 } }, "armer Schlucker");
  assert.ok(s);
  const l2 = learn([core], l1.value.pack, "armer Schlucker", s.form, s.delta);
  assert.ok(l2.ok, l2.ok ? "" : l2.reason);
  const z = formFromLlm(l2.value.onto, { name: "Zecher", base: null, scale: 3, plane: "leben", archetype: "humanoid", properties: ["mensch", "trinkt"], mechanisms: ["befreundet"], weaknesses: ["trinkt"], intended_mechanism: null, intensitaet: { Trinkfestigkeit: 5 } }, "Zecher");
  assert.ok(z);
  const l3 = learn([core], l2.value.pack, "Zecher", z.form, z.delta);
  assert.ok(l3.ok, l3.ok ? "" : l3.reason);
  return { onto: l3.value.onto, alk: l1.value.form, schlucker: l2.value.form, zecher: l3.value.form };
}

describe("Scherzgestalten, halb ernst", () => {
  it("der achtarmige Alkoholiker säuft den armen Schlucker unter den Tisch – im Wettstreit", () => {
    const { onto, alk, schlucker } = learned();
    const r = checkCounter(onto, alk, schlucker, "g_saeuft_unter_den_tisch");
    assert.ok(r.valid, r.steps.map((s) => s.text).join(" / "));
    assert.match(intensity(onto, alk, schlucker, "g_saeuft_unter_den_tisch").text, /Wettstreit in Trinkfestigkeit: 5/);
    assert.equal(alk.tone, "albern");
  });

  it("aber keinen Felsen (trinkt nicht) – und einen ebenbürtigen Zecher nicht (Gleichstand)", () => {
    const { onto, alk, zecher } = learned();
    const fels = onto.formById("fels");
    assert.ok(fels);
    assert.equal(checkCounter(onto, alk, fels, "g_saeuft_unter_den_tisch").valid, false);
    const tie = checkCounter(onto, alk, zecher, "g_saeuft_unter_den_tisch");
    assert.equal(tie.valid, false);
    assert.match(tie.steps.at(-1)?.text ?? "", /Gleichstand reicht nicht/);
  });

  it("acht Arme hauen und halten; wer betrunken ist, fürchtet nichts; Lächerliches macht keine Angst", () => {
    const { onto, alk } = learned();
    const verbs = onto.compileForm(alk).verbs;
    assert.ok(verbs.includes("zerschlaegt") && verbs.includes("fesselt"), verbs.join(", "));
    const angst = coreOnto.formById("clown");
    assert.ok(angst);
    const drunkTarget: Form = { ...coreOnto.formById("mann") ?? angst, id: "trunkenbold", tags: ["mensch", "betrunken", "furchtsam"] };
    assert.equal(checkCounter(coreOnto, angst, drunkTarget, "aengstigt").valid, false, "Mut aus der Flasche");
    const silly: Form = { ...angst, id: "harmloser_clown", tags: [...angst.tags, "laecherlich"] };
    assert.equal(coreOnto.compileForm(silly).verbs.includes("aengstigt"), false);
    assert.match(coreOnto.lacks(silly, "aengstigt") ?? "", /lächerlich/);
  });
});
