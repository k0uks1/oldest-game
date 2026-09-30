## 1. Server

- [x] 1.1 `join` holt den verbindungslosen Sitz gleichen Namens zurück (neuer Token), Gastgeber und Ein-Gerät eingeschlossen
- [x] 1.2 `away` je Sitz; nach `seatFreeAfterMs` darf jeder mit Code den Sitz übernehmen
- [x] 1.3 `resume` mit `ifAway` → `seated`, wenn eine andere Verbindung den Sitz hält
- [x] 1.4 Heartbeat 15 s

## 2. Client

- [x] 2.1 `src/online/sessions.ts`: Liste in `localStorage`, Tab-Duell in `sessionStorage`, TTL und Obergrenze
- [x] 2.2 `OnlineLink` startet mit `hello` oder `resume`, merkt sich Duelle, vergisst sie nur bei `noroom` oder bewusstem Verlassen
- [x] 2.3 Start: Tab-Duell → bekanntes eingeladenes Duell → letztes offenes Duell (`ifAway`); Beitreten per Code nutzt einen bekannten Sitz
- [x] 2.4 Startdialog „Deine Duelle“

## 3. Tests & Doku

- [x] 3.1 `tests/online.test.ts`: Rückkehr per Name (Gast, Gastgeber, Ein-Gerät), noch verbunden, verwaister Sitz, `ifAway`
- [x] 3.2 `tests/sessions.test.ts`
- [x] 3.3 `server/CONTEXT.md`, Version
