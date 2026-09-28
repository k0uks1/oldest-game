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

## Figuren (PR „feat/sprites“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Volumen statt Rauschen** | Jede Silhouette bekommt über ein Distanzfeld eine Kuppelform und wird von oben links beleuchtet. Das Rauschen ist zurückgenommen; nur raue Materialien wie Stein, Erde, Holz, Knochen und Pflanzen bleiben körnig. Wo zwei Flächen aufeinandertreffen, entsteht eine Falte (Gürtel, Rüstungsplatten). Die Kontur ist selektiv: auf der Lichtseite in der dunkelsten Farbe der Gestalt, im Schatten fast schwarz. | `renderGrid` in `src/render/sprite.ts` |
| **Detailfiguren 32×32** | Menschen, Tiere, Vögel, Schlangen, Drachen und Riesen haben eigene, doppelt so feine Grundfiguren. | `FIGURES` in `src/render/figures.ts` |
| **Gewandung nach Eigenschaften** | Die Kleidung ergibt sich aus den Tags, nie aus der Form-ID. Dadurch wird auch ein gelernter „Hofmagier“ oder „Tempelritter“ passend angezogen. | `ATTIRE`, `dress()` |
| **Stoff hat eine eigene Farbe** | Menschen ohne zweites Material tragen eine gedeckte Stofffarbe, die pro Gestalt fest gewählt wird. Tiere bekommen stattdessen einen helleren Bauch; Grün aus der Ebenen-Palette gibt es dafür nicht mehr. | `CLOTH`, `lighter()` in `src/render/palette.ts` |

Welche Tags welche Gewandung auslösen:

| Gewandung | Ausgelöst durch |
|---|---|
| Rüstung mit Visier (und Federbusch, wenn stolz) | gepanzert |
| Robe, Spitzhut und Stab | magisch |
| Kapuze mit glimmenden Augen | schatten |
| Krone | stolz + geordnet |
| Hörner und Schwanz | dämonisch |
| Heiligenschein | heilig |
| Flügel | fliegt, bei Nicht-Vögeln |
| Klinge | Metall, bei Menschen |

## Engine

| Idee | Was sie tut | Wo |
|---|---|---|
| **Entkommen** (Wunsch des Nutzers: „Kolibri fliegt der Lavawelle davon“) | Statt zu besiegen, darf man ausweichen – fliegend, tauchend oder grabend. Wer folgen kann, macht diesen Weg zu: Flieger, Blitz, Licht, Gas, Schwärme und Seuchen erreichen Flieger; Flüssiges und Blitz erreichen Taucher; Erde und Flüssiges erreichen Grabende. Nur körperliche Angriffe (Gewalt, Element, Leben) lassen sich so umgehen, denn Gesang, Flüche und Schrecken reichen überallhin. Vor Welten und Kosmischem gibt es kein Entkommen. Ein Entkommen bringt 1 Eleganz, gibt keine Rückerstattung und zählt als Echo. Danach muss der Gegner den Entkommenen besiegen. Das Ziel schlägt ins Leere und zieht sich zurück. | `checkEscape` in `src/engine/rules.ts`, `Arena.evade`, Parser erkennt „fliegt davon“ als `entkommt` |

## Waffen (Wunsch des Nutzers: „Hammer, Schwert und Lanze sehen alle gleich aus“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Form folgt Funktion** | Waffen bekommen ihre Silhouette aus dem, was sie *tun*, und dem, woraus sie bestehen. Es gibt 15 Varianten: Zerschlagen ohne Schneiden wird zum Hammer, Zerschlagen und Schneiden zur Axt, Holz und Metall mit Durchbohren zum Speer mit Wimpel, Holz mit Durchbohren zum Bogen und Läutern zum Pflock. Schneidendes Metall ergibt ab Stufe 3 ein Schwert, darunter einen Dolch. Außerdem gibt es Sense, Schaufel, Schirm, Besen, Zauberstab, Flöte, Horn und Streichholz. Gelernte Waffen passen damit automatisch. | `VARIANTS` in `src/render/figures.ts`, `variantFor()` |
## Angriffe (PR „feat/angriffe“, Wunsch des Nutzers: „passendere Angriffsanimationen“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **15 Angriffsstile** | Jeder Mechanismus bekommt ein eigenes Bild, statt dass überall dasselbe Geschoss fliegt: Hieb (echter Sprung über die Arena mit Schnittbogen), Feuerball mit Glut, Bodenwelle aus Wasser, aufbrechende Erde, Eissplitter, Blitz aus dem Himmel, Wind in Wellenlinien, Lichtstrahl, Schattenschwaden, Giftblasen am Boden, Lebensentzug (Partikel fließen zurück zum Angreifer), Schallringe, Gedankenschleier, Runenkreis und kosmischer Sog aus allen Richtungen. Gelernte Mechanismen erben den Stil ihrer Familie. | `attackStyle`, `STYLE_BY_VERB` in `src/render/arena.ts` |
| **Nicht jeder Sieg vernichtet** | Wer verängstigt, übertönt oder weggeweht wird, dreht sich um und rennt davon (der Knall und das Pferd). Wer eingeschläfert wird oder vergisst, sinkt schlafend weg. Wer verführt, gezähmt oder befreundet wird, geht in rosa Funken über. Alles andere zerfällt wie bisher. | `attackOutcome`, `Arena.depart` |

## Siegarten, Schreck und Verstecken (Wünsche des Nutzers: „Knall erschreckt Pferd“, „unterschiedliche Wege zu besiegen: in die Flucht schlagen, verführen, verstecken“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Siegarten** | Jeder Mechanismus legt im Content fest, *wie* er besiegt: vernichtet, vertrieben, verführt, befriedet, eingeschläfert, gebannt oder versteinert. Die Engine gibt die Siegart im Check zurück. Banner, Erzählung und Arena zeigen sie: Die Gestalt rennt davon, sinkt in Schlaf, geht in rosa oder goldenen Funken auf, wird in einen Runenkreis gezogen oder erstarrt zu Stein und zerbröselt. | `VerbSpec.outcome`, `CounterCheck.outcome`, `Arena.depart` |
| **Gnade** | Wer befriedet (heilt, erlöst, befreundet, löst ein Rätsel), bekommt +1 Eleganz. Gewaltlos zu gewinnen lohnt sich. | `GameConfig.mercyEleganz/mercyOutcomes` |
| **Schreck** | Tags können festlegen, was ihre Träger erschreckt: `furchtsam` erschrickt vor Übertönen, Blenden, Blitz und Feuer, `sonnenscheu` vor Licht. Ein Schreck zählt wie ein Treffer in die Schwäche (+2), und das Ziel flieht. Der Knall schlägt das Pferd in die Flucht; der Wolf zuckt vor der Fackel nicht. | `TagSpec.startledBy`, Schritt „Schreck“ in `checkCounter` |
| **Verstecken** | Das ist ein zweiter Weg neben dem Entkommen: Wer getarnt ist (Chamäleon, Ninja, Spion, Dieb, Fuchs …) oder im Schatten lebt, versteckt sich vor körperlichen Angriffen. Licht, Feuer und Blitz finden jedes Versteck. In der Arena verblasst die Gestalt kurz. | `escapeRoutes.tarnt/schatten`, `hidingRoutes`, Tag `tarnt` |

