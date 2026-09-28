/**
 * Pictures from the game server, just in time. The client asks for the forms it is about to show
 * (or shows again after a reconnect); the server answers ready / pending / none, and pending ones
 * arrive later by themselves (online) or are polled (local hot-seat server). Without a server the
 * client has no transport and every form keeps its drawn sprite.
 */
import type { Form } from "../engine/types.ts";
import type { ArtItem } from "../online/protocol.ts";
import { MAX_ART_IDS } from "../online/protocol.ts";
import { hasArt, registerArt } from "../render/art.ts";

export interface ArtTransport {
  /** Ask the server about these forms; answers come back through {@link ArtClient.receive}. */
  ask(forms: readonly Form[], client: ArtClient): void;
}

type Known = "pending" | "none";

export class ArtClient {
  private transport: ArtTransport | null = null;
  private readonly known = new Map<string, Known>();
  private readonly waiters = new Map<string, ((ready: boolean) => void)[]>();
  /** A picture for this form id just arrived (the arena swaps it in). */
  onArrive: ((id: string) => void) | null = null;

  get enabled(): boolean {
    return this.transport !== null;
  }

  /** New connection (or none): what was pending there is asked again, "none" may have changed. */
  setTransport(t: ArtTransport | null): void {
    this.transport = t;
    this.known.clear();
    if (t === null) this.settleAll(false);
  }

  /** Make sure the server works on these forms (no-op for ready or known-missing ones). */
  want(forms: readonly Form[]): void {
    const t = this.transport;
    if (t === null) return;
    const ask = forms.filter((f, i) => !hasArt(f) && this.known.get(f.id) === undefined && forms.findIndex((g) => g.id === f.id) === i);
    if (ask.length === 0) return;
    for (const f of ask) this.known.set(f.id, "pending");
    for (let i = 0; i < ask.length; i += MAX_ART_IDS) t.ask(ask.slice(i, i + MAX_ART_IDS), this);
  }

  /** Is a picture on its way (so waiting for it is worth it)? */
  coming(form: Form): boolean {
    return this.enabled && !hasArt(form) && this.known.get(form.id) !== "none";
  }

  /** Resolves true when the picture is there, false when none will come or the wait is over. */
  whenReady(form: Form, timeoutMs: number): Promise<boolean> {
    if (hasArt(form)) return Promise.resolve(true);
    if (!this.coming(form)) return Promise.resolve(false);
    this.want([form]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        finish(false);
      }, timeoutMs);
      const finish = (ok: boolean): void => {
        clearTimeout(timer);
        const list = this.waiters.get(form.id) ?? [];
        this.waiters.set(
          form.id,
          list.filter((w) => w !== finish),
        );
        resolve(ok);
      };
      this.waiters.set(form.id, [...(this.waiters.get(form.id) ?? []), finish]);
    });
  }

  /** Answers from the server. */
  receive(items: readonly ArtItem[]): void {
    for (const it of items) {
      if (it.state === "ready") {
        this.known.delete(it.id);
        const ok = registerArt(it.id, it.art);
        this.settle(it.id, ok);
        if (ok) this.onArrive?.(it.id);
      } else {
        this.known.set(it.id, it.state);
        if (it.state === "none") this.settle(it.id, false);
      }
    }
  }

  private settle(id: string, ready: boolean): void {
    const list = this.waiters.get(id) ?? [];
    this.waiters.delete(id);
    for (const w of list) w(ready);
  }

  private settleAll(ready: boolean): void {
    for (const id of [...this.waiters.keys()]) this.settle(id, ready);
  }
}

/** Online rooms: one `art` message; pending pictures are pushed by the server when done. */
export function socketTransport(send: (ids: readonly string[]) => boolean): ArtTransport {
  return {
    ask(forms, client) {
      if (!send(forms.map((f) => f.id))) client.receive(forms.map((f): ArtItem => ({ id: f.id, state: "none" })));
    },
  };
}

/**
 * Local hot-seat server: `GET /api/art`, polled while pending. A form the page learned itself may
 * not be on the server yet, so its description travels along (the local server accepts that).
 */
export function httpTransport(fetchImpl: typeof fetch = fetch, pollMs = 2500, giveUpMs = 120_000): ArtTransport {
  const poll = async (f: Form, client: ArtClient, since: number): Promise<void> => {
    const q = new URLSearchParams({ id: f.id, scale: String(f.scale), ...(f.artPrompt === undefined ? {} : { prompt: f.artPrompt }) });
    let item: ArtItem = { id: f.id, state: "none" };
    try {
      const res = await fetchImpl(`/api/art?${q.toString()}`, { cache: "no-store" });
      if (res.ok) item = { ...((await res.json()) as ArtItem), id: f.id };
    } catch {
      // server gone: treated as "none"
    }
    if (item.state === "pending" && Date.now() - since < giveUpMs) {
      setTimeout(() => {
        void poll(f, client, since);
      }, pollMs);
      return;
    }
    client.receive([item.state === "pending" ? { id: f.id, state: "none" } : item]);
  };
  return {
    ask(forms, client) {
      const now = Date.now();
      for (const f of forms) void poll(f, client, now);
    },
  };
}
