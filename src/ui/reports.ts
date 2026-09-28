/**
 * "Das war Quatsch!" – absurd wins reported by players. Kept in this browser (so a tester can copy
 * them all out of the menu) and sent to the server when there is one (learned/reports.jsonl).
 * Browser storage may be unavailable (private mode) – then only the server copy exists.
 */
import type { AbsurdReport } from "../online/protocol.ts";

export interface StoredReport extends AbsurdReport {
  readonly at: string;
}

const KEY = "oldest-game:reports";
const MAX = 300;

export function loadReports(): StoredReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? list.filter((r): r is StoredReport => typeof r === "object" && r !== null && "attacker" in r && "target" in r && "verb" in r) : [];
  } catch {
    return [];
  }
}

export function addReport(r: AbsurdReport, at: string): StoredReport[] {
  const list = [...loadReports(), { ...r, at }].slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked – the server copy (if any) still counts
  }
  return list;
}

export function clearReports(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/** One line per report, ready to paste into a chat or an issue. */
export function reportsText(list: readonly StoredReport[]): string {
  return list.map((r) => `${r.at.slice(0, 16).replace("T", " ")}  ${r.attacker} ${r.verb} ${r.target}`).join("\n");
}
