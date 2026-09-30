## Context

Kosten: `BASE_COST` je Stufe [1, 2, 3, 5, 8, 12, 17, 23] plus Aufschläge; Eskalation: Mindeststufe `1 + ⌊(Zug − 1) / 3⌋`; Regeneration je Runde `3 + (Runde − 1)`, Obergrenze 50.

## Decisions

**Rabatt auf die Mindeststufe statt mehr Regeneration.** Mehr Regeneration macht jede Runde gleich reich und nimmt dem Budget die Spannung; ein Rabatt bezogen auf die Arena lässt die bestehende Abwägung (klein und klug vs. groß und teuer) auf jeder Stufe gleich wirken. Langsamere Eskalation oder ein höheres Maximum hätten das Problem nur verschoben.

**Volle Mindeststufe (Grundpreis − 1), nicht eine Stufe darunter.** Verglichen mit einem „menschlichen“ Bot (antwortet nie von weit unten, wählt irgendeinen passenden Konter, n = 400):

| Variante | 0 % Fehlversuche: bis zum Ende · Ø Wille R10 | 30 % Fehlversuche |
|---|---|---|
| bisher | 24 · 18 | 0 |
| Arena trägt eine Stufe weniger | 379 · 29 | 171 |
| **Arena trägt die Mindeststufe** | **385 · 38** | **304** |

Mit einer Stufe weniger sinkt der Wille weiter und wer oft rät, bleibt trotzdem stecken – das war der Kern der Meldung. Erschöpfung bleibt möglich (bei 50 % Fehlversuchen weiterhin häufig).

**Balance bleibt.** Greedy-Selbstspiel (`npm run simulate -- --games 1000`): Spieler 1 : 2 = 506 : 489 (vorher 514 : 486). Der Bot endet näher am Maximum (Ø Wille 48 / 50 statt 31 / 44); Wille entscheidet bei Punktgleichstand, Eleganz bleibt die Wertung.

**Mythische kleine Gestalten** bekommen höchstens ihren eigenen Grundpreis − 1 erlassen (`min(Stufe, Mindeststufe)`), nie mehr.

## Risks

- Späte Duelle werden reicher → größere Gestalten öfter bezahlbar. Beobachten; nachschärfbar über den Abzug.
