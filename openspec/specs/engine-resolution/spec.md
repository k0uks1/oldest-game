# engine-resolution Specification

## Purpose

Die Regel-Engine entscheidet jeden Zug deterministisch: Sie prüft, ob eine Gestalt die vorige besiegt, und verwaltet Wille, Echo und Eskalation. Details: `src/engine/CONTEXT.md`.

## Requirements

### Requirement: Deterministische Entscheidung

Die Engine SHALL für dieselben Gestalten, denselben Spielzustand und dieselben Content-Packs immer dasselbe Ergebnis liefern. Sie MUST ohne DOM, `Date.now()` und `Math.random()` auskommen; Zufall kommt nur aus `hash32`/`rng` mit Seed.

#### Scenario: Gleicher Zug, gleiches Ergebnis
- **WHEN** derselbe Zug zweimal mit gleichem Zustand und gleichen Packs aufgelöst wird
- **THEN** sind Sieg, Kosten und Begründung beide Male identisch

### Requirement: Konter-Prüfung in fester Reihenfolge

`checkCounter` SHALL einen Angriff in dieser Reihenfolge prüfen: Affordanz des Angreifers, Angriffsfläche (Ziele ∩ Closure), Blocker und Immunität, Reichweite, Intensität, Maßstabsregeln, Kraft (Maß + Hebel, +2 bei Schwäche) gegen das Maß des Ziels. Die erste nicht erfüllte Stufe MUST als Begründung zurückkommen.

#### Scenario: Angreifer kann den Mechanismus nicht
- **WHEN** ein alter Kaugummi „zerschneidet“ nutzen soll, aber nicht `scharf` ist
- **THEN** scheitert der Zug mit „kann nicht … – bräuchte …“, bevor das Ziel geprüft wird

#### Scenario: Nahkampf gegen Fliegendes
- **WHEN** ein Mechanismus mit Reichweite „nah“ ein Ziel mit `fliegt` trifft und der Angreifer weder fliegt noch ≥ 2 Stufen größer ist
- **THEN** verfehlt der Angriff

#### Scenario: Gleichstand bei Intensität
- **WHEN** die Kraft des Angreifers (`by`) genau dem Schutz des Ziels (`vs`) entspricht
- **THEN** scheitert der Angriff (ein Gleichstand ist kein Sieg)

### Requirement: Regeln über Tags, nie über konkrete Gestalten

Regeln SHALL sich ausschließlich auf Tags, Eltern, Implikationen und Mechanismen beziehen. Code MUST NOT einzelne Gestalten per ID abfragen; neues Verhalten entsteht durch neue Content-Einträge.

#### Scenario: Neues Metall
- **WHEN** ein Pack `mithril` unter `metall` einhängt
- **THEN** trifft jeder Mechanismus, der auf `metall` zielt, auch Mithril – ohne Codeänderung

### Requirement: Spielschicht

Das Spiel SHALL Echo (kein Mechanismus der letzten zwei Züge), Eskalation (Mindestmaß steigt alle drei Züge, Mythisches ausgenommen), einmalige Nutzung jeder Gestalt und das Wille-Budget durchsetzen. Einfallsreichtum (Eleganz) MUST nur aus validiertem Live-Lernen kommen, nie direkt von Claude.

#### Scenario: Echo
- **WHEN** ein Spieler einen Mechanismus nutzt, der in einem der letzten beiden Züge vorkam
- **THEN** wird der Zug abgewiesen

### Requirement: Skalierung

Konter-Prüfung und Nachschlagen SHALL mit zehntausenden Tags und Gestalten funktionieren und MUST NOT pro Prüfung O(Tags) oder O(Gestalten) arbeiten; `tests/scale.test.ts` hält die Laufzeitbudgets.

#### Scenario: Stresstest
- **WHEN** 30.000 Tags und 50.000 Gestalten geladen sind
- **THEN** bleiben Konter-Prüfung und „Wer kontert X?“ innerhalb der Budgets des Stresstests