## Musik (Wunsch des Nutzers: „klassische Retro-Dungeon-Musik“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Musik, die mit der Arena wächst** | Ein Chiptune-Sequencer ohne Audiodateien spielt a-Moll mit harmonischer Wendung (Am – F – Dm – E) und einem NES-typischen 12,5-%-Puls. Mit jeder Eskalationsstufe kommt eine Schicht dazu: erst Bordun und Bass, dann Arpeggio, Hi-Hats, eine Melodie, die pro Duell neu gewürfelt wird, und schließlich die Kick. Auch das Tempo steigt. Die Musik startet mit der ersten Eingabe und lässt sich im Menü abschalten. | `src/ui/music.ts` |

## Arena-Zustände (eigener „Genie-Streich“ für komplexere Abfolgen)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Züge hinterlassen Spuren** | Ein Zug verändert die Arena für die nächsten ein bis zwei Züge. Die Engine liest das deterministisch aus der Historie. Jede Wirkung erscheint als eigener Schritt in „Warum?“ und fließt in die Kraft ein. Daraus entstehen Kombos: Wer die Arena flutet, bereitet den Blitz vor. | `src/engine/fields.ts`, `content/core/fields.json` (neuer Pack-Teil `fields`, wird validiert) |
| **Sichtbar, aber leise** | Unter der Rundenzahl steht nur ein blasses Wort („Nässe“); der Tooltip erklärt es. Die Arena zeigt jeden Zustand, siehe Tabelle unten. | `Arena.setFields`, `.fields` |

| Zustand | Wirkung | Anzeige in der Arena |
|---|---|---|
| Nässe | Blitz und Kurzschluss +2, Feuer −1 | Pfützenschimmer, Ringe |
| Glut | Feuer +1, Frost −1 | aufsteigende Funken |
| Frost | Zerschlagen und Gefrieren +1, Feuer −1 | Raureif vom Rand her |
| Finsternis | Licht +2, Täuschen und Ängstigen +1 | Dunkelheit |
| Stille | Übertönen und Wecken +2 | fahles Blau |
| Sturm | Feuer +1, Durchbohren −1 | Windschlieren |
| Staub | Blenden −1, Täuschen +1 | Dunst |

## Schiedsrichter (Idee des Nutzers: „Confidence – wenn die Engine unsicher ist, wird Claude gefragt“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Die Engine kennt ihre Zweifel** | Ein Fehlschlag gilt als *unsicher*, wenn: ein Mechanismus um genau einen Punkt zu schwach war, ein Blocker oder eine Immunität gegriffen hat (das Modell ist dort evtl. zu grob), oder wenn gar keine Angriffsfläche gefunden wurde (eine Wechselwirkung, die die Tags nicht kennen). Scheitert ein Zug nur an den Größenregeln, gilt er nicht als unsicher. | `uncertainty()` in `src/engine/attempt.ts`, `CounterCheck.failedAt` |
| **Claude als Schiedsrichter** | Nur in solchen unsicheren Fällen urteilt Claude, und zwar streng: gesunder Menschenverstand und Sagenlogik ja, „irgendwie geht das schon“ nein. Das Urteil nennt einen existierenden Mechanismus und eine Begründung in einem Satz. | `src/llm/referee.ts` |
| **Präzedenzfälle** | Jedes Urteil (ja oder nein) wird validiert und für genau dieses Paar im gelernten Pack gespeichert. Danach entscheidet die Engine es immer gleich und ohne weiteren Claude-Aufruf. Die Größenregeln gelten weiter. Im Grimoire stehen die Urteile unter „⚖ Schiedssprüche“, in der Arena erscheint die Begründung unter dem Namen. | `rulings` im Pack, `checkRuling`, `addRuling` |

## Eigene Sprites für Neues (Nutzerfeedback: „Löschdecke bekam das Schwert-Symbol“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Claude zeichnet mit** | Für eine wirklich neue Gestalt (ohne Anker im Lexikon) liefert Claude ein 16×16-Pixelbild in derselben Zeichensprache wie die eingebauten Masken. Es wird validiert: Größe, erlaubte Zeichen (mit Toleranz für Leerzeichen und fremde Zeichen), ein Füllgrad zwischen 10 und 85 % und eine zusammenhängende Silhouette statt Rauschen. Danach wird es im Grimoire gespeichert und wie jede Figur schattiert, beleuchtet und konturiert. Ist das Bild ungültig, greift der Archetyp. | `src/engine/pixelart.ts`, `FormSpec.sprite`, Werkzeugfeld `pixel_art` |
| **Sechs neue Grundformen** | Tuch, Kiste, Flasche, Fahrzeug, Haus und Becher kommen hinzu. 19 bestehende Gestalten nutzen sie jetzt, etwa Teppich, Käfig, Flasche, Weihwasser, Auto, Bus, Lebkuchenhaus und Kaffee. | `src/render/masks.ts` |

## Atmosphäre und Easter Eggs (Nutzerwünsche: „Soundtrack aufwändiger, atmosphärischer“, „die Atombombe, die TATSÄCHLICH explodiert“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Eine Halle aus Klang** | Alles klingt durch einen erzeugten Steinhallen-Nachhall (2,8 s). Die Musik hat vier Abschnitte (A A B C) mit eigenen Akkordfolgen. Dazu kommen ein langsam atmendes Flächen-Pad, ein Bass-Oktavsprung, eine Melodie als Motiv mit Antwort und eine ferne Glocke zu Beginn jedes Abschnitts. Zwischendurch tropft Wasser, und Wind zieht durch die Gänge. Der Chiptune-Charakter bleibt. | `src/ui/music.ts` |
| **Easter Eggs** | Die Atombombe explodiert wirklich: Die Arena wird weiß, Druckwellen breiten sich aus, ein Atompilz steigt auf, Ziegel fliegen aus der Wand, und ein tiefer Knall ertönt. Meteoriten schlagen vom Himmel ein, der Regenbogen spannt sich über die Arena, bei Konfetti und Party regnet es Konfetti, und das Schwarze Loch saugt alle Partikel in einen Strudel. | `easterEggFor`, `Arena.easterEgg`, Klang „boom“ |

