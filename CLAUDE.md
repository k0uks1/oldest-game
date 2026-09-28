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
npm run sheet -- items   # sprite contact sheet PNG (items | emblems a+b,c | form ids)
npm run audit            # Prüfstand: suspicious wins in the lexicon (the engine-rebuild yardstick)
npm run art -- status    # picture store: status | ingest <png-dir> | warm [--limit N] (needs PIXELLAB_API_KEY)
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
  content/core/*.json  the core content pack (tags, verbs, modifiers, forms, qualities, combos; sketches.json = SVG sprites for
                     things, id → svg; symbols.json + items.json = the part library for `look` blueprints)
  llm/               Claude client, parser (text → Form), narrator, live learning + stores
  narrate/offline.ts template narration (debug / fallback)
  render/            sprite generation (pure) + arena in layers: ArenaSim (state + animation API, arena.ts)
                     → ArenaScene (what surrounds the fighters, drawn once through the Pen interface, scene.ts)
                     → PixiArena (WebGL, pixi-arena.ts + pixi-pen.ts) or CanvasArena (2D fallback, canvas-arena.ts);
                     createArena() picks (hardware WebGL → Pixi; ?pixi / ?canvas force);
                     stage.ts = scenery types; stage-iso.ts (default) / stage-flat.ts (?flat)
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
   New tags must have existing parents; learned mechanisms have leverage ≤ 2; learned intensities are known
   qualities 0–6, forces (`kraft`) at most scale + 2 (clamped in the parser *and* in `learn()`). Never write learned content
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
- **Affordanz** (`VerbSpec.requires {any, all, none, qualities}`): what the *attacker* must be to use a mechanism at all –
  checked against its closure, qualities only where actually set (never a default). Form verbs = (assigned ∪ granted),
  filtered by `affords()`; `lacks()` says why not („bräuchte Säure“). Abilities are tags in group `faehigkeit`
  (`scharf ⇒ zerschneidet`, `laut ⇒ uebertoent`, `tueckisch ⇒ taeuscht` …) that grant their mechanism. The parser drops
  mechanisms Claude assigns but the form cannot perform and asks once more when none are left (`abilityCorrection`).
  A new mechanism in content needs `requires`; a new form gets the ability tag, not just the verb.
- **Weakness** hit = a verb target at or above a declared weakness tag (`weak: eisen`, verb targets `metall` ✓).
- **Qualities** (`qualities.json`, levels 0–6): graded properties, `kraft` (hitze, naesse, kaelte) vs `schutz`
  (hitzefest, haerte, kaeltefest). Set on tags (most specific tag wins: `stahl` over `metall`; unrelated → max),
  shifted by combos, overridden per form (`FormSpec.qualities`); unset `kraft` falls back to its default.
- **Combos** (`combos.json`): if the closure has all `if` tags and no `unless` tag → add/remove tags, shift
  qualities (wet wood is not `brennbar`). Applied to fixpoint in `compileForm`, before grants.
- Containers of fire are not fire: an oven has `hitze 3`, not the `feuer` tag (so water finds nothing to quench).

### Resolution (`checkCounter`)

affordance (attacker can do it at all, else „kann nicht … – bräuchte …“) → surface (targets ∩ closure) → blockers / immunity → reach (`reach: "nah"` verbs miss a `fliegt` target unless the
attacker flies or is ≥ 2 steps larger) → intensity (every `needs {by, vs}`: attacker's `by` ≥ target's `vs`, surplus
≥ 2 on all → +1 "Übermacht") → scale rules (max +2 up; more than 3 down only with
mythic leverage ≥ 4) → power = scale + leverage (+2 weakness) ≥ target scale. Game layer adds: echo
(no mechanism from the last 2 moves), escalation (min scale rises every 3 moves, mythic exempt),
one use per form, Wille budget, and discovery eleganz ("Einfallsreichtum": `play(…, discovery)` –
the flag comes from validated live learning, never from Claude directly).

**Escape (`checkEscape`, pseudo-mechanism `entkommt`)**: instead of defeating, a form may get out of reach –
it needs an escape route tag (`config.escapeRoutes`: fliegt / schwimmt / graebt), the target must not have a
tag that follows along that route, at least one *physical* mechanism of the target must reach the evader, no
non-physical one may, and the target must be ≤ `maxEscapeScale`. Echo applies; defeating is preferred.

### Generated art ("Kunst auf Abruf", `render/art.ts`, `server/art-service.ts`)

Nothing is pre-generated. The first time a form appears, the server paints it with PixelLab (pixflux, side view
facing right, transparent, one fixed style recipe in `server/pixellab.ts`) and keeps it in its picture store
(`learned/art/`, next to the learned pack – the Docker volume). The store key is a hash of the **description**
and size (`artKey`), not the form: variants (the hunter in a red coat) are separate pictures, equal descriptions
share one. Descriptions: core forms `content/core/art-prompts.json`, learned forms `artPrompt` (Claude's `bild`).
Pictures carry `ART_DENSITY` (2)× the detail of the sprite slot (`artSize`); the Pixi arena renders at that
density (scene in arena pixels, fighter sprites at ½ scale), the canvas fallback at 1.
Clients ask by form id (`art` message online, `GET /api/art` for the local hot-seat) and get ready / pending /
none; pending ones are pushed (online) or polled (local). While a picture is on its way the rune circle
conjures (pentagram of runes), then flares and the form appears; after a reconnect pictures are asked again.
No server, no key or budget spent (`ART_MONTHLY_LIMIT`, persisted) → the drawn sprites below. The PixelLab key
lives only in the server environment (`PIXELLAB_API_KEY`) – never in a build, the repo or the browser.
`npm run art -- status | ingest <png-dir> | warm` inspects or pre-fills the store.

### Sprites from parts ("Bauplan", `render/look.ts`)

`Form.look` (presentation only): `holds` (item for people/giants, drawn in the item's own colours via grid
symbols `m`/`n`), `emblem` + `badge` (library symbols composed into one sketch – concepts get icons, not
freehand drawings), `main`/`second` colours. Claude picks ids from closed enums (`aussehen` in the parser);
a freehand `skizze` only when no part fits. Unknown ids are dropped (`knownLook`).

> **Planned:** a fundamental engine rebuild (derived mechanisms/affordances, several axes instead of one scale,
> context-aware modifiers). Collected absurd wins and directions: `docs/engine-neubau.md`. Add new cases there.

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
