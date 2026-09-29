## Why

Wer online zuschaut, erscheint heute nur als „👁 n“ oben in der Mitte der Krone – ein Zähler, der nicht in die Arena gehört. Stattdessen soll jeder Zuschauer als eigenes kleines Wesen im Hintergrund der Arena auftauchen (ein Auge in der Felsmauer, eine Fledermaus an der Kette, eine Ratte hinten im Feld, ein schwebender Blitz …), das dort bleibt, solange er zuschaut.

Wunsch des Nutzers (Diktat, leicht geglättet): „Immer, wenn Leute zuschauen, [soll] nicht in der Mitte dieses Auge angezeigt werden, sondern die sollen so verschiedene Entities im Hintergrund bekommen, [die] in der Zukunft auch mal einen Namen haben [können]. Zum Beispiel so ein Auge, was hinten in der Felsenmauer ist und die ganze Zeit umherschaut. So eine Fledermaus, die durchfliegt und sich irgendwo absetzt an der Kette. Eine Ratte, die im Feld hinten herumrennt und sich setzt. Irgendein schwebender Blitz oder so.“

## What Changes

- Der Zuschauer-Zähler „👁 n“ in der Krone entfällt.
- Jeder verbundene Zuschauer bekommt in der Arena ein **Zuschauerwesen**: ein festes Repertoire aus vier Arten (Auge in der Felsmauer, Fledermaus, Ratte, schwebender Blitz), in fester Reihenfolge vergeben, danach Wiederholung an weiteren Plätzen, höchstens 8 sichtbar.
- Ein Wesen **kommt an** (fliegt/läuft/schwebt herein bzw. öffnet sich), **setzt sich** an einen festen Platz der Bühne (Kette, Mauerspalt, Boden hinten, Luft) und **lebt dort** (schaut umher, meist zum zuletzt angekommenen Kämpfer). Geht ein Zuschauer, verschwindet ein Wesen wieder.
- Die Bühnen (iso, flach) erhalten feste Sitzplätze für Zuschauerwesen.
- Das Banner „Jemand schaut jetzt zu.“ bleibt.
- Vorbereitet, nicht umgesetzt: Namen für Zuschauer (braucht eine Identität je Zuschauer im Protokoll).

Kein Kerninvariant (AGENTS.md) ist berührt: reine Darstellung in `src/render/` und `src/ui/`, die Engine liest nichts davon, das Protokoll bleibt unverändert (`presence.watchers` ist weiter eine Zahl).

## Capabilities

### New Capabilities

### Modified Capabilities
- `online-play`: neue Anforderung, wie Zuschauer in der Arena sichtbar sind (Zuschauerwesen statt Zähler).

## Impact

- `src/render/`: neues Modul für Repertoire und Platzvergabe (rein, testbar), Zeichnen in `scene.ts` über die `Pen`-Schnittstelle (beide Renderer), Zustand und Bewegung in `arena.ts`, Sitzplätze in `stage.ts` / `stage-iso.ts` / `stage-flat.ts`.
- `src/ui/app.ts`: `showWatchers` füttert die Arena statt der Krone; `els.watchers` und sein CSS entfallen.
- `src/render/CONTEXT.md`: kurzer Abschnitt zu den Zuschauerwesen.
- Keine Server- und Protokolländerung, kein PixelLab-Aufwand (gezeichnete Pixel wie Fledermäuse und Ratte heute).
