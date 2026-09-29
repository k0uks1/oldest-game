# src/game — one turn, and the form card

One job: glue a turn together without the DOM.

## Files

- `resolver.ts` – one turn: text → classification/learning → engine → referee → narration (DOM-free).
  Used by the hot-seat UI *and* the online server.
- `card.ts` – the form card as data (is / has / can + via, intensities, weakness, base + modifications, legend)
- `insight.ts` – Siegwege (see `src/engine/CONTEXT.md`, Ontology model)

## Form card, modifications, legends

`formCard()` (pure) → `cardView()`: in the grimoire (a click unfolds an entry) and folded under the input line
(`details.peek`, the form to beat; built only while open). A varied form keeps `base` (anchor id) and `mods` (the
player's words: „mit Zwiebel-Atem“); the card shows both plus the tag difference. Claude's classifier also returns
`ton` (ernst/heiter/albern) and, for new or varied forms, `geschichte` → `Form.lore` (≤ 480 chars, `loreOf`).
Other forms get a legend on demand: `Resolver.legend` → `loreWithClaude`; online via `lore` messages from the
server's `LoreStore` (`learned/lore.json`, one Claude call per form, hourly budget); the browser remembers them
(`LoreClient`). Presentation only – the engine never reads base, mods, lore or tone.
