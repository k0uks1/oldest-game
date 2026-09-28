# CLAUDE.md – The Oldest Game

Hot-seat duel of imagination for two players (inspired by the "Oldest Game" scene in *Sandman*).
Players take turns becoming something that defeats the opponent's last form. **Claude (Haiku)
classifies and narrates; a deterministic rule engine decides.** Pixel-art dungeon arena in the browser.

## Commands

```bash
npm install
npm start          # build + local server with Claude proxy (ANTHROPIC_API_KEY from .env)
npm run dev        # watch build + same server  (…/?debug = without Claude)
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
    attempt.ts       player-facing move without foreknowledge: success / failure (costs Wille) / rejected
    cost.ts          Wille cost, overkill surcharge, underdog refund, eleganz
    parse.ts         mechanical parser (DEBUG ONLY in the game; used for anchors & tests)
  content/core/*.json  the core content pack (tags, verbs, modifiers, forms; sketches.json = SVG sprites for things, id → svg)
  llm/               Claude client, parser (text → Form), narrator, live learning + stores
  narrate/offline.ts template narration (debug / fallback)
  render/            sprite generation (pure) + canvas arena (DOM, bloom, cosmos dissolve, ambience)
  ui/                hot-seat UI, no framework; sound.ts = WebAudio synth (no audio files)
  game/resolver.ts   one turn, text → classification/learning → engine → referee → narration (DOM-free)
  online/            WebSocket protocol (shared) + browser link with reconnect
server/              Claude proxy core + Node game server (local.ts) + online rooms (online.ts) + Cloudflare Worker
Dockerfile, compose.yml, Caddyfile   self-hosting (public mode: HOST=0.0.0.0 → rooms only, no browser proxy)
scripts/             build (esbuild → single HTML), simulate, gen-pack (stress data)
tests/               node:test suites incl. tests/scale.test.ts (30k tags / 50k forms)
```

### Core invariants – do not break

1. **The LLM never decides outcomes on its own.** It maps text → `Form` (closed vocabulary) and writes
   prose about an already-resolved move. Winner/validity/cost come from `src/engine`. The one
   exception is the **referee** (`src/llm/referee.ts`): only when the engine flags a failure as
   uncertain (`Failure.uncertain`, see `uncertainty()`), Claude may rule on that exact pair; the ruling
   is validated and stored as a precedent (`rulings` in the learned pack) and from then on replayed
   deterministically by the engine (`checkRuling`, scale caps still apply).
2. **Classification is independent of the opponent.** `parseWithClaude` gets only the player's
   text plus lexicon anchors, never the current target. Results are cached per text.
3. **Rules reference tags, never concrete forms.** No `if (form.id === "drache")` anywhere.
   New behaviour = new tag / parent / implication / verb in a content pack.
4. **Engine is pure.** No DOM, no `Date.now()`, no `Math.random()` in `src/engine`; use
   `hash32`/`rng` from `engine/text.ts` for seeded randomness.
5. **Live learning goes through `learn()`** (`src/llm/learning.ts`). Claude's proposals become a normal
   content pack ("gelernt") and must compile with the core, have a mechanism, a weakness and a counter.
   New tags must have existing parents; learned mechanisms have leverage ≤ 2. Never write learned content
   anywhere without this validation (the local server re-validates on `PUT /api/learned`).
6. **Scale:** content must work with tens of thousands of tags/forms. Avoid O(tags) or
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
(no mechanism from the last 2 moves), escalation (min scale rises every 3 moves, mythic exempt),
one use per form, Wille budget, and discovery eleganz ("Einfallsreichtum": `play(…, discovery)` –
the flag comes from validated live learning, never from Claude directly).

**Escape (`checkEscape`, pseudo-mechanism `entkommt`)**: instead of defeating, a form may get out of reach –
it needs an escape route tag (`config.escapeRoutes`: fliegt / schwimmt / graebt), the target must not have a
tag that follows along that route, at least one *physical* mechanism of the target must reach the evader, no
non-physical one may, and the target must be ≤ `maxEscapeScale`. Echo applies; defeating is preferred.

## UI principles

- As little as possible on screen: the arena, one glowing input line, a sigil (menu, also `Esc`).
- No preview of whether a form is enough – the arena reveals it. Rules detail only on demand ("Warum?").
- Ideas Claude added on its own are documented in `docs/eigene-ideen.md`.

## Conventions

- TypeScript strict incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`, no `!`.
- Imports use explicit `.ts` extensions. `import type` for types (`verbatimModuleSyntax`).
- UI text is German; code, identifiers and comments are English.
- Content JSON: one entry per line (keeps diffs reviewable). Every form needs ≥ 1 mechanism and must
  be counterable – `tests/content.test.ts` enforces this.
- Balancing changes: run `npm run simulate -- --games 2000` before and after, mention the diff in the PR.
- **Versions:** every PR bumps `package.json` `version` (minor for features/content, patch for pure fixes). The build
  injects it (`src/version.ts`); it is shown subtly on the start screen and in the menu (“v0.32.0”, previews add “· PR n”).
- Workflow: feature branch → PR (CI must be green: typecheck, lint, tests, build) → squash merge.
  CI posts a PR comment with the playable build; `pages.yml` deploys `main` to GitHub Pages and every PR
  to `pr-preview/pr-<n>/` (gh-pages branch).

## Online

- The server is authoritative: it holds game state and key, resolves moves with the same `Resolver`
  as the hot-seat UI and broadcasts `turn` / `narration` / `learned` (pack delta) messages
  (`src/online/protocol.ts`). Clients never resolve online moves.
- One shared learned pack per server; every room learns into it. Local `PUT /api/learned` merges into it,
  public servers refuse uploads.
- Abuse limits live in `server/online.ts` (`HubLimits`); `tests/online.test.ts` covers rooms, reconnect and limits.

## Claude integration

- Default model `claude-haiku-4-5-20251001`.
- **Preferred transport: proxy.** `server/proxy.ts` holds the key (env / `.env`), pins model and
  `max_tokens`, whitelists request fields; the client auto-detects the local server via `/api/health`.
  Hosted: same core as a Cloudflare Worker with `ACCESS_CODE`.
- Fallback for the standalone file: bring-your-own-key directly from the browser
  (`anthropic-dangerous-direct-browser-access`), key in localStorage. Never ship a build containing a key.
- The system prompt (vocabulary + mechanisms) is stable and sent with `cache_control`.
- Debug mode (`?debug` or settings) = mechanical parser + template narration, zero API calls.
