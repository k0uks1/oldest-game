/**
 * Live art for newly learned forms: the server watches the shared learned pack, and every form
 * without `art` but with an `artPrompt` is generated once (PixelLab) and written back into the
 * pack – the hub then broadcasts it as a normal learned delta and the clients swap the sprite.
 *
 * Guard rails: a monthly budget (persisted, survives restarts), one attempt per form and prompt,
 * a small queue with limited parallelism. No key, no budget, or the service is down → nothing
 * happens and the drawn fallback stays. The key never leaves this process.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ContentPack, FormSpec } from "../src/engine/ontology/pack.ts";
import { encodeArt } from "../src/render/art.ts";
import { spriteSize } from "../src/render/sprite.ts";
import type { Rgba } from "./png.ts";

export interface ArtServiceOptions {
  /** Image service call (PixelLab in production, a stub in tests). */
  readonly generate: (prompt: string, size: number) => Promise<Rgba>;
  /** At most this many images per calendar month. */
  readonly monthlyLimit: number;
  /** Where the monthly usage is kept (JSON). Omit to keep it in memory only. */
  readonly usageFile?: string;
  /** A finished image for a form id – the caller writes it into the pack. */
  readonly onArt: (id: string, art: string) => void;
  readonly now?: () => Date;
  readonly parallel?: number;
  readonly log?: (line: string) => void;
}

interface Usage {
  month: string;
  used: number;
}

export class ArtService {
  private readonly tried = new Set<string>();
  private readonly queue: { id: string; prompt: string; size: number }[] = [];
  private running = 0;
  private usage: Usage;

  constructor(private readonly opts: ArtServiceOptions) {
    this.usage = this.readUsage();
  }

  /** Enqueue every form of the pack that still needs art. Cheap; call after each change. */
  scan(pack: ContentPack): void {
    for (const f of pack.forms) this.consider(f);
    this.pump();
  }

  get used(): number {
    this.rollMonth();
    return this.usage.used;
  }

  /** Resolves once the queue is empty and nothing is running (tests). */
  async idle(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private consider(f: FormSpec): void {
    if (f.art !== undefined || f.artPrompt === undefined) return;
    const key = `${f.id}|${f.artPrompt}`;
    if (this.tried.has(key)) return;
    this.tried.add(key);
    this.queue.push({ id: f.id, prompt: f.artPrompt, size: spriteSize(f.scale) });
  }

  private pump(): void {
    const parallel = this.opts.parallel ?? 2;
    while (this.running < parallel && this.queue.length > 0) {
      this.rollMonth();
      if (this.usage.used >= this.opts.monthlyLimit) {
        this.opts.log?.(`Bild-Budget für ${this.usage.month} aufgebraucht (${String(this.opts.monthlyLimit)}) – gezeichnete Sprites bleiben.`);
        this.queue.length = 0;
        return;
      }
      const job = this.queue.shift();
      if (job === undefined) return;
      this.running++;
      this.usage.used++;
      this.writeUsage();
      void this.opts
        .generate(job.prompt, job.size)
        .then((img) => {
          this.opts.onArt(job.id, encodeArt(img));
          this.opts.log?.(`Bild für ${job.id} (${String(job.size)}px)`);
        })
        .catch((e: unknown) => {
          this.opts.log?.(`Bild für ${job.id} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
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

/** The pack with one form's art set (unchanged if the form is gone). */
export function withArt(pack: ContentPack, id: string, art: string): ContentPack {
  if (!pack.forms.some((f) => f.id === id)) return pack;
  return { ...pack, forms: pack.forms.map((f) => (f.id === id ? { ...f, art } : f)) };
}
