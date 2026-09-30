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
always follow the **Bavarian deck's** look, not a generic fantasy one. Learned with the Eichelober (`forms/spielkarten.json`):

- **Suit symbols as on the cards.** Eichel = yellow nut pointing up, green cross-hatched cup below, green stalk (never
  a brown acorn with a cap on top). Keep the same symbol in every place it shows: projectiles, props, room, sprite.
- **Card-figure dress:** Renaissance costume in the suit's colours (Eichel: green and yellow, red accents), rapier,
  round shield with a cross emblem, flowing cape; the Ober rides or carries his suit symbol.
- **Game lore fits the card game:** the Eichel-Ober is the highest trump in Schafkopf (flavour, aliases, moves).
- **A standard comes with the game:** such figures are ordinary lexicon forms (in the grimoire from the start) that
  bring their own picture (`form-art.json`, id → art string), may bring animations (`render/form-anims/`), a suit room
  (`rooms.json`, `anyScale`) and a signature attack (`render/eichel.ts` pattern).
- **Pictures:** painted with PixelLab from the card motif (`generate-image-v2` with the design and a Bavarian acorn
  as reference images – describe the acorn explicitly, or it comes out brown); a hand-downscaled painting looks soft.
  Animations and the suit room: see `src/render/CONTEXT.md` (Standard pictures and animations).

## Original characters (`forms/charaktere.json`)

Figures with their own personality, built like the Eichel figures (standard picture, own animations, signature, room):

- **Johnny Gnadenlos** – the singing plush cactus (after the dancing-cactus toy, as a cowboy: hat, red bandana).
  Claims to know thirty songs, always sings the same five classics (`render/johnny.ts`, public-domain songs only),
  and parrots whatever is said to him in a squeaky voice. His mechanisms `nervt`, `stellt_zur_schau`,
  `zieht_ins_laecherliche`, `aefft_nach` (label „spiegelt“) all act on the tag **`woertlich`** – anything spoken or sung
  (Wort, Witz, Lüge, Fluch, Wiegenlied, Echo, Passwort, Versprechen, Papagei, Sirene). A new speech-like form gets `woertlich`.
  **Wortgewaltige** (`wortgewaltig`, is-a `woertlich`: people who live by words – Politiker, Priester, Dichter, Anwalt,
  Lehrerin, **Martin Luther**) are his favourite prey: he repeats their theses in a squeaky voice and ridicules them.
  Luther's weakness is `wortgewaltig` itself, so against him the engine picks „zieht ins Lächerliche“ by itself.
  Weakness `hoert`: whoever is louder (`uebertoent`) drowns him out.
- **Kaktusarena:** the room `kaktus` (`anyScale`, tag `kaktusartig` – any cactus, also the plain one) turns the dungeon
  into a Wild West desert arena. Picture: PixelLab `generate-image-v2` with a photo of the toy as reference and the
  Eichelober gang as style image; animations `animate-with-text-v3` on it (dance loop, singing for the attack).
