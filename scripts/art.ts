/**
 * Generated sprite art for the core lexicon ("Kunst").
 *
 *   npm run art -- status                      how many forms have art / prompts
 *   npm run art -- ingest <dir>                import <id>.png files into content/core/art.json
 *   npm run art -- generate [--limit N] [--ids a,b] [--force]
 *                                              generate missing art via PixelLab (PIXELLAB_API_KEY)
 *
 * Prompts come from content/core/art-prompts.json (id → English description). Every image uses the
 * same style recipe, so 1 200 forms still look like one game. Results are written after each image
 * (a crash or an empty quota loses nothing); art.json stays one entry per line.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coreOntology } from "../src/content/index.ts";
import { encodeArt } from "../src/render/art.ts";
import { spriteSize } from "../src/render/sprite.ts";
import { decodePng } from "../server/png.ts";
import { generatePixelArt, STYLE_SUFFIX } from "../server/pixellab.ts";

const ART = "src/content/core/art.json";
const PROMPTS = "src/content/core/art-prompts.json";

const onto = coreOntology();
const readJson = (p: string): Record<string, string> => JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
const art = readJson(ART);
const prompts = readJson(PROMPTS);

function save(): void {
  const ids = Object.keys(art).sort();
  const lines = ids.map((id, i) => `  ${JSON.stringify(id)}: ${JSON.stringify(art[id])}${i < ids.length - 1 ? "," : ""}`);
  writeFileSync(ART, ids.length === 0 ? "{}\n" : `{\n${lines.join("\n")}\n}\n`);
}

const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? undefined : (rest[i + 1] ?? "");
};

if (cmd === "status") {
  const all = onto.lexicon.length;
  console.log(`Kunst: ${String(Object.keys(art).length)} / ${String(all)} Gestalten · Prompts: ${String(Object.keys(prompts).length)}`);
  const missing = onto.lexicon.filter((f) => prompts[f.id] === undefined).map((f) => f.id);
  if (missing.length > 0) console.log(`ohne Prompt (${String(missing.length)}): ${missing.slice(0, 40).join(" ")}${missing.length > 40 ? " …" : ""}`);
} else if (cmd === "ingest") {
  const dir = rest[0] ?? ".";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
    const id = file.slice(0, -4);
    if (onto.formById(id) === undefined) {
      console.log(`übersprungen (keine Gestalt): ${id}`);
      continue;
    }
    const img = decodePng(readFileSync(join(dir, file)));
    if (img === undefined) {
      console.log(`übersprungen (kein lesbares PNG): ${file}`);
      continue;
    }
    art[id] = encodeArt(img);
    console.log(`${id}: ${String(img.width)}×${String(img.height)} → ${String(art[id].length)} Zeichen`);
  }
  save();
} else if (cmd === "generate") {
  const key = process.env["PIXELLAB_API_KEY"];
  if (key === undefined || key === "") throw new Error("PIXELLAB_API_KEY fehlt (Umgebungsvariable).");
  const only = flag("ids")?.split(",");
  const limit = Number(flag("limit") ?? "Infinity");
  const force = rest.includes("--force");
  const todo = onto.lexicon
    .filter((f) => (only === undefined ? true : only.includes(f.id)))
    .filter((f) => force || art[f.id] === undefined)
    .filter((f) => prompts[f.id] !== undefined)
    .slice(0, limit);
  console.log(`${String(todo.length)} Bilder · Stil: „${STYLE_SUFFIX}“`);
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let f = todo.shift(); f !== undefined; f = todo.shift()) {
      const size = spriteSize(f.scale);
      try {
        const img = await generatePixelArt(key, prompts[f.id] ?? f.name, size);
        art[f.id] = encodeArt(img);
        save();
        done++;
        console.log(`✓ ${f.id} (${String(size)}px)`);
      } catch (e) {
        console.log(`✗ ${f.id}: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof Error && /quota|402|insufficient/i.test(e.message)) todo.length = 0;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log(`fertig: ${String(done)} neu, ${String(Object.keys(art).length)} insgesamt`);
} else {
  console.log("Befehle: status | ingest <dir> | generate [--limit N] [--ids a,b] [--force]");
}
