/**
 * Wire protocol for online duels (WebSocket, JSON text frames). Shared by the browser client
 * (`src/online/link.ts`) and the authoritative server (`server/online.ts`).
 *
 * The server holds the game state and the API key and resolves every move with the same
 * `Resolver` the hot-seat UI uses; clients only send text and show what comes back.
 */
import type { ContentPack, FormSpec, ModifierSpec, NoteSpec, QualitySpec, RulingSpec, TagSpec, VerbExtensionSpec, VerbSpec } from "../engine/ontology/pack.ts";
import type { GameState, PlayerId } from "../engine/types.ts";
import type { Turn } from "../game/resolver.ts";
import { NOTE_MAX_CHARS } from "../llm/learning.ts";

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
  /** Enter a room only to watch – no seat, no moves. */
  | { readonly t: "watch"; readonly room: string; readonly code?: string }
  /** Reconnect with the seat token from `welcome`. */
  | { readonly t: "resume"; readonly room: string; readonly token: string }
  | { readonly t: "move"; readonly text: string }
  /** Give up (the engine's `pass`). */
  | { readonly t: "pass" }
  | { readonly t: "rematch" }
  /** Ask for the full learned pack again (after a delta did not apply). */
  | { readonly t: "sync" }
  /** "Das war Quatsch!" – a win that makes no sense (collected for the engine rebuild). */
  | ({ readonly t: "report" } & AbsurdReport)
  /** Ask for the generated pictures of these forms (answered with `art`, pending ones follow later). */
  | { readonly t: "art"; readonly ids: readonly string[] }
  /** Ask for a form's legend (answered with `lore`; empty text = none). */
  | { readonly t: "lore"; readonly id: string }
  /** Bring your current form to life (`seat` only matters when both seats are on this device). */
  | { readonly t: "animate"; readonly action: AnimAction; readonly seat?: PlayerId };

/** "Beleben": what a player can ask their form to do – and what the image service is told. */
export const ANIM_ACTIONS = {
  atmen: { label: "atmet", prompt: "idle breathing, subtle living movement" },
  angriff: { label: "greift an", prompt: "attacking forward with its strongest move" },
  triumph: { label: "triumphiert", prompt: "victory celebration, proud triumphant pose" },
} as const;
export type AnimAction = keyof typeof ANIM_ACTIONS;
export const ANIM_ACTION_IDS = Object.keys(ANIM_ACTIONS) as AnimAction[];
/** Animations per player per duel. */
export const ANIMS_PER_PLAYER = 3;

/** A form's animation: ready (frames in the art format), being made, or none to be had. */
export type AnimItem =
  | { readonly id: string; readonly action: AnimAction; readonly state: "ready"; readonly frames: readonly string[] }
  | { readonly id: string; readonly action: AnimAction; readonly state: "pending" | "none" };

/** One form's generated picture: ready (with the art string), still being made, or none to be had. */
export type ArtItem = { readonly id: string; readonly state: "ready"; readonly art: string } | { readonly id: string; readonly state: "pending" | "none" };

/** Most form ids per `art` request. */
export const MAX_ART_IDS = 24;

/** A reported absurd win: who beat whom with what (names as shown in the game). */
export interface AbsurdReport {
  readonly attacker: string;
  readonly target: string;
  readonly verb: string;
  /** Form ids (newer clients) – lets the server have the pair judged again. */
  readonly attackerId?: string;
  readonly targetId?: string;
  /** The other way round: a failure that should have worked ("Hätte klappen müssen"). */
  readonly failed?: boolean;
  /** Why, in the player's words – kept for the next judgement involving either form. */
  readonly reason?: string;
}