## Erzählung mit Bezug, Warum-Zeile, erklärende HUD (Nutzer- und Testerfeedback)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Das Schicksal folgt dem Mechanismus** | Claude bekommt beide Gestalten mit ihren wichtigsten Eigenschaften. Die Anweisung lautet: beide beim Namen nennen, das Ende des Verlierers aus dem Mechanismus ableiten (die Welle reißt den Ritter fort, statt dass er „zu Staub zerfällt“), und nur Bewegungen beschreiben, die die Gestalt wirklich kann. Gestalten ohne Eigenbewegung werden markiert, etwa ein Damm („bewegt sich nicht von selbst“). | `src/llm/narrator.ts` |
| **Das Ziel antwortet** | Scheitert ein Zug, erzählen Claude und die Offline-Texte, *womit* das Ziel antwortet (sein Mechanismus, der den Angreifer erreicht). Auch die Animation zeigt diese Antwort. | `narrateFailure(…, answer)`, `Arena.fizzle(…, answer)` |
| **Sieg-Animation passt zum Stil** | Wasser spült fort, Feuer brennt nieder, Erde begräbt, Eis gefriert und zerspringt, Wind verweht, Gift und Dunkelheit zersetzen, Licht und Kosmos blenden aus. | `Arena.defeat()` |
| **Warum-Zeile** | Unter der Erzählung steht farbig, warum es gewirkt hat: Mechanismus in Gold, Angriffsfläche in Glut, Abzeichen wie Schreck!, Schwachstelle!, Arena-Zustand, ⚖ Schiedsspruch und Gnade. Bei Fehlschlag steht der Grund in Rot. | `showWhy()`, `.why-line` |
| **Alles im HUD ist antippbar** | Wille/Eleganz, Runde/Arena-Wachstum und Arena-Zustände öffnen jeweils eine kurze Erklärung. | `showInfo()` |
| **Die Arena-Untergrenze ist sichtbar** | Unter der Rundenzahl steht, sobald es zählt, „ab klein“ oder „ab groß“. Beim Anstieg pulsiert die Anzeige. Die Ablehnung nennt die Grenze in Worten („groß wie ein Bär (Stufe 4)“) und sagt dazu, dass der Versuch nichts kostet. | `render()`, `floorWords()` |

## Tester-Feedback (Kiki)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Schiedssprüche kippen keine Größenverhältnisse** | „Schere gewinnt gegen Felsen“ war ein zu großzügiger Schiedsspruch. Ein Urteil entscheidet jetzt nur noch, *ob* etwas wirkt. Die Kraft muss trotzdem reichen: Größe + Hebel + 1 ≥ Ziel, und mehr als 3 Stufen nach unten gehen nur mit mythischem Hebel. Auch schon gespeicherte zu großzügige Urteile werden so gedeckelt. | `checkRuling` |
| **350 eigene Sprites** | Kühlschrank als Schachturm, Smartphone als Schlüssel, Atombombe als Hammer: Die Archetypen waren für Dinge zu grob. Jetzt haben 350 Gegenstände, Orte, Naturgewalten und Begriffe ein eigenes 16×16-Pixelbild. Gezeichnet haben sie Subagenten mit einem Kontaktblatt-Werkzeug, das die Bilder im Spiel-Look rendert, damit die Agenten ihre Bilder prüfen und nachbessern konnten. Danach folgte eine Durchsicht. | `sprite` in den Formen-Packs |
| **Werkzeug** | Neu sind Spitzhacke, Amboss, Löschdecke, Feuerlöscher, Meißel, Brecheisen, Kettensäge, Säge und Bohrmaschine. | `forms/werkzeug.json` |
| **Gelerntes überlebt Kern-Updates** | Hat Claude früher eine Löschdecke gelernt und kennt der Kern sie jetzt selbst, wurde bisher das *ganze* gelernte Pack verworfen (doppelte ID). Jetzt weichen solche Einträge dem Kern, und alles andere bleibt erhalten. | `reconcileLearned()` |

## Spielfiguren (Nutzerwunsch: StarCraft, Warcraft, Overwatch, Halo, Klassiker)

48 Gestalten mit passenden Mechanismen und Schwächen: der Zergling-Schwarm, der von Flächenwirkung lebt, der stolze Lichkönig, Mercy, die heilt und erlöst, Master Chief, der gehorcht, Pac-Man, der verschlingt, GLaDOS und „Der Kuchen“, der lockt und täuscht (Schwäche: falsch). Sie nutzen die allgemeinen Grundformen. Markenfiguren werden bewusst nicht nachgezeichnet. Einige Figuren laufen unter beschreibenden Namen, etwa „Klempner mit Mütze“ oder „Blauer Igel“; die bekannten Namen funktionieren als Aliase. Simulation mit 600 Partien: 296 zu 304, also ausgeglichen.

## Grundbegriffe zuerst (Nutzerfeedback: „eher Kieselstein oder Ritterschwert statt Stein und Schwert“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Wortlisten-Test** | 521 einfache deutsche Wörter (Stein, Stock, Tisch, Stuhl, Mann, Brot, Leiter, Tor …) wurden direkt gegen den Parser geprüft. Vorher fehlten 173 oder landeten bei etwas Falschem: Tisch → Fisch, Stuhl → Stahl, Stock → Vulkanier, Milch → Feuersalamander, Toilette → Medizin. | `basis.json`, `basis2.json` |
| **217 Grundbegriffe** | Menschen, Körperteile, Tiere, Essen, Haus und Möbel, Kleidung, Werkzeug, Fahrzeuge, Orte, Instrumente. Hatte eine speziellere Gestalt den Grundbegriff als Alias (Kriegshammer → „hammer“, Pulverfass → „bombe“), gehört der Name jetzt der Grundform. Übrig bleiben nur Synonyme wie Berg → Gebirge oder Handy → Smartphone. | Content |
| **Strengere Tippfehler-Toleranz** | Kurze Wörter liegen zu nah beieinander. Ein Tippfehler wird erst ab 7 Buchstaben geraten, der erste Buchstabe muss stimmen, und zwei Fehler zählen nur als verdoppelte oder fehlende Taste („Dracheee“), nie als zwei vertauschte Buchstaben. Zweibuchstabige Namen („Ei“) werden exakt gefunden. | `parseForm`, `Ontology` |

## Versionsnummer (Nutzerwunsch: „damit man weiß, was gerade live ist“)

Jeder PR erhöht `package.json` → `version`. Der Build schreibt die Version ins Spiel, und sie steht dezent auf dem Startbildschirm und unten im Menü, zum Beispiel „v0.32.0“. PR-Vorschauen zeigen zusätzlich „· PR 32“. Details in `src/version.ts` und `appVersion()` in `scripts/build.ts`.

