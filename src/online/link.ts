/**
 * Browser side of an online duel: one WebSocket to the game server, reconnecting on its own.
 * The seat token lives in sessionStorage – per tab, so two tabs are two players, and a reload
 * (or a phone waking up) returns to the same seat.
 */
import { WS_PATH, type ClientMsg, type ServerMsg } from "./protocol.ts";

const KEY = "oldest-game:online";

export interface Seat {
  readonly room: string;
  readonly token: string;
}

export function savedSeat(): Seat | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const o = JSON.parse(raw) as Partial<Seat>;
    return typeof o.room === "string" && typeof o.token === "string" ? { room: o.room, token: o.token } : null;
  } catch {
    return null;
  }
}

function storeSeat(seat: Seat | null): void {
  try {
    if (seat === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(seat));
  } catch {
    /* private mode – reconnect then only works while the tab lives */
  }
}

export type LinkStatus = "connecting" | "open" | "lost";

export class OnlineLink {
  private ws: WebSocket | null = null;
  private seat: Seat | null;
  private attempts = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param hello first message (create / join) – or null to resume the saved seat.
   */
  constructor(
    private hello: ClientMsg | null,
    private readonly onMessage: (msg: ServerMsg) => void,
    private readonly onStatus: (s: LinkStatus) => void,
  ) {
    this.seat = hello === null ? savedSeat() : null;
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

  /** Leave for good (new local game, room closed). */
  close(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    storeSeat(null);
    this.ws?.close();
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
      if (this.seat !== null) this.send({ t: "resume", room: this.seat.room, token: this.seat.token });
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
        storeSeat(this.seat);
      }
      if (msg.t === "error" && (msg.code === "noroom" || msg.code === "access" || msg.code === "full")) {
        // Nothing to come back to.
        this.seat = null;
        this.hello = null;
        this.close();
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
