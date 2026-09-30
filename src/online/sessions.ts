/**
 * The online duels this browser takes part in – a seat token per room, kept so a lost connection,
 * a closed tab or a browser restart can come back to the same seat.
 *
 * Two stores with one job each:
 * - `localStorage` holds every remembered duel (all tabs, survives restarts). It is a list, so one
 *   browser can be in several duels at once – the start dialog offers each to go back to.
 * - `sessionStorage` holds the duel *this tab* is in, so a reload returns to it and two tabs stay
 *   two players.
 *
 * Every access is guarded: in a private window storage may be missing or throw, and then a
 * duel lives only as long as its tab.
 */
import type { PlayerId } from "../engine/types.ts";

const LIST_KEY = "oldest-game:sessions";
const TAB_KEY = "oldest-game:online";
/** As long as the server keeps an idle room (`idleTtlMs`) – older entries cannot come back. */
export const SESSION_TTL_MS = 3 * 60 * 60_000;
export const MAX_SESSIONS = 8;

export interface Seat {
  readonly room: string;
  readonly token: string;
}

/** A remembered duel. */
export interface Session extends Seat {
  /** Seats played here (none: watching). */
  readonly seats: readonly PlayerId[];
  /** Names as last seen, for the start dialog. */
  readonly me: string;
  readonly foe: string;
  /** Last contact (ms since epoch). */
  readonly seen: number;
  /** The duel was over when last seen – not worth an automatic return. */
  readonly over: boolean;
}

function read(storage: () => Storage, key: string): unknown {
  try {
    const raw = storage().getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable – the duel lives only in this tab */
  }
}

const local = (): Storage => localStorage;
const session = (): Storage => sessionStorage;

function asSeat(v: unknown): Seat | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Partial<Record<keyof Session, unknown>>;
  return typeof o.room === "string" && typeof o.token === "string" ? { room: o.room, token: o.token } : null;
}

function asSession(v: unknown): Session | null {
  const seat = asSeat(v);
  if (seat === null) return null;
  const o = v as Partial<Record<keyof Session, unknown>>;
  const seats = Array.isArray(o.seats) ? o.seats.filter((p): p is PlayerId => p === 0 || p === 1) : [];
  return {
    ...seat,
    seats,
    me: typeof o.me === "string" ? o.me : "",
    foe: typeof o.foe === "string" ? o.foe : "",
    seen: typeof o.seen === "number" ? o.seen : 0,
    over: o.over === true,
  };
}

/** Remembered duels, newest first, without the expired ones. */
export function listSessions(now = Date.now()): Session[] {
  const raw = read(local, LIST_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asSession)
    .filter((s): s is Session => s !== null && now - s.seen < SESSION_TTL_MS)
    .sort((a, b) => b.seen - a.seen)
    .slice(0, MAX_SESSIONS);
}

export function findSession(room: string, now = Date.now()): Session | undefined {
  return listSessions(now).find((s) => s.room === room);
}

/** Remember (or refresh) a duel; the oldest fall out beyond `MAX_SESSIONS`. */
export function rememberSession(s: Session, now = Date.now()): void {
  write(local, LIST_KEY, [s, ...listSessions(now).filter((o) => o.room !== s.room)].slice(0, MAX_SESSIONS));
}

/** Nothing to come back to (room closed, left on purpose). */
export function forgetSession(room: string): void {
  write(local, LIST_KEY, listSessions().filter((s) => s.room !== room));
  if (tabSeat()?.room === room) setTabSeat(null);
}

/** The duel this tab is in. */
export function tabSeat(): Seat | null {
  return asSeat(read(session, TAB_KEY));
}

export function setTabSeat(seat: Seat | null): void {
  write(session, TAB_KEY, seat === null ? null : { room: seat.room, token: seat.token });
}
