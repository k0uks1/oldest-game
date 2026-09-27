/**
 * Validation for pixel art that Claude draws for brand-new forms (a 16×16 mask in the same
 * symbol language as the built-in masks). Lenient about formatting, strict about shape:
 * the result must look like *one* object, not noise or an empty frame.
 *
 *   .  empty   #  body   +  secondary   o  glow   *  accent   ,  dark detail
 */
export const PIXEL_ART_SIZE = 16;
const ALLOWED = new Set([".", "#", "+", "o", "*", ","]);

export function validPixelArt(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.filter((r): r is string => typeof r === "string").map((r) => r.replace(/\s/g, "."));
  if (rows.length !== PIXEL_ART_SIZE) return undefined;
  const grid = rows.map((r) => {
    const chars = Array.from(r).map((ch) => (ALLOWED.has(ch) ? ch : ch === "_" || ch === "-" ? "." : "#"));
    return chars.length === PIXEL_ART_SIZE ? chars.join("") : undefined;
  });
  if (grid.some((r) => r === undefined)) return undefined;
  const g = grid as string[];
  const filled = (x: number, y: number): boolean => (g[y]?.[x] ?? ".") !== ".";
  let count = 0;
  let body = 0;
  for (let y = 0; y < PIXEL_ART_SIZE; y++) {
    for (let x = 0; x < PIXEL_ART_SIZE; x++) {
      if (filled(x, y)) count++;
      if (g[y]?.[x] === "#") body++;
    }
  }
  const total = PIXEL_ART_SIZE * PIXEL_ART_SIZE;
  if (count < total * 0.1 || count > total * 0.85 || body < 4) return undefined;
  // largest 4-connected component must hold most of the pixels (one object, not scattered noise)
  const seen = new Set<number>();
  let largest = 0;
  for (let y = 0; y < PIXEL_ART_SIZE; y++) {
    for (let x = 0; x < PIXEL_ART_SIZE; x++) {
      if (!filled(x, y) || seen.has(y * PIXEL_ART_SIZE + x)) continue;
      let size = 0;
      const stack: [number, number][] = [[x, y]];
      seen.add(y * PIXEL_ART_SIZE + x);
      while (stack.length > 0) {
        const p = stack.pop();
        if (p === undefined) break;
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = p[0] + dx;
          const ny = p[1] + dy;
          if (nx < 0 || ny < 0 || nx >= PIXEL_ART_SIZE || ny >= PIXEL_ART_SIZE) continue;
          const k = ny * PIXEL_ART_SIZE + nx;
          if (seen.has(k) || !filled(nx, ny)) continue;
          seen.add(k);
          stack.push([nx, ny]);
        }
      }
      largest = Math.max(largest, size);
    }
  }
  return largest >= count * 0.6 ? g : undefined;
}
