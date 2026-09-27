# Eigene Ideen

Hier steht, was ich (Claude) mir selbst ausgedacht und eingebaut habe, ohne dass es ausdrücklich gewünscht war.
Jede Idee lässt sich einzeln zurückdrehen. Unter jedem Eintrag steht, wo sie im Code lebt.

## Mystische Oberfläche (PR „feat/mystic“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Sigil statt Menüleiste** | Oben mittig schwebt ein kleines Pixel-Sigil (Ring, Dreieck, Auge). Ein Klick oder `Esc` öffnet ein Menü aus leuchtenden Worten. Sonst gibt es keine Knöpfe. Während Claude nachdenkt, pulsiert das Sigil. | `src/ui/app.ts` (`sigil()`, `toggleMenu`), `.sigil`, `.menu-*` |
| **Runden als römische Ziffern** | Statt „Runde 3 / 10“ steht nur ein blasses `III` unter dem Sigil. Die genaue Angabe liegt im Tooltip. | `roman()` |
| **Die Arena hat keinen Rahmen** | Der Rand der Arena läuft über eine CSS-Maske in die Dunkelheit aus. | `canvas.arena { mask-image }` |
| **Eine Zeile als Eingabe** | Das Eingabefeld ist nur noch eine Lichtlinie in der Farbe des aktiven Spielers. Die Frage steht als Platzhalter darin („Choronzon – gegen Ritter“), und `⏎` erscheint erst, wenn man tippt. | `.line`, `.summon-input`, `.enter-hint` |
| **Wille als Lichtfaden** | Die Wille-Leiste ist ein glühender 2-px-Faden. Ändert sich der Wille, schwebt die Differenz (`−7`, `+3`) kurz unter dem Namen und vergeht. | `renderHud`, `.hud .delta` |
| **Chronik als eigene Seite** | Die Chronik ist aus der Hauptansicht verschwunden und über das Menü erreichbar. Die Aufschlüsselung „Warum?“ bleibt darin erhalten. | `showChronicle` |
| **Aufgeben mit Sicherung** | Aufgeben steht klein am Ende des Menüs und verlangt einen zweiten Klick („Wirklich aufgeben?“). | `toggleMenu` |

## Lernen im Kern des Spiels

| Idee | Was sie tut | Wo |
|---|---|---|
| **Einfallsreichtum** | Wird jemand erfolgreich zu etwas, das das Spiel noch nie gesehen hat, gibt es +1 Eleganz. Die Engine entscheidet das deterministisch über `GameConfig.discoveryEleganz`. Ob eine Gestalt neu ist, sagt ihr die validierte Lern-Schicht, nie Claude direkt. Es zählen nur echte Entdeckungen: Claude fand keinen Lexikon-Anker, oder es mussten neue Eigenschaften oder Mechanismen entstehen. Varianten wie „großer Wolf“ zählen nicht. | `engine/game.ts` (`play(…, discovery)`), `engine/attempt.ts`, `ui/app.ts` |
| **Grimoire statt Kompendium** | Das Grimoire hat die Reiter „✦ Entdeckt“ und „Alle“. Jede entdeckte Gestalt trägt ihren Entdecker und das Datum; neue Eigenschaften werden eigens aufgelistet. | `FormSpec.discoveredBy/discoveredAt`, `learn(…, discovery)`, `showGrimoire` |
| **Erstbeschwörung** | Beim ersten Erscheinen einer Gestalt wird ihr Name golden buchstabiert. Darunter steht „✦ zum ersten Mal beschworen“ samt den neuen Eigenschaften. Goldene Funken steigen spiralförmig auf, ein Stern bleibt über ihr hängen, und ein eigenes Arpeggio erklingt. | `Arena.discover`, `.reveal-name.discovery`, `.reveal-sub` |
| **Wiederentdeckung** | Beschwört jemand später dieselbe Gestalt, steht kurz „aus dem Grimoire · entdeckt von …“ darunter. | `execute(…, {kind: "remembered"})` |
| **Entdeckungen am Ende** | Der Endbildschirm listet unter „In diesem Duell entdeckt“ alle Erstbeschwörungen dieses Duells und wer sie gemacht hat. | `showEnd` |

## Grafik und Stimmung

| Idee | Was sie tut | Wo |
|---|---|---|
| **Die Mauern fallen** | Die Eskalation wird sichtbar: Mit jeder Stufe der Mindestgröße bröckeln Ziegel aus der Rückwand. Oben fällt mehr, dazu kommt etwas Zufall. Dahinter liegt ein Sternenfeld mit Nebel, und die Sterne funkeln im Bloom. Die Säulen bleiben im Nichts stehen. | `Arena.setTier`, `wallBricks`, `paintStarfield`, `scatterStars` |
| **Augen in der Dunkelheit** | Oben in der Wand öffnen sich nach und nach Augenpaare, Zuschauer des ältesten Spiels. Ihre Zahl wächst mit der Dauer des Duells und mit den Entdeckungen. Jedes Paar blinzelt in eigenem Rhythmus und blickt zur Gestalt, die zuletzt erschienen ist. | `Arena.setWitnesses`, `drawEyes` |
| **Staub im Fackellicht** | Feine Staubkörner treiben durch die Luft. Man sieht sie nur, wo Licht auf sie fällt: an den Fackeln und an leuchtenden Gestalten. | `drawMotes` |
| **Klang** | Ein kleiner WebAudio-Synthesizer ohne Audiodateien. Er erzeugt ein Brummen beim Beschwören, Glocken bei der Enthüllung, ein Rauschen beim Schlag, einen dumpfen Einschlag, klirrendes Glas beim Scheitern, ein Arpeggio bei Entdeckungen und einen Schlussakkord. Er startet erst nach der ersten Eingabe und lässt sich im Menü stummschalten (pro Browser gemerkt). | `src/ui/sound.ts`, `Arena.onCue` |

## Erzählung

| Idee | Was sie tut | Wo |
|---|---|---|
| **Epilog** | Am Ende erzählt Claude das ganze Duell in zwei bis drei Sätzen als Legende nach. Es bekommt dafür nur die Kette der Gestalten und den feststehenden Ausgang. Ohne Claude bleibt der Satz aus den Textbausteinen stehen. | `narrateEpilogueWithClaude` |
| **Kette der Gestalten** | Der Endbildschirm zeigt alle Beschwörungen als Kette: `Ritter → Rost → …`. | `showEnd` |
