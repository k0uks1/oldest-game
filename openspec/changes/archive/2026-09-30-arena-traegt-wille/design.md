## Context

Kosten: `BASE_COST` je Stufe [1, 2, 3, 5, 8, 12, 17, 23] plus Aufschläge; Eskalation: Mindeststufe `1 + ⌊(Zug − 1) / 3⌋`; Regeneration je Runde `3 + (Runde − 1)`, Obergrenze bisher 50.

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

**Feinabstimmung (ausprobiert und gemessen).** Menschen-Bot n = 300 je Spalte, Greedy n = 400:

| Variante | fehlerfrei | 30 % Fehlversuche | 50 % | Greedy am Maximum |
|---|---|---|---|---|
| alte Regel | 5 % | 0 % | 0 % | 11 % |
| Arena trägt ½ | 96 % | 39 % | 8 % | 58 % |
| Arena trägt ¾ | 95 % | 67 % | 33 % | 58 % |
| Arena trägt alles | 95 % | 88 % | 65 % | 56 % |
| + Regeneration wächst nur alle 2 Runden | 97 % | 83 % | 52 % | 56 % |
| + Regeneration 2, wächst alle 2 Runden | 95 % | 75 % | 45 % | 56 % |
| + Erstattung höchstens der Preis | 95 % | 92 % | 67 % | 56 % |
| **+ Maximum 40 statt 50** | **96 %** | **89 %** | **69 %** | 56 % (Ø Wille Ende 39 statt 49) |

- Die Arena trägt die volle Mindeststufe; nur dann kommen auch Spieler mit vielen Fehlversuchen meist durch.
- Das Wille-Maximum sinkt von 50 auf 40: Spieler horten weniger, Menschen bleiben unberührt. Wer spät zu viel übrig hat, hat 10 weniger Vorsprung beim Gleichstand.
- Langsamere Regeneration kostet die schwächeren Spieler, ohne den Greedy-Bot zu bremsen – verworfen. Die Erstattungsgrenze zeigt keine messbare Wirkung – keine neue Regel ohne Effekt.
- Der Greedy-Bot (kennt jeden billigsten Konter) hängt weiter oft am Maximum; sein Siegverhältnis ändert sich mit keinem der Hebel (193 : 203). Wille bremst Experten damit kaum noch – Wertung bleibt die Eleganz, und die Spannung liegt beim Raten. Beobachten.

**Ausprobiert im Browser** (Hot-Seat, `?debug`): eine Partie auf Augenhöhe (Gehirn → … → Multiversum → Supernova → Das Nichts → Pulsar → Ra → Der Teufel) lief bis zur letzten Runde; der Wille fiel zweimal auf 9–10, blieb aber spielbar.

## Risks

- Späte Duelle werden reicher → größere Gestalten öfter bezahlbar. Beobachten; nachschärfbar über den Abzug.
