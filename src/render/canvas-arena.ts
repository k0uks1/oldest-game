/**
 * The original 2D-canvas renderer – the fallback where hardware WebGL is missing (and `?canvas`).
 *
 *   base    (480×270)  backdrop, back layer, fighters, front layer
 *   glow    (480×270)  emissive only
 *   bloom   glow → 240×135 (blur) and 120×68 (blur), upscaled bilinear, added with "lighter"
 *   display (1920×1080) = base ×4 nearest + bloom + crisp glow core + impact flash
 */
import type { Ontology } from "../engine/ontology/ontology.ts";
import { canvas, ctx2d, easeOut, HEIGHT, UPSCALE, WIDTH, type Fighter, type Side } from "./arena.ts";
import { CanvasPen } from "./pen.ts";
import { ArenaScene } from "./scene.ts";
import type { StageLayout } from "./stage.ts";

export class CanvasArena extends ArenaScene {
  private readonly display: CanvasRenderingContext2D;
  private readonly base: CanvasRenderingContext2D;
  private readonly glow: CanvasRenderingContext2D;
  private readonly bloomNear: CanvasRenderingContext2D;
  private readonly bloomFar: CanvasRenderingContext2D;
  private readonly pens: { readonly base: CanvasPen; readonly glow: CanvasPen };

  constructor(target: HTMLCanvasElement, onto: Ontology, stage?: StageLayout) {
    super(onto, stage);
    target.width = WIDTH * UPSCALE;
    target.height = HEIGHT * UPSCALE;
    this.display = ctx2d(target);
    this.base = ctx2d(canvas(WIDTH, HEIGHT));
    this.glow = ctx2d(canvas(WIDTH, HEIGHT));
    this.bloomNear = ctx2d(canvas(WIDTH / 2, HEIGHT / 2));
    this.bloomFar = ctx2d(canvas(WIDTH / 4, Math.ceil(HEIGHT / 4)));
    this.pens = { base: new CanvasPen(this.base), glow: new CanvasPen(this.glow) };
  }

  protected render(): void {
    const b = this.base;
    const g = this.glow;
    b.save();
    g.save();
    g.clearRect(0, 0, WIDTH, HEIGHT);
    const sx = Math.round((this.rand() - 0.5) * this.shake);
    const sy = Math.round((this.rand() - 0.5) * this.shake);
    b.translate(sx, sy);
    g.translate(sx, sy);
    b.drawImage(this.backdrop, 0, 0);
    this.drawBack(this.pens.base, this.pens.glow);
    for (const [side, f] of this.fighters.entries()) if (f !== null) this.drawFighter(side as Side, f);
    this.drawFront(this.pens.base, this.pens.glow);
    b.restore();
    g.restore();
    this.composite();
  }

  /** base ×4 nearest-neighbour, then two blurred bloom passes added on top. */
  private composite(): void {
    const d = this.display;
    const W = WIDTH * UPSCALE;
    const H = HEIGHT * UPSCALE;
    d.globalCompositeOperation = "source-over";
    d.globalAlpha = 1;
    d.imageSmoothingEnabled = false;
    d.drawImage(this.base.canvas, 0, 0, W, H);

    const near = this.bloomNear;
    near.clearRect(0, 0, near.canvas.width, near.canvas.height);
    near.imageSmoothingEnabled = true;
    near.filter = "blur(1.5px)";
    near.drawImage(this.glow.canvas, 0, 0, near.canvas.width, near.canvas.height);
    near.filter = "none";
    const far = this.bloomFar;
    far.clearRect(0, 0, far.canvas.width, far.canvas.height);
    far.imageSmoothingEnabled = true;
    far.filter = "blur(2px)";
    far.drawImage(this.glow.canvas, 0, 0, far.canvas.width, far.canvas.height);
    far.filter = "none";

    d.imageSmoothingEnabled = true;
    d.globalCompositeOperation = "lighter";
    d.globalAlpha = 0.9;
    d.drawImage(near.canvas, 0, 0, W, H);
    d.globalAlpha = 0.75;
    d.drawImage(far.canvas, 0, 0, W, H);
    // crisp emissive core on top
    d.imageSmoothingEnabled = false;
    d.globalAlpha = 0.35;
    d.drawImage(this.glow.canvas, 0, 0, W, H);
    if (this.flash > 0) {
      d.globalAlpha = this.flash;
      d.fillStyle = this.flashColor;
      d.fillRect(0, 0, W, H);
    }
    d.globalAlpha = 1;
    d.globalCompositeOperation = "source-over";
  }

  private drawFighter(side: Side, f: Fighter): void {
    if (f.alpha <= 0) return;
    this.base.save();
    this.glow.save();
    this.base.globalAlpha = f.alpha;
    this.glow.globalAlpha = f.alpha * (1 - f.stone);
    if (f.squash < 1) {
      for (const ctx of [this.base, this.glow]) {
        ctx.translate(0, this.gy(side));
        ctx.scale(1, Math.max(0.02, f.squash));
        ctx.translate(0, -this.gy(side));
      }
    }
    this.drawFighterBody(side, f);
    this.base.restore();
    this.glow.restore();
  }

  private drawFighterBody(side: Side, f: Fighter): void {
    const b = this.base;
    const { x, y, w, h } = this.fighterRect(side, f);
    // materialise: reveal rows from bottom
    const visible = Math.ceil(h * easeOut(f.appear));
    const mirrored = (side === 1) !== (f.facing === -1);
    const blit = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement): void => {
      ctx.save();
      if (mirrored) {
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, h - visible, w, visible, 0, y + h - visible, w, visible);
      } else {
        ctx.drawImage(img, 0, h - visible, w, visible, x, y + h - visible, w, visible);
      }
      ctx.restore();
    };
    if (f.reveal < 1) {
      blit(b, f.sprite.silhouette);
      blit(this.glow, f.sprite.rim);
    }
    if (f.reveal > 0) {
      b.save();
      b.globalAlpha = f.reveal * f.alpha;
      blit(b, f.sprite.image);
      b.restore();
      this.glow.save();
      this.glow.globalAlpha = f.reveal * f.alpha;
      blit(this.glow, f.sprite.glow);
      this.glow.restore();
    }
    if (f.stone > 0) {
      b.save();
      b.globalAlpha = f.stone * f.alpha;
      blit(b, f.sprite.stone);
      b.restore();
    }
    // materialisation scanline
    if (f.appear < 1) {
      this.glow.fillStyle = f.sprite.palette.glow;
      this.glow.fillRect(x, y + h - visible, w, 1);
    }
    if (f.flash > 0) {
      b.save();
      b.globalAlpha = f.flash * f.alpha;
      b.globalCompositeOperation = "lighter";
      if (mirrored) {
        b.translate(x + w, 0);
        b.scale(-1, 1);
        b.drawImage(f.sprite.image, 0, y);
      } else b.drawImage(f.sprite.image, x, y);
      b.restore();
    }
  }
}
