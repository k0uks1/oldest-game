/**
 * Keeps the GitHub backlog in step with OpenSpec: every change under `openspec/changes/<name>/` has exactly one
 * issue (labelled `openspec`) that shows its purpose, task progress and the PRs working on it; archiving the change
 * on `main` closes the issue. Nobody maintains these issues by hand – CI runs this on every PR and every push to main.
 *
 * A proposal may name an existing issue (`Issue: #12` anywhere in proposal.md): the change then attaches to that
 * issue instead of opening a new one. The managed part of an issue body lives between two markers, so words written
 * around it stay untouched.
 *
 *   npm run backlog               # dry run: prints the plan (no token needed)
 *   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo npm run backlog -- --apply [--main] [--pr 12] [--ref branch]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Change {
  name: string;
  /** Folder relative to the repo root. */
  path: string;
  /** First paragraph of the proposal's „Why“ section (or its first prose). */
  why: string;
  done: number;
  total: number;
  archived: boolean;
  /** Issue named in the proposal (`Issue: #12`). */
  issue?: number;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  open: boolean;
  labels: string[];
}

export type Action =
  | { kind: "create"; change: string; title: string; body: string }
  | { kind: "update"; change: string; issue: number; body: string; label: boolean }
  | { kind: "close"; change: string; issue: number; body: string; comment: string };

export interface Context {
  /** Running on the default branch: archived changes close their issues. */
  main: boolean;
  /** `owner/repo`, for links. */
  repo: string;
  /** Branch or sha the links point at. */
  ref: string;
  /** PR being built, with the changes it touches. */
  pr?: { number: number; touches: string[] };
}

export const LABEL = "openspec";
/** Labels the planning workflows rely on; created (or their descriptions updated) on every run. */
export const LABELS: { name: string; color: string; description: string }[] = [
  { name: "enhancement", color: "a2eeef", description: "Wunsch / neue Fähigkeit" },
  { name: "bug", color: "d73a4a", description: "Etwas funktioniert nicht wie gedacht" },
  { name: "debt", color: "fbca04", description: "Aufräumen, technische Schuld" },
  { name: LABEL, color: "5319e7", description: "OpenSpec-Änderung (automatisch gepflegt)" },
  { name: "wayfinder:map", color: "0e8a16", description: "Wayfinder-Karte eines großen Vorhabens" },
  { name: "wayfinder:research", color: "c5def5", description: "Wayfinder: Recherche (AFK)" },
  { name: "wayfinder:prototype", color: "c5def5", description: "Wayfinder: Prototyp (HITL)" },
  { name: "wayfinder:grilling", color: "c5def5", description: "Wayfinder: Klärungsgespräch (HITL)" },
  { name: "wayfinder:task", color: "c5def5", description: "Wayfinder: Vorarbeit für eine Entscheidung" },
  { name: "needs-user", color: "d93f0b", description: "Blockiert, bis du etwas tust (Key, Konto, Zugang) – Checkliste im Issue" },
];

const ARCHIVE_DATE = /^\d{4}-\d{2}-\d{2}-/;

// ---------- reading OpenSpec ----------

