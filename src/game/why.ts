/**
 * "Warum?" – the engine's own account of a move, step by step, as the chronicle shows it. Plain strings, so the
 * online server can keep them with its chronicle: a page that rebuilds the chronicle (joining, reconnecting after
 * the phone was in the pocket) shows the reasons again instead of bare entries.
 */
import type { PlayedOutcome } from "./resolver.ts";

export function whyLines(outcome: PlayedOutcome, discoveryEleganz: number): string[] {
  if (outcome.kind === "success") {
    const move = outcome.move;
    const steps = move.check?.steps.map((st) => st.text) ?? ["Eröffnung."];
    return move.discovery ? [...steps, `Einfallsreichtum: +${String(discoveryEleganz)} Eleganz für eine nie gesehene Gestalt.`] : steps;
  }
  const f = outcome.failure;
  return [...(f.closest?.check.steps.map((st) => st.text) ?? []), f.reason].filter((t, i, a) => a.indexOf(t) === i);
}
