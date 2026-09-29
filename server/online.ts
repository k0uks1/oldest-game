/**
 * Online duels – the authoritative side. Transport-agnostic (a `Peer` is anything that can
 * send a message), so the room logic is tested without sockets; `server/local.ts` wires it
 * to `ws`.
 *
 * The server owns each room's game state and resolves every move with the shared `Resolver`
 * (the same code the hot-seat UI runs), so all rooms learn into one pack: discoveries,
 * referee rulings and sketched sprites are everyone's at once.
 *
 * Abuse limits: access code (optional), connections per IP, rooms per IP and hour, message
 * rate per connection, one move at a time per room, a minimum gap between moves, and a
 * global budget of Claude-resolved moves per hour. Idle rooms are swept.
 */
import { randomInt, randomUUID } from "node:crypto";
import { createGame, pass } from "../src/engine/game.ts";
import type { ContentPack } from "../src/engine/ontology/pack.ts";
import type { AnimMove, Form, GameState, PlayerId } from "../src/engine/types.ts";
import type { Resolver, Turn } from "../src/game/resolver.ts";
import {
  ANIMS_PER_PLAYER,
  isEmptyDelta,
  packDelta,
  parseClientMsg,
  ROOM_ALPHABET,
  ROOM_CODE_LENGTH,
  type AbsurdReport,
  type AnimAction,
  type AnimItem,
  type ArtItem,
  type ChronicleEntry,
  type ClientMsg,
  type ErrorCode,
  type SeatInfo,
  type ServerMsg,
} from "../src/online/protocol.ts";

export interface Peer {
  readonly ip: string;
  send(msg: ServerMsg): void;
  close(): void;
}

export interface HubLimits {
  readonly maxRooms: number;
  /** Spectators per room. */
  readonly watchersPerRoom: number;
  readonly connectionsPerIp: number;
  readonly roomsPerIpPerHour: number;
  /** Messages per connection within `burstWindowMs`. */
  readonly messagesPerBurst: number;
  readonly burstWindowMs: number;
  /** Minimum time between two moves in one room. */
  readonly moveGapMs: number;
  /** Moves resolved with Claude per hour, all rooms together (the API bill). */
  readonly claudeMovesPerHour: number;
  /** A room nobody joined is closed after this long. */
  readonly waitingTtlMs: number;
  /** A room without activity is closed after this long. */
  readonly idleTtlMs: number;
  /** A room without any connection is closed after this long. */
  readonly abandonedTtlMs: number;
}

export const DEFAULT_LIMITS: HubLimits = {
  maxRooms: 200,
  watchersPerRoom: 20,
  // generous: friends often share one address (home router, office NAT)
  connectionsPerIp: 24,
  roomsPerIpPerHour: 60,
  messagesPerBurst: 30,
  burstWindowMs: 10_000,
  moveGapMs: 1_500,
  claudeMovesPerHour: 600,
  waitingTtlMs: 60 * 60_000,
  idleTtlMs: 3 * 60 * 60_000,
  abandonedTtlMs: 15 * 60_000,
};

export interface HubOptions {
  readonly accessCode?: string;
  readonly limits?: Partial<HubLimits>;
  /** Uses Claude (for the move budget); false = mechanical parser on the server. */
  readonly claude: () => boolean;
  /** Epilogue for a finished duel (Claude or templates). */
  readonly epilogue: (state: GameState) => Promise<string>;
  /** Persist the shared learned pack (called after every change). */
  readonly persist?: (pack: ContentPack) => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** Generated pictures (optional): look one up for a form, starting generation if needed. */
  readonly art?: HubArt;
  /** Animations of generated pictures (optional, needs `art`). */
  readonly anim?: HubAnim;
  /** A form's legend (stored or freshly written by Claude); undefined = none. */
  readonly lore?: (form: Form) => Promise<string | undefined>;
  /** A form's own moves for "Beleben" (stored or freshly written by Claude); undefined = none. */
  readonly moves?: (form: Form) => Promise<readonly AnimMove[] | undefined>;
  /** Store a reported absurd win (room code added). */
  readonly report?: (r: AbsurdReport & { readonly room: string }) => void;
}

