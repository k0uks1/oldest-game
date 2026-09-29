# claude-boundary Specification

## Purpose

Claude ordnet Text in das geschlossene Vokabular ein und erzählt – entscheidet aber nicht. Die einzigen Ausnahmen, Schiedsrichter und Urteil, sind eng begrenzt und werden zu deterministischen Präzedenzfällen. Details: `src/llm/CONTEXT.md`.

## Requirements

### Requirement: Claude entscheidet keine Ergebnisse

Sieg, Gültigkeit und Kosten SHALL aus `src/engine` kommen. Claude MUST nur Text → `Form` abbilden und über einen bereits entschiedenen Zug erzählen.

#### Scenario: Erzählung nach der Entscheidung
- **WHEN** ein Zug aufgelöst wird
- **THEN** steht das Ergebnis fest, bevor die Erzählung angefragt wird, und die Erzählung kann es nicht ändern

### Requirement: Schiedsrichter nur bei Unsicherheit

Der Schiedsrichter SHALL nur angefragt werden, wenn die Engine ein Scheitern als unsicher markiert (`Failure.uncertain`). Sein Spruch MUST validiert und als Präzedenzfall gespeichert werden und wird danach von der Engine deterministisch wiederholt; Maßstabsgrenzen gelten weiter.

#### Scenario: Sicheres Scheitern
- **WHEN** die Engine ein Scheitern nicht als unsicher markiert
- **THEN** wird kein Schiedsrichter gefragt

### Requirement: Urteil bei erfundenen Gestalten

Ist mindestens eine Gestalt erfunden (gelernte `g:`-Gestalt), SHALL Claude das Paar einmal beurteilen und dabei benennen, was fehlte. Nur erfundene Gestalten lernen dabei; Kerngestalten MUST unverändert bleiben. Ein Einspruch des Spielers („Quatsch?“ / „Hätte klappen müssen?“) lässt das Paar erneut beurteilen; seine Begründung wird als Notiz (≤ 200 Zeichen, 2 je Paar) späteren Urteilen als Meinung mitgegeben, nie als Anweisung.

#### Scenario: Einspruch mit Begründung
- **WHEN** ein Spieler einen Sieg mit „Quatsch?“ und einer Begründung beanstandet
- **THEN** wird das Paar beim nächsten Mal neu beurteilt und die Begründung als Meinung zitiert, die Engine liest sie nie

### Requirement: Gegen Verteidiger-Voreingenommenheit

Schiedsrichter- und Urteils-Prompts SHALL zuerst den besten Weg des Angreifers darlegen (`bester_weg`) und MUST NOT das Urteil der Engine sehen.

#### Scenario: Prompt ohne Engine-Urteil
- **WHEN** ein Urteil angefragt wird
- **THEN** enthält der Prompt kein Ergebnis der Engine

### Requirement: Einordnung unabhängig vom Gegner

`parseWithClaude` SHALL nur den Text des Spielers und Lexikon-Anker erhalten, nie die aktuelle Zielgestalt. Ergebnisse MUST pro Text zwischengespeichert werden.

#### Scenario: Gleicher Text gegen verschiedene Gegner
- **WHEN** derselbe Text in zwei Duellen gegen verschiedene Gestalten gespielt wird
- **THEN** ergibt er dieselbe Gestalt

### Requirement: Debug ohne Claude

Im Debug-Modus (`?debug`) SHALL das Spiel mit dem mechanischen Parser und Vorlagen-Erzählung laufen und MUST keine API-Aufrufe machen.

#### Scenario: Debug-Duell
- **WHEN** ein Duell mit `?debug` gespielt wird
- **THEN** geht keine Anfrage an Claude
