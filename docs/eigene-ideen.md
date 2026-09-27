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
