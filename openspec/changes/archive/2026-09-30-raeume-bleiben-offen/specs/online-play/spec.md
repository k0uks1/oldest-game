## ADDED Requirements

### Requirement: Räume leben bis zum Ende des Duells

Ein Raum mit laufendem Duell SHALL offen bleiben, auch wenn kein Spieler verbunden ist, und MUST einen Neustart des Servers überstehen (gespeichert in `online-rooms.json` neben dem gelernten Paket). Nur ein laufendes Duell ganz ohne Aktivität für 14 Tage SHALL geschlossen werden. Ein beendetes Duell SHALL nach 15 min ohne Verbindung oder 3 h ohne Aktivität geschlossen werden, ein Raum ohne zweiten Spieler nach 24 h.

#### Scenario: Beide tabben raus
- **WHEN** beide Spieler eines laufenden Duells einen Tag lang keine Verbindung haben
- **THEN** besteht der Raum weiter, und `resume` bringt jeden auf seinen Platz mit dem aktuellen Zustand

#### Scenario: Server-Neustart
- **WHEN** der Server während eines laufenden Duells neu startet
- **THEN** ist der Raum danach wieder da, und die Spieler kehren per `resume` oder per Name zurück

#### Scenario: Beendetes Duell
- **WHEN** ein Duell beendet ist und 15 Minuten niemand verbunden ist
- **THEN** ist der Raum weg und `resume` meldet „Diesen Raum gibt es nicht mehr.“

## REMOVED Requirements

### Requirement: Kurzlebige Räume

**Reason**: Laufende Duelle endeten, sobald beide Spieler 15 min offline waren oder der Server neu startete. Das verträgt sich nicht mit Raustabben und asynchronem Spiel.
**Migration**: Ersetzt durch „Räume leben bis zum Ende des Duells“.

## MODIFIED Requirements

### Requirement: Wiederverbinden

Ein Client SHALL mit Raumcode und Sitz-Token (`resume`) in einen noch offenen Raum zurückkehren und ein `welcome` mit aktuellem Zustand und Chronik erhalten. Der Browser SHALL sich jedes Duell (Raum und Token) in `localStorage` merken (14 Tage, mehrere Duelle) und das Duell des Tabs in `sessionStorage` – zwei Tabs sind zwei Spieler. Beim Laden SHALL der Client zuerst das Duell des Tabs, sonst das letzte nicht beendete gemerkte Duell wieder aufnehmen; Letzteres MUST NOT einem anderen Tab den Sitz wegnehmen (`resume` mit `ifAway`, Antwort `seated`).

`welcome` und `start` SHALL die `seq` des letzten Zugs tragen, den ihr Zustand enthält. Der Client SHALL beim Übernehmen eines solchen Zustands Züge bis zu dieser `seq` nicht erneut abspielen, auf eine mit der Verbindung verlorene `narration` nicht länger warten und die Arena erst nach einer noch laufenden Animation auf den Zustand setzen (`src/online/playback.ts`); ein Fehler in einer Animation MUST NOT spätere Züge aufhalten.

Ohne Token SHALL ein `join` per Raumcode den Sitz des Spielers mit demselben Namen übernehmen, sobald dieser Sitz keine Verbindung mehr hat; der alte Token MUST danach ungültig sein. Ein Sitz, der `seatFreeAfterMs` (5 min) ohne Verbindung ist, SHALL von jedem mit dem Raumcode übernommen werden können. Der Server SHALL tote Verbindungen per Heartbeat binnen 30 s erkennen.

#### Scenario: Neu laden
- **WHEN** ein Spieler den Tab neu lädt, solange der Raum besteht
- **THEN** sitzt er wieder auf seinem Platz und sieht den aktuellen Zustand und die Chronik

#### Scenario: Aus der App getappt und zurück
- **WHEN** ein Spieler direkt nach einem Zug aus dem Browser tappt, die Verbindung vor der `narration` abreißt und er zurückkehrt
- **THEN** zeigt die Arena die stehende Gestalt, und jede weitere Gestalt – eigene wie gegnerische – erscheint wieder

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
