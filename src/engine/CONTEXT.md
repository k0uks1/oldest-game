# src/engine — the rules, pure and deterministic

One job: decide every outcome. Content packs → compiled `Ontology`; `checkCounter()` says whether a form beats another;
the game reducer applies cost, echo and escalation. The LLM never decides here (see `src/llm/CONTEXT.md`).

## Files

- `ontology/` – content packs → compiled Ontology (closures, indexes, validation)
- `rules.ts` – `checkCounter()`: the constraint check; `findCounters()`
- `game.ts` – immutable game state reducer: `createGame` / `play` / `pass`
- `attempt.ts` – player-facing move without foreknowledge: success / failure (costs Wille) / rejected
- `cost.ts` – Wille cost, overkill surcharge, underdog refund, eleganz
- `parse.ts` – mechanical parser (DEBUG ONLY in the game; used for anchors & tests)
- `text.ts` – `hash32` / `rng` for seeded randomness

## Core invariants here (numbering as in `AGENTS.md`)

3. **Rules reference tags, never concrete forms.** No `if (form.id === "drache")` anywhere.
   New behaviour = new tag / parent / implication / verb in a content pack.
4. **Engine is pure.** No DOM, no `Date.now()`, no `Math.random()` in `src/engine`; use
   `hash32`/`rng` from `engine/text.ts` for seeded randomness.
6. **Scale:** content must work with tens of thousands of tags/forms. Avoid O(tags) or
   O(forms) work per check/lookup; use the ontology's indexes (`usersOf`, tries, trigram index).
   `tests/scale.test.ts` guards budgets.

## Ontology model

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

## Resolution (`checkCounter`)

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

> **Planned:** a fundamental engine rebuild (derived mechanisms/affordances, several axes instead of one scale,
> context-aware modifiers). Collected absurd wins and directions: `docs/engine-neubau.md`. Add new cases there.