## Lesezeit (Nutzerfeedback: „man muss sich anstrengen, schnell zu lesen“)

Erzählung und Warum-Zeile verschwinden nicht mehr nach einer festen Zeit. Sie bleiben stehen, bis der nächste Zug beginnt. Längere Hinweise im Banner, etwa eine Ablehnung mit Erklärung, bleiben so lange sichtbar, wie man zum Lesen braucht (etwa 15 Zeichen pro Sekunde). Kurze Ausrufe wie „Es reicht!“ blitzen weiterhin nur kurz auf.

## Skizzen statt Pixelraster (Nutzerwunsch: bessere Sprites, möglichst kostenlos und ohne Wartezeit)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Claude skizziert in SVG** | Claude zeichnet ein Pixelraster Zeichen für Zeichen schlecht, einfache Formen in SVG aber gut. Für eine neue *Sache* liefert Claude deshalb im Klassifizierungsaufruf, der ohnehin stattfindet, eine kleine SVG-Skizze mit. Es gibt keinen zusätzlichen Dienst und keine GPU, die Kosten sind ein paar Tokens mehr. | `skizze` im Werkzeug `gestalt` |
| **Rollenfarben** | Die Skizze nutzt fünf feste Füllfarben als *Rollen*: Körper, zweite Farbe, Leuchten, Glanz und dunkles Detail. Diese werden auf die Sprite-Zeichen abgebildet. Die echten Farben kommen wie bei jeder Gestalt aus den Tags, die Schattierung und Kontur aus dem normalen Sprite-Weg. So passen Skizzen zum restlichen Look. | `SKETCH_FILLS`, `pixelsToRows` |
| **Automatischer Zuschnitt** | Die Skizze wird groß gerendert, auf das Gezeichnete zugeschnitten und stehend in 32×32 eingepasst. Zu kleine oder verrutschte Zeichnungen füllen so trotzdem den Rahmen. | `rasterizeSketch`, `opaqueBounds` |
| **Nur für Dinge** | Ein Test mit Haiku an 20 Gestalten ergab: Gegenstände gelingen gut (Tisch, Leiter, Brille, Lupe, Leuchtturm), Lebewesen schlecht (der Drache wurde ein Streichholz). Lebewesen behalten deshalb die handgebauten Figuren. | `sketchOf` |
| **Sicher** | Die SVG wird bereinigt (keine Skripte, Links, Bilder oder Stile) und nur von unserem eigenen Rasterizer gezeichnet, nie vom Browser. | `sanitizeSketch`, `svgraster.ts` |

## Eigener SVG-Rasterizer (Vorbereitung für Mehrspieler)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Gleiche Skizze, gleiches Sprite** | Skizzen werden nicht mehr über das Browser-Canvas gerastert, sondern von einem kleinen, reinen Rasterizer ohne Abhängigkeiten. Browser und Server machen so aus derselben SVG exakt dasselbe Sprite. Gegen Chromium verglichen weicht er bei den Beispielskizzen in 0–3 von 1024 Zellen ab. | `src/render/svgraster.ts`, `rasterizeSketch` |
| **Striche wie im Browser** | Linienenden sind wie in SVG standardmäßig stumpf (`butt`), `round` und `square` gehen auf Wunsch. Überlappende Strichteile löschen sich nicht mehr gegenseitig aus. | `strokePolys` |
| **Zug-Auflösung ohne DOM** | Der Weg Text → Klassifizierung/Lernen → Engine → Schiedsrichter → Erzählung steckt jetzt in einer eigenen Klasse ohne Oberfläche, damit später der Server dieselbe Logik spielen kann. | `src/game/resolver.ts` |

## Online zu zweit (Nutzerwunsch: Mehrspieler mit maßgeblichem Server)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Ein Gerät = ein Raum** | Auf einem öffentlichen Server (Docker) gibt es keinen Claude-Proxy für den Browser. Auch ein Duell zu zweit an einem Gerät läuft dort als Raum, in dem ein Browser beide Plätze hält. So bleibt der Key auf dem Server, und alles Gelernte landet im gemeinsamen Grimoire. | `create` mit `name2`, `roomsOnly` |
| **Der Verlierer eröffnet die Revanche** | „Revanche“ startet im selben Raum ein neues Duell; wer verloren hat, beginnt. | `OnlineHub.rematch` |
| **Platz pro Tab** | Das Platz-Token liegt in `sessionStorage`: zwei Tabs sind zwei Spieler, ein Neuladen oder ein aufwachendes Handy kehrt auf denselben Platz zurück, mit Chronik und Erzählung. | `src/online/link.ts` |
| **Nur die stehende Gestalt** | Nach einem Wiederverbinden zeigt die Arena ohne Animation nur die Gestalt, die gerade steht; alle früheren wurden ja beantwortet. | `adoptState` |
| **Gelerntes als Differenz** | Lernt ein Raum etwas, bekommen alle verbundenen Browser nur die geänderten Einträge (Gestalt, Eigenschaft, Schiedsspruch mit Sprite), nicht das ganze Pack. Passt eine Differenz nicht, holt sich der Browser einmal das ganze Pack. | `packDelta`, `applyPackDelta`, `sync` |
| **Hot-Seat verliert nichts** | Lädt der lokale Hot-Seat sein Pack hoch, während ein Raum etwas gelernt hat, wird zusammengeführt statt überschrieben. | `learnedEndpoint.put` in `server/local.ts` |
| **Räume ohne Key** | Ohne `ANTHROPIC_API_KEY` spielen die Räume mit dem mechanischen Parser. Damit lässt sich Online-Spiel mit zwei Tabs kostenlos testen. | `debug: () => !claude()` |
| **Kostendeckel** | Höchstens `CLAUDE_MOVES_PER_HOUR` Züge mit Claude pro Stunde über alle Räume, dazu Grenzen pro Verbindung, IP und Raum, 8-KB-Nachrichten, Herzschlag gegen tote Verbindungen und Aufräumen verlassener Räume. | `HubLimits`, `server/online.ts` |

## Skizzen für Alltagsdinge (Nutzerwunsch: bessere Sprites, kostenlos und schnell)

