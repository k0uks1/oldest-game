/**
 * Just-in-time art ("Kunst auf Abruf"): nothing is generated ahead of time. The first time a form
 * appears, its picture description is sent to the image service (PixelLab); the result is stored
 * under a key derived from the *description* (not the form), so variants – the hunter in a red
 * coat, the hunter with a rake – are separate pictures, and identical descriptions share one.
 *
 * Guard rails: one job per key at a time (requests are merged), a monthly budget (persisted,
 * survives restarts), one failed attempt per key per process, limited parallelism. No key, no
 * budget, or the service is down → `none`, and clients keep their drawn sprites.
 * The API key never leaves this process.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeArt } from "../src/render/art.ts";
import type { Rgba } from "./png.ts";

/** Bump when the style recipe changes – old pictures are then regenerated on demand. */
export const ART_STYLE_VERSION = 1;

export type ArtState = { readonly state: "ready"; readonly art: string } | { readonly state: "pending" } | { readonly state: "none" };

export interface ArtServiceOptions {
  /** Image service call (PixelLab in production, a stub in tests). Omit = store only, never generate. */
  readonly generate?: (prompt: string, size: number) => Promise<Rgba>;
  /** At most this many generated images per calendar month. */
  readonly monthlyLimit: number;
  /** Directory for stored pictures (one small file per key). Omit = memory only. */
  readonly dir?: string;
  /** Where the monthly usage is kept (JSON). Omit = memory only. */
  readonly usageFile?: string;
  readonly now?: () => Date;
  readonly parallel?: number;
  readonly log?: (line: string) => void;
}

interface Usage {
  month: string;
  used: number;
}

/** The storage key for a description at a size: stable across processes and servers. */
export function artKey(prompt: string, size: number): string {
  const norm = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${String(ART_STYLE_VERSION)}|${String(size)}|${norm}`).digest("hex").slice(0, 32);
}

export class ArtService {
  private readonly memory = new Map<string, string>();
  private readonly failed = new Set<string>();
  private readonly pending = new Map<string, Promise<string | undefined>>();
  private readonly queue: { key: string; prompt: string; size: number; done: (art: string | undefined) => void }[] = [];
  private readonly listeners = new Set<(key: string, art: string | undefined) => void>();
  private running = 0;
  private usage: Usage;

  constructor(private readonly opts: ArtServiceOptions) {
    this.usage = this.readUsage();
  }

  /** Can this server make new pictures right now (key configured, budget left)? */
  get canGenerate(): boolean {
    this.rollMonth();
    return this.opts.generate !== undefined && this.usage.used < this.opts.monthlyLimit;
  }

  get used(): number {
    this.rollMonth();
    return this.usage.used;
  }

  /** Called with every finished job (art undefined = it failed). */
  onDone(listener: (key: string, art: string | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The storage key for a request (see {@link artKey}). */
  lookupKey(r: { readonly prompt: string; readonly size: number }): string {
    return artKey(r.prompt, r.size);
  }

  /** A stored picture, if any (memory first, then disk). */
  stored(key: string): string | undefined {
    const hit = this.memory.get(key);
    if (hit !== undefined) return hit;
    const file = this.file(key);
    if (file === undefined || !existsSync(file)) return undefined;
    try {
      const art = readFileSync(file, "utf8").trim();
      this.memory.set(key, art);
      return art;
    } catch {
      return undefined;
    }
  }

  /**
   * The picture for a description: ready, being made (then generation is started or joined),
   * or none (no service, budget spent, failed before).
   */
  lookup(prompt: string, size: number): ArtState & { readonly key: string } {
    const key = artKey(prompt, size);
    const art = this.stored(key);
    if (art !== undefined) return { key, state: "ready", art };
    if (this.pending.has(key)) return { key, state: "pending" };
    if (this.failed.has(key) || !this.canGenerate) return { key, state: "none" };
    void this.request(key, prompt, size);
    return { key, state: "pending" };
  }

  /** Generate (or join the running job for) one description. */
  request(key: string, prompt: string, size: number): Promise<string | undefined> {
    const running = this.pending.get(key);
    if (running !== undefined) return running;
    const job = new Promise<string | undefined>((done) => {
      this.queue.push({ key, prompt, size, done });
    });
    this.pending.set(key, job);
    this.pump();
    return job;
  }

  /** Put a finished picture into the store (warm-up script, tests). */
  put(key: string, art: string): void {
    this.memory.set(key, art);
    const file = this.file(key);
    if (file === undefined) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, art);
      renameSync(tmp, file);
    } catch (e) {
      this.opts.log?.(`Bild ${key} nicht gespeichert: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Resolves once nothing is queued or running (tests). */
  async idle(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private pump(): void {
    const parallel = this.opts.parallel ?? 3;
    while (this.running < parallel && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job === undefined) return;
      const generate = this.opts.generate;
      this.rollMonth();
      if (generate === undefined || this.usage.used >= this.opts.monthlyLimit) {
        this.finish(job.key, undefined, job.done);
        continue;
      }
      this.running++;
      this.usage.used++;
      this.writeUsage();
      void generate(job.prompt, job.size)
        .then((img) => {
          const art = encodeArt(img);
          this.put(job.key, art);
          this.opts.log?.(`Bild ${job.key.slice(0, 8)} (${String(job.size)}px): ${job.prompt.slice(0, 60)}`);
          this.finish(job.key, art, job.done);
        })
        .catch((e: unknown) => {
          this.opts.log?.(`Bild fehlgeschlagen (${job.prompt.slice(0, 40)}): ${e instanceof Error ? e.message : String(e)}`);
          this.failed.add(job.key);
          this.finish(job.key, undefined, job.done);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private finish(key: string, art: string | undefined, done: (art: string | undefined) => void): void {
    this.pending.delete(key);
    done(art);
    for (const l of this.listeners) l(key, art);
  }

  private file(key: string): string | undefined {
    return this.opts.dir === undefined || !/^[0-9a-f]{32}$/.test(key) ? undefined : join(this.opts.dir, key.slice(0, 2), `${key}.art`);
  }

  private month(): string {
    return (this.opts.now?.() ?? new Date()).toISOString().slice(0, 7);
  }

  private rollMonth(): void {
    const m = this.month();
    if (this.usage.month !== m) this.usage = { month: m, used: 0 };
  }

  private readUsage(): Usage {
    const fresh = { month: this.month(), used: 0 };
    const file = this.opts.usageFile;
    if (file === undefined || !existsSync(file)) return fresh;
    try {
      const u = JSON.parse(readFileSync(file, "utf8")) as Partial<Usage>;
      return typeof u.month === "string" && typeof u.used === "number" ? { month: u.month, used: u.used } : fresh;
    } catch {
      return fresh;
    }
  }

  private writeUsage(): void {
    const file = this.opts.usageFile;
    if (file === undefined) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(this.usage));
    } catch {
      // usage is a guard rail, not critical state
    }
  }
}
