# src/llm — Claude: classify, narrate, learn, judge

One job: turn player text into a `Form` (closed vocabulary), write prose about an already-resolved move, and learn new
content through validation. Client, parser (text → Form), narrator, referee, judge, live learning and stores.

## Core invariants here (numbering as in `AGENTS.md`)

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
   (`playerName`). Spelling never makes another form: a lexicon form typed by its name or a declared alias in any
   spelling („Eichel Ober“, „eichel-ober“ – `nameKey` → `Ontology.formByName`) is played without asking Claude, and a
   Claude answer whose name only differs in spelling from its base is the base. What follows a comma, colon or a spaced
   dash says how the form attacks, not what it is (`formPart`): it never enters the name. On load only exact twins (same
   name *and* shape) are folded (`mergeNamesakes`), wordings that say more than a form's name come off it again (they
   belong to another form), and a stored name that kept the attack is cut back to its form part.

## Claude integration

- Default model `claude-haiku-4-5-20251001`.
- **Preferred transport: proxy.** `server/proxy.ts` holds the key (env / `.env`), pins model and
  `max_tokens`, whitelists request fields; the client auto-detects the local server via `/api/health`.
  Hosted: same core as a Cloudflare Worker with `ACCESS_CODE`.
- Fallback for the standalone file: bring-your-own-key directly from the browser
  (`anthropic-dangerous-direct-browser-access`), key in localStorage. Never ship a build containing a key.
- The system prompt (vocabulary + mechanisms) is stable and sent with `cache_control`.
- Debug mode (`?debug` or settings) = mechanical parser + template narration, zero API calls.

Server side of the transport (proxy, Worker, stores): `server/CONTEXT.md`.
