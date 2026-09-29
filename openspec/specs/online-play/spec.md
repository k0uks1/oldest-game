# online-play Specification

## Purpose

Zwei Spieler duellieren sich über einen maßgeblichen Server; Zuschauer können zusehen. Stand heute sind Räume kurzlebig und setzen voraus, dass beide das Spiel offen haben. Details: `server/CONTEXT.md`, Protokoll in `src/online/protocol.ts`.

## Requirements

### Requirement: Der Server ist maßgeblich

Der Server SHALL den Spielzustand und den Claude-Key halten und Züge mit demselben `Resolver` wie der Hot-Seat auflösen. Clients MUST NOT Online-Züge selbst auflösen; sie erhalten `turn`, `narration` und `learned`.

#### Scenario: Ein Zug online
- **WHEN** ein Spieler online einen Zug schickt
- **THEN** löst der Server ihn auf und sendet `turn` (mit fortlaufender `seq`) und danach `narration` an alle im Raum

### Requirement: Wiederverbinden

Ein Client SHALL mit Raumcode und Sitz-Token (`resume`) in einen noch offenen Raum zurückkehren und ein `welcome` mit aktuellem Zustand und Chronik erhalten. Der Sitz-Token liegt im `sessionStorage` des Tabs – zwei Tabs sind zwei Spieler.

#### Scenario: Neu laden
- **WHEN** ein Spieler den Tab neu lädt, solange der Raum besteht
- **THEN** sitzt er wieder auf seinem Platz und sieht Zustand und Chronik, ohne dass verpasste Züge animiert nachgespielt werden

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