| Idee | Was sie tut | Wo |
|---|---|---|
| **178 handgezeichnete Skizzen** | Tisch, Stuhl, Brot, Käse und Kuchen teilten sich bisher eine Kisten-Maske, Hammer, Messer und Gewehr eine Waffen-Maske. Jetzt hat jedes dieser Dinge eine eigene SVG-Skizze (Möbel, Werkzeug, Geschirr, Essen, Gebäude, Fahrzeuge, Kleidung, Pflanzen, Geräte). Ich habe sie beim Entwickeln gezeichnet; sie kosten also keine API-Aufrufe. Sie laufen durch denselben Rasterizer wie Claudes Live-Skizzen, und die Tags schattieren sie wie alles andere. Lebewesen behalten ihre Figuren. | `src/content/core/sketches.json` |
| **Farbhinweise** | Die Farbe kommt aus den Tags, und die kennen nicht jede Farbe: Eine Tomate ist eine `pflanze` und wurde deshalb grün. Eine Skizze darf am `<svg>` `data-main`/`data-second` (nur Hex) angeben; daraus wird die Farbrampe gebildet. Das ist reine Darstellung, die Regeln sehen es nie. Auch Claude darf das bei Live-Skizzen, und gelernte Dinge behalten den Hinweis. | `tintOf`, `rampOf`, `paletteFor` |
| **Faul gerastert** | Eine Skizze wird erst beim ersten Auftritt gerastert (etwa 1 ms) und danach aus dem Cache gezeichnet. Das Spiel startet dadurch nicht langsamer. | `sketchRows` in `sprite.ts` |

## PixiJS statt eigenem Canvas-Renderer (Nutzerwunsch: eine richtige 2D-Engine)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Simulation getrennt vom Zeichnen** | Die Arena besteht jetzt aus `ArenaSim` (Zustand, Animationen, Partikel, bröckelnde Wand) und einem Renderer. Die UI merkt davon nichts, sie ruft weiter `summon`, `reveal`, `attack` usw. auf. | `src/render/arena.ts` |
| **PixiJS-Renderer mit gleichem Look** | Szenengraph statt Canvas-Befehle: Sprites für Gestalten mit Materialisieren, Silhouette, Rand, Stein und Blitz, Grafiken für Partikel, Ringe, Blitze, Rune und Fackeln, weiche Lichtkegel als getönte Sprites. Die Szene wird wie bisher in 480×270 gerendert, ×4 pixelgenau vergrößert, und darüber liegen zwei geblurrte Bloom-Stufen (Pixi-`BlurFilter`, additiv). | `src/render/pixi-arena.ts` |
| **Software-WebGL zählt nicht** | Ohne echte GPU (SwiftShader, llvmpipe, blockierte Treiber) ist WebGL bei Vollbild-Durchgängen viel langsamer als Chromes Canvas; gemessen wurden 4 statt 36 fps. Das Spiel prüft deshalb, wer rendert, und nimmt dann den alten Canvas-Renderer. `?pixi` bzw. `?canvas` erzwingen einen der beiden. Das Arena-Element trägt `data-renderer`. | `createArena`, `hardwareWebgl` in `src/render/arenas.ts` |

## Isometrische Dungeon-Arena

| Idee | Was sie tut | Wo |
|---|---|---|
| **Ein Raum statt einer Wand** | Die Arena ist jetzt ein isometrischer Kerkerraum: Zwei Ziegelwände treffen sich hinten an einem Eckpfeiler, der Boden besteht aus Rautenfliesen im Verhältnis 2:1, die Fackeln hängen an den Wänden, und die rechte Wand liegt im Schatten. Über den Wänden verliert sich das Gewölbe im Dunkel, und dort öffnen sich die Augen. Die Kulisse wird prozedural in Pixeln gemalt (Iso-Treppenstufen, Rasterdithering nach oben). | `src/render/stage.ts` (`ISO`) |
| **Die Mauern fallen auch schräg** | Die Eskalation funktioniert weiter: Die Wandziegel sind Parallelogramme aus 1-px-Spalten und bröckeln von oben nach unten ins Sternenfeld weg. Eckpfeiler und Fackelhalter bleiben im Nichts stehen. | `isoBricks`, `openBricks` |
| **Runenkreis auf dem Boden** | Der Kreis liegt perspektivisch flacher auf den Fliesen. Die Duellanten stehen auf seinem Durchmesser, und die Lichtkegel unter leuchtenden Gestalten sind jetzt echte Ellipsen statt Rechtecke. | `Rune`, `drawLightPool` |
| **Kulisse austauschbar** | Simulation und beide Renderer lesen nur `StageLayout`. `?flat` zeigt die alte Wand, und `data-stage` am Arena-Element sagt, welche Kulisse läuft. | `stageFor` |

## Aufgeräumt: eine Szene, zwei Renderer

Alles, was die Arena rund um die Gestalten zeigt (Licht, Sterne, Bodeneffekte, Augen, Fackeln, Staub, Regenbogen, Rune, Blitze, Ringe, Partikel), war nach dem Pixi-Umbau doppelt vorhanden, einmal für Canvas und einmal für Pixi. Jetzt steht es nur noch in `ArenaScene` (`src/render/scene.ts`) und zeichnet über ein kleines `Pen`-Interface (Rechteck, Ellipse, Linie, weiches Licht). Canvas und Pixi setzen nur diesen Stift um (`CanvasPen`, `PixiPen`) und kümmern sich selbst um Gestalten und Compositing. Jede künftige Verschönerung gilt dadurch automatisch für beide Renderer.

## Der Iso-Raum lebt (Nutzerwunsch: „freie Hand, die Darstellung hübscher machen – Stil beibehalten“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Einrichtung** | Links ein Torbogen mit halb hochgezogenem Fallgitter, dahinter Schwärze. An beiden Wänden hängt ein Banner mit dem Sigil des Spiels (Ring, Dreieck, Auge), rechts Ketten mit Schellen. Der Runenkreis ist als Rille in den Boden gehauen, dazu Risse, abgetretene Platten, Geröll an den Wandfüßen, ein Schädel und Knochen, vorne zwei gebrochene Säulen. Alles ist in Pixeln gemalt und folgt der Iso-Schräge. | `paintDoor`, `paintBanners`, `paintChains`, `paintFloor`, `paintDebris`, `paintStumps` in `stage.ts` |
| **Was bleibt, wenn die Mauern fallen** | Tor, Banner, Ketten, Fackeln und Pfeiler stehen noch im Sternenfeld, wenn die Wand bei der Eskalation wegbröckelt. | `KEEP` |
| **Das erste Augenpaar hinter dem Gitter** | Die Zuschauer haben im Iso-Raum feste dunkle Plätze. Das erste Paar starrt hinter dem Fallgitter hervor, die übrigen aus dem schwarzen Gewölbe über den Wänden. | `StageLayout.eyes` |
| **Weiche Schatten** | Statt eines harten Balkens liegt unter jeder Gestalt ein weicher, elliptischer Schatten. Unter schwebenden Gestalten ist er kleiner und blasser. | `drawLights` in `scene.ts` |
| **Licht an der Wand** | Leuchtende Gestalten (Feuer, Blitz, Heiliges …) werfen ihr Licht auch auf die Wand hinter sich. | `drawLights` |
| **Bodennebel und Tropfen** | Flache Nebelbänke ziehen langsam über den Boden. Aus dem Gewölbe fallen Tropfen, die auf den Fliesen Ringe schlagen und kurz spritzen. Beides entfällt bei reduzierter Bewegung. | `drawFog`, `updateDrops` |
| **Bodeneffekte folgen dem Boden** | Nässe und Frost halten sich an die tatsächliche Bodenfläche der Kulisse; im Iso-Raum kriecht der Frost von den Wandfüßen her. | `floorTop`, `floorEdge` |
| **Mehr Tiefe** | Der Boden dunkelt zum Wandfuß hin ab (gerastert), und unter jeder Fackel liegt ein warmer Lichtfleck auf dem Boden. | `paintFloor` in `stage-iso.ts`, `drawLights` |

