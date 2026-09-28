/**
 * Legends for form cards. Hot-seat: written by Claude through the page's own connection
 * (`Resolver.legend`); online: asked from the game server, which writes each legend once and
 * keeps it. Either way the browser remembers what it got. Without Claude there is no legend –
 * the card shows the flavor text instead.
 */
import type { Form } from "../engine/types.ts";

type Source = (form: Form) => Promise<string | undefined>;

const PREFIX = "oldest-game:lore:";
const WAIT_MS = 20_000;

export class LoreClient {
  private source: Source | null = null;
  private readonly memory = new Map<string, string>();
  private readonly running = new Map<string, Promise<string | undefined>>();
  private readonly waiting = new Map<string, ((text: string | undefined) => void)[]>();

  /** Hot-seat (or none): the page writes legends itself. */
  direct(source: Source | null): void {
    this.source = source;
    this.settleAll();
  }

  /** Online: `lore` messages; answers arrive through {@link receive}. */
  socket(send: (id: string) => boolean): void {
    this.settleAll();
    this.source = (form) =>
      new Promise((resolve) => {
        if (!send(form.id)) {
          resolve(undefined);
          return;
        }
        const timer = setTimeout(() => {
          this.settle(form.id, undefined);
        }, WAIT_MS);
        this.waiting.set(form.id, [
          ...(this.waiting.get(form.id) ?? []),
          (text) => {
            clearTimeout(timer);
            resolve(text);
          },
        ]);
      });
  }

  /** The server's answer (empty text = no legend). */
  receive(id: string, text: string): void {
    this.settle(id, text === "" ? undefined : text);
  }

  /** Known already (own legend or remembered)? – no waiting needed. */
  known(form: Form): string | undefined {
    if (form.lore !== undefined) return form.lore;
    const key = `${form.id}\u0000${form.name}`;
    const mem = this.memory.get(key);
    if (mem !== undefined) return mem;
    try {
      const raw = localStorage.getItem(PREFIX + form.id);
      const stored = raw === null ? undefined : (JSON.parse(raw) as { name?: unknown; text?: unknown });
      if (stored?.name === form.name && typeof stored.text === "string") {
        this.memory.set(key, stored.text);
        return stored.text;
      }
    } catch {
      // storage blocked: memory only
    }
    return undefined;
  }

  /** The legend, fetched once per form and remembered. */
  get(form: Form): Promise<string | undefined> {
    const have = this.known(form);
    if (have !== undefined) return Promise.resolve(have);
    const source = this.source;
    if (source === null) return Promise.resolve(undefined);
    const key = `${form.id}\u0000${form.name}`;
    const running = this.running.get(key);
    if (running !== undefined) return running;
    const job = source(form)
      .catch(() => undefined)
      .then((text) => {
        this.running.delete(key);
        if (text !== undefined) this.remember(form, text);
        return text;
      });
    this.running.set(key, job);
    return job;
  }

  private remember(form: Form, text: string): void {
    this.memory.set(`${form.id}\u0000${form.name}`, text);
    try {
      localStorage.setItem(PREFIX + form.id, JSON.stringify({ name: form.name, text }));
    } catch {
      // storage full or blocked: memory only
    }
  }

  private settle(id: string, text: string | undefined): void {
    const list = this.waiting.get(id) ?? [];
    this.waiting.delete(id);
    for (const w of list) w(text);
  }

  private settleAll(): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, undefined);
  }
}
