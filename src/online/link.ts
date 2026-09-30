/**
 * Browser side of an online duel: one WebSocket to the game server, reconnecting on its own.
 * Every duel it enters is remembered (`sessions.ts`), so a reload, a closed tab or a browser
 * restart comes back to the same seat. One link = one duel; several duels are several links.
 */
import type { PlayerId } from "../engine/types.ts";
import { WS_PATH, type ClientMsg, type SeatInfo, type ServerMsg } from "./protocol.ts";
import { forgetSession, rememberSession, setTabSeat, type Seat } from "./sessions.ts";

/** How a link starts: a first message (create / join / watch), or back to a remembered seat. */
export type LinkStart = { readonly hello: ClientMsg } | { readonly resume: Seat; readonly ifAway?: boolean };

export type LinkStatus = "connecting" | "open" | "lost";

export class OnlineLink {
  private ws: WebSocket | null = null;
  private hello: ClientMsg | null;
  private seat: Seat | null;
  /** Only for the very first try of a remembered seat – once welcomed, it is ours. */
  private ifAway: boolean;
  private attempts = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seats: readonly PlayerId[] = [];
  private players: readonly [SeatInfo | null, SeatInfo | null] = [null, null];
  private over = false;

  constructor(
    start: LinkStart,
    private readonly onMessage: (msg: ServerMsg) => void,
    private readonly onStatus: (s: LinkStatus) => void,
  ) {
    this.hello = "hello" in start ? start.hello : null;
    this.seat = "resume" in start ? start.resume : null;
    this.ifAway = "resume" in start && start.ifAway === true;
    this.connect();
  }

  get room(): string | null {
    return this.seat?.room ?? null;
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Stop. `forget`: leave the duel for good (else it stays offered to go back to). */
  close(forget = true): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.seat !== null) {
      if (forget) forgetSession(this.seat.room);
      else setTabSeat(null);
    }
    this.ws?.close();
  }

  private remember(): void {
    if (this.seat === null) return;
    const name = (p: PlayerId): string => this.players[p]?.name ?? "";
    const mine = this.seats.map(name).filter((n) => n !== "");
    const others = ([0, 1] as const).filter((p) => !this.seats.includes(p)).map(name).filter((n) => n !== "");
    rememberSession({ ...this.seat, seats: this.seats, me: mine.join(" & "), foe: others.join(" & "), seen: Date.now(), over: this.over });
  }

  private connect(): void {
    if (this.stopped) return;
    this.onStatus("connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.onStatus("open");
      if (this.seat !== null) this.send({ t: "resume", room: this.seat.room, token: this.seat.token, ...(this.ifAway ? { ifAway: true } : {}) });
      else if (this.hello !== null) this.send(this.hello);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "welcome") {
        this.seat = { room: msg.room, token: msg.token };
        this.hello = null;
        this.ifAway = false;
        this.seats = msg.seats;
        this.players = msg.players;
        this.over = msg.state?.phase === "finished";
        setTabSeat(this.seat);
        this.remember();
      }
      // keep the remembered duel fresh while it lasts
      if (msg.t === "presence") {
        this.players = msg.players;
        this.remember();
      }
      if (msg.t === "start" || msg.t === "turn" || msg.t === "resigned") {
        const state = msg.t === "turn" ? msg.turn.state : msg.state;
        this.players = [
          { name: state.players[0].name, online: true },
          { name: state.players[1].name, online: true },
        ];
        this.over = state.phase === "finished";
        this.remember();
      }
      if (msg.t === "error") {
        if (msg.code === "noroom") {
          // Nothing to come back to.
          this.close(true);
          this.seat = null;
        } else if (msg.code === "access" || msg.code === "full" || msg.code === "seated") {
          // Not in (yet): stop trying, but a remembered seat stays remembered.
          this.close(false);
          this.seat = null;
        }
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      this.onStatus("lost");
      // 0.5 s, 1 s, 2 s … up to 10 s – a phone that slept a minute is back quickly.
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      this.timer = setTimeout(() => {
        this.connect();
      }, delay);
    };
  }
}
