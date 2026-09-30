## Why

Refs #76

Ein Online-Duell endete, sobald beide Spieler 15 Minuten keine Verbindung hatten, und bei jedem Neustart oder Deploy des Servers, denn die Räume lebten nur im Speicher. Beide gleichzeitig „raustabben“ ist aber normal, und asynchrones Spielen ist das Ziel (#76).

Bericht des Nutzers: „Wenn man vom Server fliegt, beendet sich manchmal die Sitzung. Ich schätze, es passiert, wenn beide Clients vom Server disconnecten. Aber die können auch beide gerade raustabben (asynchrones Spielen ist Ziel). Der Server muss die Sitzung eigentlich offen halten können, bis sie beendet wird.“

## What Changes

- **Laufende Duelle bleiben offen**, auch ohne jede Verbindung. Nur 14 Tage ganz ohne Aktivität (`idleTtlMs`) schließen sie noch, als Schutz gegen Müll.
- **Beendete Duelle** schließen wie bisher: 15 min ohne Verbindung oder 3 h ohne Aktivität (`finishedTtlMs`).
- **Warten auf den zweiten Spieler:** 24 h statt 1 h, damit ein Link auch am nächsten Tag noch gilt.
- **Räume überleben einen Neustart:** `online-rooms.json` neben dem gelernten Paket (Docker: `/data`). Die Datei wird nach jeder Änderung gebündelt geschrieben, beim Beenden sofort, und beim Start wieder geladen. Alle Sitze warten dann auf ihre Spieler; `resume` und die Rückkehr per Name funktionieren wie gewohnt.
- `maxRooms` 200 → 1000, weil Räume jetzt länger leben.
- Der Client merkt sich Duelle 14 Tage lang statt 3 h, höchstens 12.

## Capabilities

### Modified Capabilities
- `online-play`: „Kurzlebige Räume“ wird durch „Räume leben bis zum Ende des Duells“ ersetzt; „Wiederverbinden“ nennt die neue Merkdauer.

## Impact

- `server/online.ts` (Laufzeiten, `saved()` / `restore()`, `roomsChanged`), neu `server/room-store.ts`, `server/local.ts`.
- `src/online/sessions.ts` (Merkdauer).
- Tests: `tests/online.test.ts`.
- Nicht enthalten, bleibt in #76: Benachrichtigungen, verpasste Züge animiert nachspielen, mehrere Duelle gleichzeitig offen.
