# Planning & backlog

Four places, each with one job – don't duplicate between them:

| What | Where | Maintained |
|---|---|---|
| Invariants, architecture, conventions | `AGENTS.md` + the `CONTEXT.md` of each folder | by hand, in the PR that changes them |
| What the game does (requirements + scenarios) | `openspec/specs/` | by archiving changes (`/opsx:archive`) |
| Work in flight: why, design, tasks | `openspec/changes/<name>/` | `/opsx:propose` → `/opsx:apply` → `/opsx:archive` |
| Backlog: everything not started, and the state of what is | GitHub issues | **automatic** for OpenSpec changes, see below |

- **Non-trivial feature or rule change** → `/opsx:propose` first (from an issue: `Issue: #<n>` under "## Why"),
  then `/opsx:apply`, and archive in the same PR that finishes it. Small fixes need no change folder.
- **The backlog keeps itself.** `.github/workflows/backlog.yml` runs `scripts/backlog.ts` on every PR and push to
  `main` touching `openspec/`: one issue per change (label `openspec`), progress from `tasks.md`, the PRs that
  touch it; archiving on `main` closes it. Never edit the block between the `openspec:begin/end` markers by hand.
- **Found something out of scope while working** (bug, idea, debt, a user wish that won't be done now): search
  the issues, then open one short issue instead of fixing it on the side or leaving it in chat.
  How to reach GitHub (gh locally, MCP tools in the cloud): `docs/agents/issue-tracker.md`.
- **Huge, foggy efforts** (more than one session, the way not yet clear – e.g. the engine rebuild): `/wayfinder`
  charts a decision map (`wayfinder:map` issue + sub-issues); once the way is clear, the buildable pieces become
  OpenSpec changes. Only on explicit `/wayfinder`; it runs autonomously here (decides what it can derive, parks
  only the user's own decisions as `needs-user` issue comments, several sessions in parallel).
- **Don't interrupt to ask.** Sessions keep working; a decision that truly belongs to the user goes on its issue
  with the label `needs-user` (options + recommendation) while the session carries on with the rest.
- `docs/eigene-ideen.md` stays the log of ideas Claude added on its own; `docs/engine-neubau.md` collects
  absurd-win cases until the rebuild is charted.
