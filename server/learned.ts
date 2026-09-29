/**
 * The server's "Gelernt" content pack: one file (default learned/pack.json) shared by the local
 * hot-seat (`/api/learned`) and all online rooms. Every write is validated exactly like
 * hand-written content: shape, pack id, and a full compile together with the core.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Ontology, OntologyError } from "../src/engine/ontology/ontology.ts";
import { parsePack, type ContentPack } from "../src/engine/ontology/pack.ts";
import { LEARNED_PACK_ID, emptyLearnedPack, mergeNamesakes, reconcileLearned } from "../src/llm/learning.ts";

const MAX_BYTES = 4_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * One entry per line, like the core content – reviewable diffs when committed. Every list the pack
 * has is written (learned qualities and Siegwege used to be dropped here, and with them every
 * learned form that needed them after a restart).
 */
export function formatPack(p: ContentPack): string {
  const list = (xs: readonly unknown[]): string => (xs.length === 0 ? "[]" : `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`);
  const optional: [string, readonly unknown[] | undefined][] = [
    ["rulings", p.rulings ?? []],
    ["qualities", p.qualities],
    ["combos", p.combos],
    ["fields", p.fields],
    ["extensions", p.extensions],
    ["notes", p.notes],
  ];
  const lines = [
    `  "id": ${JSON.stringify(p.id)}`,
    `  "name": ${JSON.stringify(p.name)}`,
    `  "version": ${JSON.stringify(p.version)}`,
    `  "tags": ${list(p.tags)}`,
    `  "verbs": ${list(p.verbs)}`,
    `  "modifiers": ${list(p.modifiers)}`,
    `  "forms": ${list(p.forms)}`,
    ...optional.flatMap(([k, xs]) => (xs === undefined ? [] : [`  ${JSON.stringify(k)}: ${list(xs)}`])),
  ];
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** Parse and validate an uploaded learned pack against the base packs. */
export function validateLearned(base: readonly ContentPack[], raw: unknown): { ok: true; pack: ContentPack } | { ok: false; error: string } {
  const parsed = parsePack(raw);
  if (!parsed.ok) return { ok: false, error: parsed.errors.slice(0, 5).join("; ") };
  if (parsed.pack.id !== LEARNED_PACK_ID) return { ok: false, error: `Pack-ID muss "${LEARNED_PACK_ID}" sein` };
  try {
    Ontology.compile([...base, parsed.pack]);
  } catch (e) {
    return { ok: false, error: e instanceof OntologyError ? e.errors.slice(0, 5).join("; ") : String(e) };
  }
  return { ok: true, pack: parsed.pack };
}

/** Load the stored pack, keeping whatever still fits the (possibly grown) core. */
export function readLearnedFile(base: readonly ContentPack[], file: string): ContentPack {
  if (!existsSync(file)) return emptyLearnedPack();
  try {
    const v = validateLearned(base, JSON.parse(readFileSync(file, "utf8")));
    // forms learned twice from different wordings become one (older servers made such twins)
    if (v.ok) return mergeNamesakes(v.pack) === v.pack ? v.pack : (reconcileLearned(base, v.pack) ?? v.pack);
    const parsed = parsePack(JSON.parse(readFileSync(file, "utf8")));
    return (parsed.ok ? reconcileLearned(base, parsed.pack) : undefined) ?? emptyLearnedPack();
  } catch {
    return emptyLearnedPack();
  }
}

/** Atomic write (temp file + rename): a crash never leaves half a pack behind. */
export function writeLearnedFile(file: string, pack: ContentPack): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, formatPack(pack));
  renameSync(tmp, file);
}

export interface LearnedEndpoint {
  readonly base: readonly ContentPack[];
  get(): ContentPack;
  /** Merge an uploaded (validated) pack into the shared one. */
  put(pack: ContentPack): ContentPack;
  /** Public servers do not accept uploads – there the rooms are the only writers. */
  readonly writable: boolean;
}

/** GET/PUT /api/learned. */
export async function handleLearned(req: Request, ep: LearnedEndpoint): Promise<Response> {
  if (req.method === "GET") return new Response(JSON.stringify(ep.get()), { status: 200, headers: { "content-type": "application/json" } });
  if (req.method !== "PUT") return json(405, { error: "GET oder PUT" });
  if (!ep.writable) return json(403, { error: "Dieser Server lernt nur in seinen Räumen." });
  const text = await req.text();
  if (text.length > MAX_BYTES) return json(413, { error: "Pack zu groß" });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "Ungültiges JSON" });
  }
  const v = validateLearned(ep.base, raw);
  if (!v.ok) return json(400, { error: v.error });
  const p = ep.put(v.pack);
  return json(200, { ok: true, forms: p.forms.length, tags: p.tags.length, verbs: p.verbs.length, rulings: (p.rulings ?? []).length });
}
