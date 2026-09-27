# CLAUDE.md – The Oldest Game

Hot-seat duel of imagination for two players (inspired by the "Oldest Game" scene in *Sandman*).
Players take turns becoming something that defeats the opponent's last form. **Claude (Haiku)
classifies and narrates; a deterministic rule engine decides.** Pixel-art dungeon arena in the browser.

## Commands

```bash
npm install
npm run dev        # watch build + http://localhost:5173  (…/?debug = without Claude)
npm run check      # typecheck + lint + tests + build – run before every PR
npm test           # node:test via tsx (tests/*.test.ts)
npm run build      # → dist/index.html (single self-contained file, opens from disk)
npm run simulate   # balancing report; add `-- --games 2000` for bot self-play
```

## Architecture

```
src/
  engine/            pure, DOM-free, deterministic – all game logic lives here
    ontology/        content packs → compiled Ontology (closures, indexes, validation)
    rules.ts         checkCounter(): the constraint check; findCounters()
    game.ts          immutable game state reducer: createGame / play / pass
    cost.ts          Wille cost, overkill surcharge, underdog refund, eleganz
    parse.ts         mechanical parser (DEBUG ONLY in the game; used for anchors & tests)
  content/core/*.json  the core content pack (tags, verbs, modifiers, forms)
  llm/               Claude client, parser (text → Form), narrator
  narrate/offline.ts template narration (debug / fallback)
  render/            sprite generation (pure) + canvas arena (DOM)
  ui/                hot-seat UI, no framework
scripts/             build (esbuild → single HTML), simulate, gen-pack (stress data)
tests/               node:test suites incl. tests/scale.test.ts (30k tags / 50k forms)
```

### Core invariants – do not break

1. **The LLM never decides outcomes.** It maps text → `Form` (closed vocabulary) and writes
   prose about an already-resolved move. Winner/validity/cost come only from `src/engine`.
2. **Classification is independent of the opponent.** `parseWithClaude` gets only the player's
   text plus lexicon anchors, never the current target. Results are cached per text.
3. **Rules reference tags, never concrete forms.** No `if (form.id === "drache")` anywhere.
   New behaviour = new tag / parent / implication / verb in a content pack.
4. **Engine is pure.** No DOM, no `Date.now()`, no `Math.random()` in `src/engine`; use
   `hash32`/`rng` from `engine/text.ts` for seeded randomness.
5. **Scale:** content must work with tens of thousands of tags/forms. Avoid O(tags) or
   O(forms) work per check/lookup; use the ontology's indexes (`usersOf`, tries, trigram index).
   `tests/scale.test.ts` guards budgets.

### Ontology model

- **Tag** `parents` = is-a (`stahl → eisen → metall → fest`), `implies` = has-property
  (`mensch ⇒ atmet, blutet, denkt …`), `grants` = mechanisms every carrier gets (`feuer ⇒ verbrennt`).
  Inheritance must be acyclic; implications may cycle.
- **Form closure** = declared tags + ancestors + implications − (`not` tags and their descendants).
- **Verb** `targets` / `blockedBy` match against the closure, so a rule on `metall` covers every metal.
- **Weakness** hit = a verb target at or above a declared weakness tag (`weak: eisen`, verb targets `metall` ✓).

### Resolution (`checkCounter`)

surface (targets ∩ closure) → blockers / immunity → scale rules (max +2 up; more than 3 down only with
mythic leverage ≥ 4) → power = scale + leverage (+2 weakness) ≥ target scale. Game layer adds: echo
(no mechanism from the last 2 moves), escalation (min scale rises every 2 rounds, mythic exempt),
one use per form, Wille budget.

## Conventions

- TypeScript strict incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`, no `!`.
- Imports use explicit `.ts` extensions. `import type` for types (`verbatimModuleSyntax`).
- UI text is German; code, identifiers and comments are English.
- Content JSON: one entry per line (keeps diffs reviewable). Every form needs ≥ 1 mechanism and must
  be counterable – `tests/content.test.ts` enforces this.
- Balancing changes: run `npm run simulate -- --games 2000` before and after, mention the diff in the PR.
- Workflow: feature branch → PR (CI must be green: typecheck, lint, tests, build) → squash merge.
  CI posts a PR comment with the playable `index.html` artifact.

## Claude integration

- Default model `claude-haiku-4-5-20251001`, called directly from the browser
  (`anthropic-dangerous-direct-browser-access`). The key lives in localStorage – **local use only,
  never deploy a build publicly with a key**.
- The system prompt (vocabulary + mechanisms) is stable and sent with `cache_control`.
- Debug mode (`?debug` or settings) = mechanical parser + template narration, zero API calls.
