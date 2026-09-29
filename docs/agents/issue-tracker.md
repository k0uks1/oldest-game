# Issue tracker: GitHub

The backlog of this repo lives in **GitHub issues** of `k0uks1/oldest-game`. Read by the planning skills
(`wayfinder`, and anything that says "publish to the issue tracker").

## Two ways to reach it

- **Local session** (a developer's machine): the `gh` CLI – `gh issue create/view/list/comment/edit/close`.
- **Cloud session** (claude.ai/code): no `gh`; use the GitHub MCP tools (`mcp__github__issue_write`,
  `issue_read`, `list_issues`, `search_issues`, `add_issue_comment`, `sub_issue_write`; load them with ToolSearch).

## What is automatic – never do it by hand

- **OpenSpec changes.** Every folder under `openspec/changes/` gets exactly one issue labelled `openspec`,
  created and updated by `.github/workflows/backlog.yml` (`scripts/backlog.ts`): summary from the proposal's
  "Why", task progress from `tasks.md`, the PRs that touch it. Archiving the change on `main` closes the issue.
  A proposal that starts from an existing issue says `Issue: #<n>` under "## Why" and is attached to it.
- **Labels** `openspec`, `wayfinder:*` and `needs-user` are created by the same workflow when missing.

## What agents do while working

- **Found something that is out of scope for the current task** (bug, idea, debt, a user wish in passing):
  search first (`search_issues` / `gh issue list --search`), then open one short issue – title in German,
  body: what, where (`file:line`), why it matters. Don't fix it on the side.
- **Starting work on an issue:** non-trivial → `/opsx:propose` with `Issue: #<n>`; small fix → just the PR.
- **PR body:** `Closes #<n>` for work that finishes a plain issue, `Refs #<n>` for an OpenSpec change's issue
  (that one closes itself when the change is archived).
- **A user wish in chat that won't be done now** becomes an issue too, so it isn't lost in scrollback.
- **A decision only the user can make** (taste, product direction, cost, irreversible): comment the question with
  options and a recommendation on the issue, label it `needs-user`, and carry on with other work – don't stop the
  session to ask. Whoever sees the answer later removes the label and continues.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` / `issue_write` (method `create`).
- **Read an issue**: `gh issue view <n> --comments` / `issue_read`.
- **List issues**: `gh issue list --state open --label <l>` / `list_issues`.
- **Comment**: `gh issue comment <n> --body "..."` / `add_issue_comment`.
- **Labels**: `gh issue edit <n> --add-label "..."` / `issue_write` (method `update`, `labels`).
- **Close**: `gh issue close <n> --comment "..."` / `issue_write` (`state: closed`, always with `state_reason`).

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the issue with its comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: one issue labelled `wayfinder:map` holding Destination / Notes / Decisions so far / Not yet specified /
  Out of scope.
- **Child ticket**: a GitHub **sub-issue** of the map (`issue_write` with `parent_issue_number`, or
  `sub_issue_write`; locally `gh api` on the sub-issues endpoint). Labels `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`). Once claimed, it is assigned to the driving dev.
- **Blocking**: GitHub's native issue dependencies where the tool can reach them
  (`gh api --method POST repos/k0uks1/oldest-game/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`).
  The MCP tools have no dependency call – there, and as the fallback, put `Blocked by: #<n>, #<n>` on the first
  line of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: the map's open sub-issues without an open blocker and without an assignee; first in map
  order wins.
- **Claim**: assign the ticket first (`gh issue edit <n> --add-assignee @me` / `issue_write` `assignees`).
- **Resolve**: comment the answer, close the issue (`state_reason: completed`), append a context pointer
  (name as link + one-line gist) to the map's Decisions so far.
- **Hand-off to building**: when the map's way is clear, each buildable piece becomes an OpenSpec change
  (`/opsx:propose`, `Issue: #<ticket or map>`), which carries it on into the automatic backlog.
