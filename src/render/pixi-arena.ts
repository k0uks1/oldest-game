/**
 * The arena on PixiJS (WebGL): a scene graph instead of immediate 2D-canvas calls.
 *
 *   baseRoot → baseRT (480×270, nearest)  backdrop, back layer, fighters, front layer
 *   glowRoot → glowRT (480×270)           emissive only
 *   glowRT   → nearRT (240×135) + BlurFilter, farRT (120×68) + BlurFilter
 *   screen   = baseRT ×4 nearest + near/far bloom (additive) + crisp glow core + impact flash
 *
 * What is drawn around the fighters comes from {@link ArenaScene} through {@link PixiPen}s;
 * this class adds the fighters (sprites) and the compositing.
 */
import { autoDetectRenderer, BlurFilter, Container, Graphics, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";
import type { Ontology } from "../engine/ontology/ontology.ts";
import { easeOut, GROUND_Y, HEIGHT, UPSCALE, WIDTH, type Fighter, type Side } from "./arena.ts";
import { colorNum, PixiPen, radialTexture } from "./pixi-pen.ts";
import { ArenaScene } from "./scene.ts";
import type { StageLayout } from "./stage.ts";

/** One layer of a fighter: a sprite whose texture frame shows only the materialised rows. */
interface Layer {
  readonly sprite: Sprite;
  readonly tex: Texture;
  readonly h: number;
}

interface FighterView {
  readonly base: Container;
  readonly glow: Container;
  readonly silhouette: Layer;
  readonly image: Layer;
  readonly stone: Layer;
  readonly flash: Sprite;
  readonly rim: Layer;
  readonly emissive: Layer;
  readonly scan: Graphics;
}

interface Targets {
  readonly base: RenderTexture;
  readonly glow: RenderTexture;
  readonly near: RenderTexture;
  readonly far: RenderTexture;
  readonly nearPass: Sprite;
  readonly farPass: Sprite;
}

export class PixiArena extends ArenaScene {
  /** true once WebGL is up; false (logged) if it could not start. */
  readonly ready: Promise<boolean>;
  private renderer: Renderer | null = null;
  private targets: Targets | null = null;
  private readonly baseRoot = new Container();
  private readonly glowRoot = new Container();
  private readonly screen = new Container();
  private readonly views = new Map<Fighter, FighterView>();
  private readonly sources = new WeakMap<HTMLCanvasElement, Texture>();
  private readonly backdropTex: Texture;
  private shownBackdrop = -1;
  private readonly back: { readonly base: PixiPen; readonly glow: PixiPen };
  private readonly front: { readonly base: PixiPen; readonly glow: PixiPen };
  private readonly fightersBase = new Container();
  private readonly fightersGlow = new Container();
  private readonly flashRect = new Graphics();

  constructor(
    private readonly target: HTMLCanvasElement,
    onto: Ontology,
    stage?: StageLayout,
  ) {
    super(onto, stage);
    target.width = WIDTH * UPSCALE;
    target.height = HEIGHT * UPSCALE;
    const disc = radialTexture();
    const pen = (): PixiPen => new PixiPen(disc);
    this.back = { base: pen(), glow: pen() };
    this.front = { base: pen(), glow: pen() };
    this.backdropTex = Texture.from(this.backdrop);
    this.backdropTex.source.scaleMode = "nearest";
    this.baseRoot.addChild(new Sprite(this.backdropTex), this.back.base.root, this.fightersBase, this.front.base.root);
    this.glowRoot.addChild(this.back.glow.root, this.fightersGlow, this.front.glow.root);
    this.ready = this.init();
  }

  private async init(): Promise<boolean> {
    try {
      this.renderer = await autoDetectRenderer({
        canvas: this.target,
        width: WIDTH * UPSCALE,
        height: HEIGHT * UPSCALE,
        preference: "webgl",
        antialias: false,
        background: "#050309",
        resolution: 1,
        autoDensity: false,
      });
      this.targets = this.buildCompositing();
      return true;
    } catch (e) {
      console.error("PixiJS konnte nicht starten:", e);
      return false;
    }
  }

  private buildCompositing(): Targets {
    const rt = (w: number, h: number, nearest: boolean): RenderTexture => RenderTexture.create({ width: w, height: h, scaleMode: nearest ? "nearest" : "linear", resolution: 1 });
    const base = rt(WIDTH, HEIGHT, true);
    const glow = rt(WIDTH, HEIGHT, true);
    const near = rt(WIDTH / 2, HEIGHT / 2, false);
    const far = rt(WIDTH / 4, Math.ceil(HEIGHT / 4), false);
    // bloom: the glow layer downsampled and blurred at two sizes
    const nearPass = new Sprite(glow);
    nearPass.scale.set(0.5);
    nearPass.filters = [new BlurFilter({ strength: 1.5, quality: 2 })];
    const farPass = new Sprite(glow);
    farPass.scale.set(0.25);
    farPass.filters = [new BlurFilter({ strength: 2, quality: 2 })];
    const up = (tex: RenderTexture, alpha: number, add: boolean): Sprite => {
      const s = new Sprite(tex);
      s.scale.set((WIDTH * UPSCALE) / tex.width, (HEIGHT * UPSCALE) / tex.height);
      s.alpha = alpha;
      if (add) s.blendMode = "add";
      return s;
    };
    this.screen.addChild(up(base, 1, false), up(near, 0.9, true), up(far, 0.75, true), up(glow, 0.35, true), this.flashRect);
    return { base, glow, near, far, nearPass, farPass };
  }

  private texture(c: HTMLCanvasElement): Texture {
    let t = this.sources.get(c);
    if (t === undefined) {
      t = Texture.from(c);
      t.source.scaleMode = "nearest";
      this.sources.set(c, t);
    }
    return t;
  }

  private layer(c: HTMLCanvasElement): Layer {
    const full = this.texture(c);
    const tex = new Texture({ source: full.source, frame: new Rectangle(0, 0, full.width, full.height) });
    return { sprite: new Sprite(tex), tex, h: full.height };
  }

  private viewFor(f: Fighter): FighterView {
    const hit = this.views.get(f);
    if (hit !== undefined) return hit;
    const s = f.sprite;
    const v: FighterView = {
      base: new Container(),
      glow: new Container(),
      silhouette: this.layer(s.silhouette),
      image: this.layer(s.image),
      stone: this.layer(s.stone),
      flash: new Sprite(this.texture(s.image)),
      rim: this.layer(s.rim),
      emissive: this.layer(s.glow),
      scan: new Graphics(),
    };
    v.flash.blendMode = "add";
    v.base.addChild(v.silhouette.sprite, v.image.sprite, v.stone.sprite, v.flash);
    v.glow.addChild(v.rim.sprite, v.emissive.sprite, v.scan);
    this.fightersBase.addChild(v.base);
    this.fightersGlow.addChild(v.glow);
    this.views.set(f, v);
    return v;
  }

  private dropView(f: Fighter, v: FighterView): void {
    v.base.destroy({ children: true });
    v.glow.destroy({ children: true });
    for (const l of [v.silhouette, v.image, v.stone, v.rim, v.emissive]) l.tex.destroy(false);
    this.views.delete(f);
  }

  protected render(): void {
    const r = this.renderer;
    const t = this.targets;
    if (r === null || t === null) return;
    if (this.shownBackdrop !== this.backdropVersion) {
      this.backdropTex.source.update();
      this.shownBackdrop = this.backdropVersion;
    }
    const sx = Math.round((this.rand() - 0.5) * this.shake);
    const sy = Math.round((this.rand() - 0.5) * this.shake);
    this.baseRoot.position.set(sx, sy);
    this.glowRoot.position.set(sx, sy);

    const pens = [this.back.base, this.back.glow, this.front.base, this.front.glow];
    for (const p of pens) p.begin();
    this.drawBack(this.back.base, this.back.glow);
    this.syncFighters();
    this.drawFront(this.front.base, this.front.glow);
    for (const p of pens) p.end();

    const clear = [0, 0, 0, 0] as const;
    r.render({ container: this.baseRoot, target: t.base, clear: true, clearColor: [0, 0, 0, 1] });
    r.render({ container: this.glowRoot, target: t.glow, clear: true, clearColor: [...clear] });
    r.render({ container: t.nearPass, target: t.near, clear: true, clearColor: [...clear] });
    r.render({ container: t.farPass, target: t.far, clear: true, clearColor: [...clear] });
    this.flashRect.clear();
    if (this.flash > 0) this.flashRect.rect(0, 0, WIDTH * UPSCALE, HEIGHT * UPSCALE).fill({ color: colorNum(this.flashColor), alpha: this.flash });
    r.render({ container: this.screen });
  }

  /** Mirror each fighter's state into its sprites (materialise rows, reveal, stone, flash, squash). */
  private syncFighters(): void {
    for (const [f, v] of this.views) if (!this.fighters.includes(f)) this.dropView(f, v);
    for (const [side, f] of this.fighters.entries()) {
      if (f === null) continue;
      const v = this.viewFor(f);
      const s = side as Side;
      v.base.visible = f.alpha > 0;
      v.glow.visible = f.alpha > 0;
      if (f.alpha <= 0) continue;
      // squash towards the ground
      for (const c of [v.base, v.glow]) {
        c.pivot.set(0, GROUND_Y);
        c.position.set(0, GROUND_Y);
        c.scale.set(1, f.squash < 1 ? Math.max(0.02, f.squash) : 1);
      }
      v.base.alpha = f.alpha;
      v.glow.alpha = f.alpha * (1 - f.stone);
      const { x, y, w, h } = this.fighterRect(s, f);
      const visible = Math.ceil(h * easeOut(f.appear));
      const mirrored = (s === 1) !== (f.facing === -1);
      const place = (l: Layer, show: boolean, alpha: number): void => {
        l.sprite.visible = show && visible > 0;
        if (!l.sprite.visible) return;
        const frame = l.tex.frame;
        if (frame.height !== visible) {
          frame.y = l.h - visible;
          frame.height = visible;
          l.tex.updateUvs();
          // the sprite takes its size from the frame
          l.sprite.texture = l.tex;
        }
        l.sprite.alpha = alpha;
        l.sprite.scale.x = mirrored ? -1 : 1;
        l.sprite.position.set(mirrored ? x + w : x, y + h - visible);
      };
      place(v.silhouette, f.reveal < 1, 1);
      place(v.image, f.reveal > 0, f.reveal);
      place(v.stone, f.stone > 0, f.stone);
      place(v.rim, f.reveal < 1, 1);
      place(v.emissive, f.reveal > 0, f.reveal);
      v.flash.visible = f.flash > 0;
      if (f.flash > 0) {
        v.flash.alpha = f.flash;
        v.flash.scale.x = mirrored ? -1 : 1;
        v.flash.position.set(mirrored ? x + w : x, y);
      }
      v.scan.clear();
      if (f.appear < 1) v.scan.rect(x, y + h - visible, w, 1).fill({ color: colorNum(f.sprite.palette.glow) });
    }
  }
}
