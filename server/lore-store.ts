/**
 * Things written once per form by Claude and kept next to the learned pack: legends for form cards
 * (`LoreStore`), moves for "Beleben" (`MoveStore`). One small Claude call per form at most; an
 * hourly budget caps what curious browsing can cost.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MAX_MOVES } from "../src/engine/ontology/pack.ts";
import type { AnimMove, Form } from "../src/engine/types.ts";

export interface FormStoreOptions<T> {
  /** Writes the value (Claude); undefined = none available now. */
  readonly write?: (form: Form) => Promise<T | undefined>;
  /** JSON file (id → {name, text}); omitted = memory only. */
  readonly file?: string;
  /** Fresh values per hour, all players together. */
  readonly perHour: number;
  readonly now?: () => number;
  /** Stored values at most (oldest are kept, new ones stop being stored). */
  readonly maxEntries?: number;
}

interface Entry<T> {
  readonly name: string;
  readonly text: T;
}

/** One value per form: the form's own, stored, or freshly written (merged while running). */
export abstract class FormStore<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly running = new Map<string, Promise<T | undefined>>();
  private stamps: number[] = [];
  private readonly now: () => number;

  constructor(private readonly opts: FormStoreOptions<T>) {
    this.now = opts.now ?? Date.now;
    if (opts.file === undefined) return;
    try {
      const raw = JSON.parse(readFileSync(opts.file, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null) return;
      for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
        const { name, text } = (e ?? {}) as { name?: unknown; text?: unknown };
        const value = this.read(text);
        if (typeof name === "string" && value !== undefined) this.entries.set(id, { name, text: value });
      }
    } catch {
      // no file yet
    }
  }

  /** The value the form carries itself (it wins over anything stored). */
  protected abstract own(form: Form): T | undefined;
  /** A stored value, checked (the file may be old or hand-edited). */
  protected abstract read(raw: unknown): T | undefined;

  get size(): number {
    return this.entries.size;
  }

  /** Known right now, without writing anything. */
  known(form: Form): T | undefined {
    const own = this.own(form);
    if (own !== undefined) return own;
    const stored = this.entries.get(form.id);
    // same id, other name (a learned form replaced by a core one …): not this one's
    return stored?.name === form.name ? stored.text : undefined;
  }

  get(form: Form): Promise<T | undefined> {
    const known = this.known(form);
    if (known !== undefined) return Promise.resolve(known);
    const running = this.running.get(form.id);
    if (running !== undefined) return running;
    const write = this.opts.write;
    const now = this.now();
    this.stamps = this.stamps.filter((t) => now - t < 3_600_000);
    if (write === undefined || this.stamps.length >= this.opts.perHour) return Promise.resolve(undefined);
    this.stamps.push(now);
    const job = write(form)
      .catch(() => undefined)
      .then((value) => {
        this.running.delete(form.id);
        if (value !== undefined) this.put(form, value);
        return value;
      });
    this.running.set(form.id, job);
    return job;
  }

  private put(form: Form, value: T): void {
    if (this.entries.size >= (this.opts.maxEntries ?? 20_000) && !this.entries.has(form.id)) return;
    this.entries.set(form.id, { name: form.name, text: value });
    const file = this.opts.file;
    if (file === undefined) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)));
      renameSync(tmp, file);
    } catch {
      // memory still has it
    }
  }
}

/** Legends for form cards. */
export class LoreStore extends FormStore<string> {
  protected own(form: Form): string | undefined {
    return form.lore;
  }

  protected read(raw: unknown): string | undefined {
    return typeof raw === "string" ? raw : undefined;
  }
}

/** "Beleben": three moves per form. */
export class MoveStore extends FormStore<readonly AnimMove[]> {
  protected own(form: Form): readonly AnimMove[] | undefined {
    return form.moves;
  }

  protected read(raw: unknown): readonly AnimMove[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MOVES) return undefined;
    const moves = raw.filter((m): m is AnimMove => typeof m === "object" && m !== null && typeof (m as AnimMove).label === "string" && typeof (m as AnimMove).action === "string");
    return moves.length === raw.length ? moves : undefined;
  }
}
