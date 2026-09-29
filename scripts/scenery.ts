/**
 * Painted scenery: renders the procedural rooms (and the void behind the wall) in a headless
 * browser and has PixelLab repaint them (edit_with_text) – the render is the input, so every
 * wall, floor line and prop stays where the arena's geometry expects it. Writes
 * src/render/scenery/{iso,flat,void}.png (bundled into the build as data URLs).
 *
 *   PIXELLAB_API_KEY=… npm run scenery [-- iso flat void] [--seed N]
 *
 * Needs Playwright with Chromium (pre-installed in the dev container; not a project dependency).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = process.env["PIXELLAB_API_KEY"] ?? "";
if (key === "") throw new Error("PIXELLAB_API_KEY fehlt (Umgebungsvariable).");
const args = process.argv.slice(2);
const seedAt = args.indexOf("--seed");
const seed = seedAt < 0 ? 11 : Number(args[seedAt + 1] ?? 11);
const which = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");
const scenes = (which.length > 0 ? which : ["iso", "flat", "void"]) as ("iso" | "flat" | "void")[];

const KEEP = "Keep the exact layout, perspective and positions of walls, pillars, floor, gate and chains.";
const PROMPTS = {
  iso: `Repaint as isometric dark fantasy dungeon room interior at night, cold violet and deep purple stone, faint warm torch glow on the walls, ancient stone brick walls meeting in a corner, iron barred gate on the left wall, hanging chains on the right wall, cracked flagstone floor with scattered bones and a skull, damp moss in the cracks, highly detailed pixel art. ${KEEP}`,
  flat: `Repaint as dark fantasy dungeon at night seen straight on, cold violet and deep purple stone, faint warm torch glow, ancient stone brick back wall with stone pillars, cracked flagstone floor with scattered bones, damp moss in the cracks, highly detailed pixel art. ${KEEP}`,
  void: "Repaint as empty deep cosmic space only, dark violet and black, a faint glowing nebula band across the middle, countless tiny stars, two small distant spiral galaxies, no buildings, no walls, no gate, no ground, pixel art.",
} as const;

// 1. the procedural paint, rendered where there is a canvas: a headless browser
const bundle = await esbuild.build({
  stdin: {
    contents: `import { ISO } from "./src/render/stage-iso.ts"; import { FLAT } from "./src/render/stage-flat.ts"; import { paintStarfield } from "./src/render/stage.ts";
      globalThis.paint = { iso: () => ISO.paintBackground().toDataURL(), flat: () => FLAT.paintBackground().toDataURL(), void: () => paintStarfield().toDataURL() };`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  write: false,
});
// Playwright: the project's own if installed, else the global one (the dev container ships it)
const require = createRequire(import.meta.url);
const findPlaywright = (): unknown => {
  try {
    return require("playwright");
  } catch {
    return require(join(execSync("npm root -g").toString().trim(), "playwright"));
  }
};
const { chromium } = findPlaywright() as { chromium: { launch(): Promise<{ newPage(): Promise<{ setContent(h: string): Promise<void>; addScriptTag(o: { content: string }): Promise<unknown>; evaluate<T>(f: (k: string) => T, k: string): Promise<T> }>; close(): Promise<void> }> } };
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });
const renders = new Map<string, string>();
for (const s of scenes) renders.set(s, (await page.evaluate((k) => (globalThis as unknown as { paint: Record<string, () => string> }).paint[k]?.() ?? "", s)).split(",")[1] ?? "");
await browser.close();

// 2. PixelLab repaints each (background job, polled)
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
async function repaint(scene: (typeof scenes)[number]): Promise<void> {
  const start = await fetch("https://api.pixellab.ai/v2/edit-images-v2", {
    method: "POST",
    headers,
    body: JSON.stringify({
      method: "edit_with_text",
      edit_images: [{ image: { type: "base64", base64: renders.get(scene) }, width: 480, height: 270 }],
      image_size: { width: 480, height: 270 },
      description: PROMPTS[scene],
      seed,
    }),
  });
  const job = ((await start.json()) as { background_job_id?: string }).background_job_id;
  if (!start.ok || job === undefined) throw new Error(`${scene}: PixelLab ${String(start.status)}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = (await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${job}`, { headers })).json()) as { status?: string; last_response?: { images?: { base64?: string }[] } };
    if (res.status === "failed") throw new Error(`${scene}: fehlgeschlagen`);
    const b64 = res.last_response?.images?.[0]?.base64;
    if (res.status === "completed" && b64 !== undefined) {
      writeFileSync(join(root, "src/render/scenery", `${scene}.png`), Buffer.from(b64, "base64"));
      console.log(`${scene}: neu gemalt`);
      return;
    }
  }
}
await Promise.all(scenes.map(repaint));
