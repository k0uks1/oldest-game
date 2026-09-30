## 1. Server

- [x] 1.1 `sweep`: laufende Duelle nur nach `idleTtlMs` (14 Tage) schließen; beendete nach `abandonedTtlMs` / `finishedTtlMs`; wartende nach 24 h
- [x] 1.2 `OnlineHub.saved()` / `restore()` und Hook `roomsChanged`
- [x] 1.3 `server/room-store.ts`: `online-rooms.json` atomar schreiben, beim Start robust lesen; `local.ts` bündelt die Schreibvorgänge und schreibt beim Beenden
- [x] 1.4 `maxRooms` 1000

## 2. Client

- [x] 2.1 `SESSION_TTL_MS` 14 Tage, `MAX_SESSIONS` 12

## 3. Tests & Doku

- [x] 3.1 Tests: Duell ohne Verbindungen bleibt, beendetes wird geschlossen, `idleTtlMs`, speichern/wiederherstellen, echter Neustart
- [x] 3.2 `server/CONTEXT.md`, Spec, Version
