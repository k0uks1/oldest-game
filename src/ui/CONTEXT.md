# src/ui — the hot-seat page

One job: the screen. Hot-seat UI, no framework; `sound.ts` = WebAudio synth (no audio files; `wake()` resumes a context
the OS suspended, music `catchUp` rejoins the beat after a stall). UI text is German.

## UI principles

- As little as possible on screen: the arena, one glowing input line, a sigil (menu, also `Esc`).
- No preview of whether a form is enough – the arena reveals it. Rules detail only on demand ("Warum?").
- Ideas Claude added on its own are documented in `docs/eigene-ideen.md`.
