/**
 * Legends for form cards, written once by Claude and kept next to the learned pack. One small
 * Claude call per form at most; an hourly budget caps what curious grimoire browsing can cost.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Form } from "../src/engine/types.ts";

export interface LoreStoreOptions {
  /** Writes a legend (Claude); undefined = none available now. */
  readonly write?: (form: Form) => Promise<string | undefined>;
  /** JSON file (id → {name, text}); omitted = memory only. */
  readonly file?: string;
  /** Fresh legends per hour, all players together. */
  readonly perHour: number;
  readonly now?: () => number;
  /** Stored legends at most (oldest are kept, new ones stop being stored). */
  readonly maxEntries?: number;
}

interface Entry {
  readonly name: string;
  readonly text: string;
}

export class LoreStore {
  private readonly entries = new Map<string, Entry>();
  private readonly running = new Map<string, Promise<string | undefined>>();
  private stamps: number[] = [];
  private readonly now: () => number;

  constructor(private readonly opts: LoreStoreOptions) {
    this.now = opts.now ?? Date.now;
    if (opts.file === undefined) return;
    try {
      const raw = JSON.parse(readFileSync(opts.file, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null) return;
      for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
        const { name, text } = (e ?? {}) as { name?: unknown; text?: unknown };
        if (typeof name === "string" && typeof text === "string") this.entries.set(id, { name, text });
      }
    } catch {
      // no file yet
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** The legend for this form: its own, stored, or freshly written (merged while running). */
  get(form: Form): Promise<string | undefined> {
    if (form.lore !== undefined) return Promise.resolve(form.lore);
    const stored = this.entries.get(form.id);
    // same id, other name (a learned form replaced by a core one …): write a new one
    if (stored?.name === form.name) return Promise.resolve(stored.text);
    const running = this.running.get(form.id);
    if (running !== undefined) return running;
    const write = this.opts.write;
    const now = this.now();
    this.stamps = this.stamps.filter((t) => now - t < 3_600_000);
    if (write === undefined || this.stamps.length >= this.opts.perHour) return Promise.resolve(undefined);
    this.stamps.push(now);
    const job = write(form)
      .catch(() => undefined)
      .then((text) => {
        this.running.delete(form.id);
        if (text !== undefined) this.put(form, text);
        return text;
      });
    this.running.set(form.id, job);
    return job;
  }

  private put(form: Form, text: string): void {
    if (this.entries.size >= (this.opts.maxEntries ?? 20_000) && !this.entries.has(form.id)) return;
    this.entries.set(form.id, { name: form.name, text });
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
