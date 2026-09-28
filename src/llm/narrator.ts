import { ESCAPE, reaches } from "../engine/rules.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Failure } from "../engine/attempt.ts";
import type { Form, GameState, Move } from "../engine/types.ts";
import { callClaude, type LlmSettings } from "./client.ts";
import { loreOf } from "./parser.ts";

/**
 * Hard cap on the client side too: the model is asked for one short sentence, but whatever
 * comes back is cut to the first sentence(s) that fit – a phone screen full of prose helps nobody.
 */
export function brief(raw: string, maxChars: number): string {
  const text = raw.replace(/\s+/g, " ").replace(/^["„»«]+|["“»«]+$/g, "").trim();
  if (text.length <= maxChars) return text;
  const first = (/^[^.!?…]+[.!?…]+/.exec(text) ?? [""])[0].trim();
  if (first !== "" && first.length <= maxChars) return first;
  const cut = text.slice(0, maxChars);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : maxChars).trim()} …`;
}

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  vertrieben: "in die Flucht geschlagen",
  verfuehrt: "verführt / umgarnt",
  befriedet: "befriedet (Gnade, ohne Leid)",
  eingeschlaefert: "eingeschläfert",
  gebannt: "gebannt / versiegelt",
  versteinert: "versteinert",
};

const SYSTEM = `Du bist der Erzähler von „The Oldest Game“, einem Duell der Vorstellungskraft in einer
Dungeon-Arena, im Stil düsterer Fantasy-Comics. Du beschreibst in GENAU EINEM kurzen, bildhaften deutschen Satz
(höchstens 16 Wörter – Kürze ist Würze) einen Zug, dessen Ausgang BEREITS FESTSTEHT. Erfinde keinen anderen Ausgang, keine
Regeln und keine Zahlen. Keine Anführungszeichen um die ganze Antwort, kein Markdown.
Regeln für den Satz:
- Nenne BEIDE Gestalten und zeige, wie genau diese eine auf genau diese andere wirkt – nichts Austauschbares.
- Das Schicksal des Verlierers folgt aus dem Mechanismus und seiner Natur: Die Welle reißt den Ritter fort und
  verschlingt ihn, Feuer lässt Holz zu Asche werden, Rost frisst Stahl. „Zerfällt zu Staub“ nur, wenn es wirklich passt.
- Nur Bewegungen, die die Gestalt wirklich kann: Ein Damm, ein Berg, ein Tresor bewegen sich nicht – sie halten,
  stauen, versperren, stürzen oder werden geworfen.
- Scheitert ein Zug, zeige kurz, woran er abprallt oder wie das Ziel antwortet.
- Ist eine Gestalt als albern oder heiter markiert, darf der Satz trocken-komisch sein: erzähle den Witz todernst,
  wie ein Chronist, der nicht lacht – die Pointe kommt aus ihren Eigenheiten, nicht aus Albernheit des Erzählers.`;

const MOVERS = ["lebendig", "fluessig", "gas", "feuer", "koerperlos", "fliegt", "schwimmt", "graebt"];

/** Name, scale and a few defining properties – plus a hint if the form cannot move by itself. */
function describe(onto: Ontology, f: Form): string {
  const tags = onto.formTags(f).slice(0, 6).map((t) => onto.tagLabel(t));
  const still = f.archetype !== "vehicle" && !MOVERS.some((t) => onto.formHas(f, t));
  const tone = f.tone === "albern" || f.tone === "heiter" ? `; Ton: ${f.tone}` : "";
  const mods = f.mods === undefined ? "" : `; ${f.mods.join(", ")}`;
  return `${f.name} (Stufe ${String(f.scale)}; ${tags.join(", ")}${mods}${still ? "; bewegt sich nicht von selbst" : ""}${tone})`;
}

/** Richer narration of an already-resolved move. Falls back to offline text on any error. */
export async function narrateWithClaude(
  onto: Ontology,
  settings: LlmSettings,
  state: GameState,
  move: Move,
  index: number,
  fallback: string,
): Promise<string> {
  const target = index > 0 ? state.history[index - 1]?.form : undefined;
  const verb = move.verb === null ? undefined : onto.verbs.get(move.verb)?.spec;
  const facts =
    target !== undefined && move.verb === ESCAPE
      ? [
          `Ausweichender: ${describe(onto, move.form)}`,
          `Bedrohung: ${describe(onto, target)} – greift an, trifft aber nicht.`,
          "Ausgang: ENTKOMMEN – niemand wird vernichtet; die Bedrohung zieht sich zurück, der Ausweichende bleibt.",
          ...(move.check?.steps.slice(1).map((s) => s.text) ?? []),
        ].join("\n")
      : target === undefined || verb === undefined
      ? `Eröffnung: ${state.players[move.player].name} nimmt die Gestalt „${move.form.name}“ an.`
      : [
          `Angreifer: ${describe(onto, move.form)}`,
          `Ziel: ${describe(onto, target)} – wird besiegt.`,
          `Mechanismus: ${verb.label} – ${verb.hint}`,
          move.check?.hitTag === null || move.check === null ? "" : `Angriffsfläche: ${onto.tagLabel(move.check.hitTag)}`,
          move.check?.weaknessHit === true ? "Traf eine offensichtliche Schwäche." : "",
          move.form.scale < target.scale ? "Der Kleinere besiegt den Größeren – ein eleganter Zug." : "",
          move.check === null || move.check.outcome === "vernichtet" ? "" : `Siegart: ${target.name} wird ${OUTCOME_WORDS[move.check.outcome] ?? move.check.outcome} – NICHT vernichtet.`,
          move.check?.startled === true ? `${target.name} erschrickt und flieht.` : "",
          move.check?.ruling === true ? `Begründung des Schiedsrichters: ${move.check.steps.at(-1)?.text ?? ""}` : "",
        ]
          .filter((l) => l !== "")
          .join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 60, temperature: 0.8 });
    const text = brief(r.text, 150);
    return text === "" ? fallback : text;
  } catch {
    return fallback;
  }
}

/** Narrate a failed attempt – the form was not enough. */
export async function narrateFailureWithClaude(
  onto: Ontology,
  settings: LlmSettings,
  failure: Failure,
  fallback: string,
): Promise<string> {
  const answer = onto.compileForm(failure.target).verbs.find((v) => reaches(onto, v, failure.form));
  const facts = [
    `Versuch: ${describe(onto, failure.form)} soll ${describe(onto, failure.target)} besiegen.`,
    "Ausgang: SCHEITERT – die Gestalt zerschellt und ist verbraucht, das Ziel bleibt unversehrt.",
    `Grund laut Regel-Engine: ${failure.reason}`,
    failure.closest === null ? "" : `Versuchter Weg: ${onto.verbs.get(failure.closest.verb)?.spec.label ?? failure.closest.verb}`,
    answer === undefined ? "" : `Das Ziel antwortet: ${failure.target.name} ${onto.verbs.get(answer)?.spec.label ?? answer} ${failure.form.name}.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 60, temperature: 0.8 });
    const text = brief(r.text, 150);
    return text === "" ? fallback : text;
  } catch {
    return fallback;
  }
}

