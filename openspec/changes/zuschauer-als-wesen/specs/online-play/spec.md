## ADDED Requirements

### Requirement: Zuschauer als Wesen in der Arena

Jeder verbundene Zuschauer eines Raums SHALL bei allen Teilnehmern als eigenes Zuschauerwesen im Hintergrund der Arena erscheinen, statt als Zähler über der Arena. Die Wesen SHALL aus einem festen Repertoire (Auge in der Felsmauer, Fledermaus, Ratte, schwebender Blitz) in fester Reihenfolge vergeben werden, sodass alle Teilnehmer bei gleicher Zuschauerzahl dieselben Wesen an denselben Plätzen sehen. Ein Wesen SHALL an einem festen Platz der Bühne bleiben, solange sein Zuschauer da ist, und MUST die Kämpfer nicht verdecken. Es SHALL höchstens 8 Wesen gleichzeitig geben. Die Wesen MUST reine Darstellung bleiben: sie ändern weder Spielzustand noch Ausgang.

#### Scenario: Ein Zuschauer kommt
- **WHEN** in einem laufenden Duell der erste Zuschauer beitritt
- **THEN** erscheint in der Arena ein Zuschauerwesen, das sich an seinen Platz setzt, und über der Arena steht kein Zuschauer-Zähler

#### Scenario: Vier Zuschauer
- **WHEN** vier Zuschauer im Raum sind
- **THEN** sitzen vier verschiedene Wesen in der Arena – Auge, Fledermaus, Ratte und Blitz

#### Scenario: Ein Zuschauer geht
- **WHEN** von drei Zuschauern einer die Verbindung trennt
- **THEN** verschwindet ein Wesen, und zwei bleiben an ihren Plätzen

#### Scenario: Sehr viele Zuschauer
- **WHEN** mehr als 8 Zuschauer im Raum sind
- **THEN** zeigt die Arena 8 Wesen

#### Scenario: Hot-Seat ohne Zuschauer
- **WHEN** zwei Spieler an einem Gerät spielen
- **THEN** erscheint kein Zuschauerwesen
