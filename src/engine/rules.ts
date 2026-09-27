import type { PowerModifier } from "./fields.ts";
import type { Ontology } from "./ontology/ontology.ts";
import type { RulingSpec } from "./ontology/pack.ts";
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
  openingEleganz: 1,
  failurePenalty: 3,
  roundLimit: 10,
  discoveryEleganz: 1,
  escapeRoutes: {
    fliegt: ["fliegt", "blitz", "licht", "gas", "krankheit", "schwarm"],
    schwimmt: ["schwimmt", "fluessig", "blitz", "krankheit"],
    graebt: ["graebt", "erde", "fluessig", "krankheit"],
    tarnt: ["licht", "feuer", "blitz"],
    schatten: ["licht", "feuer", "blitz"],
  },
  physicalFamilies: ["gewalt", "element", "leben"],
  maxEscapeScale: 6,
  escapeEleganz: 1,
  hidingRoutes: ["tarnt", "schatten"],
  mercyEleganz: 1,
  mercyOutcomes: ["befriedet"],
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
  /** Arena fields ("Nässe: Blitz +2") – see engine/fields.ts. */
  modifiers: readonly PowerModifier[] = [],
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
    outcome: "vernichtet",
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
    return fail(`${target.name} bietet keine Angriffsfläche – nötig wäre: ${need}.`, { failedAt: "surface" });
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
    return fail(`${target.name} ist ${names} – „${verb.spec.label}“ greift nicht.`, { hitTag, failedAt: "blocked" });
  }
  if (t.immune.has(verbId)) return fail(`${target.name} ist immun gegen „${verb.spec.label}“.`, { hitTag, failedAt: "immune" });

  // 3. game rules on scale
  const jump = attacker.scale - target.scale;
  const base = Math.max(target.scale, floorScale);
  if (attacker.scale - base > config.maxScaleJump) {
    return fail(
      `Maßlos: ${attacker.name} (Stufe ${attacker.scale}) ist zu groß – erlaubt ist höchstens Stufe ${String(base + config.maxScaleJump)}.`,
      { hitTag, failedAt: "scale" },
    );
  }
  if (-jump > config.maxScaleDrop && verb.spec.leverage < config.mythicLeverage) {
    return fail(
      `Zu klein: ${attacker.name} ist ${-jump} Stufen kleiner als ${target.name}. Das geht nur mit einem mythischen Hebel (≥ ${config.mythicLeverage}).`,
      { hitTag, failedAt: "scale" },
    );
  }
  if (verb.spec.minRelativeScale !== undefined && jump < verb.spec.minRelativeScale) {
    return fail(`${attacker.name} ist zu klein, um ${target.name} zu verschlingen.`, { hitTag });
  }

  // 3b. "Schreck": a startled target is as good as hit in its weakness
  const scare = t.startle.find((st) => st.verbs.has(verbId) || intersection(st.tags, a.closure).length > 0);
  if (scare !== undefined) {
    steps.push({ ok: true, text: `Schreck: ${target.name} ist ${onto.tagLabel(scare.tag)} – ${attacker.name} jagt ${target.name} in die Flucht.` });
  }

  // 4. power
  const weaknessHit = weakHit !== undefined || scare !== undefined;
  const fieldDelta = modifiers.reduce((sum, m) => sum + m.delta, 0);
  for (const m of modifiers) steps.push({ ok: m.delta >= 0, text: m.text });
  const power = attacker.scale + verb.spec.leverage + (weaknessHit ? WEAKNESS_BONUS : 0) + fieldDelta;
  const needed = target.scale;
  const powerText =
    `Kraft ${attacker.scale} (Stufe) + ${verb.spec.leverage} (Hebel)` +
    (weaknessHit ? ` + ${WEAKNESS_BONUS} (${weakHit === undefined ? "Schreck" : "Schwäche"}!)` : "") +
    (fieldDelta === 0 ? "" : ` ${fieldDelta > 0 ? "+" : "−"} ${String(Math.abs(fieldDelta))} (Arena)`) +
    ` = ${power} gegen Stufe ${needed}`;
  if (power < needed) return fail(`${powerText} – zu schwach.`, { hitTag, weaknessHit, power, needed, failedAt: "power" });
  steps.push({ ok: true, text: `${powerText} ✓` });

  const outcome = scare !== undefined ? "vertrieben" : (verb.spec.outcome ?? "vernichtet");
  return { verb: verbId, valid: true, steps, hitTag, weaknessHit, power, needed, outcome, ...(scare === undefined ? {} : { startled: true as const }) };
}

/**
 * A stored precedent ("Schiedsspruch"): a ruling for exactly this pair replaces the tag rules for
 * the mechanism it names. Game rules on scale still apply – no ruling lets a supernova swat a snake.
 */
