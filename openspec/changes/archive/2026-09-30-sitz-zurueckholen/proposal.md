## Why

Issue: #77

Wer die Verbindung verliert und dabei seinen Sitz-Token (Tab zu, Handy verwirft den Tab, anderes Gerät, privater Modus), kommt nicht mehr in sein Duell: `resume` braucht den Token, `join` meldet „Dieser Raum ist schon voll“. Der Sitz bleibt bis zu 3 h belegt, der verbliebene Spieler sitzt fest.

Wunsch des Nutzers (Diktat, geglättet): „Wenn jemand die Verbindung verliert, vielleicht seinen Browser schließt, kann es sein, dass er, wenn er den Link neu aufruft, nicht mehr in der Session drin ist. Und dann kommt er auch nicht mehr rein, wenn er den Code vom Raum eingibt. […] Optimal wäre es, wenn auch der Client-Cache das speichern würde, dass er sich nochmal probiert, mit der letzten Session zu verbinden. […] Vielleicht braucht man beim Client gleich eine Grundlage dafür, dass man mehrere Sessions hat, also mehrere Spiele gleichzeitig spielen kann.“

## What Changes

- **Sitz zurückholen:** Ein `join` per Raumcode übernimmt den Sitz des Spielers mit demselben Namen (Groß-/Kleinschreibung egal), sobald dieser Sitz keine Verbindung mehr hat – mit neuem Token; der alte ist tot. Gilt für Gast und Gastgeber, auch im wartenden Raum und für Ein-Gerät-Räume (beide Sitze).
- **Verwaister Sitz:** Ist ein Sitz `seatFreeAfterMs` (5 min) ohne Verbindung, darf jeder mit dem Code ihn übernehmen und spielt unter dem Namen des Sitzes weiter.
- **Timeout schneller erkannt:** Heartbeat alle 15 s statt 30 s – eine tote Verbindung gilt nach spätestens 30 s als getrennt.
- **Client merkt sich Duelle:** `src/online/sessions.ts` hält alle Duelle dieses Browsers in `localStorage` (Liste, 3 h, höchstens 8) und das Duell des Tabs in `sessionStorage`. Beim Laden: eigenes Duell des Tabs → Einladungslink auf ein bekanntes Duell → letztes nicht beendetes Duell (nur wenn kein anderer Tab es spielt: `resume` mit `ifAway`, Antwort sonst `seated`).
- **Grundlage für mehrere Duelle:** Der Startdialog zeigt „Deine Duelle“ mit einem Klick zurück zu jedem. Ein Link = ein Duell; mehrere gleichzeitig offene Links sind vorbereitet, nicht umgesetzt.

## Capabilities

### Modified Capabilities
- `online-play`: „Wiederverbinden“ gilt auch ohne Token (Name, verwaister Sitz) und über Tabs und Neustarts hinweg.

## Impact

- `server/online.ts` (Sitz zurückholen, `away` je Sitz, `seatFreeAfterMs`), `server/local.ts` (Heartbeat).
- `src/online/protocol.ts` (`resume.ifAway`, Fehler `seated`), `src/online/link.ts`, neu `src/online/sessions.ts`.
- `src/ui/app.ts` (Start, „Deine Duelle“, Beitreten mit bekanntem Sitz).
- Tests: `tests/online.test.ts`, neu `tests/sessions.test.ts`.
- Kein Kerninvariant berührt.
