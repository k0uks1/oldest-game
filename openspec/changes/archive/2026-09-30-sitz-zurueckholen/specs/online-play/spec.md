## MODIFIED Requirements

### Requirement: Wiederverbinden

Ein Client SHALL mit Raumcode und Sitz-Token (`resume`) in einen noch offenen Raum zurückkehren und ein `welcome` mit aktuellem Zustand und Chronik erhalten. Der Browser SHALL sich jedes Duell (Raum und Token) in `localStorage` merken (3 h, mehrere Duelle) und das Duell des Tabs in `sessionStorage` – zwei Tabs sind zwei Spieler. Beim Laden SHALL der Client zuerst das Duell des Tabs, sonst das letzte nicht beendete gemerkte Duell wieder aufnehmen; Letzteres MUST NOT einem anderen Tab den Sitz wegnehmen (`resume` mit `ifAway`, Antwort `seated`).

Ohne Token SHALL ein `join` per Raumcode den Sitz des Spielers mit demselben Namen übernehmen, sobald dieser Sitz keine Verbindung mehr hat; der alte Token MUST danach ungültig sein. Ein Sitz, der `seatFreeAfterMs` (5 min) ohne Verbindung ist, SHALL von jedem mit dem Raumcode übernommen werden können. Der Server SHALL tote Verbindungen per Heartbeat binnen 30 s erkennen.

#### Scenario: Neu laden
- **WHEN** ein Spieler den Tab neu lädt, solange der Raum besteht
- **THEN** sitzt er wieder auf seinem Platz und sieht den aktuellen Zustand und die Chronik

#### Scenario: Browser geschlossen und wieder geöffnet
- **WHEN** ein Spieler den Browser schließt und das Spiel später wieder öffnet, solange der Raum besteht
- **THEN** kehrt er ohne Eingabe auf seinen Platz zurück

#### Scenario: Token verloren, Rückkehr per Code
- **WHEN** ein Spieler ohne Token (anderes Gerät, privater Modus) mit Raumcode und seinem Namen beitritt und sein Sitz keine Verbindung hat
- **THEN** sitzt er wieder auf seinem Platz, und der alte Token gilt nicht mehr

#### Scenario: Der Sitz ist noch verbunden
- **WHEN** jemand mit dem Namen eines Spielers beitritt, dessen Verbindung noch besteht
- **THEN** meldet der Server „voll“ mit dem Hinweis, es gleich noch einmal zu versuchen

#### Scenario: Niemand kommt zurück
- **WHEN** ein Sitz 5 Minuten ohne Verbindung ist und jemand mit dem Raumcode beitritt
- **THEN** übernimmt er den Sitz und spielt unter dessen Namen weiter

#### Scenario: Zweiter Tab
- **WHEN** ein Spieler in einem Tab spielt und das Spiel in einem zweiten Tab öffnet
- **THEN** bleibt der Sitz beim ersten Tab, und der zweite zeigt den Startdialog
