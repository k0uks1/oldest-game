import type { Ontology } from "./ontology/ontology.ts";
import type { FieldSpec } from "./ontology/pack.ts";
import type { GameState } from "./types.ts";

/** A field currently shaping the arena, with the number of moves it still lasts. */
export interface ActiveField {
  readonly spec: FieldSpec;
  readonly remaining: number;
}

/** A power change applied to one check, explained for the players. */
export interface PowerModifier {
  readonly delta: number;
  readonly text: string;
}

/**
 * Fields left behind by the last successful moves ("Arena-Zustand"). Pure function of the
 * history: a move triggers a field if it used one of its mechanisms or its form carries one
 * of its tags; the field lasts `duration` further moves. The newest trigger wins.
 */
export function activeFields(onto: Ontology, state: GameState): ActiveField[] {
  const out = new Map<string, ActiveField>();
  const n = state.history.length;
  for (const [i, m] of state.history.entries()) {
    const age = n - 1 - i; // moves since then
    for (const f of onto.fields) {
      if (age >= f.duration) continue;
      const hit = f.from.some((x) => x === m.verb || onto.formHas(m.form, x));
      if (hit) out.set(f.id, { spec: f, remaining: f.duration - age });
    }
  }
  return [...out.values()];
}

/** Power modifiers the active fields give mechanism `verbId`. */
export function fieldModifiers(onto: Ontology, fields: readonly ActiveField[], verbId: string): PowerModifier[] {
  const family = onto.verbs.get(verbId)?.spec.family;
  const mods: PowerModifier[] = [];
  for (const f of fields) {
    for (const e of f.spec.effects) {
      if (!e.on.includes(verbId) && (family === undefined || !e.on.includes(family))) continue;
      const label = onto.verbs.get(verbId)?.spec.label ?? verbId;
      mods.push({ delta: e.delta, text: `${f.spec.label}: „${label}“ ${e.delta > 0 ? "+" : "−"}${String(Math.abs(e.delta))}` });
    }
  }
  return mods;
}
