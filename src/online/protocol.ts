/**
 * Wire protocol for online duels (WebSocket, JSON text frames). Shared by the browser client
 * (`src/online/link.ts`) and the authoritative server (`server/online.ts`).
 *
 * The server holds the game state and the API key and resolves every move with the same
 * `Resolver` the hot-seat UI uses; clients only send text and show what comes back.
 */
import type { ContentPack, FormSpec, ModifierSpec, RulingSpec, TagSpec, VerbSpec } from "../engine/ontology/pack.ts";
import type { GameState, PlayerId } from "../engine/types.ts";
import type { Turn } from "../game/resolver.ts";

export const WS_PATH = "/ws";
export const MAX_TEXT = 80;
export const MAX_NAME = 24;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O, 1/I/L – codes are read aloud and typed on phones. */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_PATTERN = new RegExp(`^[${ROOM_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`);

// ── client → server ───────────────────────────────────────────────────────

export type ClientMsg =
  /** Open a room. With `name2`, both seats belong to this client (one device, server-side Claude). */
  | { readonly t: "create"; readonly name: string; readonly name2?: string; readonly code?: string }
  | { readonly t: "join"; readonly room: string; readonly name: string; readonly code?: string }
  /** Reconnect with the seat token from `welcome`. */
  | { readonly t: "resume"; readonly room: string; readonly token: string }
  | { readonly t: "move"; readonly text: string }
  /** Give up (the engine's `pass`). */
  | { readonly t: "pass" }
  | { readonly t: "rematch" }
  /** Ask for the full learned pack again (after a delta did not apply). */
  | { readonly t: "sync" };

// ── server → client ───────────────────────────────────────────────────────

export interface SeatInfo {
  readonly name: string;
  readonly online: boolean;
}

/** One chronicle line – enough to rebuild the log after a reconnect. */
export interface ChronicleEntry {
  readonly actor: PlayerId;
  readonly name: string;
  readonly failed: boolean;
  readonly discovery: boolean;
  readonly text: string;
}

/** Changed or new entries of the learned pack (the pack only grows online). */
export interface PackDelta {
  readonly tags: readonly TagSpec[];
  readonly verbs: readonly VerbSpec[];
  readonly modifiers: readonly ModifierSpec[];
  readonly forms: readonly FormSpec[];
  readonly rulings: readonly RulingSpec[];
}

export type ErrorCode = "access" | "noroom" | "full" | "limit" | "bad" | "turn" | "busy" | "claude";

export type ServerMsg =
  | {
      readonly t: "welcome";
      readonly room: string;
      readonly token: string;
      /** Seats this client may play (both on one device). */
      readonly seats: readonly PlayerId[];
      readonly players: readonly [SeatInfo | null, SeatInfo | null];
      /** null while waiting for the second player. */
      readonly state: GameState | null;
      readonly chronicle: readonly ChronicleEntry[];
      readonly epilogue: string | null;
      readonly learned: ContentPack;
    }
  | { readonly t: "presence"; readonly players: readonly [SeatInfo | null, SeatInfo | null] }
  | { readonly t: "start"; readonly state: GameState }
  | { readonly t: "thinking"; readonly seat: PlayerId }
  | { readonly t: "rejected"; readonly reason: string }
  | { readonly t: "turn"; readonly seq: number; readonly turn: Turn }
  | { readonly t: "narration"; readonly seq: number; readonly text: string }
  | { readonly t: "resigned"; readonly seat: PlayerId; readonly state: GameState }
  | { readonly t: "epilogue"; readonly text: string }
  | { readonly t: "learned"; readonly delta: PackDelta }
  | { readonly t: "learnedFull"; readonly pack: ContentPack }
  | { readonly t: "error"; readonly code: ErrorCode; readonly message: string };

// ── validation (the server never trusts a frame) ──────────────────────────

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);

/** Printable, trimmed, no control characters. */
export function cleanName(v: unknown): string | undefined {
  const s = str(v, 200)
    ?.replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, MAX_NAME);
  return s === undefined || s === "" ? undefined : s;
}

export function normalizeRoom(v: unknown): string | undefined {
  const s = str(v, 32)?.trim().toUpperCase();
  return s !== undefined && ROOM_PATTERN.test(s) ? s : undefined;
}

export function parseClientMsg(raw: string): ClientMsg | undefined {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
  const m = o as Record<string, unknown>;
  const code = str(m["code"], 200);
  const withCode = code === undefined ? {} : { code };
  switch (m["t"]) {
    case "create": {
      const name = cleanName(m["name"]);
      if (name === undefined) return undefined;
      const name2 = m["name2"] === undefined ? undefined : cleanName(m["name2"]);
      if (m["name2"] !== undefined && name2 === undefined) return undefined;
      return { t: "create", name, ...(name2 === undefined ? {} : { name2 }), ...withCode };
    }
    case "join": {
      const room = normalizeRoom(m["room"]);
      const name = cleanName(m["name"]);
      return room === undefined || name === undefined ? undefined : { t: "join", room, name, ...withCode };
    }
    case "resume": {
      const room = normalizeRoom(m["room"]);
      const token = str(m["token"], 64);
      return room === undefined || token === undefined ? undefined : { t: "resume", room, token };
    }
    case "move": {
      const text = str(m["text"], 400)?.replace(/[\p{C}]/gu, "").trim();
      return text === undefined || text === "" || text.length > MAX_TEXT ? undefined : { t: "move", text };
    }
    case "pass":
    case "rematch":
    case "sync":
      return { t: m["t"] };
    default:
      return undefined;
  }
}

// ── learned pack deltas ───────────────────────────────────────────────────

const rulingKey = (r: RulingSpec): string => `${r.attacker}\u0000${r.target}`;

function changed<T>(before: readonly T[], after: readonly T[], key: (x: T) => string): T[] {
  const old = new Map(before.map((x) => [key(x), JSON.stringify(x)]));
  return after.filter((x) => old.get(key(x)) !== JSON.stringify(x));
}

/** What `after` adds to or changes in `before` (entries are never removed online). */
export function packDelta(before: ContentPack, after: ContentPack): PackDelta {
  const id = (x: { readonly id: string }): string => x.id;
  return {
    tags: changed(before.tags, after.tags, id),
    verbs: changed(before.verbs, after.verbs, id),
    modifiers: changed(before.modifiers, after.modifiers, id),
    forms: changed(before.forms, after.forms, id),
    rulings: changed(before.rulings ?? [], after.rulings ?? [], rulingKey),
  };
}

export function isEmptyDelta(d: PackDelta): boolean {
  return d.tags.length + d.verbs.length + d.modifiers.length + d.forms.length + d.rulings.length === 0;
}

function upsert<T>(list: readonly T[], add: readonly T[], key: (x: T) => string): T[] {
  const keys = new Set(add.map(key));
  return [...list.filter((x) => !keys.has(key(x))), ...add];
}

/** Apply a delta: replace entries with the same key, append new ones. */
export function applyPackDelta(pack: ContentPack, d: PackDelta): ContentPack {
  const id = (x: { readonly id: string }): string => x.id;
  return {
    ...pack,
    tags: upsert(pack.tags, d.tags, id),
    verbs: upsert(pack.verbs, d.verbs, id),
    modifiers: upsert(pack.modifiers, d.modifiers, id),
    forms: upsert(pack.forms, d.forms, id),
    rulings: upsert(pack.rulings ?? [], d.rulings, rulingKey),
  };
}
