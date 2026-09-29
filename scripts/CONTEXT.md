# scripts — build and tools

One job: everything run from `npm run …`. Build (esbuild → single HTML), simulate, gen-pack (stress data), art tools,
backlog sync.

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
