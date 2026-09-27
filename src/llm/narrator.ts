import { ESCAPE } from "../engine/rules.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Failure } from "../engine/attempt.ts";
import type { GameState, Move } from "../engine/types.ts";
import { callClaude, type LlmSettings } from "./client.ts";

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  vertrieben: "in die Flucht geschlagen",
  verfuehrt: "verführt / umgarnt",
  befriedet: "befriedet (Gnade, ohne Leid)",
  eingeschlaefert: "eingeschläfert",
  gebannt: "gebannt / versiegelt",
  versteinert: "versteinert",
};

const SYSTEM = `Du bist der Erzähler von „The Oldest Game“, einem Duell der Vorstellungskraft in einer
Dungeon-Arena, im Stil düsterer Fantasy-Comics. Du beschreibst in 1–2 kurzen, bildhaften deutschen Sätzen
(höchstens 45 Wörter) einen Zug, dessen Ausgang BEREITS FESTSTEHT. Erfinde keinen anderen Ausgang, keine
Regeln und keine Zahlen. Keine Anführungszeichen um die ganze Antwort, kein Markdown.`;

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
          `Ausweichender: ${move.form.name} (Stufe ${String(move.form.scale)})`,
          `Bedrohung: ${target.name} (Stufe ${String(target.scale)}) – greift an, trifft aber nicht.`,
          "Ausgang: ENTKOMMEN – niemand wird vernichtet; die Bedrohung zieht sich zurück, der Ausweichende bleibt.",
          ...(move.check?.steps.slice(1).map((s) => s.text) ?? []),
        ].join("\n")
      : target === undefined || verb === undefined
      ? `Eröffnung: ${state.players[move.player].name} nimmt die Gestalt „${move.form.name}“ an.`
      : [
          `Angreifer: ${move.form.name} (Stufe ${String(move.form.scale)})`,
          `Ziel: ${target.name} (Stufe ${String(target.scale)}) – wird besiegt.`,
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
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 160, temperature: 0.8 });
    const text = r.text.trim();
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
  const facts = [
    `Versuch: ${failure.form.name} (Stufe ${String(failure.form.scale)}) soll ${failure.target.name} (Stufe ${String(failure.target.scale)}) besiegen.`,
    "Ausgang: SCHEITERT – die Gestalt zerschellt und ist verbraucht, das Ziel bleibt unversehrt.",
    `Grund laut Regel-Engine: ${failure.reason}`,
    failure.closest === null ? "" : `Versuchter Weg: ${onto.verbs.get(failure.closest.verb)?.spec.label ?? failure.closest.verb}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 160, temperature: 0.8 });
    const text = r.text.trim();
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
    "Schreibe einen Epilog in 2–3 Sätzen (höchstens 60 Wörter), wie eine alte Legende, die man sich über dieses Duell erzählt. Nenne den Sieger.",
  ].join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user: facts, maxTokens: 220, temperature: 0.9 });
    const text = r.text.trim();
    return text === "" ? fallback : text;
  } catch {
    return fallback;
  }
}
