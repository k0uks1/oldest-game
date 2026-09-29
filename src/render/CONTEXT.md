# src/render — sprites and the arena

One job: show what the engine decided. Presentation only – nothing here feeds back into outcomes.

## Files

- sprite generation (pure) + arena in layers: `ArenaSim` (state + animation API, `arena.ts`)
  → `ArenaScene` (what surrounds the fighters, drawn once through the Pen interface, `scene.ts`)
  → `PixiArena` (WebGL, `pixi-arena.ts` + `pixi-pen.ts`) or `CanvasArena` (2D fallback, `canvas-arena.ts`);
  `createArena()` picks (hardware WebGL → Pixi; `?pixi` / `?canvas` force)
- `stage.ts` = scenery types; `stage-iso.ts` (default) / `stage-flat.ts` (`?flat`)
- `art.ts`, `morph.ts`, `scenery.ts`, `effects.ts`, `rooms.ts`, `look.ts` – below

## Generated art ("Kunst auf Abruf", `render/art.ts`, `server/art-service.ts`)

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

## Painted scenery (`render/scenery.ts`, `npm run scenery`)

The rooms (iso, flat) and the void behind the crumbling wall are PixelLab repaints of our own procedural render
(`edit-images-v2`, edit_with_text – the render is the input, so the geometry the rules and fighters rely on stays put).
Bundled as PNG data URLs (esbuild `dataurl` loader, `src/assets.d.ts`); the arena paints the procedural scene first and
swaps in the pictures once decoded (`loadScenery`); `?drawn` keeps the procedural one. Animated things (torch flames,
banners, rune circle, eyes, crumbling bricks) stay drawn on top. Change the stage geometry → rerun `npm run scenery`.

## Painted attacks and the living room (`render/effects.ts`, `render/rooms.ts`)

A fixed library, made once and bundled (no waiting, no cost in play). **Attacks** (`content/core/effects.json`, strips in
`render/effects/`): projectile (flies from the winner, then `<id>-impact`), strike (at the loser) or drain (back to the
winner). `chooseEffect` picks for the *winner*: mechanism 4, held item (`look.holds`) 3, property 2 – the hunter's rifle
fires a bullet. **Rooms** (`content/core/rooms.json`, `render/rooms/<id>.png` + `<id>-anim.png`): our iso room repainted
(edit_with_text, full size) and animated at half size (animate-with-text-v3 is capped at 256 px). Only forms of scale ≥
`ROOM_MIN_SCALE` (4) change the room – a match lights nothing, a dragon sets it on fire; an arena field a big form brought
keeps its room while it lasts (`latched`), otherwise the newest big form's properties set the mood. Both go through
`ImageDraw` (backdrop / front layer, both renderers). Missing pictures fall back to the drawn particles / the plain room.
Animations use `animate-pixminimax` (short queue, 1 generation at 64 px); Tier 2 allows 11 PixelLab jobs at once.

## Sprites from parts ("Bauplan", `render/look.ts`)

`Form.look` (presentation only): `holds` (item for people/giants, drawn in the item's own colours via grid
symbols `m`/`n`), `emblem` + `badge` (library symbols composed into one sketch – concepts get icons, not
freehand drawings), `main`/`second` colours. Claude picks ids from closed enums (`aussehen` in the parser);
a freehand `skizze` only when no part fits. Unknown ids are dropped (`knownLook`).

## Secret characters (`render/eichel.ts`)

Forms with `secret: true` (`content/core/forms/geheim.json`) stay out of the grimoire until this browser has seen them
summoned (`oldest-game:secrets`). Their pictures come with the game (`content/core/secret-art.json`, id → art string,
PixelLab `generate-image-v2` from a design with reference images – the Eichelober from `docs/art/eichelober-vorlage.png`
mirrored plus a Bavarian acorn, the gang from text + the Eichelober as coat of arms, then an `edit-images-v2` pass for
the acorn sack). Stored **untrimmed** at the art size (160 / 128 px) so still and animation frames share one scale.
**Their own animations** (`render/secret/<id>.png` loop, `<id>-attack.png` with the signature; square frames side by
side, `SECRET_ANIMS`; PixelLab animate-with-text-v3 / pixminimax on the picture): the loop starts at `summon`, the attack
strip loops while the signature plays (`withSecretMove`), one crop for still and strips (`secretBox`). The **Eichelober**
arrives in a shower of acorns and attacks with the
*Eichelkäseattacke* (an acorn machine gun: a stream of acorns with tracers, then one giant acorn) while he thrusts his
rapier; every acorn is drawn after the Eichel of the Bavarian cards (yellow nut up, green hatched cup and stalk); the
**Eichelober-Gang** flashes its tattoo (the Eichelober picture as ink) and fires three volleys of acorns with slingshots
(*Eichelhagel*) while the front one draws and shoots. Chosen by name (`signatureFor`, like the easter eggs) – pure show,
the engine decides as for every form. **Eichel-Arena:** the room `eichel` (`rooms.json`, `anyScale`: any form with
`kaesig`, whatever its scale, before any field) rolls in at once, and acorns and oak leaves fall while one of them stands
in the arena. Painted by `npm run rooms` from a **guide** (`guide`: the iso room with banners and the statue pasted in,
`docs/art/eichel-raum-vorlage.png`; `seed`, `animSeed` pin the chosen result); `hideBanners` fades the drawn wall banners
out so the room's yellow Eichelober banners show.
