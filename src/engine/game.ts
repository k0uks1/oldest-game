import { eleganzFor, formCost, overkillSurcharge, underdogRefund } from "./cost.ts";
import type { Ontology } from "./ontology/ontology.ts";
import { checkCounter, DEFAULT_CONFIG, effectiveVerbs } from "./rules.ts";
import type {
  CounterCheck,
  Form,
  GameConfig,
  GameState,
  Move,
  PlayerId,
  PlayerState,
} from "./types.ts";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

export function createGame(names: readonly [string, string], config: GameConfig = DEFAULT_CONFIG): GameState {
  const mk = (name: string): PlayerState => ({ name, wille: config.startWille, eleganz: 0 });
  return {
    config,
    phase: "opening",
    players: [mk(names[0]), mk(names[1])],
    active: 0,
    history: [],
    usedFormIds: [],
    winner: null,
    endReason: null,
  };
}

export function currentTarget(state: GameState): Form | null {
  return state.history.at(-1)?.form ?? null;
}

/** Mechanisms that may not be used right now because they echo a recent move. */
export function echoedVerbs(state: GameState): Set<string> {
  const recent = state.history.slice(-state.config.echoWindow);
  return new Set(recent.map((m) => m.verb).filter((v): v is string => v !== null));
}

export interface MoveOption {
  readonly verb: string;
  readonly check: CounterCheck;
  readonly echoed: boolean;
  readonly cost: number;
  readonly affordable: boolean;
  /** Form is below the current minimum scale and the mechanism is not mythic. */
  readonly belowArena: boolean;
  readonly playable: boolean;
}

/** Minimum scale a counter needs in the current round ("Eskalation"). */
export function arenaMinScale(state: GameState): number {
  const move = state.history.length + 1;
  return 1 + Math.floor((move - 1) / Math.max(1, state.config.escalateEveryMoves));
}

export function isMythic(onto: Ontology, state: GameState, verb: string): boolean {
  return (onto.verbs.get(verb)?.spec.leverage ?? 0) >= state.config.mythicLeverage;
}

/** Evaluate every mechanism of `form` against the current target. */
export function evaluateForm(onto: Ontology, state: GameState, form: Form): MoveOption[] {
  const target = currentTarget(state);
  if (target === null) return [];
  const echo = echoedVerbs(state);
  const wille = state.players[state.active].wille;
  const minScale = arenaMinScale(state);
  const cost = formCost(onto, form).total + overkillSurcharge(form.scale, Math.max(target.scale, minScale));
  return effectiveVerbs(onto, form)
    .map((verb) => {
      const check = checkCounter(onto, form, target, verb, state.config, minScale);
      const echoed = echo.has(verb);
      const affordable = cost <= wille;
      const belowArena = form.scale < minScale && !isMythic(onto, state, verb);
      return {
        verb,
        check,
        echoed,
        cost,
        affordable,
        belowArena,
        playable: check.valid && !echoed && affordable && !belowArena,
      };
    })
    .sort((a, b) => Number(b.playable) - Number(a.playable) || b.check.power - a.check.power);
}

export function moveCost(onto: Ontology, state: GameState, form: Form): number {
  const target = currentTarget(state);
  return formCost(onto, form).total + (target === null ? 0 : overkillSurcharge(form.scale, Math.max(target.scale, arenaMinScale(state))));
}

/**
 * Apply a move. Pure: returns a new state or an explanation why the move is illegal.
 * If `verb` is null for a counter, the best playable mechanism is chosen.
 */
