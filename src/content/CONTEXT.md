# src/content — the core content pack

One job: what exists in the game. `core/*.json`: tags, verbs, modifiers, forms, qualities, combos;
`sketches.json` = SVG sprites for things (id → svg); `symbols.json` + `items.json` = the part library for `look`
blueprints; `art-prompts.json`, `effects.json`, `rooms.json` feed the painted art (`src/render/CONTEXT.md`).

## Rules

- How tags, verbs, affordances, qualities and combos work: `src/engine/CONTEXT.md` (Ontology model). Rules reference
  tags, never concrete forms – new behaviour = new tag / parent / implication / verb here.
- A new mechanism needs `requires`; a new form gets the ability tag, not just the verb.
- Containers of fire are not fire: an oven has `hitze 3`, not the `feuer` tag.
- One entry per line (keeps diffs reviewable). Every form needs ≥ 1 mechanism and must be counterable –
  `tests/content.test.ts` enforces this.
- Balancing changes: run `npm run simulate -- --games 2000` before and after, mention the diff in the PR.
- Must scale to tens of thousands of tags/forms (`tests/scale.test.ts`).