export function summarize(proposal: string): string {
  const lines = proposal.split("\n");
  const why = lines.findIndex((l) => /^##\s+(why|warum)\b/i.test(l.trim()));
  const para: string[] = [];
  for (const raw of lines.slice(why + 1)) {
    const l = raw.trim();
    if (l.startsWith("#") || /^issue:/i.test(l)) {
      if (para.length > 0) break;
      continue;
    }
    if (l === "") {
      if (para.length > 0) break;
      continue;
    }
    para.push(l);
  }
  const text = para.join(" ");
  return text.length > 600 ? `${text.slice(0, 597)}…` : text;
}

export function countTasks(tasks: string): { done: number; total: number } {
  const boxes = tasks.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? [];
  return { done: boxes.filter((b) => /\[[xX]\]/.test(b)).length, total: boxes.length };
}

export function issueRef(proposal: string): number | undefined {
  const m = /^\s*(?:[-*]\s*)?\**issue\**:\**\s*#(\d+)/im.exec(proposal);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

function readChange(root: string, dir: string, name: string, archived: boolean): Change {
  const read = (f: string): string => (existsSync(join(root, dir, f)) ? readFileSync(join(root, dir, f), "utf8") : "");
  const proposal = read("proposal.md");
  const issue = issueRef(proposal);
  return { name, path: dir, why: summarize(proposal), ...countTasks(read("tasks.md")), archived, ...(issue === undefined ? {} : { issue }) };
}

export function readChanges(root: string): Change[] {
  const base = join(root, "openspec", "changes");
  if (!existsSync(base)) return [];
  const dirs = (p: string): string[] => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const active = dirs(base).filter((d) => d !== "archive").map((d) => readChange(root, `openspec/changes/${d}`, d, false));
  const archive = join(base, "archive");
  const archived = existsSync(archive)
    ? dirs(archive).map((d) => readChange(root, `openspec/changes/archive/${d}`, d.replace(ARCHIVE_DATE, ""), true))
    : [];
  return [...active, ...archived];
}

/** Active changes a list of changed files touches. */
export function touched(files: string[]): string[] {
  const names = files.map((f) => /^openspec\/changes\/(?!archive\/)([^/]+)\//.exec(f)?.[1]).filter((n): n is string => n !== undefined);
  return [...new Set(names)].sort();
}

// ---------- the managed block ----------

const begin = (name: string): string => `<!-- openspec:begin ${name} -->`;
const END = "<!-- openspec:end -->";

function blockRange(body: string, name: string): [number, number] | undefined {
  const start = body.indexOf(begin(name));
  if (start < 0) return undefined;
  const end = body.indexOf(END, start);
  return end < 0 ? undefined : [start, end + END.length];
}

export function managesChange(issue: Issue, name: string): boolean {
  return blockRange(issue.body, name) !== undefined;
}

export function prsIn(body: string, name: string): number[] {
  const r = blockRange(body, name);
  const line = r === undefined ? undefined : /Pull Requests: (.*)/.exec(body.slice(r[0], r[1]))?.[1];
  return (line?.match(/#\d+/g) ?? []).map((n) => Number(n.slice(1)));
}

export function block(change: Change, ctx: Context, prs: number[], home?: number): string {
  const url = `https://github.com/${ctx.repo}/blob/${ctx.ref}/${change.path}`;
  const state = change.archived ? "✅ archiviert" : change.total > 0 && change.done === change.total ? "🟢 alle Aufgaben erledigt" : "🛠 in Arbeit";
  const tasks = change.total > 0 ? ` · Aufgaben ${String(change.done)}/${String(change.total)}` : "";
  const lines = [
    begin(change.name),
    `**OpenSpec-Änderung** [\`${change.name}\`](${url}) · ${state}${tasks}`,
    "",
    change.why === "" ? "_(noch kein „Why“ im Proposal)_" : change.why,
    "",
    `[Proposal](${url}/proposal.md) · [Aufgaben](${url}/tasks.md)`,
  ];
  if (change.issue !== undefined && change.issue !== home) lines.push(`Bezug: #${String(change.issue)}`);
  if (prs.length > 0) lines.push(`Pull Requests: ${prs.map((n) => `#${String(n)}`).join(", ")}`);
  lines.push("", "<sub>Automatisch gepflegt aus `openspec/` (scripts/backlog.ts) – Text außerhalb dieses Blocks bleibt stehen.</sub>", END);
  return lines.join("\n");
}

export function withBlock(body: string, name: string, next: string): string {
  const r = blockRange(body, name);
  if (r !== undefined) return body.slice(0, r[0]) + next + body.slice(r[1]);
  return body.trim() === "" ? next : `${body.trimEnd()}\n\n${next}`;
}

export function title(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------- planning (pure) ----------

export function plan(changes: Change[], issues: Issue[], ctx: Context): Action[] {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const actions: Action[] = [];
  const activeNames = new Set(changes.filter((c) => !c.archived).map((c) => c.name));
  for (const change of changes) {
    // an archived change whose name lives on as a new active change has handed its issue over
    if (change.archived && (!ctx.main || activeNames.has(change.name))) continue;
    const managed = issues.filter((i) => managesChange(i, change.name));
    // a closed named issue is history: the change then gets a fresh one that points back to it
    const named = change.issue === undefined ? undefined : byNumber.get(change.issue);
    const issue = (named?.open === true ? named : undefined) ?? managed.find((i) => i.open);
    const prs = [...new Set([...(issue === undefined ? [] : prsIn(issue.body, change.name)), ...(ctx.pr?.touches.includes(change.name) === true ? [ctx.pr.number] : [])])].sort((a, b) => a - b);
    const body = withBlock(issue?.body ?? "", change.name, block(change, ctx, prs, issue?.number));
    if (issue === undefined) {
      if (!change.archived) actions.push({ kind: "create", change: change.name, title: title(change.name), body });
    } else if (change.archived) {
      if (issue.open) {
        actions.push({ kind: "close", change: change.name, issue: issue.number, body, comment: `Die OpenSpec-Änderung \`${change.name}\` wurde archiviert (\`${change.path}\`) – erledigt.` });
      }
    } else if (issue.open && (body !== issue.body || !issue.labels.includes(LABEL))) {
      actions.push({ kind: "update", change: change.name, issue: issue.number, body, label: !issue.labels.includes(LABEL) });
    }
  }
  return actions;
}

// ---------- GitHub ----------

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  pull_request?: unknown;
}

const toIssue = (r: RawIssue): Issue => ({ number: r.number, title: r.title, body: r.body ?? "", open: r.state === "open", labels: r.labels.map((l) => l.name) });

async function fetchIssues(token: string, repo: string, changes: Change[]): Promise<Issue[]> {
  const out = new Map<number, Issue>();
  for (let page = 1; ; page++) {
    const raw = await api<RawIssue[]>(token, "GET", `/repos/${repo}/issues?labels=${LABEL}&state=all&per_page=100&page=${String(page)}`);
    for (const r of raw) if (r.pull_request === undefined) out.set(r.number, toIssue(r));
    if (raw.length < 100) break;
  }
  for (const n of new Set(changes.map((c) => c.issue).filter((n): n is number => n !== undefined))) {
    if (out.has(n)) continue;
    try {
      const r = await api<RawIssue>(token, "GET", `/repos/${repo}/issues/${String(n)}`);
      if (r.pull_request === undefined) out.set(n, toIssue(r));
    } catch (e) {
      console.warn(`⚠ Issue #${String(n)} aus einem Proposal nicht lesbar: ${String(e)}`);
    }
  }
  return [...out.values()];
}

async function ensureLabels(token: string, repo: string): Promise<void> {
  const have = new Map((await api<{ name: string; description: string | null }[]>(token, "GET", `/repos/${repo}/labels?per_page=100`)).map((l) => [l.name, l.description]));
  for (const l of LABELS) {
    if (!have.has(l.name)) await api(token, "POST", `/repos/${repo}/labels`, l);
    else if (have.get(l.name) !== l.description) await api(token, "PATCH", `/repos/${repo}/labels/${encodeURIComponent(l.name)}`, { description: l.description });
  }
}

async function run(actions: Action[], token: string, repo: string): Promise<void> {
  for (const a of actions) {
    if (a.kind === "create") {
      const r = await api<RawIssue>(token, "POST", `/repos/${repo}/issues`, { title: a.title, body: a.body, labels: [LABEL] });
      console.log(`+ #${String(r.number)} ${a.title}`);
    } else if (a.kind === "update") {
      await api(token, "PATCH", `/repos/${repo}/issues/${String(a.issue)}`, { body: a.body });
      if (a.label) await api(token, "POST", `/repos/${repo}/issues/${String(a.issue)}/labels`, { labels: [LABEL] });
      console.log(`~ #${String(a.issue)} ${a.change}`);
    } else {
      await api(token, "POST", `/repos/${repo}/issues/${String(a.issue)}/comments`, { body: a.comment });
      await api(token, "PATCH", `/repos/${repo}/issues/${String(a.issue)}`, { body: a.body, state: "closed", state_reason: "completed" });
      console.log(`✓ #${String(a.issue)} ${a.change} geschlossen`);
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const apply = process.argv.includes("--apply");
  const token = process.env["GITHUB_TOKEN"] ?? "";
  const repo = process.env["GITHUB_REPOSITORY"] ?? /github\.com[:/](.+?)(?:\.git)?$/.exec(git("remote", "get-url", "origin"))?.[1] ?? "";
  const prArg = arg("--pr");
  // on a PR's merge commit, the first parent is the base: its diff is what the PR changes
  const pr = prArg === undefined ? undefined : { number: Number(prArg), touches: touched(git("diff", "--name-only", "HEAD^1", "HEAD").split("\n")) };
  const ctx: Context = { main: process.argv.includes("--main"), repo, ref: arg("--ref") ?? (git("rev-parse", "--abbrev-ref", "HEAD") || "main"), ...(pr === undefined ? {} : { pr }) };
  const changes = readChanges(process.cwd());
  if (!apply || token === "") {
    console.log(`Backlog (Probelauf): ${String(changes.length)} OpenSpec-Änderungen`);
    for (const c of changes) console.log(`  ${c.archived ? "✓" : "·"} ${c.name}  ${String(c.done)}/${String(c.total)}${c.issue === undefined ? "" : `  → #${String(c.issue)}`}`);
    if (apply) console.log("Kein GITHUB_TOKEN – nichts geschrieben.");
  } else {
    await ensureLabels(token, repo);
    const actions = plan(changes, await fetchIssues(token, repo, changes), ctx);
    await run(actions, token, repo);
    console.log(`✓ Backlog synchron (${String(actions.length)} Änderung${actions.length === 1 ? "" : "en"}).`);
  }
}
