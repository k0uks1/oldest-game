import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Form } from "../engine/types.ts";
import { callClaude, type LlmSettings, type ToolDef } from "./client.ts";
import type { LearningDelta } from "./learning.ts";
import { PROPOSAL_PROPERTIES, proposeDelta, qualitiesOf } from "./parser.ts";

/**
 * The judge ("Urteil"): when a form meets that the game did not know before (learned from a
 * player's own words), no rule was ever written for the pair. Then Claude judges
 * the pair outright – and must give the reasons in the game's own vocabulary: properties,
 * intensities, a mechanism. Those are validated and learned like any other proposal; the engine
 * re-checks the pair with them, and only where it still disagrees is the verdict stored as a
 * precedent (like a referee ruling). Next time the engine decides alone.
 */

const MAX_PER_SIDE = 3;

const TOOL: ToolDef = {
  name: "urteil",
  description: "Entscheide, ob die eine erfundene Gestalt die andere besiegt – und begründe es im Vokabular des Spiels.",
  input_schema: {
    type: "object",
    properties: {
      sieg: { type: "boolean", description: "true, wenn der Angreifer das Ziel plausibel besiegt." },
      begruendung: { type: "string", description: "Ein kurzer deutscher Satz (höchstens 25 Wörter), warum." },
      mechanismus: {
        type: ["string", "null"],
        description: "Womit der Angreifer siegt: Mechanismus-ID (auch aus seiner Liste) oder das Verb eines new_mechanism. Bei false: der naheliegendste Versuch.",
      },
      angreifer: {
        type: "object",
        description: "Was dem Angreifer bisher fehlte, damit das Urteil aus seinen Eigenschaften folgt (höchstens 3).",
        properties: {
          eigenschaften: { type: "array", items: { type: "string" }, maxItems: MAX_PER_SIDE },
          intensitaet: { type: "object", additionalProperties: { type: "integer", minimum: 0, maximum: 6 } },
        },
      },
      ziel: {
        type: "object",
        description: "Was dem Ziel bisher fehlte (z. B. eine Schwachstelle, die der Angreifer trifft, oder ein Schutz), höchstens 3.",
        properties: {
          eigenschaften: { type: "array", items: { type: "string" }, maxItems: MAX_PER_SIDE },
          intensitaet: { type: "object", additionalProperties: { type: "integer", minimum: 0, maximum: 6 } },
        },
      },
      ...PROPOSAL_PROPERTIES,
    },
    required: ["sieg", "begruendung", "mechanismus"],
  },
};

const SYSTEM = `Du bist der Richter im „ältesten Spiel“ (Sandman: Morpheus gegen einen Dämon – jeder wird zu etwas,
das die letzte Gestalt des anderen besiegt). Hier ist mindestens eine Gestalt dabei, die ein Spieler selbst erfunden
hat; keine Regel kennt dieses Paar, und die Regel-Engine irrt bei neuen Gestalten oft (ein Radio „zersetzt“ einen Marder). Du urteilst – mit gesundem Menschenverstand, Märchenlogik und der inneren Logik
der Gestalten (auch Witzgestalten nimmst du halb ernst: ihre Pointe gilt).

Dein Urteil muss aus Eigenschaften folgen, die das Spiel versteht: Nenne, was dem Angreifer oder dem Ziel an
Eigenschaften, Fähigkeiten oder Intensität noch fehlte, damit eine Regel-Engine zum selben Ergebnis kommt – bestehende
Begriffe bevorzugt, sonst neue (new_properties, new_qualities, new_mechanism im bekannten Format). Gestalten ohne
„(erfunden)“ stammen aus dem Lexikon und ändern sich nicht – nenne dort nichts. Nur was wirklich zur
Gestalt gehört: nichts erfinden, nur damit es passt. Größe zählt: Eine Maus besiegt keinen Berg, außer ihre Natur trifft
genau seine Schwachstelle. Sei streng, aber fair: Ein Sieg „irgendwie“ ist kein Sieg. Antworte nur mit dem Werkzeug.`;

