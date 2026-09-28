/**
 * The few drawing primitives the arena's immediate-mode layers need. {@link ArenaScene} draws
 * everything through two pens (base and glow layer); each renderer implements them once –
 * the 2D canvas with context calls, PixiJS with Graphics and pooled light sprites.
 */
export type Pt = readonly [number, number];

export interface Pen {
  /** Filled rectangle (pixels, particles, flames). */
  rect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void;
  /** Ellipse outline. */
  ring(cx: number, cy: number, rx: number, ry: number, color: string, alpha?: number, width?: number): void;
  /** Open polyline. */
  line(points: readonly Pt[], color: string, alpha?: number, width?: number): void;
  /**
   * A soft light: an elliptical radial gradient from `color` at `alpha` to transparent.
   * Scenes draw lights before anything else on the same pen, so both renderers layer them alike.
   */
  light(cx: number, cy: number, rx: number, ry: number, color: string, alpha: number): void;
}

/** Hex/rgb colour with alpha as a CSS string (canvas gradients). */
export function withAlpha(css: string, a: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css)?.[1];
  if (hex === undefined) return css;
  const n = Number.parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  return `rgba(${String((n >> 16) & 255)},${String((n >> 8) & 255)},${String(n & 255)},${a.toFixed(3)})`;
}

/** Pen on a 2D canvas context. */
export class CanvasPen implements Pen {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  ring(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1, width = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  line(points: readonly Pt[], color: string, alpha = 1, width = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    for (const [i, [x, y]] of points.entries()) {
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  light(cx: number, cy: number, rx: number, ry: number, color: string, alpha: number): void {
    if (rx <= 0 || ry <= 0 || alpha <= 0) return;
    const c = this.ctx;
    c.save();
    c.translate(cx, cy);
    c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, 1, 0, 0, rx);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(1, withAlpha(color, 0));
    c.fillStyle = g;
    c.fillRect(-rx, -rx, rx * 2, rx * 2);
    c.restore();
  }
}
