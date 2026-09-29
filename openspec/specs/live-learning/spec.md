# live-learning Specification

## Purpose

Neue Gestalten, Eigenschaften und Präzedenzfälle lernt das Spiel während des Spielens – aber nur über eine Validierung, die sie zu einem normalen Content-Pack macht. Details: `src/llm/CONTEXT.md` (Invariante 5).

## Requirements

### Requirement: Lernen nur über learn()

Vorschläge von Claude SHALL nur über `learn()` / `sanitizeDelta()` in das gelernte Pack gelangen. Das Ergebnis MUST mit dem Kern kompilieren und jede gelernte Gestalt einen Mechanismus, eine Schwäche und einen Konter haben. Gelernter Inhalt MUST NOT ohne diese Validierung irgendwo gespeichert werden; der lokale Server validiert `PUT /api/learned` erneut.

#### Scenario: Ungültiger Vorschlag
- **WHEN** Claude eine Gestalt ohne Konter vorschlägt
- **THEN** wird sie nicht gelernt

### Requirement: Grenzen gelernter Eigenschaften

Neue Tags SHALL bestehende Eltern haben; gelernte Mechanismen haben einen Hebel ≤ 2; gelernte Intensitäten sind bekannte Qualitäten 0–6, Kräfte höchstens Maß + 2. Je Vorschlag MUST höchstens 3 Tags und 2 Qualitäten entstehen, und ein gelernter Tag verleiht nur Mechanismen, die ein bloßer Träger tatsächlich ausführen kann.

#### Scenario: Zu starke Kraft
- **WHEN** Claude einer Gestalt der Stufe 2 eine Kraft 6 gibt
- **THEN** wird die Kraft auf 4 begrenzt

### Requirement: Ein Ding, ein Eintrag

Eine gelernte Gestalt gleichen Namens SHALL nur wiederverwendet werden, wenn die Worte des Spielers nichts über ihren Namen hinaus sagen; weitere Worte ergeben eine eigene Gestalt.

#### Scenario: Mehr als der Name
- **WHEN** „die Bibel“ bekannt ist und jemand „zehnbeinige Bibel“ spielt
- **THEN** entsteht eine eigene Gestalt statt eines Alias

### Requirement: Ein gemeinsames Pack je Server

Online SHALL es ein gelerntes Pack je Server geben, in das alle Räume lernen; Änderungen gehen als Pack-Delta (`learned`) an alle verbundenen Clients. Öffentliche Server MUST Uploads ablehnen.

#### Scenario: Lernen in einem Raum
- **WHEN** in Raum A eine Gestalt gelernt wird
- **THEN** kennt Raum B sie beim nächsten Zug ebenfalls