/** What the hub needs from the animation store. */
export interface HubAnim {
  /** State of this form's animation (undefined: no picture to animate yet); `key` identifies the job. */
  lookup(form: Form, action: AnimAction): { readonly key: string; readonly item: AnimItem } | undefined;
  /** Every finished job (frames undefined = it failed). */
  onDone(listener: (key: string, frames: readonly string[] | undefined) => void): () => void;
}

/** What the hub needs from the picture store. */
export interface HubArt {
  /** State of a form's picture; `key` identifies the job so waiting clients get the result later. */
  lookup(form: Form): { readonly key: string; readonly item: ArtItem } | undefined;
  /** Every finished job (art undefined = failed). */
  onDone(listener: (key: string, art: string | undefined) => void): () => void;
}

interface Seat {
  readonly name: string;
  readonly token: string;
}

interface Room {
  readonly code: string;
  readonly seats: [Seat | null, Seat | null];
  /** Both seats played from one device. */
  readonly sameDevice: boolean;
  readonly conns: Set<Conn>;
  /** Tokens of spectators (so a reload brings them back). */
  readonly watchers: Set<string>;
  state: GameState | null;
  busy: boolean;
  seq: number;
  chronicle: ChronicleEntry[];
  epilogue: string | null;
  readonly created: number;
  lastActive: number;
  lastMove: number;
  /** Set when the last connection left. */
  emptySince: number | null;
  /** "Beleben": animations left per seat in this duel, and the ones made so far. */
  animLeft: [number, number];
  anims: AnimItem[];
}

export class Conn {
  room: Room | null = null;
  /** Seat token of the room this connection is in. */
  token: string | null = null;
  seats: readonly PlayerId[] = [];
  private stamps: number[] = [];

  constructor(
    readonly hub: OnlineHub,
    readonly peer: Peer,
  ) {}

  receive(raw: string): void {
    this.hub.receive(this, raw);
  }

  closed(): void {
    this.hub.detach(this);
  }

  /** Sliding-window rate limit; true = allowed. */
  allow(now: number, max: number, windowMs: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t < windowMs);
    if (this.stamps.length >= max) return false;
    this.stamps.push(now);
    return true;
  }
}

export class OnlineHub {
  readonly limits: HubLimits;
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Set<Conn>();
  private readonly roomsByIp = new Map<string, number[]>();
  private claudeMoves: number[] = [];
  /** The pack the clients last heard about – deltas are computed against it. */
  private published: ContentPack;
  private readonly now: () => number;

  /** Clients waiting for a picture that is being made: job key → (connection, form id). */
  private readonly artWaiting = new Map<string, Map<Conn, Set<string>>>();

