/**
 * "Beleben": short animations of a form's generated picture, made on request (PixelLab,
 * animate-with-text). Like pictures they are made once and kept: the key is the picture plus the
 * action, so every duel that asks for the same breathing wolf gets the stored one. A monthly
 * budget (persisted) caps the cost; one job per key at a time; a failed key is not retried in
 * this process. The API key never leaves the server.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeArt, encodeArt } from "../src/render/art.ts";
import type { Rgba } from "./png.ts";

export type AnimState = { readonly state: "ready"; readonly frames: readonly string[] } | { readonly state: "pending" } | { readonly state: "none" };

export interface AnimServiceOptions {
  /** The animation call (PixelLab in production, a stub in tests). Omit = store only. */
  readonly animate?: (first: Rgba, action: string) => Promise<Rgba[]>;
  readonly monthlyLimit: number;
  readonly dir?: string;
  readonly usageFile?: string;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export function animKey(art: string, action: string): string {
  return createHash("sha256").update(`anim|1|${action}|${art}`).digest("hex").slice(0, 32);
}

export class AnimService {
  private readonly memory = new Map<string, readonly string[]>();
  private readonly failed = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(key: string, frames: readonly string[] | undefined) => void>();
  private usage: { month: string; used: number };

  constructor(private readonly opts: AnimServiceOptions) {
    this.usage = this.readUsage();
  }

  get used(): number {
    this.rollMonth();
    return this.usage.used;
  }

  /** Can new animations be made right now (key configured, budget left)? */
  get canAnimate(): boolean {
    this.rollMonth();
    return this.opts.animate !== undefined && this.usage.used < this.opts.monthlyLimit;
  }

  onDone(listener: (key: string, frames: readonly string[] | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stored, running (pending) or started now – or none (no key, no budget, failed before). */
  lookup(art: string, action: string): AnimState & { readonly key: string } {
    const key = animKey(art, action);
    const stored = this.stored(key);
    if (stored !== undefined) return { key, state: "ready", frames: stored };
    if (this.pending.has(key)) return { key, state: "pending" };
    const first = decodeArt(art);
    const animate = this.opts.animate;
    if (first === undefined || animate === undefined || this.failed.has(key) || !this.canAnimate) return { key, state: "none" };
    this.usage.used++;
    this.writeUsage();
    const job = animate({ width: first.width, height: first.height, data: new Uint8ClampedArray(first.data) }, action)
      .then((frames) => {
        const encoded = frames.map((f) => encodeArt(f));
        this.put(key, encoded);
        this.opts.log?.(`Belebt: ${action} (${String(frames.length)} Bilder) · diesen Monat ${String(this.usage.used)}`);
        this.finish(key, encoded);
      })
      .catch((e: unknown) => {
        this.failed.add(key);
        this.opts.log?.(`Belebung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        this.finish(key, undefined);
      });
    this.pending.set(key, job);
    return { key, state: "pending" };
  }

  /** Wait for every running job (tests, scripts). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending.values()]);
  }

  private finish(key: string, frames: readonly string[] | undefined): void {
    this.pending.delete(key);
    for (const l of this.listeners) l(key, frames);
  }

  private file(key: string): string | undefined {
    return this.opts.dir === undefined ? undefined : join(this.opts.dir, key.slice(0, 2), `${key}.anim`);
  }

  private stored(key: string): readonly string[] | undefined {
    const mem = this.memory.get(key);
    if (mem !== undefined) return mem;
    const file = this.file(key);
    if (file === undefined || !existsSync(file)) return undefined;
    const frames = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
    if (frames.length < 2) return undefined;
    this.memory.set(key, frames);
    return frames;
  }

  private put(key: string, frames: readonly string[]): void {
    this.memory.set(key, frames);
    const file = this.file(key);
    if (file === undefined) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, frames.join("\n"));
      renameSync(`${file}.tmp`, file);
    } catch {
      // memory still has it
    }
  }

  private month(): string {
    return (this.opts.now?.() ?? new Date()).toISOString().slice(0, 7);
  }

  private rollMonth(): void {
    if (this.usage.month !== this.month()) this.usage = { month: this.month(), used: 0 };
  }

  private readUsage(): { month: string; used: number } {
    try {
      if (this.opts.usageFile !== undefined) {
        const u = JSON.parse(readFileSync(this.opts.usageFile, "utf8")) as { month?: unknown; used?: unknown };
        if (typeof u.month === "string" && typeof u.used === "number" && u.month === this.month()) return { month: u.month, used: u.used };
      }
    } catch {
      // first run
    }
    return { month: this.month(), used: 0 };
  }

  private writeUsage(): void {
    if (this.opts.usageFile === undefined) return;
    try {
      mkdirSync(dirname(this.opts.usageFile), { recursive: true });
      writeFileSync(this.opts.usageFile, JSON.stringify(this.usage));
    } catch {
      // counted in memory
    }
  }
}
