# server — proxy, game server, online rooms

One job: hold the keys and the authority. Claude proxy core (`proxy.ts`) + Node game server (`local.ts`) + online
rooms (`online.ts`) + Cloudflare Worker (`worker.ts`); stores next to the learned pack in `learned/` (art, anim, lore,
moves). Self-hosting: `Dockerfile`, `compose.yml`, `Caddyfile` (public mode: `HOST=0.0.0.0` → rooms only, no browser
proxy). Protocol shared with the browser: `src/online/` (WebSocket protocol + browser link with reconnect).

## Online

- The server is authoritative: it holds game state and key, resolves moves with the same `Resolver`
  as the hot-seat UI and broadcasts `turn` / `narration` / `learned` (pack delta) messages
  (`src/online/protocol.ts`). Clients never resolve online moves.
- One shared learned pack per server; every room learns into it. Local `PUT /api/learned` merges into it,
  public servers refuse uploads.
- Seats and coming back: a seat belongs to a token; `resume` with it returns. A lost token is not the end – a
  `join` under the same name takes a seat that has no connection (fresh token, the old one dies), and after
  `seatFreeAfterMs` anyone with the code may. The heartbeat (15 s) makes dead sockets count as offline within 30 s.
  The browser remembers every duel it is in (`src/online/sessions.ts`: list in `localStorage`, the tab's own in
  `sessionStorage`); a fresh tab resumes the last one with `ifAway`, so it never steals a seat from a playing tab.
- Abuse limits live in `server/online.ts` (`HubLimits`); `tests/online.test.ts` covers rooms, reconnect and limits.

## Keys

- Anthropic key: env / `.env`, only here (details: `src/llm/CONTEXT.md`, Claude integration).
- PixelLab key `PIXELLAB_API_KEY` lives only in the server environment – never in a build, the repo or the browser.
  Art, animation and lore services: `src/render/CONTEXT.md` (Generated art) and `src/game/CONTEXT.md` (legends).