export function play(onto: Ontology, state: GameState, form: Form, verb: string | null): Result<GameState> {
  if (state.phase === "finished") return { ok: false, error: "Das Spiel ist vorbei." };
  if (state.usedFormIds.includes(form.id)) {
    return { ok: false, error: `${form.name} wurde in diesem Spiel schon beschworen.` };
  }
  const me = state.players[state.active];
  const target = currentTarget(state);

  let check: CounterCheck | null = null;
  let chosenVerb: string | null = null;
  if (target === null) {
    if (form.scale > state.config.maxOpeningScale) {
      return {
        ok: false,
        error: `Die Eröffnung muss klein beginnen: höchstens Stufe ${state.config.maxOpeningScale}.`,
      };
    }
  } else {
    const options = evaluateForm(onto, state, form);
    const option =
      verb === null ? options.find((o) => o.playable) : options.find((o) => o.verb === verb);
    if (option === undefined) {
      const reason = options[0]?.check.steps.at(-1)?.text;
      return {
        ok: false,
        error: verb === null ? `Kein wirksamer Mechanismus. ${reason ?? ""}`.trim() : `${form.name} kennt diesen Mechanismus nicht.`,
      };
    }
    if (!option.check.valid) return { ok: false, error: option.check.steps.at(-1)?.text ?? "Ungültig." };
    if (option.echoed) {
      return { ok: false, error: "Echo: Dieser Mechanismus wurde gerade erst benutzt. Sei einfallsreicher!" };
    }
    if (option.belowArena) {
      return {
        ok: false,
        error: `Eskalation: In dieser Runde muss eine Gestalt mindestens Stufe ${arenaMinScale(state)} haben – außer mit einem mythischen Hebel.`,
      };
    }
    check = option.check;
    chosenVerb = option.verb;
  }

  // The opening is free – a small compensation for moving first.
  const cost = target === null ? 0 : moveCost(onto, state, form);
  if (cost > me.wille) {
    return { ok: false, error: `Zu wenig Wille: ${form.name} kostet ${cost}, du hast ${me.wille}.` };
  }

  const refund = target === null ? 0 : underdogRefund(form.scale, target.scale);
  const eleganz =
    target === null || check === null
      ? state.config.openingEleganz
      : eleganzFor(form.scale, target.scale, check.weaknessHit);
  const move: Move = { player: state.active, form, verb: chosenVerb, cost, eleganz, refund, check };

  const cap = state.config.maxWille;
  const updatedMe: PlayerState = {
    ...me,
    wille: Math.min(cap, me.wille - cost + refund),
    eleganz: me.eleganz + eleganz,
  };
  const next = other(state.active);
  const opp = state.players[next];
  const regen = regenFor(state.config, roundNumberFor(state.history.length + 1));
  const updatedOpp: PlayerState = { ...opp, wille: Math.min(cap, opp.wille + regen) };
  const players: [PlayerState, PlayerState] =
    state.active === 0 ? [updatedMe, updatedOpp] : [updatedOpp, updatedMe];

  const history = [...state.history, move];
  const afterMove: GameState = {
    ...state,
    phase: "playing",
    players,
    active: next,
    history,
    usedFormIds: [...state.usedFormIds, form.id],
  };

  const counters = history.length - 1;
  if (counters >= state.config.roundLimit * 2) return { ok: true, value: finishOnPoints(afterMove) };
  return { ok: true, value: afterMove };
}

/** The active player cannot or will not answer – they lose. */
export function pass(state: GameState): GameState {
  if (state.phase === "finished") return state;
  return { ...state, phase: "finished", winner: other(state.active), endReason: "pass" };
}

function finishOnPoints(state: GameState): GameState {
  const [a, b] = state.players;
  let winner: PlayerId | null = null;
  if (a.eleganz !== b.eleganz) winner = a.eleganz > b.eleganz ? 0 : 1;
  else if (a.wille !== b.wille) winner = a.wille > b.wille ? 0 : 1;
  return { ...state, phase: "finished", winner, endReason: "rounds" };
}

/** Round of the move that would be made after `moves` moves have happened. */
function roundNumberFor(moves: number): number {
  return Math.floor(Math.max(0, moves - 1) / 2) + 1;
}

/** Round of the move that is about to be made. */
export function roundNumber(state: GameState): number {
  return roundNumberFor(state.history.length + 1);
}

/** Regeneration grows as the duel escalates. */
export function regenFor(config: GameConfig, round: number): number {
  return config.regen + Math.floor((round - 1) / Math.max(1, config.regenGrowthEvery));
}
