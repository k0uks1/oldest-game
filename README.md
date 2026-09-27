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

**Sofort im Browser:** https://k0uks1.github.io/oldest-game/ (Stand von `main`; jeder PR hat eine eigene Vorschau-URL im PR-Kommentar).
Dort eigenen Claude-API-Key eintragen oder `?debug` anhängen.

**Empfohlen – lokaler Server, Key bleibt auf deinem Rechner:**
```bash
npm install
cp .env.example .env     # ANTHROPIC_API_KEY=… eintragen
npm start                # → http://localhost:5173
```
Der Server liefert das Spiel aus und leitet Claude-Aufrufe über `/api/claude` weiter. Der Browser sieht den
API-Key nie; Modell und `max_tokens` legt der Server fest.

**Ohne Server:** die einzelne `index.html` (aus dem PR-Kommentar/CI-Artefakt oder `npm run build`) direkt öffnen
und einen eigenen API-Key eintragen („bring your own key“, bleibt in deinem Browser). `index.html?debug` spielt
ganz ohne Claude (mechanischer Debug-Modus).

**Gehostet (optional):** Spiel statisch hosten (z. B. GitHub Pages) + `server/worker.ts` als Cloudflare Worker
mit dem Key als Secret und einem Zugangscode; die Worker-URL in den Claude-Einstellungen eintragen.

## Das Spiel lernt dazu

Wird jemand zu etwas, das das Spiel noch nicht kennt („ein stinkender Käse“), ordnet Claude es ein – und darf
dabei sparsam **neues Vokabular** vorschlagen: eine neue Eigenschaft (immer unter bestehende Kategorien
eingeordnet, z. B. `Käse ⊂ fest, impliziert brennbar`) oder einen neuen Mechanismus (kleiner Hebel).
Durch die Taxonomie erbt Neues sofort die Regeln seiner Eltern – Feuer verbrennt den Käse, ohne dass jemand eine
Regel schreiben musste. Alles Gelernte wird wie handgeschriebener Content validiert (muss angreifen können,
braucht eine Schwäche, muss konterbar sein) und landet im Kompendium (✦).

Gespeichert wird lokal mit `npm start` in `learned/pack.json` – reviewbar und per PR in den Grundstock
übernehmbar – bzw. auf GitHub Pages im Browser (Export im Kompendium).

## Regeln in Kürze

| Regel | |
|---|---|
| Eröffnung | Spieler 1 beginnt mit Stufe ≤ 3 |
| Konter | Gestalt + Mechanismus; das Ziel braucht eine passende Angriffsfläche |
| Ungewissheit | Du siehst vorher nicht, ob es reicht. Scheitern kostet den Preis der Gestalt + 3 Wille, du versuchst es erneut |
| Kraft | Stufe + Hebel des Mechanismus (+2 bei Schwäche) ≥ Stufe des Ziels |
| Maß | höchstens 2 Stufen über max(Ziel, Mindeststufe); mehr als 3 kleiner nur mit mythischem Hebel (Hoffnung, wahre Namen …) |
| Wille | Start 20, max 40, Regeneration wächst jede Runde; Größe ist teuer, Overkill kostet extra |
| Eleganz | Siege von unten bringen Punkte und Wille zurück; die Eröffnung ist gratis und bringt 2 Eleganz |
| Eskalation | alle 3 Züge steigt die Mindeststufe (ungerade Periode: beide Spieler trifft es abwechselnd zuerst) |
| Echo | ein Mechanismus der letzten 2 Züge ist gesperrt; jede Gestalt nur einmal |
| Ende | wer aufgibt, verliert; nach 10 Runden entscheidet die Eleganz |

## Architektur

Siehe [`CLAUDE.md`](CLAUDE.md) und [`docs/architektur.md`](docs/architektur.md). Kurz: Inhalte sind
JSON-Packs mit einer Taxonomie (Vererbung + Implikationen), die zu einer indizierten Ontologie kompiliert
werden. Das skaliert auf zehntausende Eigenschaften und Gestalten (siehe `tests/scale.test.ts`).
