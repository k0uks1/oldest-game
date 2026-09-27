import { ESCAPE } from "./rules.ts";
import { arenaMinScale, currentTarget, evaluateForm, moveCost, other, play, type MoveOption } from "./game.ts";
import type { Ontology } from "./ontology/ontology.ts";
import type { Form, GameState, Move, PlayerId } from "./types.ts";

/**
 * The player-facing move: "become something" without knowing in advance whether
 * it is enough. That uncertainty is part of the game (the debug UI shows the
 * full check up front, the real game does not).
 *
 *  - success  → the move is played (best mechanism, or the one the player described)
 *  - failure  → the form shatters: its price in Wille plus a penalty is paid, the form is used up,
 *               the same player must try again (or yield). At 0 Wille they are exhausted.
 *  - rejected → nothing happens (game over, form already used, opening too big,
 *               not enough Wille to even summon it) – no cost
 */
export type AttemptOutcome =
  | { readonly kind: "success"; readonly state: GameState; readonly move: Move }
  | { readonly kind: "failure"; readonly state: GameState; readonly failure: Failure }
  | { readonly kind: "rejected"; readonly state: GameState; readonly reason: string };

export interface Failure {
  readonly player: PlayerId;
  readonly form: Form;
  readonly target: Form;
  readonly cost: number;
  /** Why it failed, in the engine's words (shown after the fact / sent to the narrator). */
  readonly reason: string;
  /** The mechanism that came closest, if any. */
  readonly closest: MoveOption | null;
  /**
   * Set when the engine is *not sure* about this verdict – a referee (Claude) may be asked.
   * Never set when a precedent exists for the pair, or for game-rule failures (scale caps).
   */
  readonly uncertain?: string;
}

/** `discovery`: the form was just learned (never seen before) – see GameConfig.discoveryEleganz. */
export function attempt(onto: Ontology, state: GameState, form: Form, intendedVerb: string | null, discovery = false): AttemptOutcome {
  if (state.phase === "finished") return { kind: "rejected", state, reason: "Das Spiel ist vorbei." };
  if (state.usedFormIds.includes(form.id)) {
    return { kind: "rejected", state, reason: `${form.name} wurde in diesem Spiel schon beschworen.` };
  }
  const target = currentTarget(state);
  if (target === null) {
    const r = play(onto, state, form, null, discovery);
    return r.ok ? { kind: "success", state: r.value, move: lastMove(r.value) } : { kind: "rejected", state, reason: r.error };
  }

  const options = evaluateForm(onto, state, form);
  const chosen = options.find((o) => o.playable && o.verb === intendedVerb) ?? options.find((o) => o.playable);
  if (chosen !== undefined) {
    const r = play(onto, state, form, chosen.verb, discovery);
    if (r.ok) return { kind: "success", state: r.value, move: lastMove(r.value) };
    return { kind: "rejected", state, reason: r.error };
  }

  // The matchup works, only a game rule stands in the way (echo, arena floor): say so, charge nothing.
  // "A knife cuts a net" stays true – it is just too small for this round.
  const blockedByRule = options.find((o) => o.check.valid && o.affordable && (o.echoed || o.belowArena));
  if (blockedByRule !== undefined) {
    const verb = onto.verbs.get(blockedByRule.verb)?.spec.label ?? blockedByRule.verb;
    return {
      kind: "rejected",
      state,
      reason: blockedByRule.echoed
        ? `${form.name} ${verb} ${target.name} – aber dieser Weg wurde gerade erst beschritten (Echo). Finde einen anderen.`
        : `${form.name} ${verb} ${target.name} – doch die Arena ist gewachsen: In dieser Runde braucht es mindestens Stufe ${String(arenaMinScale(state))} (oder einen mythischen Hebel).`,
    };
  }

  const me = state.players[state.active];
  const cost = moveCost(onto, state, form);
  if (cost > me.wille) {
    return { kind: "rejected", state, reason: `Dein Wille reicht nicht, um ${form.name} zu beschwören.` };
  }
  const closest = closestOption(options);
  const paid = Math.min(me.wille, cost + state.config.failurePenalty);
  const doubt = onto.rulingFor(form.id, target.id) === undefined ? uncertainty(options) : undefined;
  const failure: Failure = {
    player: state.active,
    form,
    target,
    cost: paid,
    reason: failureReason(state, form, target, closest),
    closest,
    ...(doubt === undefined ? {} : { uncertain: doubt }),
  };
  const wille = me.wille - paid;
  const players = [...state.players] as [typeof me, typeof me];
  players[state.active] = { ...me, wille };
  const next: GameState = { ...state, players, usedFormIds: [...state.usedFormIds, form.id] };
  if (wille <= 0) {
    return {
      kind: "failure",
      state: { ...next, phase: "finished", winner: other(state.active), endReason: "erschoepft" },
      failure,
    };
  }
  return { kind: "failure", state: next, failure };
}

/**
 * How sure is the engine that nothing works? Unsure when a mechanism fell short by a single point,
 * or was stopped by a blocker/immunity (the model may be too coarse), or when a form of at least the
 * target's size found no surface at all (an interaction the tags don't capture).
 */
export function uncertainty(options: readonly MoveOption[]): string | undefined {
  const real = options.filter((o) => o.verb !== ESCAPE);
  const near = real.find((o) => o.check.failedAt === "power" && o.check.needed - o.check.power <= 1);
  if (near !== undefined) return `knapp: ${String(near.check.power)} gegen ${String(near.check.needed)}`;
  const blocked = real.find((o) => o.check.failedAt === "blocked" || o.check.failedAt === "immune");
  if (blocked !== undefined) return "blockiert";
  if (real.length > 0 && real.every((o) => o.check.failedAt === "surface")) return "keine Angriffsfläche";
  return undefined;
}

function lastMove(state: GameState): Move {
  const m = state.history.at(-1);
  if (m === undefined) throw new Error("invariant: successful play appends a move");
  return m;
}

/** The option that got furthest through the check (valid-but-blocked beats invalid). */
function closestOption(options: readonly MoveOption[]): MoveOption | null {
  const score = (o: MoveOption): number =>
    (o.check.valid ? 1000 : 0) + o.check.steps.filter((s) => s.ok).length * 10 + o.check.power;
  return [...options].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function failureReason(state: GameState, form: Form, target: Form, o: MoveOption | null): string {
  if (o === null) return `${form.name} hat nichts, womit es ${target.name} etwas anhaben könnte.`;
  if (o.check.valid && o.echoed) return "Dieser Weg wurde gerade erst beschritten – ein Echo hat keine Kraft.";
  if (o.check.valid && o.belowArena) {
    return `Die Arena ist gewachsen: Gestalten unter Stufe ${String(arenaMinScale(state))} verblassen, bevor sie wirken.`;
  }
  return o.check.steps.at(-1)?.text ?? `${form.name} kann ${target.name} nicht besiegen.`;
}