Aufgeräumt dabei: Die Kulisse ist jetzt auf `stage.ts` (Typen, gemeinsame Helfer), `stage-flat.ts` und `stage-iso.ts` verteilt; `stageFor` steht in `arenas.ts`.

## Tiefe und Leben im Hintergrund (Nutzerwunsch: „mehr Tiefe, versetzte Kontrahenten, wehende Banner“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Versetzt in der Tiefe** | Im Iso-Raum steht, wer herausfordert, weiter hinten links, und die Antwort tritt vorne rechts auf. Alles richtet sich nach der Bodenlinie der jeweiligen Seite: Geschosse fliegen schräg durch den Raum, dazu Ringe, Schatten, Lichtkegel, Staub und Untergänge. Die flache Kulisse bleibt auf einer Linie. | `StageLayout.ground`, `ArenaSim.gy()` |
| **Wehende Banner** | Die Banner hängen still an ihrer Stange, darunter atmet der Stoff im Luftzug: Der Schwalbenschwanz flattert, und die Falten wandern durchs Tuch. Das Sigil sitzt oben, wo der Stoff ruhig bleibt. Bei reduzierter Bewegung hängen sie still. | `drawBanners` in `stage-iso.ts`, `StageLayout.drawProps` |
| **Fledermäuse** | Ab und zu zieht ein kleiner Schwarm durchs Gewölbe: dunkle Silhouetten mit Flügelschlag in zwei Bildern und hellen Flügelkanten. Vor der schwarzen Decke sieht man oft nur die roten Augen wandern. | `updateCritters`, `drawCritters` |
| **Eine Ratte** | Gelegentlich huscht eine Ratte am Fuß der rechten Wand entlang, bleibt stehen, schnuppert und trippelt weiter. | ebd. |

## Online-Start ohne Rätsel (Nutzerfeedback: „mega verwirrend, springt nach 2 Sekunden zurück ins Menü“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Zwei Reiter** | „Hier zu zweit“ und „Online“ sind getrennt. Online gibt es nur „Dein Name“, bei Bedarf „Zugangscode des Servers“ und zwei Kästen: „Neues Duell → Raum eröffnen“ und „Eingeladen? → Raum-Code → Beitreten“. Raum-Code und Zugangscode sind klar benannt. | `showStart` |
| **Fehler bleiben im Dialog** | Vorher schloss sich das Menü, die Verbindung scheiterte (falscher Zugangscode, unbekannter Raum, Limit), und das Menü öffnete sich wieder – die Meldung blitzte nur dahinter auf. Jetzt steht der Grund rot im Dialog, der Cursor sitzt im Feld, das korrigiert werden muss, und alles Eingetippte bleibt erhalten. | `StartOptions.error`, `onServer("error")` |
| **„Verbinde …“ statt leerer Arena** | Bis der Server den Raum bestätigt, zeigt der Dialog „Verbinde …“ mit „Abbrechen“; ist der Server nicht erreichbar, sagt er das. | `showConnecting` |
| **Beitreten erst mit gültigem Code** | Der Knopf wird aktiv, sobald fünf gültige Zeichen dastehen; Kleinbuchstaben werden groß. Der Einladungslink öffnet direkt den Online-Reiter mit eingetragenem Code. | `updateJoin` |
| **Name wird gemerkt** | Der eigene Name steht beim nächsten Mal schon da, der Zugangscode nur für diese Sitzung. | `rememberName` |
| **Großzügigere Limits** | Freunde teilen oft eine Adresse (Router). Pro Adresse sind jetzt 24 Verbindungen und 60 Räume pro Stunde erlaubt, und das Server-Log weist darauf hin, wenn ein Proxy ohne `TRUST_PROXY` der Grund sein dürfte. | `server/online.ts` |

## Zuschauen (Nutzerwunsch: „einem Raum beitreten, aber nur den 2 Spielern zuschauen“)

| Idee | Was sie tut | Wo |
|---|---|---|
| **Zuschauen mit dem Raum-Code** | Unter „Eingeladen?“ steht neben „Beitreten“ jetzt „Zuschauen“. Wer zuschaut, sieht alles live – Züge, Erzählung, Epilog –, kann aber weder ziehen noch aufgeben noch eine Revanche starten. Das prüft der Server, nicht der Browser. Bis zu 20 Zuschauer pro Raum. | `watch` in `server/online.ts`, `spectating` in `app.ts` |
| **Auch volle Räume** | Ist ein Raum schon voll, sagt die Meldung beim Beitreten, dass man noch zuschauen kann. | ebd. |
| **Auge in der Kopfzeile** | Die Spieler sehen unter der Runde „👁 2“ und bekommen kurz Bescheid, wenn jemand dazukommt. | `showWatchers` |
| **Neuladen geht** | Auch Zuschauer bekommen ein Token und kehren nach dem Neuladen in den Raum zurück, mit der bisherigen Chronik. | `resume` |

