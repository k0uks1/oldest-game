## 1. Repertoire und Plätze

- [ ] 1.1 `src/render/spectators.ts`: `ROSTER` (auge, fledermaus, ratte, blitz), `MAX_SPECTATORS = 8`, reine Funktion `spectatorSlots(n, perches)` → Art + Platz je Slot; Test in `tests/render.test.ts`: 4 → vier verschiedene Arten, 12 → 8 Slots, 0 → keine, gleiche Eingabe → gleiche Ausgabe
- [ ] 1.2 `StageLayout.perches` in `stage.ts`, Plätze in `stage-iso.ts` (zwei Ketten, Mauerspalten, hintere Bodenbahn, Gewölbeluft) und `stage-flat.ts`; Test: kein Platz überlappt die Kämpferflächen oder liegt außerhalb der Arena

## 2. Wesen in der Arena

- [ ] 2.1 `ArenaSim.setSpectators(n)` mit Zustand je Slot (ankommen → sitzen → gehen) und Bewegung im Update; die zufällige Ratte ruht, solange eine Zuschauer-Ratte sitzt; reduced motion → direkt am Platz; Test: `setSpectators(3)` dann `(2)` lässt Slot 2 gehen, 0 und 1 bleiben
- [ ] 2.2 Die vier Wesen in `scene.ts` über `Pen` zeichnen (Basis + Glow) – geprüft per Screenshot bei 1, 4 und 8 Zuschauern in Pixi und `?canvas`, iso und `?flat`, mit gemalter Szenerie und `?drawn`
- [ ] 2.3 `src/render/CONTEXT.md` um einen kurzen Abschnitt „Zuschauerwesen“ ergänzen (Slots, Plätze, spätere Namen)

## 3. Seite

- [ ] 3.1 `src/ui/app.ts`: `showWatchers` ruft `arena.setSpectators(n)` und setzt das `aria-label` der Arena; `els.watchers` und sein CSS entfernen, Banner bleibt; geprüft online mit einem Zuschauer-Tab (Wesen erscheint, kein „👁“ in der Krone)
- [ ] 3.2 Idee „Namen für Zuschauer“ als eigenes `enhancement`-Issue anlegen (braucht Zuschauer-Identität im `presence`), falls noch keins existiert

## 4. Abschluss

- [ ] 4.1 npm run check grün
- [ ] 4.2 Version in package.json anheben (minor für Features/Content, patch für Fixes)
