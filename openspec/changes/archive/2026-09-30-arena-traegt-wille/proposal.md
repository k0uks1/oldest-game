## Why

Wunsch des Nutzers (Diktat, geglättet): „Wenn man lange spielt, muss man immer größere Charaktere beschwören. Wenn es aber immer hin und her geht – der eine besiegt den anderen, der andere besiegt das wieder –, reduziert sich der Wille total. Dann haben beide Spieler nur noch neun Wille, müssen aber riesige Charaktere beschwören, und es ist gar nicht mehr möglich, etwas zu spielen. Das Spiel sollte sich eigentlich bis zur letzten Runde spielen lassen.“

Die Eskalation zwingt zu Größe (Stufe 7 in der letzten Runde), die Kosten bestrafen Größe überproportional (Ø Stufe 7 ≈ 19, Stufe 8 ≈ 26 Wille), die Regeneration wächst nur linear (3 … 12). Ab Runde 7 kostet jeder Pflichtzug mehr, als nachkommt. Der Selbstspiel-Bot merkt das nicht, weil er immer den billigsten Konter von unten kennt; ein Spieler, der „auf Augenhöhe“ antwortet, kommt fast nie ans Ende (Simulation: 24 von 400 Duellen ohne einen einzigen Fehlversuch, 0 von 400 mit 30 % Fehlversuchen).

## What Changes

- **„Die Arena trägt“:** Den Anteil des Preises, den die Mindeststufe der Arena jedem aufzwingt, zahlt niemand. Abgezogen wird der Grundpreis der Mindeststufe minus 1 (nie mehr als der eigene Grundpreis der Gestalt), mindestens 1 Wille bleibt. Größe über die Mindeststufe hinaus, Overkill, Mechanismen, Immunitäten kosten wie bisher; Fehlversuche kosten die Hälfte des (jetzt kleineren) Preises plus Strafe.
- Vor der ersten Eskalation (Mindeststufe 1) ändert sich nichts.
- **Wille-Maximum 40 statt 50**, damit niemand übermäßig hortet (Feinabstimmung, siehe `design.md`).

## Capabilities

### Modified Capabilities
- `engine-resolution`: Das Wille-Budget rechnet mit dem Anteil der Arena.

## Impact

- `src/engine/rules.ts` (`maxWille` 40), `src/engine/cost.ts` (`arenaShare`), `src/engine/game.ts` (`moveCost`, `evaluateForm` nutzt es).
- Tests: `tests/game.test.ts` (Anteil, später Zug bezahlbar, Schlagabtausch bis zur letzten Runde).
- Kerninvarianten unberührt: die Engine bleibt rein und deterministisch, Regeln referenzieren weiter keine Gestalten.
