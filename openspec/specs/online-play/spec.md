# online-play Specification

## Purpose

Zwei Spieler duellieren sich über einen maßgeblichen Server; Zuschauer können zusehen. Stand heute sind Räume kurzlebig und setzen voraus, dass beide das Spiel offen haben (asynchrones Spiel: Issue #76). Details: `server/CONTEXT.md`, Protokoll in `src/online/protocol.ts`.

## Requirements

### Requirement: Der Server ist maßgeblich

Der Server SHALL den Spielzustand und den Claude-Key halten und Züge mit demselben `Resolver` wie der Hot-Seat auflösen. Clients MUST NOT Online-Züge selbst auflösen; sie erhalten `turn`, `narration` und `learned`.

#### Scenario: Ein Zug online
- **WHEN** ein Spieler online einen Zug schickt
- **THEN** löst der Server ihn auf und sendet `turn` (mit fortlaufender `seq`) und danach `narration` an alle im Raum

### Requirement: Wiederverbinden

Ein Client SHALL mit Raumcode und Sitz-Token (`resume`) in einen noch offenen Raum zurückkehren und ein `welcome` mit aktuellem Zustand und Chronik erhalten. Der Browser SHALL sich jedes Duell (Raum und Token) in `localStorage` merken (3 h, mehrere Duelle) und das Duell des Tabs in `sessionStorage` – zwei Tabs sind zwei Spieler. Beim Laden SHALL der Client zuerst das Duell des Tabs, sonst das letzte nicht beendete gemerkte Duell wieder aufnehmen; Letzteres MUST NOT einem anderen Tab den Sitz wegnehmen (`resume` mit `ifAway`, Antwort `seated`).

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

### Requirement: Kurzlebige Räume

Räume SHALL nur im Speicher des Servers leben. Ein Raum MUST geschlossen werden, wenn niemand beitritt (1 h), er ohne Aktivität ist (3 h) oder keine Verbindung mehr hat (15 min).

#### Scenario: Alle Tabs zu
- **WHEN** beide Spieler das Spiel 15 Minuten lang geschlossen haben
- **THEN** ist der Raum weg und `resume` meldet „Diesen Raum gibt es nicht mehr.“

### Requirement: Missbrauchsgrenzen

Der Server SHALL Grenzen für Räume, Verbindungen je IP, Nachrichten-Bursts, Abstand zwischen Zügen und Claude-Züge je Stunde durchsetzen (`HubLimits`); `tests/online.test.ts` deckt sie ab.

#### Scenario: Zu schnelle Züge
- **WHEN** ein Client schneller als der Mindestabstand zieht
- **THEN** wird der Zug abgewiesen

### Requirement: Zuschauen

Zuschauer SHALL einem Raum beitreten und alle Züge sehen können, MUST aber keinen Sitz belegen.

#### Scenario: Zuschauer im vollen Raum
- **WHEN** ein Zuschauer einem Raum mit zwei Spielern beitritt
- **THEN** sieht er das Duell, und beide Sitze bleiben bei den Spielern
