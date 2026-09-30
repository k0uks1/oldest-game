/**
 * Order of an online duel on screen: turns from the server play one after another, and a state
 * adopted on (re)connect replaces whatever was still playing or queued. Pure – the page supplies
 * the animations.
 *
 * Why it exists: a phone that leaves the tab loses its socket; the `narration` of a turn played
 * just before (Claude writes it after the `turn`) never arrives, the turn waited for it for good,
 * and every later turn queued up behind it – the opponent's next form was in the game but never
 * came into the arena. Now a (re)connect resolves what still waits, skips what the adopted state
 * already holds and puts the arena right (`settle`) once the last stale animation is over.
 */
import type { Form, GameState, PlayerId } from "../engine/types.ts";

/** What stands in the arena for a state: only the newest form – every earlier one was answered. */
export function standingForms(state: GameState): readonly [Form | null, Form | null] {
  const last = state.history.at(-1);
  if (last === undefined) return [null, null];
  return last.player === 0 ? [last.form, null] : [null, last.form];
}

/** Narration text while none will come (lost with a connection). */
export const NO_NARRATION = "…";

export interface PlaybackShow<T> {
  /**
   * Animate one turn; resolves when it is over. `current()` turns false once a newer state was
   * adopted meanwhile – the chronicle and captions then belong to that state, leave them alone.
   */
  play(turn: T, narration: Promise<string>, current: () => boolean): Promise<void>;
  /** A narration for a turn the adopted state already holds: entry `index` of its chronicle. */
  lateNarration(index: number, text: string): void;
}

export class Playback<T> {
  private queue: Promise<void> = Promise.resolve();
  /** Counts adopted states. */
  private epoch = 0;
  /** Highest turn `seq` the adopted state already holds. */
  private adopted = 0;
  /** `seq` of the adopted chronicle's first entry. */
  private chronicleBase = 1;
  private readonly waiting = new Map<number, (text: string) => void>();
  private readonly early = new Map<number, string>();

  constructor(private readonly show: PlaybackShow<T>) {}

  /**
   * A state from the server (welcome, start, rematch) holding every turn up to `seq`; its chronicle
   * has `chronicleLength` entries (one per turn since the duel began). `settle` shows it – it runs
   * after whatever is still playing, so no stale animation touches the arena afterwards.
   */
  adopt(seq: number, chronicleLength: number, settle: () => Promise<void> | void): Promise<void> {
    this.epoch++;
    this.adopted = seq;
    this.chronicleBase = seq - chronicleLength + 1;
    // a turn still waiting for its words would wait forever – the connection that carried them is gone
    for (const resolve of this.waiting.values()) resolve(NO_NARRATION);
    this.waiting.clear();
    for (const s of this.early.keys()) if (s <= seq) this.early.delete(s);
    return this.run(settle);
  }

  /** A turn from the server. Turns the adopted state already holds are not played again. */
  turn(seq: number, turn: T): Promise<void> {
    return this.run(async () => {
      if (seq <= this.adopted) return;
      this.adopted = seq;
      const epoch = this.epoch;
      await this.show.play(turn, this.narrationFor(seq), () => this.epoch === epoch);
    });
  }

  narration(seq: number, text: string): void {
    const resolve = this.waiting.get(seq);
    if (resolve !== undefined) {
      this.waiting.delete(seq);
      resolve(text);
      return;
    }
    const index = seq - this.chronicleBase;
    // already in the adopted state (its turn is not played) – fill in its chronicle line
    if (seq <= this.adopted && index >= 0) this.show.lateNarration(index, text);
    else this.early.set(seq, text);
  }

  /** Something else in turn order (a resignation). */
  run(job: () => Promise<void> | void): Promise<void> {
    // one broken animation must not stop every later one
    const next = this.queue.then(job).catch((e: unknown) => {
      console.error(e);
    });
    this.queue = next;
    return next;
  }

  private narrationFor(seq: number): Promise<string> {
    const early = this.early.get(seq);
    if (early !== undefined) {
      this.early.delete(seq);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      this.waiting.set(seq, resolve);
    });
  }
}

/** Does the arena show what the state says (form ids per side)? */
export function arenaMatches(shown: readonly [string | null, string | null], state: GameState): boolean {
  const want = standingForms(state);
  return ([0, 1] as const).every((p: PlayerId) => shown[p] === (want[p]?.id ?? null));
}
