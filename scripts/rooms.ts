/**
 * The living room ("lebender Raum"): every state in content/core/rooms.json is our own painted
 * dungeon (src/render/scenery/iso.png) repainted by PixelLab (edit_with_text – walls, floor, gate and
 * rune circle stay where the arena expects them), plus an animation loop of it (animate-pixminimax on
 * a half-size copy – the service animates at most 256×256). Writes src/render/rooms/<id>.png and
 * <id>-anim.png (frames side by side) and the index the arena imports.
 *
 *   PIXELLAB_API_KEY=… npm run rooms [-- flut brand …] [--force] [--no-anim]
 *
 * Resumable: running jobs are remembered in learned/rooms-jobs.json, finished pictures are kept.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import roomsJson from "../src/content/core/rooms.json" with { type: "json" };
import { decodePng, encodePng, type Rgba } from "../server/png.ts";

interface RoomSpec {
  readonly id: string;
  readonly repaint: string;
  readonly motion: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src/render/rooms");
const jobsFile = join(root, "learned/rooms-jobs.json");
const key = process.env["PIXELLAB_API_KEY"] ?? "";
if (key === "") throw new Error("PIXELLAB_API_KEY fehlt (Umgebungsvariable).");
const args = process.argv.slice(2);
const force = args.includes("--force");
const noAnim = args.includes("--no-anim");
const only = args.filter((a) => !a.startsWith("--"));
const API = "https://api.pixellab.ai/v2";
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const KEEP = "Keep the exact layout, perspective and positions of walls, floor, gate, chains and the rune circle on the floor. Highly detailed pixel art.";

const jobs = new Map<string, string>(existsSync(jobsFile) ? Object.entries(JSON.parse(readFileSync(jobsFile, "utf8")) as Record<string, string>) : []);
const remember = (): void => {
  mkdirSync(dirname(jobsFile), { recursive: true });
  writeFileSync(jobsFile, JSON.stringify(Object.fromEntries(jobs), null, 1));
};

/** Start (or pick up) a background job and wait for its pictures. */
async function job(name: string, start: () => Promise<Response>): Promise<Rgba[]> {
  let id = force ? undefined : jobs.get(name);
  if (id === undefined) {
    const res = await start();
    id = ((await res.json()) as { background_job_id?: string }).background_job_id;
    if (!res.ok || id === undefined) throw new Error(`${name}: PixelLab ${String(res.status)}`);
    jobs.set(name, id);
    remember();
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = (await (await fetch(`${API}/background-jobs/${id}`, { headers })).json()) as { status?: string; last_response?: { images?: { base64?: string }[] } };
    if (s.status === "failed" || s.status === "completed") {
      jobs.delete(name);
      remember();
    }
    if (s.status === "failed") throw new Error(`${name}: fehlgeschlagen`);
    if (s.status === "completed") return (s.last_response?.images ?? []).map((im) => decodePng(Buffer.from(im.base64 ?? "", "base64"))).filter((f): f is Rgba => f !== undefined);
  }
}

/** Nearest-neighbour halving (the animator takes at most 256 px a side). */
function half(img: Rgba): Rgba {
  const w = Math.floor(img.width / 2);
  const h = Math.floor(img.height / 2);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(img.data.subarray(((y * 2) * img.width + x * 2) * 4, ((y * 2) * img.width + x * 2) * 4 + 4), (y * w + x) * 4);
  return { width: w, height: h, data };
}

function strip(frames: readonly Rgba[]): Buffer {
  const w = frames[0]?.width ?? 0;
  const h = frames[0]?.height ?? 0;
  const data = new Uint8ClampedArray(w * frames.length * h * 4);
  frames.forEach((f, k) => {
    for (let y = 0; y < h; y++) data.set(f.data.subarray(y * w * 4, (y + 1) * w * 4), (y * w * frames.length + k * w) * 4);
  });
  return encodePng({ width: w * frames.length, height: h, data });
}

const base = readFileSync(join(root, "src/render/scenery/iso.png")).toString("base64");

async function make(r: RoomSpec): Promise<void> {
  const stillFile = join(out, `${r.id}.png`);
  if (force || !existsSync(stillFile)) {
    const [still] = await job(r.id, () =>
      fetch(`${API}/edit-images-v2`, {
        method: "POST",
        headers,
        body: JSON.stringify({ method: "edit_with_text", edit_images: [{ image: { type: "base64", base64: base }, width: 480, height: 270 }], image_size: { width: 480, height: 270 }, description: `${r.repaint}. ${KEEP}`, seed: 11 }),
      }),
    );
    if (still === undefined) throw new Error(`${r.id}: kein Bild`);
    writeFileSync(stillFile, encodePng(still));
    console.log(`${r.id}: gemalt`);
  }
  const animFile = join(out, `${r.id}-anim.png`);
  if (noAnim || (existsSync(animFile) && !force)) return;
  const still = decodePng(readFileSync(stillFile));
  if (still === undefined) throw new Error(`${r.id}: Bild nicht lesbar`);
  const first = encodePng(half(still)).toString("base64");
  // PixMiniMax: a far shorter queue than animate-with-text-v3; a full house (Tier 2: 11 jobs) answers 429 – wait for a slot
  const frames = await job(`${r.id}-anim`, async () => {
    for (;;) {
      const res = await fetch(`${API}/animate-pixminimax`, { method: "POST", headers, body: JSON.stringify({ first_frame: { type: "base64", base64: first }, description: r.motion, frame_count: 8, no_background: false, seed: 11 }) });
      if (res.status !== 429) return res;
      await new Promise((w) => setTimeout(w, 15000));
    }
  });
  if (frames.length < 4) throw new Error(`${r.id}: zu wenige Bilder`);
  writeFileSync(animFile, strip(frames));
  console.log(`${r.id}: belebt (${String(frames.length)} Bilder)`);
}

function writeIndex(): void {
  const names = readdirSync(out)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4))
    .sort();
  const ident = (n: string): string => `room_${n.replace(/[^a-z0-9]/gi, "_")}`;
  const head = "// Generated by `npm run rooms` – the painted room states (still + animation strip), bundled as data URLs.";
  writeFileSync(
    join(out, "index.ts"),
    [head, ...names.map((n) => `import ${ident(n)} from "./${n}.png";`), "", "export const ROOM_PICTURES: Readonly<Record<string, string>> = {", ...names.map((n) => `  ${JSON.stringify(n)}: ${ident(n)},`), "};", ""].join("\n"),
  );
}

mkdirSync(out, { recursive: true });
const specs = (roomsJson as RoomSpec[]).filter((r) => only.length === 0 || only.includes(r.id));
let next = 0;
const failed: string[] = [];
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < specs.length) {
      const r = specs[next++];
      if (r !== undefined)
        await make(r).catch((e: unknown) => {
          failed.push(e instanceof Error ? e.message : String(e));
        });
    }
  }),
);
writeIndex();
if (failed.length > 0) console.log(`Fehlgeschlagen (nochmal starten setzt fort):\n  ${failed.join("\n  ")}`);
