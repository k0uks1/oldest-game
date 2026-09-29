## Context

Heute zählt der Server Zuschauer (`server/online.ts`, `watcherCount`, Grenze `watchersPerRoom` 20) und schickt die Zahl
in `welcome.watchers` und `presence.watchers` (`src/online/protocol.ts`). Die Seite zeigt sie als „👁 n“ in der Krone
(`src/ui/app.ts`, `showWatchers`, `els.watchers`) und blendet beim Zuwachs ein Banner ein. Unabhängig davon hat die Arena
schon Hintergrundleben: Augenpaare in der Dunkelheit, deren Zahl mit dem Duell wächst (`setWitnesses`, nicht mit
Zuschauern verknüpft), vorbeiziehende Fledermäuse und eine Ratte (`updateCritters` in `arena.ts`, `drawCritters` in
`scene.ts`, nur wo `stage.critters`), Ketten an der Wand (`CHAINS` in `stage-iso.ts`). Alles wird über die
`Pen`-Schnittstelle gezeichnet und läuft damit in Pixi und Canvas.

## Goals / Non-Goals

**Goals:**
- Zuschauer sind in der Arena als Wesen sichtbar – bleibend und dadurch unterscheidbar vom zufälligen Hintergrundleben.
- Bei gleicher Zuschauerzahl sehen alle Teilnehmer dieselben Wesen an denselben Plätzen.
- Platz für spätere Namen lassen, ohne sie jetzt zu bauen.

**Non-Goals:**
- Namen, Auswahl des eigenen Wesens, Reaktionen (Jubeln) von Zuschauern – je eigenes Issue, wenn gewünscht.
- Protokoll- oder Serveränderungen.
- Gemalte (PixelLab-)Bilder für die Wesen.

## Decisions

1. **Die Zahl bleibt, die Wesen werden deterministisch aus Slots abgeleitet.** Slot `i` (0-basiert) bekommt die Art
   `ROSTER[i % 4]` und den Platz `perches[art][floor(i / 4)]`. Jeder Client rechnet dasselbe aus der Zahl.
   *Alternative:* der Server vergibt je Zuschauer eine Kennung und Art im `presence` – nötig erst für Namen; dann wird
   aus der Zahl eine Liste, und die Slot-Logik bleibt (Slot = Beitrittsreihenfolge). Deshalb schon jetzt die Vergabe
   als reine Funktion `spectatorSlots(n, perches)` in einem eigenen Modul (`render/spectators.ts`).
   *Folge heute:* geht ein Zuschauer, verschwindet das Wesen mit dem höchsten Slot – nicht zwingend „seins“. Ohne
   Namen sieht das niemand.
2. **Repertoire und Verhalten** (Reihenfolge = Reihenfolge im Wunsch des Nutzers):
   - *Auge* – öffnet sich in der Felsmauer (ein einzelnes größeres Auge, deutlich anders als die Augenpaare der
     Dunkelheit), schaut umher, zwinkert, blickt meist zum zuletzt angekommenen Kämpfer (`lookSide()` wie `drawEyes`).
   - *Fledermaus* – fliegt von der Seite herein, hängt sich kopfüber an eine Kette, faltet die Flügel, flattert ab und zu.
   - *Ratte* – rennt hinten über das Feld, setzt sich an ihren Platz, putzt sich / schnuppert.
   - *Blitz* – schwebende, knisternde Kugel (Irrlicht), die an ihrem Platz auf und ab driftet und leuchtet (Glow-Pen).
   Pixelmuster wie `BAT_UP` / `RAT` in `scene.ts`, gezeichnet über `Pen` (beide Renderer).
3. **Sitzplätze kommen von der Bühne**: neues optionales Feld `StageLayout.perches` je Art, außerhalb der Kämpferflächen
   (iso: Mauerspalten, die zwei `CHAINS`, Bodenstreifen an der hinteren Wand um die heutige Rattenbahn x ≥ 262,
   Luft unter dem Gewölbe; flach: entsprechende Stellen der flachen Wand). Je Art 2 Plätze → höchstens 8 Wesen
   (`MAX_SPECTATORS = 8`, weit unter der Servergrenze 20 – mehr Wesen würden die Szene überladen). Bühnen ohne
   `perches` zeigen keine Wesen.
4. **Ankunft und Abgang** als kleine Zustandsmaschine je Slot in `ArenaSim` (`arriving → settled → leaving`); neue API
   `setSpectators(n)`. `prefers-reduced-motion`: Wesen erscheinen direkt am Platz und bleiben ruhig.
5. **Das zufällige Hintergrundleben bleibt.** Vorbeiziehende Fledermäuse/Ratte und die Augenpaare der Dunkelheit
   (Duell-Länge) bleiben unverändert; Zuschauerwesen unterscheiden sich dadurch, dass sie bleiben. Solange eine
   Zuschauer-Ratte sitzt, startet die zufällige Ratte nicht (zwei Ratten auf einer Bahn wirken wie ein Fehler).
6. **Krone**: `els.watchers` und sein CSS entfallen; das Banner bleibt. Für Screenreader bekommt die Arena ein
   `aria-label` mit der Zuschauerzahl („2 Zuschauer“), damit die Information nicht nur als Bild existiert.

## Risks / Trade-offs

- [Wesen lenken vom Duell ab] → klein (≈ 10 px), gedämpfte Farben, nur hinten/am Rand, im Sitzen keine hektische Bewegung.
- [Die Iso-Szenerie ist gemalt (`npm run scenery`), Plätze passen evtl. nicht zum Bild] → Plätze an Geometrie hängen,
  die das Repaint erhält (Ketten, Mauer); Sichtprüfung mit gemalter Szenerie und mit `?drawn`.
- [Die Mauer zerfällt mit der Eskalation, das Auge säße in einer weggebrochenen Stelle] → Auge-Plätze in den
  `KEEP`-Bereichen wählen oder das Auge mit der Mauer ins Nichts blicken lassen; beim Bauen entscheiden, im PR notieren.
- [Beim Abgang verschwindet das „falsche“ Wesen] → bewusst in Kauf genommen, bis Namen kommen (Decision 1).

## Open Questions

- Genaue Pixelmuster und Farben der vier Wesen – beim Bauen festlegen; ändert weder Spec noch Aufgaben.
