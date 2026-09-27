import type { Ontology } from "./ontology/ontology.ts";
import { has, intersection } from "./ontology/tagset.ts";
import type { CheckStep, CounterCheck, Form, GameConfig, Scale } from "./types.ts";

export const DEFAULT_CONFIG: GameConfig = {
  startWille: 20,
  maxWille: 40,
  regen: 3,
  maxOpeningScale: 3,
  maxScaleJump: 2,
  maxScaleDrop: 3,
  mythicLeverage: 4,
  regenGrowthEvery: 1,
  escalateEveryMoves: 3,
  openingEleganz: 2,
  roundLimit: 10,
  echoWindow: 2,
};

/** Bonus to power when the mechanism hits an exposed weakness. */
export const WEAKNESS_BONUS = 2;

/** All mechanisms a form can use: explicit verbs plus those granted by its tags. */
export function effectiveVerbs(onto: Ontology, form: Form): readonly string[] {
  return onto.compileForm(form).verbs;
}

/**
 * The heart of the engine: can `attacker` defeat `target` using `verbId`?
 * A pure constraint check over the compiled tag closures – every step is
 * recorded so the UI (and the LLM narrator) can explain *why*.
 */
export function checkCounter(
  onto: Ontology,
  attacker: Form,
  target: Form,
  verbId: string,
  config: GameConfig = DEFAULT_CONFIG,
  /**
   * Current minimum scale of the arena ("Eskalation"). The escalation cap is measured from
   * max(target scale, floor) – otherwise a tiny mythic form played late would leave the
   * opponent no legal answer at all.
   */
  floorScale = 1,
): CounterCheck {
  const steps: CheckStep[] = [];
  const fail = (text: string, extra: Partial<CounterCheck> = {}): CounterCheck => ({
    verb: verbId,
    valid: false,
    steps: [...steps, { ok: false, text }],
    hitTag: null,
    weaknessHit: false,
    power: 0,
    needed: target.scale,
    ...extra,
  });

  const verb = onto.verbs.get(verbId);
  if (verb === undefined) return fail(`Unbekannter Mechanismus „${verbId}“.`);
  const a = onto.compileForm(attacker);
  const t = onto.compileForm(target);
  if (!a.verbs.includes(verbId)) return fail(`${attacker.name} beherrscht „${verb.spec.label}“ nicht.`);
  steps.push({ ok: true, text: `${attacker.name} ${verb.spec.label} …` });

  // 1. target must offer a surface: some verb target is in the target's closure
  const hits = intersection(verb.targets, t.closure);
  if (hits.length === 0) {
    const need = verb.spec.targets.map((x) => onto.tagLabel(x)).join(" / ");
    return fail(`${target.name} bietet keine Angriffsfläche – nötig wäre: ${need}.`);
  }
  // A hit exploits a weakness if the weakness tag lies at or below the targeted category:
  // weak "eisen", verb targets "metall" → weakness. Weak "stolz", verb targets "fuehlt" → no.
  const weakHit = hits.find((h) => t.weak.some((w) => has(onto.ancestorsOf(w), h)));
  const hitIndex = weakHit ?? hits[0] ?? 0;
  const hitTag = onto.tagAt(hitIndex)?.id ?? null;
  steps.push({ ok: true, text: `Angriffsfläche: ${target.name} ist ${onto.tagLabel(hitIndex)}.` });

  // 2. blockers & immunity
  const blockers = intersection(verb.blocked, t.closure);
  if (blockers.length > 0) {
    const names = blockers.map((b) => onto.tagLabel(b)).join(" und ");
    return fail(`${target.name} ist ${names} – „${verb.spec.label}“ greift nicht.`, { hitTag });
  }
  if (t.immune.has(verbId)) return fail(`${target.name} ist immun gegen „${verb.spec.label}“.`, { hitTag });

  // 3. game rules on scale
  const jump = attacker.scale - target.scale;
  const base = Math.max(target.scale, floorScale);
  if (attacker.scale - base > config.maxScaleJump) {
    return fail(
      `Maßlos: ${attacker.name} (Stufe ${attacker.scale}) ist zu groß – erlaubt ist höchstens Stufe ${String(base + config.maxScaleJump)}.`,
      { hitTag },
    );
  }
  if (-jump > config.maxScaleDrop && verb.spec.leverage < config.mythicLeverage) {
    return fail(
      `Zu klein: ${attacker.name} ist ${-jump} Stufen kleiner als ${target.name}. Das geht nur mit einem mythischen Hebel (≥ ${config.mythicLeverage}).`,
      { hitTag },
    );
  }
  if (verb.spec.minRelativeScale !== undefined && jump < verb.spec.minRelativeScale) {
    return fail(`${attacker.name} ist zu klein, um ${target.name} zu verschlingen.`, { hitTag });
  }

  // 4. power
  const weaknessHit = weakHit !== undefined;
  const power = attacker.scale + verb.spec.leverage + (weaknessHit ? WEAKNESS_BONUS : 0);
  const needed = target.scale;
  const powerText =
    `Kraft ${attacker.scale} (Stufe) + ${verb.spec.leverage} (Hebel)` +
    (weaknessHit ? ` + ${WEAKNESS_BONUS} (Schwäche!)` : "") +
    ` = ${power} gegen Stufe ${needed}`;
  if (power < needed) return fail(`${powerText} – zu schwach.`, { hitTag, weaknessHit, power, needed });
  steps.push({ ok: true, text: `${powerText} ✓` });

  return { verb: verbId, valid: true, steps, hitTag, weaknessHit, power, needed };
}

/**
 * Every (form, verb) in the lexicon that validly counters `target`.
 * Uses the inverted verb → users index, so cost scales with the number of
 * *relevant* mechanisms rather than lexicon size × verbs.
 */
export function findCounters(
  onto: Ontology,
  target: Form,
  config: GameConfig = DEFAULT_CONFIG,
): { form: Form; verb: string }[] {
  const t = onto.compileForm(target);
  const out: { form: Form; verb: string }[] = [];
  for (const [id, verb] of onto.verbs) {
    if (intersection(verb.targets, t.closure).length === 0) continue;
    if (intersection(verb.blocked, t.closure).length > 0 || t.immune.has(id)) continue;
    for (const form of onto.usersOf(id)) {
      if (form.id !== target.id && checkCounter(onto, form, target, id, config).valid) out.push({ form, verb: id });
    }
  }
  return out;
}

export function clampScale(n: number): Scale {
  return Math.max(1, Math.min(8, Math.round(n))) as Scale;
}
