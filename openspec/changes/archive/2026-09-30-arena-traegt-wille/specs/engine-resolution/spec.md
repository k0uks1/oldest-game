## MODIFIED Requirements

### Requirement: Spielschicht

Das Spiel SHALL Echo (kein Mechanismus der letzten zwei Züge), Eskalation (Mindestmaß steigt alle drei Züge, Mythisches ausgenommen), einmalige Nutzung jeder Gestalt und das Wille-Budget durchsetzen. Den Anteil des Preises, den die Mindeststufe der Arena erzwingt (Grundpreis der Mindeststufe − 1, höchstens der eigene Grundpreis der Gestalt), SHALL niemand zahlen; ein Zug MUST mindestens 1 Wille kosten. Einfallsreichtum (Eleganz) MUST nur aus validiertem Live-Lernen kommen, nie direkt von Claude.

#### Scenario: Echo
- **WHEN** ein Spieler einen Mechanismus nutzt, der in einem der letzten beiden Züge vorkam
- **THEN** wird der Zug abgewiesen

#### Scenario: Die Arena trägt
- **WHEN** die Arena Stufe 7 verlangt und ein Spieler eine Gestalt der Stufe 7 beschwört
- **THEN** zahlt er ihren Preis ohne den Grundpreis der Stufe 7 (bis auf 1)

#### Scenario: Schlagabtausch bis zur letzten Runde
- **WHEN** beide Spieler einander immer auf mindestens gleicher Größe besiegen
- **THEN** reicht ihr Wille bis zur letzten Runde
