# The Oldest Game

> *„Ich bin ein Wolf.“ – „Ich bin ein Jäger.“ – … – „Ich bin Anti-Leben, das Biest des Gerichts.“ – „Ich bin Hoffnung.“*

Ein Duell der Vorstellungskraft für **zwei Spieler an einem Gerät**, inspiriert von der Szene aus *Sandman*,
in der Morpheus in der Hölle das älteste Spiel spielt. Abwechselnd wird jeder zu etwas, das die letzte
Gestalt des Gegners besiegt – bis einer keine Antwort mehr findet.

- **Freie Eingabe:** „Rost, der sich durch die Rüstung frisst“, „gläserner Riesendrache“, „Hoffnung“.
- **Claude (Haiku)** übersetzt die Idee in Eigenschaften und Mechanismen und erzählt jeden Zug.
- **Eine deterministische Regel-Engine entscheidet** – nachvollziehbar Schritt für Schritt
  (Angriffsfläche → Blocker → Stufenregeln → Kraft).
- **Clever schlägt groß:** Größe kostet Wille, Overkill kostet extra, Siege von unten bringen Eleganz.
- **Pixel-Dungeon-Arena** mit prozedural erzeugten Sprites für jede Gestalt.

## Spielen

1. Den neuesten Build aus einem PR-Kommentar oder dem CI-Lauf herunterladen (`index.html`) – oder selbst bauen:
   ```bash
   npm install
   npm run build        # → dist/index.html, direkt im Browser öffnen
   npm run dev          # Entwicklung mit Watch: http://localhost:5173
   ```
2. Claude-API-Key eintragen (bleibt lokal im Browser). Ohne Key: `index.html?debug` (mechanischer Debug-Modus).

## Regeln in Kürze

| Regel | |
|---|---|
| Eröffnung | Spieler 1 beginnt mit Stufe ≤ 3 |
| Konter | Gestalt + Mechanismus; das Ziel braucht eine passende Angriffsfläche |
| Kraft | Stufe + Hebel des Mechanismus (+2 bei Schwäche) ≥ Stufe des Ziels |
| Maß | höchstens 2 Stufen größer; mehr als 3 kleiner nur mit mythischem Hebel (Hoffnung, wahre Namen …) |
| Wille | Start 20, max 30, Regeneration wächst mit den Runden; Größe ist teuer, Overkill kostet extra |
| Eleganz | Siege von unten bringen Punkte und Wille zurück |
| Eskalation | alle 2 Runden steigt die Mindeststufe |
| Echo | ein Mechanismus der letzten 2 Züge ist gesperrt; jede Gestalt nur einmal |
| Ende | wer aufgibt, verliert; nach 10 Runden entscheidet die Eleganz |

## Architektur

Siehe [`CLAUDE.md`](CLAUDE.md) und [`docs/architektur.md`](docs/architektur.md). Kurz: Inhalte sind
JSON-Packs mit einer Taxonomie (Vererbung + Implikationen), die zu einer indizierten Ontologie kompiliert
werden. Das skaliert auf zehntausende Eigenschaften und Gestalten (siehe `tests/scale.test.ts`).
