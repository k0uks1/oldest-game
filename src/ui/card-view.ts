/**
 * The form card in the DOM – grimoire entries and the overview under the input line.
 * All content comes from `formCard` (pure); this only lays it out.
 */
import type { FormCard } from "../game/card.ts";
import type { PixelImage } from "../render/sprite.ts";
import { h } from "./dom.ts";

/** A pixel image at a fixed on-screen size, crisp (no smoothing). */
export function spriteCanvas(img: PixelImage, px: number): HTMLCanvasElement {
  const canvas = h("canvas", { class: "card-sprite", "aria-hidden": "true" });
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${String(px)}px`;
  canvas.style.height = `${String(Math.round((px * img.height) / img.width))}px`;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

function row(label: string, items: readonly (string | HTMLElement)[], cls = "", sep = " · "): HTMLElement | null {
  if (items.length === 0) return null;
  return h("div", { class: `card-row ${cls}` }, h("span", { class: "card-key" }, label), h("span", { class: "card-val" }, ...items.flatMap((x, i) => (i === 0 ? [x] : [sep, x]))));
}

export interface CardViewOptions {
  readonly sprite?: PixelImage;
  /** Sprite size on screen (px). */
  readonly spritePx?: number;
  /** Legend: text, or a promise (a quiet placeholder until it arrives), or nothing. */
  readonly lore?: string | Promise<string | undefined>;
  /** Extra line under the name (discovered by …). */
  readonly meta?: string;
}

export function cardView(card: FormCard, opts: CardViewOptions = {}): HTMLElement {
  const chip = (text: string, cls: string): HTMLElement => h("span", { class: `chip ${cls}` }, text);
  const levels = card.levels.map((l) => chip(`${l.label} ${String(l.level)}`, l.kind === "kraft" ? "force" : "guard"));
  const variant =
    card.base === undefined
      ? null
      : h(
          "div",
          { class: "card-variant" },
          h("span", { class: "card-key" }, "Abwandlung"),
          h(
            "span",
            { class: "card-val" },
            `von ${card.base.name}`,
            ...card.mods.map((m) => chip(m, "mod")),
            ...card.added.map((t) => chip(`+ ${t}`, "plus")),
            ...card.removed.map((t) => chip(`− ${t}`, "minus")),
          ),
        );
  const legend = h("p", { class: `card-lore${card.tone === undefined ? "" : ` tone-${card.tone}`}` });
  const lore = opts.lore;
  if (typeof lore === "string") legend.textContent = lore;
  else if (lore !== undefined) {
    legend.classList.add("waiting");
    legend.textContent = "Das Grimoire blättert …";
    void lore.then((text) => {
      legend.classList.remove("waiting");
      legend.textContent = text ?? card.flavor ?? "";
      legend.hidden = legend.textContent === "";
    });
  } else {
    legend.textContent = card.flavor ?? "";
    legend.hidden = legend.textContent === "";
  }
  return h(
    "article",
    { class: `form-card${card.learned ? " learned" : ""}` },
    h(
      "header",
      { class: "card-head" },
      opts.sprite === undefined ? null : spriteCanvas(opts.sprite, opts.spritePx ?? 96),
      h(
        "div",
        { class: "card-title" },
        h("h3", {}, `${card.learned ? "✦ " : ""}${card.name}`),
        h("div", { class: "card-sub" }, `${card.scaleName} · ${card.plane}`),
        opts.meta === undefined ? null : h("div", { class: "card-meta" }, opts.meta),
      ),
    ),
    variant,
    row("ist", [...card.is]),
    row("hat", [...card.traits]),
    row(
      "kann",
      card.can.map((a) => h("span", { class: "ability" }, a.label, a.via === undefined ? null : h("small", {}, ` (${a.via})`))),
    ),
    row("Stärke", levels, "", " "),
    row("Schwäche", [...card.weak], "weak"),
    legend,
  );
}
