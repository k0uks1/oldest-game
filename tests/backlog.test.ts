import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { type Change, type Context, type Issue, block, countTasks, issueRef, plan, prsIn, readChanges, summarize, touched, withBlock } from "../scripts/backlog.ts";

const ctx: Context = { main: false, repo: "o/r", ref: "feat" };
const change = (over: Partial<Change> = {}): Change => ({ name: "add-x", path: "openspec/changes/add-x", why: "Weil.", done: 1, total: 3, archived: false, ...over });
const issue = (over: Partial<Issue> = {}): Issue => ({ number: 7, title: "Add x", body: "", open: true, labels: ["openspec"], ...over });

describe("backlog: reading OpenSpec", () => {
  it("summarizes the Why section and counts tasks", () => {
    assert.equal(summarize("## Why\n\nIssue: #3\n\nDie Engine ist zu grob,\nweil sie zählt.\n\n## What Changes\n- a"), "Die Engine ist zu grob, weil sie zählt.");
    assert.deepEqual(countTasks("## 1\n- [x] 1.1 a\n- [ ] 1.2 b\n  - [X] 1.3 c\ntext [ ]"), { done: 2, total: 3 });
    assert.equal(issueRef("## Why\n**Issue:** #42\n"), 42);
    assert.equal(issueRef("## Why\nsee issue #42 later"), undefined);
  });

  it("reads active and archived changes, archive dates stripped", () => {
    const root = mkdtempSync(join(tmpdir(), "backlog-"));
    mkdirSync(join(root, "openspec/changes/add-x"), { recursive: true });
    mkdirSync(join(root, "openspec/changes/archive/2026-09-01-old-y"), { recursive: true });
    writeFileSync(join(root, "openspec/changes/add-x/proposal.md"), "## Why\nNeu.\n");
    writeFileSync(join(root, "openspec/changes/add-x/tasks.md"), "- [ ] a\n");
    const got = readChanges(root).map((c) => [c.name, c.archived, c.total]);
    assert.deepEqual(got, [["add-x", false, 1], ["old-y", true, 0]]);
  });

  it("finds the changes a diff touches", () => {
    assert.deepEqual(touched(["openspec/changes/b/tasks.md", "src/x.ts", "openspec/changes/a/proposal.md", "openspec/changes/archive/2026-01-01-c/tasks.md", "openspec/changes/b/design.md"]), ["a", "b"]);
  });
});

describe("backlog: planning", () => {
  it("opens one issue per new change", () => {
    const [a, ...rest] = plan([change()], [], ctx);
    assert.equal(rest.length, 0);
    assert.ok(a?.kind === "create" && a.title === "Add x" && a.body.includes("Aufgaben 1/3") && a.body.includes("Weil."));
  });

  it("updates progress and keeps words outside the block", () => {
    const body = withBlock("Notiz von Hand.", "add-x", block(change({ done: 0 }), ctx, []));
    const [a] = plan([change({ done: 2 })], [issue({ body })], ctx);
    assert.ok(a?.kind === "update" && a.body.startsWith("Notiz von Hand.") && a.body.includes("Aufgaben 2/3") && !a.label);
  });

  it("does nothing when the issue is current", () => {
    const body = block(change(), ctx, [], 7);
    assert.deepEqual(plan([change()], [issue({ body })], ctx), []);
  });

  it("attaches to an issue named in the proposal and labels it", () => {
    const [a] = plan([change({ issue: 3 })], [issue({ number: 3, body: "Idee aus dem Backlog.", labels: [] })], ctx);
    assert.ok(a?.kind === "update" && a.issue === 3 && a.label && a.body.startsWith("Idee aus dem Backlog.") && !a.body.includes("Bezug"));
  });

  it("gives a fresh issue when the named one is closed, pointing back", () => {
    const [a] = plan([change({ issue: 3 })], [issue({ number: 3, open: false })], ctx);
    assert.ok(a?.kind === "create" && a.body.includes("Bezug: #3"));
  });

  it("records the PRs that touch a change", () => {
    const body = block(change(), ctx, [4], 7);
    const [a] = plan([change()], [issue({ body })], { ...ctx, pr: { number: 9, touches: ["add-x"] } });
    assert.ok(a?.kind === "update");
    assert.deepEqual(prsIn(a.body, "add-x"), [4, 9]);
  });

  it("closes the issue once the change is archived on main – only there", () => {
    const body = block(change(), ctx, [], 7);
    const archived = change({ archived: true, path: "openspec/changes/archive/2026-09-29-add-x" });
    assert.deepEqual(plan([archived], [issue({ body })], ctx), []);
    const [a] = plan([archived], [issue({ body })], { ...ctx, main: true });
    assert.ok(a?.kind === "close" && a.issue === 7 && a.body.includes("archiviert"));
    assert.deepEqual(plan([archived], [issue({ body, open: false })], { ...ctx, main: true }), []);
  });

  it("a reused name: the new change gets a new issue, the old one stays closed", () => {
    const old = issue({ body: block(change(), ctx, [], 7), open: false });
    const actions = plan([change(), change({ archived: true, path: "openspec/changes/archive/2026-01-01-add-x" })], [old], { ...ctx, main: true });
    assert.deepEqual(actions.map((a) => a.kind), ["create"]);
  });
});
