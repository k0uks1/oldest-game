/**
 * Attack effects ("Angriffe"): which of the painted animations (content/core/effects.json, made
 * once by `npm run effects`) shows a victory. Chosen for the *winner*: the mechanism counts most,
 * then what the form holds (the hunter's rifle fires a bullet), then what it is (claws, fire, a
 * mouth). Presentation only – the engine never sees it. Pure (no DOM): the sheets themselves are
 * loaded by the arena (`effect-sheets.ts`).
 */
import effectsJson from "../content/core/effects.json" with { type: "json" };
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { Form } from "../engine/types.ts";

export type EffectKind = "projectile" | "strike" | "drain";

export interface EffectSpec {
  readonly id: string;
  /** projectile: flies from the winner to the loser, then an impact · strike: happens at the loser · drain: flows back to the winner. */
  readonly kind: EffectKind;
  readonly verbs: readonly string[];
  /** Held items (`look.holds`) that call for it. */
  readonly items: readonly string[];
  /** Properties of the winner that call for it. */
  readonly tags: readonly string[];
}

export const EFFECTS: readonly EffectSpec[] = effectsJson as EffectSpec[];

const VERB = 4;
const ITEM = 3;
const TAG = 2;

/**
 * The best-fitting effect for this winner and mechanism among those that exist (`available`),
 * or undefined (then the drawn particles stay). Ties go to the catalog order.
 */
export function chooseEffect(onto: Ontology, winner: Form, verb: string, available: (id: string) => boolean): EffectSpec | undefined {
  let best: EffectSpec | undefined;
  let bestScore = 0;
  for (const e of EFFECTS) {
    if (!available(e.id)) continue;
    const score =
      (e.verbs.includes(verb) ? VERB : 0) +
      (winner.look?.holds !== undefined && e.items.includes(winner.look.holds) ? ITEM : 0) +
      (e.tags.some((t) => onto.hasTag(t) && onto.formHas(winner, t)) ? TAG : 0);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}
