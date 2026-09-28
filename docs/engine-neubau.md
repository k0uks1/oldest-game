# Engine-Neubau – wichtige Aufgabe für später

> Nutzerwunsch (28.9.): „Wirklich, WIRKLICH grundlegende Überarbeitung der Engine. Nichts ist sicher oder fix –
> wir finden aktuell so unfassbar viele ‚bescheuerte Siege‘, die ganz klar zeigen, dass die Engine begrenzt ist.
> Ein ‚alter Kaugummi‘ hat gerade etwas zerschnitten …“

Die Intensitäten (v0.41) und Reichweite waren Flickwerk an einem Modell, das an der Wurzel zu grob ist.
Dieses Dokument sammelt Fälle und Ursachen, bis der Neubau beginnt. **Nichts am heutigen Modell ist gesetzt.**

## Gesammelte „bescheuerte Siege“

| Fall | Ursache (Stand heute) | Status |
|---|---|---|
| Alter Kaugummi zerschneidet etwas | Mechanismen werden der Gestalt *zugeteilt* (von Claude oder im Content), statt aus ihren Eigenschaften zu folgen. Nichts verlangt, dass wer schneidet, scharf und härter als das Ziel ist. | offen |
| „alter“ Kaugummi wird magisch | „alt“ läuft über den Modifikator `uralt` (fügt `magisch`, `erinnert` hinzu). Wörter haben keinen Kontext: alt heißt bei Dingen „abgenutzt“, nicht „mythisch“. | offen |
| Hut besiegt Elefant | Der Schiedsrichter durfte fremde Mechanismen vergeben. | behoben v0.41 |
| Fackel schmilzt Anker | Keine Intensität, „schmilzt“ war binär. | behoben v0.41 (nur für 6 Mechanismen) |
| Wasser trägt Brücke, Wüste, Fels ab | wie oben | behoben v0.41 |
| Jäger fesselt Adler | Keine Reichweite. | behoben v0.41 (nur Nahkampf gegen Fliegendes) |
| „Ofen ist Feuer“ | Tags vermischen „ist“ und „enthält/erzeugt“. | per Content umgangen, Modell offen |

## Ursachen an der Wurzel

1. **Mechanismen sind deklariert statt abgeleitet.** Eine Gestalt „kann“, was in ihrer `verbs`-Liste steht.
   Richtig wäre: Was etwas kann, folgt aus dem, was es *ist* (scharf + hart → schneidet, schwer → zermalmt,
   heiß → verbrennt). Die Liste der Mechanismen wäre dann eine Folge, keine Behauptung.
2. **Fast nur das Ziel wird geprüft.** `targets`/`blockedBy` fragen: Ist das Ziel verwundbar? Kaum gefragt wird:
   Hat der Angreifer das Zeug dazu? `needs` gibt es erst für 6 von ~80 Mechanismen.
3. **Eine einzige Zahl für alles.** `scale` ist gleichzeitig Größe, Masse, Macht und Kosten. Eine Mücke und eine Idee
   der Stufe 1 sind gleich „stark“.
4. **Modifikatoren ohne Bedeutung im Kontext.** Adjektive fügen Tags hinzu, egal worauf sie treffen („alt“,
   „riesig“, „nass“ wirken immer gleich) und verschieben keine Intensitäten.
5. **Claude hat zu viel Spielraum beim Einordnen.** Es wählt „1–3 passende Mechanismen“ – genau dort entstehen
   kreative, aber physikalisch unsinnige Fähigkeiten, die danach als gelernte Wahrheit gespeichert werden.

## Richtungen für den Neubau (Ideen, nichts entschieden)

- **Affordanzen**: Jeder Mechanismus nennt, was der Angreifer haben muss (Eigenschaften und Intensitäten).
  `zerschneidet` ⇒ `scharf` und Härte ≥ Härte des Ziels. Mechanismen einer Gestalt = alle, deren Voraussetzungen
  sie erfüllt. Claude ordnet dann nur noch Eigenschaften ein, nie Fähigkeiten.
- **Mehrere Achsen statt einer Stufe**: Größe, Masse, Härte, Energie, Geist … – jeder Mechanismus vergleicht die
  Achsen, die für ihn zählen (Schneiden: Schärfe/Härte; Zermalmen: Masse; Täuschen: Geist).
- **Modifikatoren als Operatoren**: „alt“ bei Dingen senkt Härte/Zustand, bei Wesen hebt es Weisheit, bei Mythen
  Macht. „nass“ setzt Nässe, „glühend“ Hitze. Kontext = Art der Gestalt (Ding, Wesen, Begriff).
- **Unterscheidung „ist / enthält / erzeugt“**: Ein Ofen *enthält* Feuer, eine Fackel *ist* brennend, ein
  Drache *erzeugt* Feuer. Treffen kann nur, was *ist*; angreifen kann, was *erzeugt* oder *ist*.
- **Plausibilitäts-Prüfstand**: eine wachsende Liste absurder Paare als Tests („Kaugummi zerschneidet nicht“),
  plus ein Bot, der gezielt nach verdächtigen Siegen sucht (kleine/weiche Angreifer mit Gewalt-Mechanismen …).
- **„Das war Quatsch!“ im Spiel**: Ein Knopf nach einem Sieg speichert das Paar samt Begründung als Fall für den
  Prüfstand. So liefern Testrunden wie die mit Kiki direkt Material.

## Vorgehen, wenn es losgeht

1. Prüfstand zuerst: alle Fälle oben plus ein Stichproben-Bot → Zahl der absurden Siege messen.
2. Modell entwerfen (Affordanzen, Achsen, Modifikator-Operatoren), an 20–30 Kernpaaren durchrechnen.
3. Umbau in Schritten, jede Stufe gegen Prüfstand und `npm run simulate -- --games 2000`.
4. Gelernte Packs migrieren (Mechanismen-Listen werden zu abgeleiteten Fähigkeiten).
