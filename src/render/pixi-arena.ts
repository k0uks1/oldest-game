/**
 * The arena on PixiJS (WebGL): a scene graph instead of immediate 2D-canvas calls.
 *
 * Same look as the canvas renderer, built from Pixi parts:
 *   baseRoot  → baseRT (480×270, nearest)   backdrop, floor effects, torches, fighters, particles
 *   glowRoot  → glowRT (480×270)            emissive only (torch flames, eyes, stars, rims, sparks)
 *   glowRT    → nearRT (240×135) + BlurFilter, farRT (120×68) + BlurFilter
 *   screen    = baseRT ×4 nearest + near/far bloom (additive) + crisp glow core + impact flash
 *
 * All motion and game-facing API live in {@link ArenaSim}; this class only mirrors that state
 * into display objects once per frame.
 */
import { autoDetectRenderer, BlurFilter, Container, Graphics, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";
import type { Ontology } from "../engine/ontology/ontology.ts";
import type { StageLayout } from "./stage.ts";
import { ArenaSim, easeOut, FLOOR_Y, GROUND_Y, HEIGHT, SIDE_X, TORCH_X, UPSCALE, WIDTH, type Fighter, type Side } from "./arena.ts";

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

/** A soft white disc, fading from the centre – tinted for torch light and light pools. */
function radialTexture(): Texture {
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

/** One layer of a fighter: a sprite whose texture frame shows only the materialised rows. */
interface Layer {
  readonly sprite: Sprite;
  readonly tex: Texture;
  readonly h: number;
}

interface FighterView {
  readonly base: Container;
  readonly glow: Container;
  readonly shadow: Graphics;
  readonly silhouette: Layer;
  readonly image: Layer;
  readonly stone: Layer;
  readonly flash: Sprite;
  readonly rim: Layer;
  readonly emissive: Layer;
  readonly scan: Graphics;
}

export class PixiArena extends ArenaSim {
  private renderer: Renderer | null = null;
  private failed = false;
  private readonly baseRoot = new Container();
  private readonly glowRoot = new Container();
  private readonly screen = new Container();
  private readonly views = new Map<Fighter, FighterView>();
  private readonly sources = new WeakMap<HTMLCanvasElement, Texture>();
  private baseRT: RenderTexture | null = null;
  private glowRT: RenderTexture | null = null;
  private nearRT: RenderTexture | null = null;
  private farRT: RenderTexture | null = null;
  private nearPass: Sprite | null = null;
  private farPass: Sprite | null = null;
  private backdropTex: Texture | null = null;
  private shownBackdrop = -1;
  private readonly radial: Texture;

  // immediate-mode layers (cleared and redrawn every frame)
  private readonly under = { base: new Graphics(), glow: new Graphics() };
  private readonly torchLights: Sprite[] = [];
  private readonly pools: [Sprite, Sprite];
  private readonly fightersBase = new Container();
  private readonly fightersGlow = new Container();
  private readonly over = { base: new Graphics(), glow: new Graphics() };
  private readonly overlay = new Graphics();
  private readonly flashRect = new Graphics();

  constructor(
    private readonly target: HTMLCanvasElement,
    onto: Ontology,
    stage?: StageLayout,
  ) {
    super(onto, stage);
    target.width = WIDTH * UPSCALE;
    target.height = HEIGHT * UPSCALE;
    this.radial = radialTexture();
    this.pools = [new Sprite(this.radial), new Sprite(this.radial)];
    this.ready = this.init();
  }

  /** true once WebGL is up; false (logged) if it could not start. */
  readonly ready: Promise<boolean>;

  private async init(): Promise<boolean> {
    try {
      const renderer = await autoDetectRenderer({
        canvas: this.target,
        width: WIDTH * UPSCALE,
        height: HEIGHT * UPSCALE,
        preference: "webgl",
        antialias: false,
        background: "#050309",
        resolution: 1,
        autoDensity: false,
      });
      this.renderer = renderer;
      this.build();
      return true;
    } catch (e) {
      this.failed = true;
      console.error("PixiJS konnte nicht starten:", e);
      return false;
    }
  }

  private build(): void {
    const rt = (w: number, h: number, nearest: boolean): RenderTexture => RenderTexture.create({ width: w, height: h, scaleMode: nearest ? "nearest" : "linear", resolution: 1 });
    this.baseRT = rt(WIDTH, HEIGHT, true);
    this.glowRT = rt(WIDTH, HEIGHT, true);
    this.nearRT = rt(WIDTH / 2, HEIGHT / 2, false);
    this.farRT = rt(WIDTH / 4, Math.ceil(HEIGHT / 4), false);

    this.backdropTex = Texture.from(this.backdrop);
    this.backdropTex.source.scaleMode = "nearest";
    const backdrop = new Sprite(this.backdropTex);
    for (const tx of TORCH_X) {
      const s = new Sprite(this.radial);
      s.anchor.set(0.5);
      s.position.set(tx, 84);
      s.tint = 0xffaa46;
      this.torchLights.push(s);
    }
    for (const p of this.pools) {
      p.anchor.set(0.5);
      p.visible = false;
    }
    this.baseRoot.addChild(backdrop, ...this.torchLights, this.under.base, ...this.pools, this.fightersBase, this.over.base, this.overlay);
    this.glowRoot.addChild(this.under.glow, this.fightersGlow, this.over.glow);

    // bloom: the glow layer downsampled and blurred at two sizes
    const near = new Sprite(this.glowRT);
    near.scale.set(0.5);
    near.filters = [new BlurFilter({ strength: 1.5, quality: 2 })];
    const far = new Sprite(this.glowRT);
    far.scale.set(0.25);
    far.filters = [new BlurFilter({ strength: 2, quality: 2 })];
    this.nearPass = near;
    this.farPass = far;

    const baseUp = new Sprite(this.baseRT);
    baseUp.scale.set(UPSCALE);
    const nearUp = new Sprite(this.nearRT);
    nearUp.scale.set(UPSCALE * 2);
    nearUp.blendMode = "add";
    nearUp.alpha = 0.9;
    const farUp = new Sprite(this.farRT);
    farUp.scale.set((WIDTH * UPSCALE) / (WIDTH / 4), (HEIGHT * UPSCALE) / Math.ceil(HEIGHT / 4));
    farUp.blendMode = "add";
    farUp.alpha = 0.75;
    const core = new Sprite(this.glowRT);
    core.scale.set(UPSCALE);
    core.blendMode = "add";
    core.alpha = 0.35;
    this.screen.addChild(baseUp, nearUp, farUp, core, this.flashRect);
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
      shadow: new Graphics(),
      silhouette: this.layer(s.silhouette),
      image: this.layer(s.image),
      stone: this.layer(s.stone),
      flash: new Sprite(this.texture(s.image)),
      rim: this.layer(s.rim),
      emissive: this.layer(s.glow),
      scan: new Graphics(),
    };
    v.flash.blendMode = "add";
    v.base.addChild(v.shadow, v.silhouette.sprite, v.image.sprite, v.stone.sprite, v.flash);
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
    if (r === null || this.failed || this.baseRT === null || this.glowRT === null || this.nearRT === null || this.farRT === null) return;
    if (this.shownBackdrop !== this.backdropVersion) {
      this.backdropTex?.source.update();
      this.shownBackdrop = this.backdropVersion;
    }
    const sx = Math.round((this.rand() - 0.5) * this.shake);
    const sy = Math.round((this.rand() - 0.5) * this.shake);
    this.baseRoot.position.set(sx, sy);
    this.glowRoot.position.set(sx, sy);

    this.drawUnder();
    this.syncFighters();
    this.drawOver();

    r.render({ container: this.baseRoot, target: this.baseRT, clear: true, clearColor: [0, 0, 0, 1] });
    r.render({ container: this.glowRoot, target: this.glowRT, clear: true, clearColor: [0, 0, 0, 0] });
    if (this.nearPass !== null) r.render({ container: this.nearPass, target: this.nearRT, clear: true, clearColor: [0, 0, 0, 0] });
    if (this.farPass !== null) r.render({ container: this.farPass, target: this.farRT, clear: true, clearColor: [0, 0, 0, 0] });
    this.flashRect.clear();
    if (this.flash > 0) this.flashRect.rect(0, 0, WIDTH * UPSCALE, HEIGHT * UPSCALE).fill({ color: colorNum(this.flashColor), alpha: this.flash });
    r.render({ container: this.screen });
  }

  /** Everything behind the fighters: stars, floor fields, eyes, torch flames, dust, rainbow, rune. */
  private drawUnder(): void {
    const b = this.under.base.clear();
    const g = this.under.glow.clear();
    const both = (fn: (x: Graphics, isGlow: boolean) => void): void => {
      fn(b, false);
      fn(g, true);
    };

    // stars behind fallen bricks
    if (this.openBricks > 0) {
      for (const st of this.stars) {
        if (this.open[st.brick] !== 1) continue;
        const tw = this.reducedMotion ? 0.6 : 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 1.3 + st.phase));
        g.rect(st.x, st.y, 1, 1).fill({ color: colorNum(st.color), alpha: tw });
      }
    }
    // floor fields
    const nass = this.field("nass");
    if (nass > 0.01) {
      for (let y = FLOOR_Y + 6; y < HEIGHT; y += 5) {
        const off = Math.round(Math.sin(this.time * 1.7 + y * 0.4) * 6);
        b.rect(40 + off, y, WIDTH - 80, 1).fill({ color: 0x3f8fc9, alpha: 0.18 * nass });
      }
    }
    const frost = this.field("frost");
    if (frost > 0.01) {
      for (let i = 0; i < 420; i++) {
        const x = (i * 7919) % WIDTH;
        const y = FLOOR_Y + ((i * 104729) % (HEIGHT - FLOOR_Y));
        const edge = Math.min(x, WIDTH - x) / (WIDTH / 2);
        if (edge > 0.25 + 0.75 * frost * ((i % 7) / 7)) continue;
        b.rect(x, y, 1 + (i % 3 === 0 ? 1 : 0), 1).fill({ color: 0xdff4ff, alpha: 0.5 * frost * (1 - edge) });
      }
    }
    // eyes in the dark
    for (let i = 0; i < this.witnesses; i++) {
      const e = this.eyes[i];
      if (e === undefined) continue;
      const cycle = (this.time + e.phase) % (4 + (i % 3));
      if (cycle < 0.14) continue;
      const fadeIn = Math.min(1, cycle / 1.5);
      const look = this.fighters[this.lookSide()] === null ? 0 : this.lookSide() === 0 ? -1 : 1;
      both((x, isGlow) => {
        const a = (isGlow ? 0.45 : 0.8) * fadeIn;
        x.rect(e.x + look, e.y, 1, 1).fill({ color: colorNum(e.color), alpha: a });
        x.rect(e.x + 4 + look, e.y, 1, 1).fill({ color: colorNum(e.color), alpha: a });
      });
    }
    // torches: light (sprite) and flame
    for (const [k, tx] of TORCH_X.entries()) {
      const flick = this.reducedMotion ? 0 : Math.sin(this.time * 17 + tx) * 0.5 + Math.sin(this.time * 7.3 + tx * 2) * 0.5;
      const light = this.torchLights[k];
      if (light !== undefined) {
        const rr = 50 + flick * 4;
        light.width = rr * 2;
        light.height = rr * 2;
        light.alpha = 0.32;
      }
      const h = 7 + Math.round(flick * 2);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((h - i) * 0.6));
        const color = i < 2 ? 0xfff3a0 : i < 4 ? 0xffb040 : 0xe8641c;
        const fx = tx - Math.floor(w / 2) + Math.round(Math.sin(this.time * 9 + i) * (i / 4));
        both((x) => x.rect(fx, 86 - i, w, 1).fill({ color }));
      }
    }
    // dust, only where light falls
    const lights: { x: number; y: number; r: number }[] = TORCH_X.map((x) => ({ x, y: 84, r: 70 }));
    for (const [side, f] of this.fighters.entries()) {
      if (f !== null && f.sprite.palette.emissive && f.reveal > 0.5) lights.push({ x: SIDE_X[side as Side], y: GROUND_Y - f.sprite.pixels.height / 2, r: 60 });
    }
    for (const m of this.motes) {
      let lit = 0;
      for (const l of lights) {
        const d = Math.hypot(m.x - l.x, (m.y - l.y) * 1.3);
        if (d < l.r) lit = Math.max(lit, 1 - d / l.r);
      }
      if (lit <= 0.05) continue;
      b.rect(Math.round(m.x), Math.round(m.y), 1, 1).fill({ color: 0xffd9a0, alpha: lit * (0.4 + 0.3 * Math.sin(m.phase * 2)) });
    }
    // rainbow
    if (this.rainbow > 0.01) {
      const colors = [0xff5a5a, 0xffa040, 0xffe060, 0x70e060, 0x60a0ff, 0x9a6aff];
      both((x, isGlow) => {
        const a = Math.min(1, this.rainbow * 1.5) * (isGlow ? 0.5 : 0.8);
        for (const [i, c] of colors.entries()) {
          // upper half of an ellipse, as a polyline (Graphics has no partial ellipse)
          const rx = 190 - i * 2;
          const ry = 150 - i * 2;
          for (let k = 0; k <= 48; k++) {
            const t = Math.PI + (k / 48) * Math.PI;
            if (k === 0) x.moveTo(240 + Math.cos(t) * rx, GROUND_Y + Math.sin(t) * ry);
            else x.lineTo(240 + Math.cos(t) * rx, GROUND_Y + Math.sin(t) * ry);
          }
          x.stroke({ width: 2, color: c, alpha: a });
        }
      });
    }
    // rune circle
    const pulse = 0.22 + Math.sin(this.time * 1.5) * 0.06 + this.thinking * 0.5;
    const spin = this.time * (0.3 + this.thinking * 2.5);
    const runeColor = this.thinking > 0.2 ? 0xc8a0ff : 0x8a62b0;
    const { cx, cy, outer, inner, orbit } = this.stage.rune;
    both((x, isGlow) => {
      const a = isGlow ? pulse * 0.8 : pulse;
      x.ellipse(cx, cy, outer[0], outer[1]).stroke({ width: 1, color: runeColor, alpha: a });
      x.ellipse(cx, cy, inner[0], inner[1]).stroke({ width: 1, color: runeColor, alpha: a });
      for (let i = 0; i < 12; i++) {
        const ang = spin + (i / 12) * Math.PI * 2;
        x.rect(Math.round(cx + Math.cos(ang) * orbit[0]), Math.round(cy + Math.sin(ang) * orbit[1]), 2, 1).fill({ color: runeColor, alpha: a });
      }
    });
    // light pools under the fighters
    for (const [side, f] of this.fighters.entries()) {
      const pool = this.pools[side as Side];
      if (f === null || f.alpha <= 0) {
        pool.visible = false;
        continue;
      }
      const rr = f.sprite.pixels.width * 0.9;
      pool.visible = true;
      pool.tint = colorNum(f.sprite.palette.glow);
      pool.alpha = (f.sprite.palette.emissive ? 0.35 : 0.12) * f.appear;
      pool.position.set(SIDE_X[side as Side] + f.offsetX, GROUND_Y);
      pool.width = rr * 2;
      pool.height = rr * 0.7;
    }
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
      const shw = Math.round(w * 0.4);
      v.shadow.clear().rect(SIDE_X[s] - shw + Math.round(f.offsetX), GROUND_Y - 1, shw * 2, 3).fill({ color: 0x000000, alpha: 0.45 });
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

  /** Everything in front: discovery star, bolts, rings, particles, field overlays. */
  private drawOver(): void {
    const b = this.over.base.clear();
    const g = this.over.glow.clear();
    const both = (fn: (x: Graphics) => void): void => {
      fn(b);
      fn(g);
    };
    const d = this.discoveryGlow;
    const df = d === null ? null : this.fighters[d.side];
    if (d !== null && df !== null) {
      const { x, y, w } = this.fighterRect(d.side, df);
      const cx = x + Math.floor(w / 2);
      const cy = y - 12 + Math.round(Math.sin(this.time * 2) * 2);
      const a = Math.min(1, d.life * 3) * Math.min(1, (3.2 - d.life) / 0.8);
      const arm = 3 + Math.round(Math.sin(this.time * 5) + 1);
      both((c) => {
        c.rect(cx, cy - arm, 1, arm * 2 + 1).fill({ color: 0xfff4c8, alpha: a });
        c.rect(cx - arm, cy, arm * 2 + 1, 1).fill({ color: 0xfff4c8, alpha: a });
        c.rect(cx - 1, cy - 1, 3, 3).fill({ color: 0xffd86a, alpha: a });
      });
    }
    for (const bolt of this.bolts) {
      const a = Math.max(0, 1 - bolt.life / bolt.max) * (Math.floor(bolt.life * 30) % 2 === 0 ? 1 : 0.6);
      both((c) => {
        for (const [i, [px, py]] of bolt.points.entries()) {
          if (i === 0) c.moveTo(Math.round(px) + 0.5, Math.round(py) + 0.5);
          else c.lineTo(Math.round(px) + 0.5, Math.round(py) + 0.5);
        }
        c.stroke({ width: 1, color: colorNum(bolt.color), alpha: a });
      });
    }
    for (const ring of this.rings) {
      const a = Math.max(0, 1 - ring.life / ring.max);
      if (ring.life < 0 || ring.r <= 0) continue;
      both((c) => c.ellipse(Math.round(ring.x), Math.round(ring.y), ring.r, ring.r * 0.35).stroke({ width: 1, color: colorNum(ring.color), alpha: a }));
    }
    for (const p of this.particles) {
      if (p.life < 0) continue;
      const fade = Math.max(0, 1 - p.life / p.max);
      const color = colorNum(p.color);
      b.rect(Math.round(p.x), Math.round(p.y), p.size, p.size).fill({ color, alpha: fade });
      if (p.glow) g.rect(Math.round(p.x), Math.round(p.y), p.size, p.size).fill({ color, alpha: fade });
    }
    // darkness, dust haze, silence
    const o = this.overlay.clear();
    const dark = this.field("finsternis");
    if (dark > 0.01) o.rect(-10, -10, WIDTH + 20, HEIGHT + 20).fill({ color: 0x020106, alpha: 0.45 * dark });
    const staub = this.field("staub");
    if (staub > 0.01) o.rect(-10, -10, WIDTH + 20, HEIGHT + 20).fill({ color: 0x6a5a44, alpha: 0.12 * staub });
    const still = this.field("stille");
    if (still > 0.01) o.rect(-10, -10, WIDTH + 20, HEIGHT + 20).fill({ color: 0x1a2030, alpha: 0.15 * still });
  }
}
