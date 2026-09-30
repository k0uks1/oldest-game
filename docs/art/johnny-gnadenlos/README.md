# Johnny Gnadenlos – Bilder

Alles, was für Johnny und die Kaktusarena gemalt wurde (PixelLab), damit nichts verloren geht.

| Datei | Was |
|---|---|
| `johnny.png` | das gewählte Standardbild (128 px, = `content/core/form-art.json`) |
| `kandidaten/` | alle Entwürfe aus `generate-image-v2` (Seeds 5 und 9, je 4), Übersichten vergrößert |
| `animationen/` | `animate-with-text-v3` auf `johnny.png`: Tanz (Seed 3 = im Spiel, 8) und Singen (3, Seed 8 = im Spiel); `-gross` = vergrößerte Ansicht |
| `vorlagen/` | die Fotos des Spielzeugs, die als Vorlage dienten (`spielzeug.jpg` war das Referenzbild) |
| `arena/` | Bildschirmfotos aus dem Spiel: Auftritt, der Klassiker, Nachplappern |

Im Spiel gebündelt: `src/render/form-anims/johnny_gnadenlos*.png`, die Kaktusarena in `src/render/rooms/kaktus*.png`.

Rezept: `generate-image-v2`, 128×128, Referenz `vorlagen/spielzeug.jpg`, Stilbild = Eichelober-Gang
(`style_options`: Farben nicht übernehmen), Beschreibung „Johnny Gnadenlos, a singing dancing plush cactus toy … wearing a
tiny brown cowboy hat and a red paisley bandana …“.
