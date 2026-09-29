/**
 * Prüfstand for the judge ("Urteil"): labelled pairs, one side dressed up as invented (`g:` id, as
 * a player's own form arrives), judged by Claude exactly as in the game. Reports how often a
 * fitting answer wins (should be high) and how often nonsense wins (should be low) – the yardstick
 * for the "the form that was there first keeps winning" bias.
 *
 *   ANTHROPIC_API_KEY=… npm run judge-eval            (key from the environment or .env, never printed)
 *   npm run judge-eval -- --proxy http://localhost:8787/api/claude
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coreOntology } from "../src/content/index.ts";
import type { Form } from "../src/engine/types.ts";
import { DEFAULT_SETTINGS, type LlmSettings } from "../src/llm/client.ts";
import { judgeWithClaude } from "../src/llm/judge.ts";

/** attacker, target, should the attacker win? `a` / `t` / `both` = which side is invented. */
const PAIRS: readonly (readonly [string, string, boolean, "a" | "t" | "both"])[] = [
  ["wasser", "feuer", true, "a"],
  ["katze", "maus", true, "a"],
  ["licht", "schatten", true, "a"],
  ["wolf", "grossmutter", true, "a"],
  ["hoffnung", "verzweiflung", true, "a"],
  ["storch", "frosch", true, "a"],
  ["axt", "baum", true, "a"],
  ["messer", "netz", true, "a"],
  ["adler", "schlange", true, "a"],
  ["frosch", "fliege", true, "t"],
  ["spinne", "fliege", true, "t"],
  ["eis", "feuer", false, "a"],
  ["schere", "fels", false, "a"],
  ["ameise", "drache", false, "a"],
  ["fliege", "loewe", false, "a"],
  ["vogel", "hai", false, "a"],
  ["funke", "wasser", false, "both"],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function keyFromEnv(): string {
  const env = process.env["ANTHROPIC_API_KEY"];
  if (env !== undefined && env !== "") return env;
  const file = join(import.meta.dirname, "..", ".env");
  if (!existsSync(file)) return "";
  return /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? "";
}

const proxy = arg("--proxy") ?? "";
const settings: LlmSettings = { ...DEFAULT_SETTINGS, proxyUrl: proxy, apiKey: proxy === "" ? keyFromEnv() : "" };
if (settings.proxyUrl === "" && settings.apiKey === "") {
  console.error("Kein Claude: ANTHROPIC_API_KEY setzen (Umgebung oder .env) oder --proxy <url>.");
  process.exit(1);
}

const onto = coreOntology();
const invent = (f: Form): Form => ({ ...f, id: `g:${f.id}` });
let fit = 0;
let fitWon = 0;
let nonsense = 0;
let nonsenseWon = 0;
for (const [aid, tid, should, side] of PAIRS) {
  const a0 = onto.formById(aid);
  const t0 = onto.formById(tid);
  if (a0 === undefined || t0 === undefined) throw new Error(`unbekannt: ${aid} / ${tid}`);
  const a = side === "t" ? a0 : invent(a0);
  const t = side === "a" ? t0 : invent(t0);
  const j = await judgeWithClaude(onto, settings, a, t);
  const won = j?.win === true;
  if (should) {
    fit++;
    if (won) fitWon++;
  } else {
    nonsense++;
    if (won) nonsenseWon++;
  }
  const mark = j === undefined ? "?" : won === should ? "✓" : "✗";
  console.log(`${mark} ${a0.name} → ${t0.name}: ${j === undefined ? "keine Antwort" : `${won ? "Sieg" : "kein Sieg"} – ${j.reason}`}`);
}
const pct = (n: number, d: number): string => `${String(n)}/${String(d)} (${d === 0 ? "–" : String(Math.round((100 * n) / d))} %)`;
console.log(`\nStimmige Antworten gewonnen: ${pct(fitWon, fit)}   ·   Unsinn gewonnen: ${pct(nonsenseWon, nonsense)}`);
