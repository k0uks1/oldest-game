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

## Playing-card characters (Bavarian deck)

Figures from the German-suited cards (Eichel-Ober, and any later Ober, Unter, Sau, König of Eichel, Gras, Herz, Schellen)
always follow the **Bavarian deck's** look, not a generic fantasy one. Learned with the Eichelober (`forms/geheim.json`):

- **Suit symbols as on the cards.** Eichel = yellow nut pointing up, green cross-hatched cup below, green stalk (never
  a brown acorn with a cap on top). Keep the same symbol in every place it shows: projectiles, props, room, sprite.
- **Card-figure dress:** Renaissance costume in the suit's colours (Eichel: green and yellow, red accents), rapier,
  round shield with a cross emblem, flowing cape; the Ober rides or carries his suit symbol.
- **Game lore fits the card game:** the Eichel-Ober is the highest trump in Schafkopf (flavour, aliases, moves).
- **Secret by default:** such figures are `secret: true`, bring their own picture (`secret-art.json`) and may get a
  suit room (`rooms.json`, `anyScale`) and a signature attack (`render/eichel.ts` pattern).
- **Pictures:** painted with PixelLab from the card motif (`generate-image-v2` with the design and a Bavarian acorn
  as reference images – describe the acorn explicitly, or it comes out brown); a hand-downscaled painting looks soft.
  Animations and the suit room: see `src/render/CONTEXT.md` (Secret characters).