/** Validate a report from an untrusted client: three short printable strings. */
export function parseReport(o: Record<string, unknown>): AbsurdReport | undefined {
  const field = (k: string, max = 80): string | undefined => {
    const v = o[k];
    if (typeof v !== "string") return undefined;
    const clean = v.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
    return clean === "" ? undefined : clean;
  };
  const attacker = field("attacker");
  const target = field("target");
  const verb = field("verb");
  if (attacker === undefined || target === undefined || verb === undefined) return undefined;
  const attackerId = field("attackerId");
  const targetId = field("targetId");
  const reason = field("reason", NOTE_MAX_CHARS);
  return {
    attacker,
    target,
    verb,
    ...(attackerId === undefined ? {} : { attackerId }),
    ...(targetId === undefined ? {} : { targetId }),
    ...(o["failed"] === true ? { failed: true } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
}

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
  /** Learned intensities (optional: servers before v0.49 send none). */
  readonly qualities?: readonly QualitySpec[];
  /** Learned mechanism widenings (optional: servers before v0.53 send none). */
  readonly extensions?: readonly VerbExtensionSpec[];
  /** Players' objections (optional: servers before v0.61 send none). */
  readonly notes?: readonly NoteSpec[];
}

export type ErrorCode = "access" | "noroom" | "full" | "limit" | "bad" | "turn" | "busy" | "claude";

export type ServerMsg =
  | {
      readonly t: "welcome";
      readonly room: string;
      readonly token: string;
      /** Seats this client may play (both on one device; none for a spectator). */
      readonly seats: readonly PlayerId[];
      readonly players: readonly [SeatInfo | null, SeatInfo | null];
      /** How many spectators are in the room. */
      readonly watchers: number;
      /** The server delivers generated pictures (ask with `art`). */
      readonly art: boolean;
      /** The server can bring forms to life (`animate`); how many each seat has left, and what is alive now. */
      readonly anim?: { readonly left: readonly [number, number]; readonly items: readonly AnimItem[] };
      /** null while waiting for the second player. */
      readonly state: GameState | null;
      readonly chronicle: readonly ChronicleEntry[];
      readonly epilogue: string | null;
      readonly learned: ContentPack;
    }
  | { readonly t: "presence"; readonly players: readonly [SeatInfo | null, SeatInfo | null]; readonly watchers: number }
  | { readonly t: "start"; readonly state: GameState }
  | { readonly t: "thinking"; readonly seat: PlayerId }
  | { readonly t: "rejected"; readonly reason: string }
  /** To everyone else: the active player tried something that does not count (free retry). */
  | { readonly t: "tried"; readonly seat: PlayerId; readonly text: string }
  | { readonly t: "turn"; readonly seq: number; readonly turn: Turn }
  | { readonly t: "narration"; readonly seq: number; readonly text: string }
  | { readonly t: "resigned"; readonly seat: PlayerId; readonly state: GameState }
  | { readonly t: "epilogue"; readonly text: string }
  | { readonly t: "learned"; readonly delta: PackDelta }
  | { readonly t: "learnedFull"; readonly pack: ContentPack }
  | { readonly t: "art"; readonly items: readonly ArtItem[] }
  | { readonly t: "lore"; readonly id: string; readonly text: string }
  /** The judge looked at a reported win again (counts from the next time). */
  | { readonly t: "reconsidered"; readonly text: string }
  | { readonly t: "anim"; readonly item: AnimItem; readonly left: readonly [number, number] }
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
    case "watch": {
      const room = normalizeRoom(m["room"]);
      return room === undefined ? undefined : { t: "watch", room, ...withCode };
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
    case "report": {
      const r = parseReport(m);
      return r === undefined ? undefined : { t: "report", ...r };
    }
    case "art": {
      const ids = m["ids"];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ART_IDS) return undefined;
      const clean = ids.map((x) => str(x, 80)).filter((x): x is string => x !== undefined && x !== "");
      return clean.length === ids.length ? { t: "art", ids: [...new Set(clean)] } : undefined;
    }
    case "animate": {
      const action = ANIM_ACTION_IDS.find((a) => a === m["action"]);
      const seat = m["seat"] === 0 || m["seat"] === 1 ? m["seat"] : undefined;
      return action === undefined ? undefined : { t: "animate", action, ...(seat === undefined ? {} : { seat }) };
    }
    case "lore": {
      const id = str(m["id"], 80);
      return id === undefined || id === "" ? undefined : { t: "lore", id };
    }
    default:
      return undefined;
  }
}

// ── learned pack deltas ───────────────────────────────────────────────────

const rulingKey = (r: RulingSpec): string => `${r.attacker}\u0000${r.target}`;
const noteKey = (n: NoteSpec): string => `${n.form}\u0000${n.other}\u0000${n.text}`;

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
    qualities: changed(before.qualities ?? [], after.qualities ?? [], id),
    extensions: changed(before.extensions ?? [], after.extensions ?? [], (x) => x.verb),
    notes: changed(before.notes ?? [], after.notes ?? [], noteKey),
  };
}

export function isEmptyDelta(d: PackDelta): boolean {
  return d.tags.length + d.verbs.length + d.modifiers.length + d.forms.length + d.rulings.length + (d.qualities ?? []).length + (d.extensions ?? []).length + (d.notes ?? []).length === 0;
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
    ...(d.qualities === undefined || d.qualities.length === 0 ? {} : { qualities: upsert(pack.qualities ?? [], d.qualities, id) }),
    ...(d.extensions === undefined || d.extensions.length === 0 ? {} : { extensions: upsert(pack.extensions ?? [], d.extensions, (x) => x.verb) }),
    ...(d.notes === undefined || d.notes.length === 0 ? {} : { notes: upsert(pack.notes ?? [], d.notes, noteKey) }),
  };
}
