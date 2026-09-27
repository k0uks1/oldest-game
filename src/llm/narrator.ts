import type { Ontology } from "../engine/ontology/ontology.ts";
import type { GameState, Move } from "../engine/types.ts";
import { callClaude, type LlmSettings } from "./client.ts";

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
    target === undefined || verb === undefined
      ? `Eröffnung: ${state.players[move.player].name} nimmt die Gestalt „${move.form.name}“ an.`
      : [
          `Angreifer: ${move.form.name} (Stufe ${String(move.form.scale)})`,
          `Ziel: ${target.name} (Stufe ${String(target.scale)}) – wird besiegt.`,
          `Mechanismus: ${verb.label} – ${verb.hint}`,
          move.check?.hitTag === null || move.check === null ? "" : `Angriffsfläche: ${onto.tagLabel(move.check.hitTag)}`,
          move.check?.weaknessHit === true ? "Traf eine offensichtliche Schwäche." : "",
          move.form.scale < target.scale ? "Der Kleinere besiegt den Größeren – ein eleganter Zug." : "",
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
