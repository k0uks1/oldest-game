/**
 * Fails if anything that looks like an Anthropic API key is tracked by git or
 * present in the build output. Runs in CI before anything is published.
 *
 *   npm run secret-scan
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{20,}/;

export function scanText(text: string): boolean {
  return KEY_PATTERN.test(text);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f !== "" && existsSync(f));
  const files = [...tracked, ...walk("dist")];
  const hits = files.filter((f) => {
    try {
      return scanText(readFileSync(f, "utf8"));
    } catch {
      return false;
    }
  });
  if (hits.length > 0) {
    console.error(`✖ Möglicher API-Key gefunden in:\n  ${hits.join("\n  ")}\nNichts wird veröffentlicht. Key entfernen UND in der Anthropic Console widerrufen.`);
    process.exit(1);
  }
  console.log(`✓ Secret-Scan: ${String(files.length)} Dateien, kein API-Key gefunden.`);
}