## Intensität statt Ja/Nein (Nutzerwunsch: „Eigenschaften mit Intensität, Modifikatoren, Implikationen – ich will beeindruckt sein“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Stufen für Eigenschaften** | Hitze, Wasserkraft, Kälte gegen Hitzefestigkeit, Härte, Kältefestigkeit, je 0–6. Eine Kerze hat Hitze 1, ein Schmiedefeuer 3, die Sonne 6. Metall hält 3 aus, Stein 5. Die Fackel schmilzt keinen Anker mehr, der Schmied schon. Ein Eimer Wasser trägt keinen Fels ab, ein Fluss schon. | `qualities.json`, `intensity()` |
| **Der genaueste Tag gewinnt** | Stahl ist härter als „Metall“, Gold weicher. Ohne Sonderfall, nur über die Ist-ein-Hierarchie. | `resolveQualities` |
| **Übermacht** | Wer die Anforderung um 2 übertrifft, bekommt +1 Kraft. Ein Drache schmilzt Eis mühelos. | `intensity()` |
| **Kombinationen** | Regeln der Form „wenn A und B, dann …“: nasses Holz brennt nicht, glühendes Metall hält Hitze aus, ein Irrlicht glimmt nur, Untote frieren nicht, brennendes Öl brennt heißer. | `combos.json` |
| **Reichweite** | Nahkampf (fesseln, zerschlagen, zerreißen …) erreicht nichts, was fliegt – außer man fliegt selbst oder ist viel größer. Der Jäger fesselt keinen Adler mehr, er schießt ihn. | `inRange()` |
| **Ein Ofen ist kein Feuer** | Ofen, Kamin, Toaster, Schmied, Gewehr, Kanone haben Hitze, sind aber nicht selbst Feuer – Wasser „löscht“ keinen Ofen. | Content |
| **Ehrlicher Schiedsrichter** | Claude sieht nur die Mechanismen, die der Angreifer wirklich hat; ein Urteil mit fremdem Mechanismus wird verworfen, und Urteile übergehen weder Reichweite noch Intensität. Ein Hut gegen einen Elefanten gilt nicht mehr als „strittig“ – nur wer mindestens so groß ist wie das Ziel und es gar nicht berühren kann, ist ein Fall für den Schiedsrichter. | `referee.ts`, `uncertainty()`, `checkRuling` |
| **Seife ist fest** | Die letzte Form, gegen die der Bot aufgeben musste, lässt sich jetzt auch zerdrücken. Selbstspiel: 0 Aufgaben in 2000 Partien (vorher 4). | Content |

## Auch Abgewiesenes sieht der Gegner (Nutzerfeedback: „der Gegner sieht gar nicht, dass ich etwas gespielt habe“)

| Idee | Was es tut | Wo |
|---|---|---|
| **„zählt nicht“ für alle** | Ein echter Fehlversuch („Es genügt nicht.“) kam schon immer bei allen an. Ein Zug, der gar nicht zählt (Echo, Arena gewachsen, zu wenig Wille, unverständlich), ging aber nur an den Spieler selbst – beim Gegner hing sogar „denkt nach …“. Jetzt sehen Gegner und Zuschauer „Ben versucht „…“ – zählt nicht, noch einmal.“ | `tried` in `protocol.ts`, `server/online.ts` |

## Keine gequetschten Gestalten nach dem Neuverbinden (Nutzerfeedback: „wenn man neu connected, sind die Sprites gequetscht“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Sprite misst sich neu** | Beim Wiederverbinden erscheint die stehende Gestalt direkt sichtbar und materialisiert sich Zeile für Zeile. Pixi 8 hat die Größe dabei nur einmal übernommen, sodass sie als Streifen hängen blieb. Jetzt ist die Textur „dynamisch“ und meldet jede Änderung. | `pixi-arena.ts` |

## Bilder aus Bauteilen (Kiki: „Die Sprites brauchen Items … mehrere modifizierbare Bestandteile“; „Politische Korruption waren zwei lila Blöcke“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Gegenstände in der Hand** | 58 Gegenstände (Flinte, Harke, Brot, Schwert, Besen, Lupe, Waage, Handy …) mit Haltung (lang/kurz/klein) und eigenen Materialfarben – die Flinte bleibt Holz und Stahl, egal wer sie trägt. Rund 90 Menschen im Lexikon halten jetzt ihr Werkzeug. | `items.json`, `look.ts`, Symbole `m`/`n` |
| **Begriffe als Embleme** | Abstraktes wird nicht mehr frei gezeichnet, sondern aus zwei Symbolen gebaut: Hauptsymbol plus Abzeichen in der Ecke (Korruption = Geldsack + Krone, Verrat = Maske + Dolch, Freundschaft = Handschlag + Herz). 53 neue Symbole, zusammen mit den 178 Skizzen eine Bibliothek aus 231 Teilen. | `symbols.json`, `sketchOf` |
| **Claude wählt statt zu zeichnen** | Beim Einordnen wählt Claude `aussehen` aus geschlossenen Listen (haelt, emblem, abzeichen, Farben). Eine Freihand-Skizze gibt es nur noch für wirklich neue Dinge, für die kein Teil passt. | `parser.ts`, `lookOf` |
| **Kontaktbogen** | `npm run sheet -- items` rendert alle Teile als PNG – so lässt sich die Grafik prüfen, ohne das Spiel zu starten. | `scripts/sheet.ts` |

## Gelernte Intensität (Fortsetzung „Engine schlauer machen“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Claude schätzt Intensitäten** | Neue Gestalten bekommen beim Lernen eigene Stufen, wenn sie vom Üblichen abweichen: ein Schweißbrenner hat Hitze 4 und schmilzt den Anker, den die Fackel nicht schafft. | `qualitiesOf` in `parser.ts` |
| **Kalibrierung über Anker** | Die Lexikon-Anker im Prompt zeigen ihre Intensitäten („Fackel · hitze 2“) – Claude ordnet relativ zu Bekanntem ein statt frei zu schätzen. | `anchorLine` |
| **Deckel gegen Übertreibung** | Kräfte (Hitze, Wasserkraft, Kälte) höchstens Stufe + 2 – ein Streichholz brennt nie wie die Sonne, egal was der Spieler behauptet. Doppelt geprüft: im Parser und in `learn()`. | `cappedQualities` |

## Generierte Pixel Art (Nutzerwunsch: „Service für geile und schnelle Sprite-Generierung, unser manueller Modus ist Fallback“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Ein Stil-Rezept für alle** | Jedes Bild entsteht mit denselben Vorgaben (Seitenansicht, Blick nach rechts, schwarze Kontur, mittlere Schattierung, transparenter Hintergrund, „dark fantasy“) – 1 200 Gestalten sehen aus wie ein Spiel, ohne alte Sprites als Vorlage. | `server/pixellab.ts` |
| **Größe folgt der Stufe** | Winziges wird in 32 px, Mittleres in 64 px, Riesiges in 128 px generiert – eine Maus steht klein neben dem Elefanten. Kostet gleich viel. | `scripts/art.ts` |
| **Eigenes, reines Bildformat** | Palette + Lauflängen statt PNG: 1–3 KB pro Bild, synchron dekodierbar im Browser, auf dem Server und in der Einzeldatei – kein Canvas, kein Netzwerk. | `render/art.ts` |
| **Alle Effekte bleiben** | Materialisieren, Silhouette, Leuchtkontur, Versteinern und Glühen werden aus den Pixeln des Bildes abgeleitet; Flammen und Augen leuchten von selbst. | `arena.ts`, `artGlow` |
| **Fallback bleibt** | Ohne Bild greift wie bisher Bauplan, Skizze oder Figur. | `artFor` |

## Neue Gestalten bekommen ihr Bild live