/**
 * A short epilogue for the finished duel – the chain of forms retold as one legend.
 * Only facts from the engine go in; the outcome is fixed.
 */
export async function narrateEpilogueWithClaude(settings: LlmSettings, state: GameState, fallback: string): Promise<string> {
  if (state.winner === null && state.history.length === 0) return fallback;
  const chain = state.history.map((m) => `${state.players[m.player].name}: ${m.form.name}${m.discovery ? " (nie zuvor gesehen)" : ""}`).join(" → ");
  const facts = [
    `Verlauf: ${chain}`,
    `Ende: ${fallback}`,
    "Schreibe einen Epilog in höchstens 2 kurzen Sätzen (zusammen höchstens 30 Wörter), wie eine alte Legende, die man sich über dieses Duell erzählt. Nenne den Sieger.",
  ].join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 110, temperature: 0.9 });
    const text = brief(r.text, 260);
    return text === "" ? fallback : text;
  } catch {
    return fallback;
  }
}

const LORE_SYSTEM = `Du schreibst Einträge für das Grimoire von „The Oldest Game“, einem Duell der Vorstellungskraft
(Sandman: Morpheus gegen einen Dämon). Zu einer Gestalt schreibst du ihre kurze Legende: 2–4 kurze deutsche Sätze,
zusammen höchstens 60 Wörter, kein Markdown, keine Anführungszeichen um das Ganze, keine Zahlen oder Spielregeln.
Der TON folgt der Gestalt:
- ernst (Ritter, Drache, Tod): mythisch, düster, wie eine alte Sage.
- heiter (Quietscheente, Postbote): warm und augenzwinkernd.
- albern (Witz- und Quatschgestalten wie „der achtarmige Alkoholiker“): absurd-komisch, aber mit innerer Logik –
  nimm den Witz halb ernst, als wäre er wahr, und lass seine Eigenheiten eine Rolle spielen.
Erfinde Herkunft, Gewohnheiten, einen Ruf – nichts, was ihren Eigenschaften widerspricht.`;

/**
 * A short legend for the form card (grimoire, overview). Presentation only: the engine never
 * reads it. `undefined` when Claude is not reachable – the card then shows the flavor text.
 */
export async function loreWithClaude(onto: Ontology, settings: LlmSettings, form: Form): Promise<string | undefined> {
  const verbs = onto.compileForm(form).verbs.slice(0, 4).map((v) => onto.verbs.get(v)?.spec.label ?? v);
  const facts = [
    `Gestalt: ${describe(onto, form)}`,
    verbs.length === 0 ? "" : `Kann: ${verbs.join(", ")}`,
    form.mods === undefined ? "" : `Abwandlungen: ${form.mods.join(", ")}`,
    form.flavor === undefined ? "" : `Bekannter Spruch: ${form.flavor}`,
    `Ton: ${form.tone ?? "wähle ihn selbst"}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const r = await callClaude(settings, { system: LORE_SYSTEM, user: facts, maxTokens: 220, temperature: 0.9 });
    return loreOf(r.text);
  } catch {
    return undefined;
  }
}
