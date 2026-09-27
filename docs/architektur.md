# Architektur

## Datenfluss eines Zuges

```
Freitext des Spielers
   │
   ▼
Claude (Haiku) ── Klassifikation ──► Form { tags, verbs, scale, … }     (gecacht pro Text)
   ▲  Anker: nahe Lexikon-Einträge (Retrieval)                           │
   │                                                                     ▼
   │                                               Ontologie: Closure = Tags + Vorfahren + Implikationen
   │                                                                     │
   │                                                                     ▼
   │                                    checkCounter(): Angriffsfläche → Blocker → Maß → Kraft
   │                                                                     │
   │                                                                     ▼
   │                                    game.play(): Echo, Eskalation, Wille, Eleganz → neuer Zustand
   │                                                                     │
   └──────────── Erzählung (Claude) ◄── feststehendes Ergebnis ◄─────────┘
```

Claude sieht beim Klassifizieren **nie** den Gegner. So kann das Modell keinem Spieler „helfen“,
und gleiche Eingaben ergeben dank Cache gleiche Gestalten.

## Ontologie & Skalierung

| Baustein | Umsetzung | Kosten |
|---|---|---|
| Tag-Closure | lazy, memoisiert, zyklensicher (iterativ) | einmal pro Tag |
| Tag-Mengen | sortierte `Uint32Array` (sparse) statt Bitsets | O(Tags der Gestalt) Speicher |
| Konter-Check | Schnittmengen kleiner sortierter Arrays | ~6 µs bei 30k Tags |
| „Wer kontert X?“ | invertierter Index Mechanismus → Nutzer | ~3 ms bei 50k Gestalten |
| Namen / Komposita | Hash-Map + Suffix-Trie („Eis\|wolf“) | O(Wortlänge) |
| Tippfehler | Trigramm-Index + Levenshtein | nur Kandidaten mit gemeinsamen Trigrammen |
| LLM-Stichworte → Tags | Alias-Map + Trigramm-Fallback | Prompt listet nicht alle Tags |

Der Stresstest (`tests/scale.test.ts`) generiert 30.000 Tags, 5.000 Mechanismen, 3.000 Modifikatoren und
50.000 Gestalten und prüft Laufzeitbudgets.

## Content-Packs

Ein Pack ist JSON (`id`, `name`, `version`, `tags`, `verbs`, `modifiers`, `forms`). Mehrere Packs
lassen sich kombinieren; spätere Packs können neue Tags unter bestehende hängen:

```json
{ "id": "mithril", "label": "Mithril", "group": "material", "parents": ["metall"] }
```

Ohne weitere Regel wird Mithril dann von allem getroffen, was auf `metall` zielt (Blitz, Schmelzen) –
aber nicht von Rost, der nur auf `eisen` zielt.

Validierung beim Laden: Form des JSON (`parsePack`), dann Referenzen, doppelte IDs, Zyklen in der
Vererbung, gültige Stufen/Ebenen/Archetypen (`Ontology.compile`). Alias-Kollisionen werden als Warnung gemeldet.

## Rendering

Sprites entstehen deterministisch aus Daten: 16×16-Silhouette je Archetyp → EPX-Upscaling (32/64/128 px
je nach Stufe, gleichbleibende Pixelgröße) → Beleuchtung mit 4×4-Bayer-Dithering → Outline. Die Palette
kommt aus der erweiterten Closure (ein neuer Tag unter `feuer` wird automatisch in Feuerfarben gezeichnet).
