# The Oldest Game

Hot-seat and online duel of imagination (after the "Oldest Game" in *Sandman*): players take turns becoming something
that defeats the opponent's last form. **Claude classifies and narrates; a deterministic rule engine decides.**
Pixel-art dungeon arena in the browser.

This file only routes. Content lives in the `CONTEXT.md` of the folder it is about – open it before working there.

## Where things live

| Folder | What it holds |
|---|---|
| `src/engine/` | the rules: ontology, `checkCounter`, game reducer, cost – pure and deterministic |
| `src/content/` | the core content pack (tags, verbs, forms, qualities, combos, art/effect/room lists) |
| `src/llm/` | Claude: classification, narration, referee, judge, live learning |
| `src/game/` | one turn (`resolver.ts`) and the form card |
| `src/render/` | sprites, arena (Pixi / canvas), painted art, effects, rooms |
| `src/ui/` · `src/online/` · `src/narrate/` | the page · WebSocket protocol + link · template narration (debug) |
| `server/` | Claude proxy, local + online server, stores, Worker, self-hosting |
| `scripts/` | build and every `npm run` tool |
| `tests/` | node:test suites (`scale.test.ts`: 30k tags / 50k forms, guards budgets) |
| `.claude/skills/` | OpenSpec skills (generated) + vendored planning skills (`VENDORED.md`) |
| `openspec/` | `specs/` what the game does · `changes/` work in flight |
| `docs/` | `architektur.md` overview (German) · `eigene-ideen.md` Claude's own ideas · `engine-neubau.md` rebuild cases · `agents/` planning, issue tracker, domain docs |

## Route by task

| If you are … | Open first |
|---|---|
| changing rules, ontology, resolution, cost | `src/engine/CONTEXT.md` |
| adding or balancing content | `src/content/CONTEXT.md`, then `src/engine/CONTEXT.md` (Ontology model) |
| touching prompts, parser, learning, referee, judge | `src/llm/CONTEXT.md` |
| working on a turn, the card, legends | `src/game/CONTEXT.md` |
| working on arena, sprites, painted art | `src/render/CONTEXT.md` |
| working on the page, sound, menus | `src/ui/CONTEXT.md` |
| online play, proxy, keys, deployment | `server/CONTEXT.md` |
| looking for a command | `scripts/CONTEXT.md` |
| planning a feature, the backlog, a question for the user | `docs/agents/planning.md` |
| collecting an absurd win | `docs/engine-neubau.md` |

## Core invariants – do not break (full text in the linked file)

1. The LLM never decides outcomes on its own – only referee and judge, validated, stored as precedent. → `src/llm/`
2. Classification is independent of the opponent. → `src/llm/`
3. Rules reference tags, never concrete forms. → `src/engine/`
4. The engine is pure (no DOM, `Date.now()`, `Math.random()`). → `src/engine/`
5. Live learning goes through `learn()` and its validation. → `src/llm/`
6. Scale: no O(tags)/O(forms) work per check; `tests/scale.test.ts`. → `src/engine/`

## Conventions

- TypeScript strict incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`, no `!`.
  Imports with explicit `.ts`; `import type` for types (`verbatimModuleSyntax`).
- UI text is German; code, identifiers and comments are English.
- `npm run check` before every PR (typecheck, lint, tests, build, secret scan, OpenSpec validation).
- **Versions:** every PR bumps `package.json` `version` (minor for features/content, patch for fixes); the build injects it
  (`src/version.ts`), shown on the start screen and in the menu (previews add „· PR n“).
- Workflow: feature branch → PR (CI green) → squash merge. CI comments a playable build; `pages.yml` deploys `main`
  and every PR to `pr-preview/pr-<n>/`
  (gh-pages branch).
- Ideas Claude adds on its own go into `docs/eigene-ideen.md`.
- **Work autonomously.** Ask only when the user explicitly wants feedback or leaves a point open for them;
  otherwise decide, record the reasoning (issue, PR, `design.md`) and carry on (`docs/agents/planning.md`).

## Agent skills

### Issue tracker

GitHub issues of `k0uks1/oldest-game`, OpenSpec changes synced automatically. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root, created lazily by `domain-modeling`. See `docs/agents/domain.md`.
