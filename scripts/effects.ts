/**
 * Attack effects ("Angriffe"): a fixed library of short PixelLab animations – fireballs, bullets,
 * claw marks, lightning, hearts … – made once and bundled, so a duel never waits for one. Each
 * effect in content/core/effects.json gets a first frame (pixflux) and an animation of it
 * (animate-pixminimax); projectiles also get an impact. Frames are written side by side as one
 * strip: src/render/effects/<id>.png and <id>-impact.png.
 *
 *   PIXELLAB_API_KEY=… npm run effects [-- fireball bullet …] [--force]
 *
 * Resumable: running jobs are remembered in learned/effects-jobs.json, finished strips are kept.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import effectsJson from "../src/content/core/effects.json" with { type: "json" };
import { decodePng, encodePng, type Rgba } from "../server/png.ts";

interface EffectSpec {
  readonly id: string;
  readonly kind: "projectile" | "strike" | "drain";
  readonly look: string;
  readonly motion: string;
  readonly impact?: string;
  readonly impactMotion?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src/render/effects");
const jobsFile = join(root, "learned/effects-jobs.json");
const key = process.env["PIXELLAB_API_KEY"] ?? "";
if (key === "") throw new Error("PIXELLAB_API_KEY fehlt (Umgebungsvariable).");
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const API = "https://api.pixellab.ai/v2";
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const STYLE = "pixel art game attack effect, glowing, transparent background";

const jobs = new Map<string, string>(existsSync(jobsFile) ? Object.entries(JSON.parse(readFileSync(jobsFile, "utf8")) as Record<string, string>) : []);
const remember = (): void => {
  mkdirSync(dirname(jobsFile), { recursive: true });
  writeFileSync(jobsFile, JSON.stringify(Object.fromEntries(jobs), null, 1));
};

async function firstFrame(name: string, description: string, size: number): Promise<string> {
  const file = join(root, "learned/effects-first", `${name}.png`);
  if (existsSync(file) && !force) return readFileSync(file).toString("base64");
  const res = await fetch(`${API}/create-image-pixflux`, {
    method: "POST",
    headers,
    body: JSON.stringify({ description: `${description}, ${STYLE}`, image_size: { width: size, height: size }, outline: "single color black outline", shading: "medium shading", detail: "medium detail", view: "side", direction: "east", no_background: true, seed: 7 }),
  });
  const b64 = ((await res.json()) as { image?: { base64?: string } }).image?.base64;
  if (!res.ok || b64 === undefined) throw new Error(`${name}: pixflux ${String(res.status)}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(b64, "base64"));
  return b64;
}

async function animate(name: string, first: string, action: string): Promise<Rgba[]> {
  let id = force ? undefined : jobs.get(name);
  if (id === undefined) {
    // PixMiniMax: a much shorter queue than animate-with-text-v3 (minutes, not a quarter hour) and
    // steadier loops; 1 generation for 64 px × 8 frames. Tier 2 allows 11 jobs at once – a full
    // house answers 429, so wait for a slot.
    let res: Response;
    for (;;) {
      res = await fetch(`${API}/animate-pixminimax`, { method: "POST", headers, body: JSON.stringify({ first_frame: { type: "base64", base64: first }, description: action, frame_count: 8, no_background: true, seed: 7 }) });
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 15000));
    }
    id = ((await res.json()) as { background_job_id?: string }).background_job_id;
    if (!res.ok || id === undefined) throw new Error(`${name}: animate ${String(res.status)}`);
    jobs.set(name, id);
    remember();
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = (await (await fetch(`${API}/background-jobs/${id}`, { headers })).json()) as { status?: string; last_response?: { images?: { base64?: string }[] } };
    if (s.status === "failed") {
      jobs.delete(name);
      remember();
      throw new Error(`${name}: fehlgeschlagen`);
    }
    if (s.status === "completed") {
      const frames = (s.last_response?.images ?? []).map((im) => decodePng(Buffer.from(im.base64 ?? "", "base64"))).filter((f): f is Rgba => f !== undefined);
      jobs.delete(name);
      remember();
      return frames;
    }
  }
}

/** Frames side by side in one PNG. */
function strip(frames: readonly Rgba[]): Buffer {
  const w = frames[0]?.width ?? 0;
  const h = frames[0]?.height ?? 0;
  const data = new Uint8ClampedArray(w * frames.length * h * 4);
  frames.forEach((f, k) => {
    for (let y = 0; y < h; y++) data.set(f.data.subarray(y * w * 4, (y + 1) * w * 4), (y * w * frames.length + k * w) * 4);
  });
  return encodePng({ width: w * frames.length, height: h, data });
}

async function make(name: string, look: string, motion: string, size: number): Promise<void> {
  const file = join(out, `${name}.png`);
  if (existsSync(file) && !force) return;
  const first = await firstFrame(name, look, size);
  const frames = await animate(name, first, motion);
  if (frames.length < 4) throw new Error(`${name}: zu wenige Bilder`);
  writeFileSync(file, strip(frames));
  console.log(`${name}: ${String(frames.length)} Bilder`);
}

/** src/render/effects/index.ts: every finished strip, bundled as a data URL. */
function writeIndex(): void {
  const names = readdirSync(out)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4))
    .sort();
  const ident = (n: string): string => `fx_${n.replace(/[^a-z0-9]/gi, "_")}`;
  const lines = [
    "// Generated by `npm run effects` – the painted attack animations, bundled as data URLs.",
    ...names.map((n) => `import ${ident(n)} from "./${n}.png";`),
    "",
    "export const EFFECT_SHEETS: Readonly<Record<string, string>> = {",
    ...names.map((n) => `  ${JSON.stringify(n)}: ${ident(n)},`),
    "};",
    "",
  ];
  writeFileSync(join(out, "index.ts"), names.length === 0 ? `${lines[0] ?? ""}\nexport const EFFECT_SHEETS: Readonly<Record<string, string>> = {};\n` : lines.join("\n"));
}

const specs = (effectsJson as EffectSpec[]).filter((e) => only.length === 0 || only.includes(e.id));
const tasks: (() => Promise<void>)[] = [];
for (const e of specs) {
  tasks.push(() => make(e.id, e.look, e.motion, e.kind === "strike" ? 96 : 64));
  if (e.impact !== undefined && e.impactMotion !== undefined) {
    const impact = e.impact;
    const motion = e.impactMotion;
    tasks.push(() => make(`${e.id}-impact`, impact, motion, 96));
  }
}
mkdirSync(out, { recursive: true });
// PixelLab queues animations – a few at a time keeps it moving without flooding it
let next = 0;
const failed: string[] = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      await t?.().catch((e: unknown) => {
        failed.push(e instanceof Error ? e.message : String(e));
      });
    }
  }),
);
writeIndex();
if (failed.length > 0) console.log(`Fehlgeschlagen (nochmal starten setzt fort):\n  ${failed.join("\n  ")}`);
