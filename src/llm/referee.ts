import type { Failure } from "../engine/attempt.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { RulingSpec } from "../engine/ontology/pack.ts";
import type { Form } from "../engine/types.ts";
import { callClaude, type LlmSettings } from "./client.ts";

/**
 * The referee ("Schiedsrichter"): consulted only when the engine flags its own verdict as
 * uncertain (see `uncertainty()` in engine/attempt.ts). Claude may overturn a failure – but
 * only by naming an existing mechanism and a one-line reason. The ruling becomes a stored
 * precedent for exactly this pair, so the same matchup is decided the same way forever.
 */

const TOOL = {
  name: "schiedsspruch",
  description: "Entscheide einen strittigen Zug im Duell der Vorstellungskraft.",
  input_schema: {
    type: "object",
    properties: {
      sieg: { type: "boolean", description: "true, wenn der Angreifer das Ziel plausibel besiegt – sonst false." },
      mechanismus: { type: "string", description: "ID des Mechanismus, mit dem der Sieg gelingt (aus der Liste). Bei false: der am nächsten liegende." },
      begruendung: { type: "string", description: "Ein kurzer deutscher Satz (höchstens 20 Wörter), warum." },
    },
    required: ["sieg", "mechanismus", "begruendung"],
  },
} as const;

const SYSTEM = `Du bist der Schiedsrichter im „ältesten Spiel“: Zwei Spieler verwandeln sich abwechselnd in
etwas, das die letzte Gestalt des Gegners besiegt. Eine Regel-Engine entscheidet fast alles; sie ruft
dich nur, wenn sie unsicher ist. Urteile mit gesundem Menschenverstand und mythischer Logik (Märchen,
Sagen, Physik des Alltags): Ein Messer zerschneidet ein Netz, Wasser löscht Feuer, Hoffnung trotzt dem Ende.
Sei aber streng: Kein Sieg durch bloße Größe, keine Ausreden, kein „irgendwie“. Größenverhältnisse
zählen: Eine Schere zerschneidet keinen Felsen, eine Maus hält keinen Damm auf. Wenn es nur mit viel
Fantasie ginge, entscheide false. Antworte nur mit dem Werkzeug.`;

export interface RefereeVerdict {
  readonly ruling: RulingSpec;
}

function describe(onto: Ontology, f: Form): string {
  const tags = onto.formTags(f).slice(0, 18).map((t) => onto.tagLabel(t));
  return `${f.name} (Stufe ${String(f.scale)}; ${tags.join(", ")})`;
}

export async function refereeWithClaude(onto: Ontology, settings: LlmSettings, failure: Failure): Promise<RefereeVerdict | undefined> {
  const verbs = [...onto.verbs.values()].map((v) => `${v.spec.id}: ${v.spec.label} – ${v.spec.hint}`);
  const user = [
    `Angreifer: ${describe(onto, failure.form)}`,
    `Ziel: ${describe(onto, failure.target)}`,
    `Die Engine meint: ${failure.reason}`,
    failure.closest === null ? "" : `Versuchter Weg: ${failure.closest.check.steps.map((s) => s.text).join(" → ")}`,
    `Unsicherheit der Engine: ${failure.uncertain ?? "?"}`,
    "",
    "Mechanismen:",
    ...verbs,
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user, maxTokens: 200, temperature: 0, tool: TOOL });
    return verdictFrom(onto, failure, r.toolInput);
  } catch {
    return undefined;
  }
}

/** Validate Claude's answer – unknown mechanisms or malformed input mean: no ruling. */
export function verdictFrom(onto: Ontology, failure: Failure, raw: unknown): RefereeVerdict | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const sieg = o["sieg"];
  const verb = typeof o["mechanismus"] === "string" ? o["mechanismus"] : "";
  const reason = typeof o["begruendung"] === "string" ? o["begruendung"].trim().slice(0, 160) : "";
  if (typeof sieg !== "boolean" || reason === "") return undefined;
  const resolved = onto.verbs.has(verb) ? verb : (onto.resolveVerb(verb) ?? failure.closest?.verb);
  if (resolved === undefined || !onto.verbs.has(resolved)) return undefined;
  return { ruling: { attacker: failure.form.id, target: failure.target.id, valid: sieg, verb: resolved, reason } };
}
