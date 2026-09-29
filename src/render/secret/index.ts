// The secret characters' own animations (PixelLab, made once and bundled – see src/render/CONTEXT.md), square frames
// side by side: `<form id>` loops while the form stands, `<form id>-attack` goes with its signature attack.
import eichelober from "./eichelober.png";
import eichelober_attack from "./eichelober-attack.png";
import eichelober_gang from "./eichelober_gang.png";
import eichelober_gang_attack from "./eichelober_gang-attack.png";

export const SECRET_ANIMS: Readonly<Record<string, string>> = {
  eichelober,
  "eichelober-attack": eichelober_attack,
  eichelober_gang,
  "eichelober_gang-attack": eichelober_gang_attack,
};