/** A judgement in the game's vocabulary (validated later by `amend` and the engine). */
export interface Judgement {
  readonly win: boolean;
  readonly reason: string;
  /** Mechanism id (existing or proposed); undefined = none named. */
  readonly verb?: string;
  readonly delta: LearningDelta;
  readonly attacker: SideChange;
  readonly target: SideChange;
}

export interface SideChange {
  readonly tags: readonly string[];
  readonly qualities?: Readonly<Record<string, number>>;
}

function describe(onto: Ontology, f: Form): string {
  const c = onto.compileForm(f);
  const tags = f.tags.map((t) => onto.tagLabel(t));
  const verbs = c.verbs.map((v) => `${v} (${onto.verbs.get(v)?.spec.label ?? v})`);
  const levels = [...c.qualities].map(([q, n]) => `${onto.qualities.get(q)?.label ?? q} ${String(n)}`);
  return [
    `${f.name}${f.id.startsWith("g:") ? " (erfunden)" : ""} – Stufe ${String(f.scale)}, ${f.plane}${f.tone === undefined ? "" : `, Ton ${f.tone}`}`,
    `  Eigenschaften: ${tags.join(", ")}`,
    `  Kann: ${verbs.join(", ") || "nichts"}`,
    levels.length === 0 ? "" : `  Intensität: ${levels.join(", ")}`,
    f.weak.length === 0 ? "" : `  Schwäche: ${f.weak.map((w) => onto.tagLabel(w)).join(", ")}`,
    f.mods === undefined ? "" : `  Abwandlungen: ${f.mods.join(", ")}`,
    f.lore === undefined ? "" : `  Legende: ${f.lore}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function judgeWithClaude(onto: Ontology, settings: LlmSettings, attacker: Form, target: Form, engine: string): Promise<Judgement | undefined> {
  const user = [
    `Angreifer:\n${describe(onto, attacker)}`,
    `Ziel:\n${describe(onto, target)}`,
    `Die Regel-Engine meint bisher: ${engine}`,
    "Besiegt der Angreifer das Ziel? Urteile und nenne, was an Eigenschaften fehlte.",
  ].join("\n\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user, maxTokens: 900, temperature: 0, tool: TOOL });
    return judgementFrom(onto, attacker, target, r.toolInput);
  } catch {
    return undefined;
  }
}

/** Shape Claude's answer (pure – unit-testable). Unknown words are dropped, not guessed. */
export function judgementFrom(onto: Ontology, attacker: Form, target: Form, raw: unknown): Judgement | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const reason = typeof o["begruendung"] === "string" ? o["begruendung"].replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (typeof o["sieg"] !== "boolean" || reason === "") return undefined;
  const delta = proposeDelta(onto, o, []);
  const tagRef = (k: string): string | undefined =>
    onto.hasTag(k) ? k : (onto.resolveTag(k) ?? delta.tags.find((t) => t.id === k || t.label.toLowerCase() === k.toLowerCase())?.id);
  const side = (raw: unknown, form: Form): SideChange => {
    const s = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const tags = (Array.isArray(s["eigenschaften"]) ? s["eigenschaften"] : [])
      .filter((x): x is string => typeof x === "string")
      .map(tagRef)
      .filter((x): x is string => x !== undefined && !form.tags.includes(x));
    const qualities = qualitiesOf(onto, s["intensitaet"], form.scale, delta.qualities);
    return { tags: [...new Set(tags)].slice(0, MAX_PER_SIDE), ...(qualities === undefined ? {} : { qualities }) };
  };
  const m = typeof o["mechanismus"] === "string" ? o["mechanismus"].trim() : "";
  const proposed = delta.verbs.find((v) => v.id === m || v.label.toLowerCase() === m.toLowerCase());
  const verb = proposed?.id ?? (onto.verbs.has(m) ? m : onto.resolveVerb(m));
  return { win: o["sieg"], reason, ...(verb === undefined ? {} : { verb }), delta, attacker: side(o["angreifer"], attacker), target: side(o["ziel"], target) };
}
