/**
 * {@link Pen} on PixiJS: shapes go into one Graphics (rebuilt every frame), soft lights are
 * tinted radial sprites from a pool that sits below it.
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Pen, Pt } from "./pen.ts";

/** "#rgb", "#rrggbb", "rgb(r,g,b)" → 0xrrggbb (cached – particles ask every frame). */
const colorCache = new Map<string, number>();
export function colorNum(css: string): number {
  const hit = colorCache.get(css);
  if (hit !== undefined) return hit;
  let n = 0xffffff;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css)?.[1];
  if (hex !== undefined) n = Number.parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  else {
    const m = /^rgba?\(([^)]*)\)$/i.exec(css)?.[1];
    if (m !== undefined) {
      const [r = 0, g = 0, b = 0] = m.split(",").map((x) => Number.parseFloat(x));
      n = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    }
  }
  if (colorCache.size > 4000) colorCache.clear();
  colorCache.set(css, n);
  return n;
}

/** A soft white disc fading from the centre – tinted and stretched into every light. */
export function radialTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx !== null) {
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return Texture.from(c);
}

export class PixiPen implements Pen {
  /** Add this to the scene: lights below, shapes above. */
  readonly root = new Container();
  private readonly lights = new Container();
  private readonly g = new Graphics();
  private used = 0;

  constructor(private readonly disc: Texture) {
    this.root.addChild(this.lights, this.g);
  }

  /** Start a new frame. */
  begin(): void {
    this.g.clear();
    this.used = 0;
  }

  /** Hide lights not used this frame. */
  end(): void {
    for (let i = this.used; i < this.lights.children.length; i++) {
      const s = this.lights.children[i];
      if (s !== undefined) s.visible = false;
    }
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    this.g.rect(x, y, w, h).fill({ color: colorNum(color), alpha });
  }

  ring(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1, width = 1): void {
    if (rx <= 0 || ry <= 0) return;
    this.g.ellipse(cx, cy, rx, ry).stroke({ width, color: colorNum(color), alpha });
  }

  line(points: readonly Pt[], color: string, alpha = 1, width = 1): void {
    for (const [i, [x, y]] of points.entries()) {
      if (i === 0) this.g.moveTo(x, y);
      else this.g.lineTo(x, y);
    }
    this.g.stroke({ width, color: colorNum(color), alpha });
  }

  light(cx: number, cy: number, rx: number, ry: number, color: string, alpha: number): void {
    if (rx <= 0 || ry <= 0 || alpha <= 0) return;
    let s = this.lights.children[this.used] as Sprite | undefined;
    if (s === undefined) {
      s = new Sprite(this.disc);
      s.anchor.set(0.5);
      this.lights.addChild(s);
    }
    this.used++;
    s.visible = true;
    s.position.set(cx, cy);
    s.width = rx * 2;
    s.height = ry * 2;
    s.tint = colorNum(color);
    s.alpha = alpha;
  }
}