export function checkRuling(
  onto: Ontology,
  attacker: Form,
  target: Form,
  ruling: RulingSpec,
  config: GameConfig = DEFAULT_CONFIG,
  floorScale = 1,
): CounterCheck {
  const verb = onto.verbs.get(ruling.verb);
  const label = verb?.spec.label ?? ruling.verb;
  const steps: CheckStep[] = [{ ok: true, text: `${attacker.name} ${label} …` }];
  const base = Math.max(target.scale, floorScale);
  const common = { verb: ruling.verb, hitTag: null, weaknessHit: false, needed: target.scale, ruling: true as const };
  if (attacker.scale - base > config.maxScaleJump) {
    return { ...common, valid: false, steps: [...steps, { ok: false, text: `Maßlos: ${attacker.name} ist zu groß.` }], power: 0, outcome: "vernichtet", failedAt: "scale" };
  }
  steps.push({ ok: ruling.valid, text: `Schiedsspruch: ${ruling.reason}` });
  return { ...common, valid: ruling.valid, steps, power: attacker.scale, outcome: verb?.spec.outcome ?? "vernichtet", ...(ruling.valid ? {} : { failedAt: "other" as const }) };
}

/** Pseudo-mechanism recorded in the history for an escape (subject to echo like any mechanism). */
export const ESCAPE = "entkommt";

/** Can mechanism `verbId` touch `target` at all? (surface, blockers, immunity – no scale rules) */
export function reaches(onto: Ontology, verbId: string, target: Form): boolean {
  const verb = onto.verbs.get(verbId);
  if (verb === undefined) return false;
  const t = onto.compileForm(target);
  if (intersection(verb.targets, t.closure).length === 0) return false;
  if (intersection(verb.blocked, t.closure).length > 0) return false;
  return !t.immune.has(verbId);
}

/**
 * "Entkommen" – `evader` answers `target` not by defeating it but by getting out of reach.
 *
 *  1. the evader has an escape route (a key of `config.escapeRoutes`, e.g. fliegt)
 *  2. the target is not too vast to flee from (≤ maxEscapeScale)
 *  3. the target cannot follow along that route (it has none of the route's closing tags)
 *  4. there is something to flee from: at least one physical mechanism of the target reaches the evader
 *  5. nothing non-physical of the target reaches it either (a siren's song follows you into the sky)
 *  6. usual scale cap: the evader may not be more than maxScaleJump above the target / floor
 */
export function checkEscape(
  onto: Ontology,
  evader: Form,
  target: Form,
  config: GameConfig = DEFAULT_CONFIG,
  floorScale = 1,
): CounterCheck {
  const steps: CheckStep[] = [{ ok: true, text: `${evader.name} versucht zu entkommen …` }];
  const fail = (text: string): CounterCheck => ({
    verb: ESCAPE,
    valid: false,
    steps: [...steps, { ok: false, text }],
    hitTag: null,
    weaknessHit: false,
    power: 0,
    needed: target.scale,
    outcome: "entkommen",
  });
  const routes = Object.keys(config.escapeRoutes).filter((r) => onto.formHas(evader, r));
  if (routes.length === 0) return fail(`${evader.name} hat keinen Fluchtweg (fliegen, schwimmen, graben, sich verstecken).`);
  if (target.scale >= config.maxEscapeScale + 1) return fail(`Vor ${target.name} gibt es kein Entkommen – es ist überall.`);
  const open = routes.filter((r) => !(config.escapeRoutes[r] ?? []).some((c) => onto.formHas(target, c)));
  if (open.length === 0) {
    const r = routes[0] ?? "";
    return fail(`${target.name} spürt ${evader.name} überall auf – ${onto.tagLabel(r)} zu sein hilft hier nicht.`);
  }
  const route = open[0] ?? "";
  const hides = config.hidingRoutes.includes(route);
  steps.push({
    ok: true,
    text: hides
      ? `Versteck: ${evader.name} ist ${onto.tagLabel(route)} – ${target.name} findet es nicht.`
      : `Fluchtweg: ${evader.name} ${onto.tagLabel(route)} – ${target.name} kann nicht folgen.`,
  });
  const threats = onto.compileForm(target).verbs.filter((v) => reaches(onto, v, evader));
  const family = (v: string): string => onto.verbs.get(v)?.spec.family ?? "";
  const physical = threats.filter((v) => config.physicalFamilies.includes(family(v)));
  const other = threats.filter((v) => !config.physicalFamilies.includes(family(v)));
  if (other.length > 0) {
    const label = onto.verbs.get(other[0] ?? "")?.spec.label ?? "";
    return fail(`„${label}“ erreicht ${evader.name} auch aus der Ferne – Flucht hilft nicht.`);
  }
  if (physical.length === 0) return fail(`${target.name} kann ${evader.name} ohnehin nichts anhaben – Flucht ist hier kein Zug.`);
  const base = Math.max(target.scale, floorScale);
  if (evader.scale - base > config.maxScaleJump) {
    return fail(`Maßlos: ${evader.name} ist zu groß, um bloß zu fliehen.`);
  }
  const labels = physical.map((v) => onto.verbs.get(v)?.spec.label ?? v).join(", ");
  steps.push({ ok: true, text: `${target.name} (${labels}) greift ins Leere ✓` });
  return { verb: ESCAPE, valid: true, steps, hitTag: null, weaknessHit: false, power: evader.scale, needed: target.scale, outcome: hides ? "versteckt" : "entkommen" };
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
