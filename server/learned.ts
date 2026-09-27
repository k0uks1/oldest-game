/**
 * /api/learned – persists the "Gelernt" content pack of the local server to a
 * JSON file (default: learned/pack.json). Every write is validated exactly like
 * hand-written content: shape, pack id, and a full compile together with the core.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CORE_PACK_RAW, loadPack } from "../src/content/index.ts";
import { Ontology, OntologyError } from "../src/engine/ontology/ontology.ts";
import { parsePack } from "../src/engine/ontology/pack.ts";
import { LEARNED_PACK_ID, emptyLearnedPack } from "../src/llm/learning.ts";

const MAX_BYTES = 2_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handleLearned(req: Request, file: string): Promise<Response> {
  if (req.method === "GET") {
    if (!existsSync(file)) return json(200, emptyLearnedPack());
    return new Response(readFileSync(file, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (req.method !== "PUT") return json(405, { error: "GET oder PUT" });
  const text = await req.text();
  if (text.length > MAX_BYTES) return json(413, { error: "Pack zu groß" });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "Ungültiges JSON" });
  }
  const parsed = parsePack(raw);
  if (!parsed.ok) return json(400, { error: parsed.errors.slice(0, 5).join("; ") });
  if (parsed.pack.id !== LEARNED_PACK_ID) return json(400, { error: `Pack-ID muss "${LEARNED_PACK_ID}" sein` });
  try {
    Ontology.compile([loadPack(CORE_PACK_RAW), parsed.pack]);
  } catch (e) {
    return json(400, { error: e instanceof OntologyError ? e.errors.slice(0, 5).join("; ") : String(e) });
  }
  mkdirSync(dirname(file), { recursive: true });
  // one entry per line, like the core content – reviewable diffs when committed
  const p = parsed.pack;
  const list = (xs: readonly unknown[]): string => (xs.length === 0 ? "[]" : `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`);
  const out = `{\n  "id": ${JSON.stringify(p.id)},\n  "name": ${JSON.stringify(p.name)},\n  "version": ${JSON.stringify(p.version)},\n  "tags": ${list(p.tags)},\n  "verbs": ${list(p.verbs)},\n  "modifiers": ${list(p.modifiers)},\n  "forms": ${list(p.forms)}\n}\n`;
  writeFileSync(file, out);
  return json(200, { ok: true, forms: p.forms.length, tags: p.tags.length, verbs: p.verbs.length });
}
