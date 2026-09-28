/**
 * Generated art tooling. Pictures are made just in time by the game server; this script only
 * inspects coverage and can warm the server's picture store ahead of a session.
 *
 *   npm run art -- status                                   prompts per lexicon form, pictures in the store
 *   npm run art -- ingest <png-dir> [--dir learned/art]      put <form-id>.png files into the store (no API calls)
 *   npm run art -- warm [--ids a,b] [--limit N] [--parallel N] [--dir learned/art]
 *                                                           generate missing pictures into the store
 *                                                           (needs PIXELLAB_API_KEY, counts against ART_MONTHLY_LIMIT)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coreOntology } from "../src/content/index.ts";
import { artRequest } from "../server/art-prompts.ts";
import { ArtService } from "../server/art-service.ts";
import { encodeArt } from "../src/render/art.ts";
import { decodePng } from "../server/png.ts";
import { generatePixelArt, STYLE_SUFFIX } from "../server/pixellab.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const onto = coreOntology();
const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? undefined : (rest[i + 1] ?? "");
};
const dir = flag("dir") ?? join(root, "learned/art");
const key = process.env["PIXELLAB_API_KEY"] ?? "";
const store = new ArtService({
  ...(key === "" ? {} : { generate: (prompt: string, size: number) => generatePixelArt(key, prompt, size) }),
  monthlyLimit: Number(process.env["ART_MONTHLY_LIMIT"] ?? 1500),
  dir,
  usageFile: join(dirname(dir), "art-usage.json"),
  parallel: Math.max(1, Math.min(4, Number(flag("parallel") ?? "3"))),
  log: (l) => {
    console.log(l);
  },
});

const requests = onto.lexicon.map((f) => ({ form: f, req: artRequest(f) }));

if (cmd === "status") {
  const withPrompt = requests.filter((r) => r.req !== undefined);
  const stored = withPrompt.filter((r) => r.req !== undefined && store.stored(store.lookupKey(r.req)) !== undefined);
  console.log(`Prompts: ${String(withPrompt.length)} / ${String(onto.lexicon.length)} · im Speicher (${dir}): ${String(stored.length)} · diesen Monat erzeugt: ${String(store.used)}`);
} else if (cmd === "ingest") {
  const src = rest[0] ?? ".";
  for (const file of readdirSync(src).filter((f) => f.endsWith(".png"))) {
    const form = onto.formById(file.slice(0, -4));
    const req = form === undefined ? undefined : artRequest(form);
    const img = decodePng(readFileSync(join(src, file)));
    if (req === undefined || img === undefined) {
      console.log(`übersprungen: ${file}`);
      continue;
    }
    store.put(store.lookupKey(req), encodeArt(img));
    console.log(`${file} → ${store.lookupKey(req)} (${String(img.width)}px, Soll ${String(req.size)}px)`);
  }
} else if (cmd === "warm") {
  if (key === "") throw new Error("PIXELLAB_API_KEY fehlt (Umgebungsvariable).");
  const only = flag("ids")?.split(",");
  const limit = Number(flag("limit") ?? "Infinity");
  const todo = requests
    .filter((r) => only === undefined || only.includes(r.form.id))
    .flatMap((r) => (r.req === undefined || store.stored(store.lookupKey(r.req)) !== undefined ? [] : [r.req]))
    .slice(0, limit);
  console.log(`${String(todo.length)} Bilder · Stil: „${STYLE_SUFFIX}“`);
  await Promise.all(todo.map((r) => store.request(store.lookupKey(r), r.prompt, r.size)));
  await store.idle();
  console.log(`fertig · diesen Monat erzeugt: ${String(store.used)}`);
} else {
  console.log("Befehle: status | ingest <png-dir> | warm [--ids a,b] [--limit N] [--parallel N] [--dir learned/art]");
}
