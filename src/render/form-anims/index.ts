// Standard animations of forms (PixelLab, made once and bundled – see src/render/CONTEXT.md), square frames
// side by side: `<form id>` loops while the form stands, `<form id>-attack` goes with its signature attack.
import birthday_boy from "./birthday_boy.png";
import birthday_boy_attack from "./birthday_boy-attack.png";
import eichelober from "./eichelober.png";
import eichelober_attack from "./eichelober-attack.png";
import eichelober_gang from "./eichelober_gang.png";
import eichelober_gang_attack from "./eichelober_gang-attack.png";
import johnny_gnadenlos from "./johnny_gnadenlos.png";
import johnny_gnadenlos_attack from "./johnny_gnadenlos-attack.png";

export const FORM_ANIMS: Readonly<Record<string, string>> = {
  birthday_boy,
  "birthday_boy-attack": birthday_boy_attack,
  eichelober,
  "eichelober-attack": eichelober_attack,
  eichelober_gang,
  "eichelober_gang-attack": eichelober_gang_attack,
  johnny_gnadenlos,
  "johnny_gnadenlos-attack": johnny_gnadenlos_attack,
};
