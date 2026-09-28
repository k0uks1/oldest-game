/** The original straight-on dungeon wall with two pillars (`?flat`). */
import { rng } from "../engine/text.ts";
import { FLOOR_Y, HEIGHT, WIDTH, type Brick, type StageLayout } from "./stage.ts";

/** Procedural dungeon backdrop, painted once. */
function paintFlat(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext("2d");
  if (ctx === null) return c;
  const rand = rng(99);
  const px = (x: number, y: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // wall
  px(0, 0, WIDTH, FLOOR_Y, "#15111f");
  const bricks = ["#2a2438", "#2e2740", "#262033", "#302a44"];
  for (let row = 0; row * 10 < FLOOR_Y; row++) {
    const off = row % 2 === 0 ? 0 : 12;
    for (let col = -1; col * 24 < WIDTH; col++) {
      const x = col * 24 + off;
      const y = row * 10;
      const base = bricks[Math.floor(rand() * bricks.length)] ?? "#2a2438";
      px(x + 1, y + 1, 22, 8, base);
      px(x + 1, y + 1, 22, 1, "#3a3352");
      px(x + 1, y + 8, 22, 1, "#1c1728");
      if (rand() < 0.12) px(x + 3 + Math.floor(rand() * 14), y + 2 + Math.floor(rand() * 5), 2, 1, "#1c1728");
      if (rand() < 0.07) px(x + 2 + Math.floor(rand() * 16), y + 7, 4, 2, "#243a2a");
    }
  }
  // darken wall toward top (dithered)
  for (let y = 0; y < FLOOR_Y; y++) {
    const shade = Math.max(0, 1 - y / (FLOOR_Y * 0.55));
    for (let x = 0; x < WIDTH; x++) {
      const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y % 4) * 4 + (x % 4)] ?? 0;
      if (b / 16 < shade * 0.8) px(x, y, 1, 1, "rgba(8,6,14,0.5)");
    }
  }
  // pillars
  for (const x0 of [20, 428]) {
    px(x0, 0, 32, FLOOR_Y, "#3a3350");
    px(x0, 0, 4, FLOOR_Y, "#4a4264");
    px(x0 + 28, 0, 4, FLOOR_Y, "#251f36");
    for (let y = 0; y < FLOOR_Y; y += 16) px(x0, y, 32, 1, "#251f36");
    px(x0 - 3, FLOOR_Y - 10, 38, 10, "#2c2640");
    px(x0 - 3, 0, 38, 8, "#2c2640");
    // torch bracket
    px(x0 + 12, 88, 8, 10, "#5c3418");
    px(x0 + 10, 86, 12, 3, "#3a2210");
  }
  // floor
  px(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y, "#1a1526");
  const vx = WIDTH / 2;
  const vy = 60;
  let y = FLOOR_Y;
  let gap = 4;
  let i = 0;
  while (y < HEIGHT) {
    px(0, Math.round(y), WIDTH, 1, i % 2 === 0 ? "#241e34" : "#221c30");
    y += gap;
    gap *= 1.28;
    i++;
  }
  ctx.strokeStyle = "#241e34";
  for (let k = -12; k <= 12; k++) {
    const bx = vx + k * 40;
    ctx.beginPath();
    ctx.moveTo(vx + (bx - vx) * ((FLOOR_Y - vy) / (HEIGHT - vy)), FLOOR_Y);
    ctx.lineTo(bx, HEIGHT);
    ctx.stroke();
  }
  px(0, FLOOR_Y, WIDTH, 2, "#0e0b16");
  // vignette
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 80, WIDTH / 2, HEIGHT / 2, 300);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return c;
}

/** Brick rectangles of the back wall (same grid as paintBackground), pillars excluded. */
function flatBricks(): Brick[] {
  const r = rng(77);
  const out: Brick[] = [];
  for (let row = 0; row * 10 < FLOOR_Y - 10; row++) {
    const off = row % 2 === 0 ? 0 : 12;
    for (let col = -1; col * 24 < WIDTH; col++) {
      const x = col * 24 + off;
      const y = row * 10;
      const x0 = Math.max(0, x);
      const x1 = Math.min(WIDTH, x + 24);
      if (x1 - x0 < 4) continue;
      // keep the pillars standing in the void
      if (x1 > 14 && x0 < 58) continue;
      if (x1 > 422 && x0 < 466) continue;
      // upper bricks go first, with noise so it looks like crumbling, not a wipe
      const height = y / FLOOR_Y;
      out.push({ x: x0, y, w: x1 - x0, h: 10, threshold: Math.min(0.98, 0.05 + height * 0.6 + r() * 0.35) });
    }
  }
  return out;
}



export const FLAT: StageLayout = {
  name: "flat",
  paintBackground: paintFlat,
  wallBricks: flatBricks,
  rune: { cx: 240, cy: 226, outer: [150, 22], inner: [138, 18], orbit: [144, 20] },
  floorTop: () => FLOOR_Y,
  floorEdge: (x) => Math.min(x, WIDTH - x) / (WIDTH / 2),
  drips: [],
  fog: false,
};
