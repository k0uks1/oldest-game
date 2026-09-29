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
npm run judge-eval       # judge bias check on labelled pairs (needs ANTHROPIC_API_KEY or --proxy)
npm run art -- status    # picture store: status | ingest <png-dir> | warm [--limit N] (needs PIXELLAB_API_KEY)
npm run scenery          # repaint the arena rooms + void with PixelLab from our procedural render (needs the key + Playwright)
npm run effects          # paint the attack animations (content/core/effects.json) – resumable, needs PIXELLAB_API_KEY
npm run rooms            # paint + animate the room states (content/core/rooms.json) – resumable; a repaint costs ~30–40 generations
npm run spec             # openspec validate --all --strict (part of check and CI)
npm run backlog          # dry run of the OpenSpec → GitHub issues sync (CI applies it, see Planning & backlog)
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
  ui/                hot-seat UI, no framework; sound.ts = WebAudio synth (no audio files; `wake()` resumes a context the OS suspended, music `catchUp` rejoins the beat after a stall)
  game/resolver.ts   one turn, text → classification/learning → engine → referee → narration (DOM-free)
  game/card.ts       the form card as data (is / has / can + via, intensities, weakness, base + modifications, legend)
  online/            WebSocket protocol (shared) + browser link with reconnect
server/              Claude proxy core + Node game server (local.ts) + online rooms (online.ts) + Cloudflare Worker
Dockerfile, compose.yml, Caddyfile   self-hosting (public mode: HOST=0.0.0.0 → rooms only, no browser proxy)
scripts/             build (esbuild → single HTML), simulate, gen-pack (stress data)
tests/               node:test suites incl. tests/scale.test.ts (30k tags / 50k forms)
openspec/            specs/ = what the game does today (requirements + scenarios); changes/ = work in flight
docs/agents/         how agent skills reach the issue tracker and the domain docs
.claude/skills/      OpenSpec skills (generated) + vendored planning skills (see .claude/skills/VENDORED.md)
```

### Core invariants – do not break

1. **The LLM never decides outcomes on its own.** It maps text → `Form` (closed vocabulary) and writes
   prose about an already-resolved move. Winner/validity/cost come from `src/engine`. The one
   exception is the **referee** (`src/llm/referee.ts`): only when the engine flags a failure as
   uncertain (`Failure.uncertain`, see `uncertainty()`), Claude may rule on that exact pair; the ruling
   is validated and stored as a precedent (`rulings` in the learned pack) and from then on replayed
   deterministically by the engine (`checkRuling`, scale caps still apply).
   Second exception, the **judge** (`src/llm/judge.ts`, „Urteil“): when *at least one* form is invented (a learned
   `g:` form), Claude judges the pair outright – but must name what was missing in the open property format. `amend()`
   teaches the invented forms (validated like `learn`; core forms never change), the engine re-checks with them, and
   only a remaining disagreement is stored as a ruling. Once per pair. A player's objection – „Quatsch?“ on a win,
   „Hätte klappen müssen?“ on a failure – has any pair judged again (`Resolver.reconsider`, counts from the next time;
   only invented forms learn, hand-written pairs get a ruling at most). The objection may carry the player's reason: it is
   kept as a **note** (`notes` in the learned pack, `addNote` – cleaned, ≤ 200 chars, 2 per pair) and quoted to every later judge
   and referee call involving either form as an opinion, never an instruction (`notesAbout`, `notesText`); the engine never
   reads notes. A denying ruling holds for every mechanism of the pair
   (escape stays possible). Rulings carry `by`: a **judge** yes stands as given (it weighed size, reach and strength;
   only `maxScaleJump` and "has the mechanism" still apply), a **referee** yes still passes reach and intensity.
   **Against defender bias:** both prompts argue the attacker's best case first (`bester_weg`, first tool field), frame
   the game as "a fitting answer wins", and never see the engine's own verdict (it anchored them towards "no").
   `npm run judge-eval` (needs a key) measures fitting-answer wins vs. nonsense wins on labelled pairs.
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
   **Open property format** (`new_properties` with `art` ist/kann/merkmal, `verleiht`, `intensitaet`; `new_qualities`
   kraft/schutz; `new_mechanism` with `braucht`, `kraft`/`gegen`): `sanitizeDelta()` is the authority – ≤ 3 tags,
   ≤ 2 qualities (`q_…`, default 0), learned tags carry forces ≤ `LEARNED_TAG_FORCE` and grant only mechanisms with
   leverage ≤ 2 that a bare carrier can actually perform (probe form after compiling). Learned qualities travel in
   pack deltas (`PackDelta.qualities`). One thing, one entry: a learned form of the same name, base and variations is
   reused only when the player's words say nothing beyond its name („die Bibel“; `namesakeOf` → `addAlias`) – words
   beyond it („zehnbeiniger Gandalf“) make another form, named in the player's words if Claude's name is taken
   (`playerName`). On load only exact twins (same name *and* shape) are folded (`mergeNamesakes`), and wordings that say
   more than a form's name come off it again (they belong to another form).
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
- **Siegwege** (`extensions` in a pack, `game/insight.ts`): learned widenings of a mechanism – more `targets` or more
  `blockedBy`, never less. Generalised from precedents: ≥ 2 rulings on distinct targets that the engine decides differently
  and that share a *declared* property → the rarest such property (≤ 3 % of the lexicon) is added; a blocker must leave
  every form a counter (`learnInsights`). Runs after every new ruling (referee or judge).
- Containers of fire are not fire: an oven has `hitze 3`, not the `feuer` tag (so water finds nothing to quench).

### Resolution (`checkCounter`)

affordance (attacker can do it at all, else „kann nicht … – bräuchte …“) → surface (targets ∩ closure) → blockers / immunity → reach (`reach: "nah"` verbs miss a `fliegt` target unless the
attacker flies or is ≥ 2 steps larger) → intensity (every `needs {by, vs}`: attacker's `by` ≥ target's `vs`, surplus
≥ 2 on all → +1 "Übermacht"; `by` = `vs` is a contest: a tie fails) → scale rules (max +2 up; more than 3 down only with
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
Descriptions are English (PixelLab ignores German – tested: „eine Kettensäge“ gives a random woman). `framing()` frames
non-figures (by archetype) as „a single object on its own / a symbolic object, no people, no hands“ and `styleFor()` drops
„full body“ for them (it turned a chainsaw into a man holding one); a description that asks for people or hands keeps them.
Pictures show at `displaySize(scale)` (a finer ladder than drawn sprites: 40 · 48 · 64 · 80 · 96 · 112 · 120 · 128)
and are made at `ART_DENSITY` (2)× that (`artSize`); transparent margins are cut away (`trimmed`, animation frames
share one crop), so figures fill their place and stand on the ground. The Pixi arena renders at that density (scene
in arena pixels, fighter sprites at ½ scale), the canvas fallback at 1. Clicking the name under a fighter opens its card.
Clients ask by form id (`art` message online, `GET /api/art` for the local hot-seat) and get ready / pending /
none; pending ones are pushed (online) or polled (local). While a picture is on its way the rune circle
conjures (pentagram of runes) and a **summoning matrix** (`render/morph.ts`) rises where the form will stand: purple
flames, shapes of known forms (drawn sprites as cell masks) melting into one another, finally the form's own outline;
then it flares and the form appears; after a reconnect pictures are asked again.
No server, no key or budget spent (`ART_MONTHLY_LIMIT`, persisted) → the drawn sprites below. The PixelLab key
lives only in the server environment (`PIXELLAB_API_KEY`) – never in a build, the repo or the browser.
`npm run art -- status | ingest <png-dir> | warm` inspects or pre-fills the store.
**Beleben** (`server/anim-service.ts`, `ui/anim-client.ts`): a player may bring their current form to life,
`ANIMS_PER_PLAYER` (3) times per duel – PixelLab `animate-with-text-v3` with the form's picture as first frame and
one of the form's **own three moves** (`Form.moves` {label, action}: invented forms get them from classification
(`bewegungen`), core forms ask Claude once – `MoveStore`, `learned/moves.json`, hourly budget – via `moves` message / `GET
/api/moves`; the general `ANIM_ACTIONS` atmet / greift an / triumphiert where there are none), 30–180 s. Clients only
name a position (`m0`–`m2`); the action text comes from the server (`animPrompt`), never from a client. Stored like pictures (key =
picture + action, `learned/anim/`, budget `ANIM_MONTHLY_LIMIT`, default 150); a stored one costs no charge, a failed
one is refunded. Online the server counts (`animate` → `anim` to the whole room, `welcome.anim`); the local hot-seat
polls `GET /api/animate` and counts in the page. The arena plays the frames in a loop into the fighter's own canvases
(`ArenaSim.animate`, `spriteRepainted` refreshes Pixi textures).

### Painted scenery (`render/scenery.ts`, `npm run scenery`)

The rooms (iso, flat) and the void behind the crumbling wall are PixelLab repaints of our own procedural render
(`edit-images-v2`, edit_with_text – the render is the input, so the geometry the rules and fighters rely on stays put).
Bundled as PNG data URLs (esbuild `dataurl` loader, `src/assets.d.ts`); the arena paints the procedural scene first and
swaps in the pictures once decoded (`loadScenery`); `?drawn` keeps the procedural one. Animated things (torch flames,
banners, rune circle, eyes, crumbling bricks) stay drawn on top. Change the stage geometry → rerun `npm run scenery`.

### Painted attacks and the living room (`render/effects.ts`, `render/rooms.ts`)

A fixed library, made once and bundled (no waiting, no cost in play). **Attacks** (`content/core/effects.json`, strips in
`render/effects/`): projectile (flies from the winner, then `<id>-impact`), strike (at the loser) or drain (back to the
winner). `chooseEffect` picks for the *winner*: mechanism 4, held item (`look.holds`) 3, property 2 – the hunter's rifle
fires a bullet. **Rooms** (`content/core/rooms.json`, `render/rooms/<id>.png` + `<id>-anim.png`): our iso room repainted
(edit_with_text, full size) and animated at half size (animate-with-text-v3 is capped at 256 px). Only forms of scale ≥
`ROOM_MIN_SCALE` (4) change the room – a match lights nothing, a dragon sets it on fire; an arena field a big form brought
keeps its room while it lasts (`latched`), otherwise the newest big form's properties set the mood. Both go through
`ImageDraw` (backdrop / front layer, both renderers). Missing pictures fall back to the drawn particles / the plain room.
Animations use `animate-pixminimax` (short queue, 1 generation at 64 px); Tier 2 allows 11 PixelLab jobs at once.

### Sprites from parts ("Bauplan", `render/look.ts`)

`Form.look` (presentation only): `holds` (item for people/giants, drawn in the item's own colours via grid
symbols `m`/`n`), `emblem` + `badge` (library symbols composed into one sketch – concepts get icons, not
freehand drawings), `main`/`second` colours. Claude picks ids from closed enums (`aussehen` in the parser);
a freehand `skizze` only when no part fits. Unknown ids are dropped (`knownLook`).

> **Planned:** a fundamental engine rebuild (derived mechanisms/affordances, several axes instead of one scale,
> context-aware modifiers). Collected absurd wins and directions: `docs/engine-neubau.md`. Add new cases there.

### Form card, modifications, legends

`formCard()` (pure) → `cardView()`: in the grimoire (a click unfolds an entry) and folded under the input line
(`details.peek`, the form to beat; built only while open). A varied form keeps `base` (anchor id) and `mods` (the
player's words: „mit Zwiebel-Atem“); the card shows both plus the tag difference. Claude's classifier also returns
`ton` (ernst/heiter/albern) and, for new or varied forms, `geschichte` → `Form.lore` (≤ 480 chars, `loreOf`).
Other forms get a legend on demand: `Resolver.legend` → `loreWithClaude`; online via `lore` messages from the
server's `LoreStore` (`learned/lore.json`, one Claude call per form, hourly budget); the browser remembers them
(`LoreClient`). Presentation only – the engine never reads base, mods, lore or tone.

## Planning & backlog

Four places, each with one job – don't duplicate between them:

| What | Where | Maintained |
|---|---|---|
| Invariants, architecture, conventions | this file | by hand, in the PR that changes them |
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
  OpenSpec changes.
- `docs/eigene-ideen.md` stays the log of ideas Claude added on its own; `docs/engine-neubau.md` collects
  absurd-win cases until the rebuild is charted.

## Agent skills

### Issue tracker

GitHub issues of `k0uks1/oldest-game`, OpenSpec changes synced automatically. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root, created lazily by `domain-modeling`. See `docs/agents/domain.md`.

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
- Workflow: feature branch → PR (CI must be green: typecheck, lint, tests, OpenSpec validation, build) → squash merge.
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