  constructor(
    private readonly resolver: Resolver,
    private readonly opts: HubOptions,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
    this.published = resolver.learned;
    opts.anim?.onDone((key, frames) => {
      this.animDone(key, frames);
    });
    opts.art?.onDone((key, art) => {
      this.artDone(key, art);
    });
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  attach(peer: Peer): Conn | undefined {
    const perIp = [...this.conns].filter((c) => c.peer.ip === peer.ip).length;
    if (perIp >= this.limits.connectionsPerIp) {
      peer.send({ t: "error", code: "limit", message: "Zu viele Verbindungen von dieser Adresse." });
      peer.close();
      return undefined;
    }
    const c = new Conn(this, peer);
    this.conns.add(c);
    return c;
  }

  detach(c: Conn): void {
    this.conns.delete(c);
    for (const waiting of this.artWaiting.values()) waiting.delete(c);
    this.leave(c);
  }

  /**
   * The resolver learned something (new form, sketch, ruling) or the local hot-seat saved its
   * pack: persist it and tell every connected client what changed.
   */
  learnedChanged(): void {
    const pack = this.resolver.learned;
    const delta = packDelta(this.published, pack);
    this.published = pack;
    if (isEmptyDelta(delta)) return;
    this.opts.persist?.(pack);
    for (const c of this.conns) if (c.room !== null) c.peer.send({ t: "learned", delta });
  }

  receive(c: Conn, raw: string): void {
    const now = this.now();
    if (!c.allow(now, this.limits.messagesPerBurst, this.limits.burstWindowMs)) {
      this.error(c, "limit", "Langsamer, bitte.");
      return;
    }
    const msg = parseClientMsg(raw);
    if (msg === undefined) {
      this.error(c, "bad", "Unverständliche Nachricht.");
      return;
    }
    if (c.room !== null) c.room.lastActive = now;
    switch (msg.t) {
      case "create":
        this.create(c, msg);
        return;
      case "join":
        this.join(c, msg);
        return;
      case "watch":
        this.watch(c, msg);
        return;
      case "resume":
        this.resume(c, msg);
        return;
      case "sync":
        if (c.room !== null) c.peer.send({ t: "learnedFull", pack: this.resolver.learned });
        return;
      case "move":
        void this.move(c, msg.text);
        return;
      case "pass":
        this.resign(c);
        return;
      case "rematch":
        this.rematch(c);
        return;
      case "report":
        if (c.room !== null) this.opts.report?.({ attacker: msg.attacker, target: msg.target, verb: msg.verb, room: c.room.code });
        if (c.room !== null && msg.attackerId !== undefined && msg.targetId !== undefined) void this.reconsider(c, msg.attackerId, msg.targetId, msg.verb, msg.failed === true, msg.reason ?? "");
        return;
      case "art":
        this.artRequest(c, msg.ids);
        return;
      case "lore":
        void this.loreRequest(c, msg.id);
        return;
      case "moves":
        void this.movesRequest(c, msg.id);
        return;
      case "animate":
        this.animateRequest(c, msg.action, msg.seat);
        return;
    }
  }

  /** Close rooms that are over, abandoned or idle. Call periodically. */
  sweep(): void {
    const now = this.now();
    const L = this.limits;
    for (const [code, r] of this.rooms) {
      const waiting = r.state === null && now - r.created > L.waitingTtlMs;
      const idle = now - r.lastActive > L.idleTtlMs;
      const abandoned = r.emptySince !== null && now - r.emptySince > L.abandonedTtlMs;
      if (!waiting && !idle && !abandoned) continue;
      for (const c of r.conns) {
        c.peer.send({ t: "error", code: "noroom", message: "Der Raum wurde geschlossen." });
        c.room = null;
      }
      this.rooms.delete(code);
    }
    for (const [ip, stamps] of this.roomsByIp) {
      const recent = stamps.filter((t) => now - t < 3_600_000);
      if (recent.length === 0) this.roomsByIp.delete(ip);
      else this.roomsByIp.set(ip, recent);
    }
    this.claudeMoves = this.claudeMoves.filter((t) => now - t < 3_600_000);
  }

  // ── lobby ───────────────────────────────────────────────────────────────

  private checkCode(c: Conn, code: string | undefined): boolean {
    if (this.opts.accessCode === undefined || code === this.opts.accessCode) return true;
    this.error(c, "access", code === undefined || code === "" ? "Dieser Server verlangt einen Zugangscode." : "Der Zugangscode stimmt nicht.");
    return false;
  }

  private create(c: Conn, msg: Extract<ClientMsg, { t: "create" }>): void {
    if (!this.checkCode(c, msg.code)) return;
    const now = this.now();
    const recent = (this.roomsByIp.get(c.peer.ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.limits.roomsPerIpPerHour || this.rooms.size >= this.limits.maxRooms) {
      const full = this.rooms.size >= this.limits.maxRooms;
      // Behind a reverse proxy without TRUST_PROXY=1 every player shares the proxy's address.
      this.opts.log?.(`room limit hit (${full ? "server full" : `address ${c.peer.ip}`})${full ? "" : " – behind a proxy? set TRUST_PROXY=1"}`);
      this.error(c, "limit", full ? "Der Server ist voll – bitte später noch einmal." : "Von dieser Adresse wurden in der letzten Stunde zu viele Räume eröffnet. Bitte später noch einmal.");
      return;
    }
    this.roomsByIp.set(c.peer.ip, [...recent, now]);
    this.leave(c);
    const code = this.newCode();
    const sameDevice = msg.name2 !== undefined;
    const token = randomUUID();
    const room: Room = {
      code,
      seats: [{ name: msg.name, token }, sameDevice ? { name: msg.name2 ?? "", token } : null],
      sameDevice,
      conns: new Set(),
      watchers: new Set(),
      state: sameDevice ? createGame([msg.name, msg.name2 ?? ""]) : null,
      busy: false,
      seq: 0,
      chronicle: [],
      epilogue: null,
      created: now,
      lastActive: now,
      lastMove: 0,
      emptySince: null,
      animLeft: [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER],
      anims: [],
    };
    this.rooms.set(code, room);
    this.enter(c, room, token);
    this.opts.log?.(`room ${code} opened${sameDevice ? " (one device)" : ""} · ${String(this.rooms.size)} rooms`);
  }

  private join(c: Conn, msg: Extract<ClientMsg, { t: "join" }>): void {
    if (!this.checkCode(c, msg.code)) return;
    const room = this.rooms.get(msg.room);
    if (room === undefined) {
      this.error(c, "noroom", "Diesen Raum gibt es nicht (mehr).");
      return;
    }
    if (room.seats[1] !== null) {
      this.error(c, "full", "Dieser Raum ist schon voll – du kannst aber zuschauen.");
      return;
    }
    this.leave(c);
    const token = randomUUID();
    const host = room.seats[0]?.name ?? "";
    // Same name as the host would make the HUD ambiguous.
    const name = msg.name === host ? `${msg.name} II` : msg.name;
    room.seats[1] = { name, token };
    room.state = createGame([host, name]);
    room.animLeft = [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER];
    room.anims = [];
    this.enter(c, room, token);
    this.broadcast(room, { t: "start", state: room.state }, c);
  }

  /** A spectator: sees everything, changes nothing. */
  private watch(c: Conn, msg: Extract<ClientMsg, { t: "watch" }>): void {
    if (!this.checkCode(c, msg.code)) return;
    const room = this.rooms.get(msg.room);
    if (room === undefined) {
      this.error(c, "noroom", "Diesen Raum gibt es nicht (mehr).");
      return;
    }
    if (room.watchers.size >= this.limits.watchersPerRoom) {
      this.error(c, "full", "In diesem Raum schauen schon genug zu.");
      return;
    }
    this.leave(c);
    const token = `w-${randomUUID()}`;
    room.watchers.add(token);
    this.enter(c, room, token);
  }

  private resume(c: Conn, msg: Extract<ClientMsg, { t: "resume" }>): void {
    const room = this.rooms.get(msg.room);
    if (room?.seats.some((s) => s?.token === msg.token) !== true && room?.watchers.has(msg.token) !== true) {
      this.error(c, "noroom", "Diesen Raum gibt es nicht mehr.");
      return;
    }
    this.leave(c);
    this.enter(c, room, msg.token);
  }

  private enter(c: Conn, room: Room, token: string): void {
    c.room = room;
    c.token = token;
    room.conns.add(c);
    room.emptySince = null;
    room.lastActive = this.now();
    this.sendWelcome(c, room);
    this.broadcast(room, { t: "presence", players: this.presence(room), watchers: this.watcherCount(room) }, c);
  }

  private leave(c: Conn): void {
    const room = c.room;
    if (room === null) return;
    room.conns.delete(c);
    c.room = null;
    c.token = null;
    c.seats = [];
    if (room.conns.size === 0) room.emptySince = this.now();
    this.broadcast(room, { t: "presence", players: this.presence(room), watchers: this.watcherCount(room) });
  }

  // ── play ────────────────────────────────────────────────────────────────

  private async move(c: Conn, text: string): Promise<void> {
    const room = c.room;
    const state = room?.state ?? null;
    if (room === null || state === null) {
      this.error(c, "turn", "Das Duell hat noch nicht begonnen.");
      return;
    }
    if (state.phase === "finished") {
      this.error(c, "turn", "Das Duell ist vorbei.");
      return;
    }
    if (!c.seats.includes(state.active)) {
      this.error(c, "turn", "Du bist nicht am Zug.");
      return;
    }
    const now = this.now();
    if (room.busy || now - room.lastMove < this.limits.moveGapMs) {
      this.error(c, "busy", "Einen Augenblick …");
      return;
    }
    if (this.opts.claude()) {
      this.claudeMoves = this.claudeMoves.filter((t) => now - t < 3_600_000);
      if (this.claudeMoves.length >= this.limits.claudeMovesPerHour) {
        this.error(c, "limit", "Der Server hat für diese Stunde genug gedacht. Bitte später weiterspielen.");
        return;
      }
      this.claudeMoves.push(now);
    }
    room.busy = true;
    room.lastMove = now;
    this.broadcast(room, { t: "thinking", seat: state.active });
    let turn: Turn;
    try {
      const r = await this.resolver.resolve(state, text);
      this.learnedChanged();
      if (r.kind === "rejected") {
        c.peer.send({ t: "rejected", reason: r.reason });
        // the others saw "thinking" – tell them it did not count, or they wait forever
        this.broadcast(room, { t: "tried", seat: state.active, text: text.trim().slice(0, 40) }, c);
        return;
      }
      turn = r.turn;
    } catch (e) {
      this.error(c, "claude", e instanceof Error ? e.message : "Claude antwortet nicht.");
      return;
    } finally {
      room.busy = false;
    }
    // The room may have been swept or restarted while Claude was thinking.
    if (this.rooms.get(room.code) !== room || room.state !== state) return;
    // start painting the new form right away – by the time the clients ask, it is on its way
    this.opts.art?.lookup(turn.form);
    room.state = turn.state;
    const seq = ++room.seq;
    const entry: ChronicleEntry = {
      actor: turn.actor,
      name: turn.form.name,
      failed: turn.outcome.kind === "failure",
      discovery: turn.novelty?.kind === "discovery",
      text: "…",
    };
    room.chronicle.push(entry);
    this.broadcast(room, { t: "turn", seq, turn });
    const finished = turn.state.phase === "finished";
    let text2: string;
    try {
      text2 = await this.resolver.narrate(turn);
    } catch {
      text2 = "…";
    }
    const i = room.chronicle.indexOf(entry);
    if (i >= 0) room.chronicle[i] = { ...entry, text: text2 };
    this.broadcast(room, { t: "narration", seq, text: text2 });
    if (finished) await this.finish(room);
  }

  private resign(c: Conn): void {
    const room = c.room;
    const state = room?.state ?? null;
    if (room === null || state === null || state.phase === "finished" || c.seats.length === 0) return;
    // On one device the active player gives up; otherwise the one who asked.
    const seat = c.seats.includes(state.active) ? state.active : (c.seats[0] ?? state.active);
    const next = pass({ ...state, active: seat });
    room.state = next;
    room.lastActive = this.now();
    this.broadcast(room, { t: "resigned", seat, state: next });
    void this.finish(room);
  }

  private async finish(room: Room): Promise<void> {
    const state = room.state;
    if (state === null) return;
    let text: string;
    try {
      text = await this.opts.epilogue(state);
    } catch {
      return;
    }
    if (room.state !== state) return;
    room.epilogue = text;
    this.broadcast(room, { t: "epilogue", text });
  }

  private rematch(c: Conn): void {
    const room = c.room;
    const state = room?.state ?? null;
    const [a, b] = room?.seats ?? [null, null];
    if (room === null || c.seats.length === 0 || state?.phase !== "finished" || a === null || b === null || room.busy) return;
    // The loser opens the next duel (seat 0 moves first).
    if (state.winner === 0) {
      room.seats[0] = b;
      room.seats[1] = a;
    }
    room.state = createGame([room.seats[0]?.name ?? a.name, room.seats[1]?.name ?? b.name]);
    room.chronicle = [];
    room.epilogue = null;
    room.animLeft = [ANIMS_PER_PLAYER, ANIMS_PER_PLAYER];
    room.anims = [];
    room.lastActive = this.now();
    // Seats may have swapped – every client gets a fresh welcome.
    for (const conn of room.conns) this.sendWelcome(conn, room);
  }

  private sendWelcome(c: Conn, room: Room): void {
    const token = c.token ?? "";
    c.seats = ([0, 1] as const).filter((p) => room.seats[p]?.token === token);
    c.peer.send({
      t: "welcome",
      room: room.code,
      token,
      seats: c.seats,
      players: this.presence(room),
      watchers: this.watcherCount(room),
      art: this.opts.art !== undefined,
      ...(this.opts.anim === undefined ? {} : { anim: { left: room.animLeft, items: room.anims } }),
      state: room.state,
      chronicle: room.chronicle,
      epilogue: room.epilogue,
      learned: this.resolver.learned,
    });
  }

  // ── generated pictures ──────────────────────────────────────────────────

  /** A reported win with an invented form is judged again; the reporter hears the outcome. */
  private reconsidering = 0;
  private async reconsider(c: Conn, attackerId: string, targetId: string, verb: string, failed: boolean, note: string): Promise<void> {
    if (!this.opts.claude() || this.reconsidering >= 2) {
      // no judge right now – the player's reason is kept for the next judgement all the same
      if (this.resolver.note(attackerId, targetId, note, failed)) this.learnedChanged();
      return;
    }
    this.reconsidering++;
    try {
      const reason = await this.resolver.reconsider(attackerId, targetId, verb, failed, note);
      if (note !== "") this.learnedChanged();
      if (reason === undefined) return;
      this.learnedChanged();
      if (this.conns.has(c)) c.peer.send({ t: "reconsidered", text: reason });
    } finally {
      this.reconsidering--;
    }
  }

  /** A legend for one form – stored, freshly written (the store keeps the budget) or none. */
  private async loreRequest(c: Conn, id: string): Promise<void> {
    const form = this.resolver.onto.formById(id);
    const text = form === undefined ? undefined : (form.lore ?? (await this.opts.lore?.(form).catch(() => undefined)));
    if (this.conns.has(c)) c.peer.send({ t: "lore", id, text: text ?? "" });
  }

  /** A form's own moves – stored, freshly written (the store keeps the budget) or none. */
  private async movesRequest(c: Conn, id: string): Promise<void> {
    const form = this.resolver.onto.formById(id);
    const moves = form === undefined ? undefined : (form.moves ?? (await this.opts.moves?.(form).catch(() => undefined)));
    if (this.conns.has(c)) c.peer.send({ t: "moves", id, moves: moves ?? [] });
  }

  /**
   * "Beleben": a player brings their current form to life – at most ANIMS_PER_PLAYER times per
   * duel (counted when a new animation starts, refunded if it fails; a stored one is free).
   * Everyone in the room sees it.
   */
  private animateRequest(c: Conn, action: AnimAction, wanted?: PlayerId): void {
    const room = c.room;
    const anim = this.opts.anim;
    const seat = wanted !== undefined && c.seats.includes(wanted) ? wanted : c.seats[0];
    const state = room?.state ?? null;
    if (room === null || state === null || anim === undefined || seat === undefined) return;
    const form = [...state.history].reverse().find((m) => m.player === seat)?.form;
    if (form === undefined) {
      this.error(c, "bad", "Erst beschwören, dann beleben.");
      return;
    }
    if (room.animLeft[seat] <= 0) {
      this.error(c, "limit", `Schon ${String(ANIMS_PER_PLAYER)}-mal belebt – mehr gibt dieses Duell nicht her.`);
      return;
    }
    const found = anim.lookup(form, action);
    if (found === undefined || found.item.state === "none") {
      this.error(c, "bad", found === undefined ? "Diese Gestalt hat noch kein Bild, das sich bewegen könnte." : "Beleben geht gerade nicht (Kontingent des Servers oder Dienst weg).");
      return;
    }
    if (found.item.state === "pending") {
      room.animLeft[seat]--;
      this.pendingAnims.set(found.key, [...(this.pendingAnims.get(found.key) ?? []), { room, seat, id: form.id, action }]);
    }
    this.publishAnim(room, found.item);
  }

  /** Who is waiting for which job (to deliver, or to refund when it fails). */
  private readonly pendingAnims = new Map<string, { room: Room; seat: PlayerId; id: string; action: AnimAction }[]>();

  private animDone(key: string, frames: readonly string[] | undefined): void {
    const waiting = this.pendingAnims.get(key) ?? [];
    this.pendingAnims.delete(key);
    for (const w of waiting) {
      if (!this.rooms.has(w.room.code)) continue;
      if (frames === undefined) w.room.animLeft[w.seat]++;
      this.publishAnim(w.room, frames === undefined ? { id: w.id, action: w.action, state: "none" } : { id: w.id, action: w.action, state: "ready", frames });
    }
  }

  private publishAnim(room: Room, item: AnimItem): void {
    room.anims = [...room.anims.filter((a) => a.id !== item.id), item].slice(-8);
    this.broadcast(room, { t: "anim", item, left: room.animLeft });
  }

  private artRequest(c: Conn, ids: readonly string[]): void {
    const art = this.opts.art;
    const items: ArtItem[] = [];
    for (const id of ids) {
      const form = this.resolver.onto.formById(id);
      const found = form === undefined || art === undefined ? undefined : art.lookup(form);
      if (found === undefined) {
        items.push({ id, state: "none" });
        continue;
      }
      items.push(found.item);
      if (found.item.state === "pending") {
        const waiting = this.artWaiting.get(found.key) ?? new Map<Conn, Set<string>>();
        waiting.set(c, (waiting.get(c) ?? new Set<string>()).add(id));
        this.artWaiting.set(found.key, waiting);
      }
    }
    c.peer.send({ t: "art", items });
  }

  private artDone(key: string, art: string | undefined): void {
    const waiting = this.artWaiting.get(key);
    if (waiting === undefined) return;
    this.artWaiting.delete(key);
    for (const [c, ids] of waiting) {
      if (!this.conns.has(c)) continue;
      c.peer.send({ t: "art", items: [...ids].map((id): ArtItem => (art === undefined ? { id, state: "none" } : { id, state: "ready", art })) });
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /** Spectators currently connected. */
  private watcherCount(room: Room): number {
    return [...room.conns].filter((c) => c.token !== null && room.watchers.has(c.token)).length;
  }

  private presence(room: Room): [SeatInfo | null, SeatInfo | null] {
    const online = (s: Seat): boolean => [...room.conns].some((c) => c.token === s.token);
    const info = (s: Seat | null): SeatInfo | null => (s === null ? null : { name: s.name, online: online(s) });
    return [info(room.seats[0]), info(room.seats[1])];
  }

  private broadcast(room: Room, msg: ServerMsg, except?: Conn): void {
    for (const c of room.conns) if (c !== except) c.peer.send(msg);
  }

  private error(c: Conn, code: ErrorCode, message: string): void {
    c.peer.send({ t: "error", code, message });
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)] ?? "A";
      if (!this.rooms.has(code)) return code;
    }
  }
}

