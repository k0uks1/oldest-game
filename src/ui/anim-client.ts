/**
 * "Beleben": a player brings their current form to life, at most ANIMS_PER_PLAYER times per
 * duel. Online the server counts and everyone in the room sees it; in the local hot-seat the
 * page counts and polls the local server. Frames arrive in the art format and are played by the
 * arena in a loop for as long as the form stands.
 */
import type { AnimMove, Form, PlayerId } from "../engine/types.ts";
import { ANIMS_PER_PLAYER, type AnimAction, type AnimItem } from "../online/protocol.ts";
import { movesOf } from "../llm/parser.ts";
import { decodeArt } from "../render/art.ts";
import type { PixelImage } from "../render/sprite.ts";

export interface AnimTransport {
  /** Start (or join) an animation; answers come back through {@link AnimClient.receive}. */
  ask(form: Form, action: AnimAction, seat: PlayerId, client: AnimClient): void;
  /** Ask for the form's own moves; the answer comes back through {@link AnimClient.receiveMoves}. */
  moves(form: Form, client: AnimClient): void;
}

export class AnimClient {
  private transport: AnimTransport | null = null;
  left: [number, number] = [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER];
  /** Form ids with an animation on its way. */
  readonly pending = new Set<string>();
  private readonly frames = new Map<string, PixelImage[]>();
  /** The forms' own moves as the server told them (empty = only the general ones). */
  private readonly moves = new Map<string, readonly AnimMove[]>();
  private readonly movesWaiting = new Map<string, ((m: readonly AnimMove[]) => void)[]>();
  /** Frames arrived for a form (the arena plays them) – or it did not work out (frames undefined). */
  onUpdate: ((id: string, frames: PixelImage[] | undefined) => void) | null = null;

  get enabled(): boolean {
    return this.transport !== null;
  }

  setTransport(t: AnimTransport | null): void {
    this.transport = t;
    this.pending.clear();
  }

  /** A new duel (hot-seat): the full allowance again, nothing alive. */
  reset(): void {
    this.left = [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER];
    this.pending.clear();
    this.frames.clear();
  }

  /** Frames already known for this form (to play again after it was summoned anew). */
  framesOf(id: string): PixelImage[] | undefined {
    return this.frames.get(id);
  }

  /** The form's own moves, if known already (its own, or what the server said). */
  movesOf(form: Form): readonly AnimMove[] | undefined {
    return form.moves ?? this.moves.get(form.id);
  }

  /** The form's own moves – asked once; empty when there are none (or no answer in time). */
  loadMoves(form: Form, timeoutMs = 9000): Promise<readonly AnimMove[]> {
    const known = this.movesOf(form);
    if (known !== undefined) return Promise.resolve(known);
    if (this.transport === null) return Promise.resolve([]);
    const first = !this.movesWaiting.has(form.id);
    const answer = new Promise<readonly AnimMove[]>((resolve) => {
      const timer = setTimeout(() => {
        resolve([]);
      }, timeoutMs);
      this.movesWaiting.set(form.id, [
        ...(this.movesWaiting.get(form.id) ?? []),
        (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      ]);
    });
    if (first) this.transport.moves(form, this);
    return answer;
  }

  receiveMoves(id: string, moves: readonly AnimMove[]): void {
    this.moves.set(id, moves);
    const waiting = this.movesWaiting.get(id) ?? [];
    this.movesWaiting.delete(id);
    for (const w of waiting) w(moves);
  }

  canAnimate(seat: PlayerId): boolean {
    return this.enabled && this.left[seat] > 0;
  }

  request(form: Form, action: AnimAction, seat: PlayerId): void {
    if (this.transport === null || this.pending.has(form.id)) return;
    this.pending.add(form.id);
    this.transport.ask(form, action, seat, this);
  }

  /** An answer: ready frames, still pending, or none. `left` from the server (online) wins. */
  receive(item: AnimItem, left?: readonly [number, number]): void {
    if (left !== undefined) this.left = [left[0], left[1]];
    if (item.state !== "ready") {
      if (item.state === "pending") this.pending.add(item.id);
      else {
        this.pending.delete(item.id);
        this.onUpdate?.(item.id, undefined);
      }
      return;
    }
    this.pending.delete(item.id);
    const decoded = item.frames.map((f) => decodeArt(f)).filter((f): f is PixelImage => f !== undefined);
    if (decoded.length < 2) {
      this.onUpdate?.(item.id, undefined);
      return;
    }
    this.frames.set(item.id, decoded);
    this.onUpdate?.(item.id, decoded);
  }
}

/** Online: the server counts, animates and tells the whole room. */
export function socketAnimTransport(send: (action: AnimAction, seat: PlayerId) => boolean, askMoves: (id: string) => boolean): AnimTransport {
  return {
    ask(form, action, seat, client) {
      if (!send(action, seat)) client.receive({ id: form.id, action, state: "none" });
    },
    moves(form, client) {
      if (!askMoves(form.id)) client.receiveMoves(form.id, []);
    },
  };
}

/** Local hot-seat: the page counts (one of the allowance when a new animation starts), the server animates. */
export function httpAnimTransport(fetchImpl: typeof fetch = fetch, pollMs = 4000, giveUpMs = 300_000): AnimTransport {
  return {
    moves(form, client) {
      void fetchImpl(`/api/moves?${new URLSearchParams({ id: form.id }).toString()}`, { cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as { moves?: unknown }).moves : undefined))
        .catch(() => undefined)
        .then((raw) => {
          client.receiveMoves(form.id, Array.isArray(raw) ? (movesOf(raw) ?? []) : []);
        });
    },
    ask(form, action, seat, client) {
      const since = Date.now();
      let counted = false;
      const poll = async (): Promise<void> => {
        const q = new URLSearchParams({ id: form.id, scale: String(form.scale), action, ...(form.artPrompt === undefined ? {} : { prompt: form.artPrompt }) });
        let item: AnimItem = { id: form.id, action, state: "none" };
        try {
          const res = await fetchImpl(`/api/animate?${q.toString()}`, { cache: "no-store" });
          if (res.ok) item = { ...((await res.json()) as AnimItem), id: form.id, action };
        } catch {
          // server gone: none
        }
        if (item.state === "pending" && !counted) {
          counted = true;
          client.left[seat] = Math.max(0, client.left[seat] - 1);
        }
        if (item.state === "pending" && Date.now() - since < giveUpMs) {
          setTimeout(() => {
            void poll();
          }, pollMs);
          return;
        }
        // failed after it was counted: the allowance comes back
        if (item.state !== "ready" && counted) client.left[seat] = Math.min(ANIMS_PER_PLAYER, client.left[seat] + 1);
        client.receive(item.state === "pending" ? { id: form.id, action, state: "none" } : item);
      };
      void poll();
    },
  };
}
