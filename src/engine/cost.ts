import type { Ontology } from "./ontology/ontology.ts";
import type { Form } from "./types.ts";

/** Base price per scale step – grows super-linearly so size is expensive. */
const BASE_COST = [1, 2, 3, 5, 8, 12, 17, 23] as const;

export interface CostBreakdown {
  readonly total: number;
  readonly lines: readonly { readonly label: string; readonly value: number }[];
}

/**
 * Price of summoning a form, independent of what it is played against.
 * Power costs, weaknesses discount – so the cheapest path to victory is a
 * precise, clever counter rather than a bigger hammer.
 */
export function formCost(onto: Ontology, form: Form): CostBreakdown {
  const lines: { label: string; value: number }[] = [];
  lines.push({ label: `Stufe ${form.scale}`, value: BASE_COST[form.scale - 1] ?? 23 });
  const extraVerbs = Math.max(0, onto.compileForm(form).verbs.length - 2);
  if (extraVerbs > 0) lines.push({ label: `${extraVerbs} weitere Mechanismen`, value: extraVerbs });
  if (form.immune.length > 0) lines.push({ label: "Immunitäten", value: 2 * form.immune.length });
  if (onto.formHas(form, "unsterblich")) lines.push({ label: "unsterblich", value: 2 });
  if (form.plane === "abstrakt") lines.push({ label: "abstrakt", value: 1 });
  if (form.weak.length > 0) lines.push({ label: "Schwächen", value: -form.weak.length });
  const sum = lines.reduce((acc, l) => acc + l.value, 0);
  return { total: Math.max(1, sum), lines };
}

/** Surcharge for playing something bigger than the target ("Overkill"). */
export function overkillSurcharge(attackerScale: number, targetScale: number): number {
  const gap = attackerScale - targetScale;
  return gap <= 0 ? 0 : gap * (gap + 1);
}

/** Wille refunded for a successful counter from below. */
export function underdogRefund(attackerScale: number, targetScale: number): number {
  return Math.max(0, targetScale - attackerScale) * 2;
}

/** Eleganz points awarded for a successful counter. */
export function eleganzFor(attackerScale: number, targetScale: number, weaknessHit: boolean): number {
  return Math.max(0, 1 + 2 * (targetScale - attackerScale) + (weaknessHit ? 1 : 0));
}