| Idee | Was es tut | Wo |
|---|---|---|
| **Claude beschreibt, der Server malt** | Beim Einordnen schreibt Claude eine kurze englische Bildbeschreibung (geschützte Figuren beschrieben, nie beim Namen). Der Server generiert daraus einmal das Bild und verteilt es an alle Räume. | `bild` im Parser, `ArtService` |
| **Einblenden statt Warten** | Der Zug wartet nicht auf das Bild. Trifft es ein, während die Gestalt noch steht, blendet die Arena mit einem Lichtblitz auf das neue Bild um. | `arena.setOntology` |
| **Budget mit Gedächtnis** | Monatsdeckel (`ART_MONTHLY_LIMIT`), der Zähler liegt neben dem gelernten Pack und übersteht Neustarts. Ein Versuch pro Gestalt. Leer, kein Key oder Dienst weg: Es bleibt still beim gezeichneten Bild. | `art-usage.json` |

## Prüfstand für den Engine-Neubau (Schritt 1 von 6)

| Idee | Was es tut | Wo |
|---|---|---|
| **Audit-Bot** | Geht alle 547 682 gültigen Siege im Lexikon durch und markiert verdächtige nach Regeln, die nicht aus der Engine stammen: Weiches schneidet, Begriffe prügeln, Dinge ohne Geist täuschen, Winzlinge mit roher Gewalt. Ausgangswert: 2,7 % verdächtig. Jeder Neubau-Schritt muss die Zahl senken. | `npm run audit` |
| **Konkrete Fälle als Tests** | Was schon stimmt, ist Test (Fackel schmilzt keinen Anker …). Was noch absurd ist, steht als `todo` („Klebeband fesselt Ritter“) und wird zum echten Test, sobald der Neubau es behebt. | `tests/plausibility.test.ts` |
| **„Quatsch?“-Knopf** | Hinter der Warum-Zeile, dezent. Ein Klick meldet den Sieg: an den Server (`reports.jsonl`) und in eine Liste im Menü, die man mit einem Knopf kopieren kann. So liefert jede Testrunde Fälle. | `reports.ts`, `report` im Protokoll |

## Bilder auf Abruf und die Beschwörung (Nutzerwunsch: „nicht alles vorgenerieren – just in time“, „statt unserer gemalten Sprites soll der Runenkreis beschwören“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Nichts vorgenerieren** | Der Server malt eine Gestalt erst, wenn sie zum ersten Mal auftritt, und hebt das Bild für immer auf. Bezahlt wird nur, was gespielt wird. | `server/art-service.ts` |
| **Schlüssel ist die Beschreibung** | Gespeichert wird nach Bildbeschreibung, nicht nach Gestalt: der Jäger im roten Mantel und der Jäger mit Harke sind zwei Bilder, gleiche Beschreibungen teilen sich eins. | `artKey` |
| **Schon beim Auflösen losmalen** | Sobald der Server einen Zug auflöst, beginnt er zu malen – wenn die Clients fragen, läuft es schon. Gleiche Anfragen werden zusammengelegt. | `online.ts` (move) |
| **Die Beschwörung** | Während gemalt wird, lädt sich der Runenkreis auf, ein Pentagramm zeichnet sich Strich für Strich hinein und dreht sich, an seinen Spitzen flackern Runen, Funken steigen auf. Ist das Bild da: ein heller Blitz, die Gestalt erscheint. Die gezeichneten Sprites sieht man nur noch ohne Server oder wenn nach 75 s kein Bild kam. | `drawPentagram`, `startConjuring` |
| **Doppelte Schärfe** | Bilder kommen in doppelter Auflösung; die Arena rendert Kämpfer in doppelter Dichte – gleich groß, doppelt so viele Details. Kulisse und alte Sprites sehen aus wie immer. | `ART_DENSITY`, `pixi-arena.ts` |
| **Nach dem Wiederverbinden** | Bilder werden bei jedem (Wieder-)Beitritt neu erfragt – Zuschauer sehen nach einem Verbindungsabbruch nicht mehr die gezeichneten Ersatzbilder. | `welcome`, `resummon` |

## Affordanzen: Fähigkeiten folgen aus Eigenschaften (Engine-Neubau Schritt 3; Nutzerwunsch: „Radio zersetzt Marder ergibt keinen Sinn“)

| Idee | Was es tut | Wo |
|---|---|---|
| **Jeder Mechanismus sagt, was er braucht** | Alle 80 Mechanismen haben `requires`: zerschneiden braucht etwas Scharfes, zersetzen Säure, wecken Lärm, Licht, Geist oder einen Weckreiz, verbrennen Feuer *oder* gesetzte Hitze ≥ 2 (der Ofen brennt, ohne Feuer zu sein). Wer es nicht kann, dem nützt die Zuweisung nichts – egal ob von Claude, aus dem Content oder gelernt. | `verbs.json`, `ontology.affords` |
| **Fähigkeiten als Eigenschaften** | 42 Fähigkeits-Tags (scharf, spitz, Klauen, Maul, wuchtig, stürmisch, bindend, laut, lockend, giftig, reinigend, tückisch, nervtötend …) bringen ihren Mechanismus selbst mit. Claude ordnet eine Gestalt also über das ein, was sie *ist* und *kann*, statt ihr Verben anzuheften. | `tags.json` (Gruppe `faehigkeit`) |
| **Scherz ernst genommen** | Tückisch (Bananenschale, Butter), nervtötend (Kaugummi am Schuh, Drucker), bloßstellend (Tomatenwurf), unheimlich (Legostein, barfuß, nachts) – Witzgestalten bekommen echte, prüfbare Fähigkeiten statt Beliebigkeit. | `tags.json` |
| **„Warum?“ sagt, was fehlt** | „Radio kann nicht „zersetzt“ – bräuchte Säure / Fäulnis.“ | `ontology.lacks`, `rules.ts` |
| **Claude bekommt eine zweite Chance** | Im Vokabular steht hinter jedem Mechanismus „braucht: …“. Gibt Claude trotzdem nur Unmögliches an, fragt der Parser einmal nach: Fähigkeit nennen, wenn die Gestalt sie wirklich hat – sonst andere Mechanismen. Erfinden, nur damit es passt, ist ausdrücklich verboten. | `parser.ts` (`abilityCorrection`) |
| **Migration mit Augenmaß** | Alle 1.228 Gestalten per Skript und Tabelle je Mechanismus umgestellt: wo die Fähigkeit stimmt, wurde sie ergänzt (Ritter spitz, Python bindend), wo nicht, flog der Mechanismus raus (Hut täuscht, Kopf zerschlägt, Löffel verschlingt, Stille übertönt). Prüfstand: 2,7 % → 1,8 % verdächtige Siege, „Begriff prügelt“ 3 972 → 392; Balance laut 2000 Selbstspielen unverändert. | `src/content/core/forms/*.json` |

