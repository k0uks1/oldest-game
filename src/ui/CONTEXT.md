# src/ui — the hot-seat page

One job: the screen. Hot-seat UI, no framework. UI text is German.

**Sound** (`sound.ts`): a WebAudio synth for the magic plus a handful of real recordings for what is physical – blade,
blow, thud, page, door, bell, explosion (`ui/sfx/`: CC0 from Kenney, trimmed, normalised, mono MP3 so every browser
decodes them, bundled as data URLs and decoded with `atob`, not fetch; `<group>-<n>` are takes of one sound, played at a
slightly different speed each time). A missing or undecodable sample leaves the synth alone – never silence. New sounds:
CC0 only, keep `LICENSE-Kenney-CC0.txt` (or the new source's licence) next to them. `wake()` resumes a context the OS
suspended. **Music** (`music.ts`): three procedural pieces, one per duel by its seed (`trackFor`) – *Gewölbe* (A minor),
*Nebelsee* (D dorian: choir pad, kalimba plucks), *Schicksal* (E phrygian: low ostinato, tolling bell, toms) – layers join
as the arena escalates; all share a stone-hall reverb, a stereo ping-pong echo and a faint room tone; `catchUp` rejoins
the beat after a stall.

## UI principles

- As little as possible on screen: the arena, one glowing input line, a sigil (menu, also `Esc`).
- No preview of whether a form is enough – the arena reveals it. Rules detail only on demand ("Warum?").
- Ideas Claude added on its own are documented in `docs/eigene-ideen.md`.
