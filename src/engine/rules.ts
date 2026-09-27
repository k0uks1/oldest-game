import { TAGS, isTagId, tagLabel } from "../content/tags.ts";
import { getVerb, isVerbId } from "../content/verbs.ts";
import type { CheckStep, CounterCheck, Form, GameConfig, Scale } from "./types.ts";

export const DEFAULT_CONFIG: GameConfig = {
  startWille: 20,
  maxWille: 30,
  regen: 3,
  maxOpeningScale: 3,
  maxScaleJump: 2,
  maxScaleDrop: 3,
  mythicLeverage: 4,
  regenGrowthEvery: 2,
  escalateEvery: 2,
  roundLimit: 10,
  echoWindow: 2,
};

/** Bonus to power when the mechanism hits an exposed weakness. */
export const WEAKNESS_BONUS = 2;

/** All mechanisms a form can use: explicit verbs plus those granted by its tags. */
export function effectiveVerbs(form: Form): string[] {
  const out = new Set<string>();
  for (const v of form.verbs) if (isVerbId(v)) out.add(v);
  for (const t of form.tags) {
    if (!isTagId(t)) continue;
    for (const g of TAGS.get(t)?.grants ?? []) if (isVerbId(g)) out.add(g);
  }
  return [...out];
}

/**
 * The heart of the engine: can `attacker` defeat `target` using `verbId`?
 * Pure constraint check – every step is recorded so the UI (and the LLM
 * narrator) can explain *why*.
 */
export function checkCounter(
  attacker: Form,
  target: Form,
  verbId: string,
  config: GameConfig = DEFAULT_CONFIG,
): CounterCheck {
  const steps: CheckStep[] = [];
  const verb = getVerb(verbId);
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

  if (verb === undefined) return fail(`Unbekannter Mechanismus „${verbId}“.`);
  if (!effectiveVerbs(attacker).includes(verb.id)) {
    return fail(`${attacker.name} beherrscht „${verb.label}“ nicht.`);
  }
  steps.push({ ok: true, text: `${attacker.name} ${verb.label} …` });

  // 1. target must offer a surface for the mechanism
  const targetTags = new Set(target.tags);
  const hits = verb.targets.filter((t) => targetTags.has(t));
  if (hits.length === 0) {
    return fail(
      `${target.name} bietet keine Angriffsfläche: braucht ${verb.targets.map(tagLabel).join(" / ")}.`,
    );
  }
  const weakHit = hits.find((t) => target.weak.includes(t));
  const hitTag = weakHit ?? hits[0] ?? null;
  steps.push({ ok: true, text: `Angriffsfläche: ${target.name} ist ${tagLabel(hitTag ?? "")}.` });

  // 2. blockers
  const blockers = verb.blockedBy.filter((t) => targetTags.has(t));
  if (blockers.length > 0) {
    return fail(`${target.name} ist ${blockers.map(tagLabel).join(" und ")} – „${verb.label}“ greift nicht.`, {
      hitTag,
    });
  }
  if (target.immune.includes(verb.id)) {
    return fail(`${target.name} ist immun gegen „${verb.label}“.`, { hitTag });
  }

  // 3. game rule: no absurd escalation
  const jump = attacker.scale - target.scale;
  if (jump > config.maxScaleJump) {
    return fail(
      `Maßlos: ${attacker.name} (Stufe ${attacker.scale}) ist ${jump} Stufen größer als ${target.name}. Erlaubt sind höchstens ${config.maxScaleJump}.`,
      { hitTag },
    );
  }
  if (-jump > config.maxScaleDrop && verb.leverage < config.mythicLeverage) {
    return fail(
      `Zu klein: ${attacker.name} ist ${-jump} Stufen kleiner als ${target.name}. Das geht nur mit einem mythischen Hebel (≥ ${config.mythicLeverage}).`,
      { hitTag },
    );
  }
  if (verb.minRelativeScale !== undefined && jump < verb.minRelativeScale) {
    return fail(`${attacker.name} ist zu klein, um ${target.name} zu verschlingen.`, { hitTag });
  }

  // 4. power
  const weaknessHit = weakHit !== undefined;
  const power = attacker.scale + verb.leverage + (weaknessHit ? WEAKNESS_BONUS : 0);
  const needed = target.scale;
  const powerText =
    `Kraft ${attacker.scale} (Stufe) + ${verb.leverage} (Hebel)` +
    (weaknessHit ? ` + ${WEAKNESS_BONUS} (Schwäche!)` : "") +
    ` = ${power} gegen Stufe ${needed}`;
  if (power < needed) return fail(`${powerText} – zu schwach.`, { hitTag, weaknessHit, power, needed });
  steps.push({ ok: true, text: `${powerText} ✓` });

  return { verb: verb.id, valid: true, steps, hitTag, weaknessHit, power, needed };
}

export function clampScale(n: number): Scale {
  return Math.max(1, Math.min(8, Math.round(n))) as Scale;
}
