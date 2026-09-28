/**
 * "Bauplan": sprites assembled from a part library instead of drawn freehand.
 *
 *  - symbols: every hand-drawn sketch (`content/core/sketches.json`) plus the emblem/item symbols
 *    (`content/core/symbols.json`), all 32×32 in the sketch colour roles
 *  - items: things a person can hold (`content/core/items.json`) – a symbol, a pose and the
 *    item's own material colours, so a rifle stays wood and steel whoever carries it
 *
 * A concept like "politische Korruption" becomes a money bag with a crown badge – recognisable,
 * and Claude only has to pick ids from closed lists. Pure: no DOM, same result everywhere.
 */
import itemsJson from "../content/core/items.json" with { type: "json" };
import sketchesJson from "../content/core/sketches.json" with { type: "json" };
import symbolsJson from "../content/core/symbols.json" with { type: "json" };
import type { Form, FormLook } from "../engine/types.ts";
import { rasterizeFrame, tintOf } from "./svgsprite.ts";

export type ItemPose = "lang" | "kurz" | "klein";

export interface ItemSpec {
  readonly id: string;
  readonly label: string;
  readonly symbol: string;
  readonly pose: ItemPose;
  /** Colour of the symbol's main role (#808080) and second role (#c0c0c0). */
  readonly main: string;
  readonly second: string;
  /** Degrees, to stand the symbol upright (a rifle is drawn lying down). */
  readonly rotate?: number;
}

const SYMBOLS: ReadonlyMap<string, string> = new Map([...Object.entries(sketchesJson as Record<string, string>), ...Object.entries(symbolsJson as Record<string, string>)]);

export const ITEMS: ReadonlyMap<string, ItemSpec> = new Map((itemsJson as readonly ItemSpec[]).map((i) => [i.id, i]));

/** Ids Claude may choose from (prompt enums). */
export const SYMBOL_IDS: readonly string[] = [...SYMBOLS.keys()].sort();
export const ITEM_IDS: readonly string[] = [...ITEMS.keys()].sort();

export function symbolSvg(id: string): string | undefined {
  return SYMBOLS.get(id);
}

/** Drawing markup inside the root <svg>. */
function inner(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
}

/** Main and second role swapped – a badge reads as the second colour next to its emblem. */
function swapRoles(markup: string): string {
  return markup.replaceAll("#808080", "#__main__").replaceAll("#c0c0c0", "#808080").replaceAll("#__main__", "#c0c0c0");
}

function svg(body: string, tint: { main?: string | undefined; second?: string | undefined }): string {
  const attrs = `${tint.main === undefined ? "" : ` data-main="${tint.main}"`}${tint.second === undefined ? "" : ` data-second="${tint.second}"`}`;
  return `<svg viewBox="0 0 32 32"${attrs}>${body}</svg>`;
}

/**
 * The sketch a form is drawn from: its own, else one composed from its emblem (+ badge).
 * Colour hints: the look's colours first, then the emblem's own, the badge's own as second colour.
 */
export function sketchOf(form: Form): string | undefined {
  if (form.sketch !== undefined) return form.sketch;
  const look = form.look;
  const emblem = look?.emblem === undefined ? undefined : symbolSvg(look.emblem);
  if (look === undefined || emblem === undefined) return undefined;
  const badge = look.badge === undefined ? undefined : symbolSvg(look.badge);
  const own = tintOf(emblem);
  const badgeTint = badge === undefined ? {} : tintOf(badge);
  const body =
    badge === undefined
      ? inner(emblem)
      : `${inner(emblem)}<circle cx="25" cy="25" r="7.6" fill="#202020"/><g transform="translate(18.6 18.6) scale(0.4)">${swapRoles(inner(badge))}</g>`;
  return svg(body, { main: look.main ?? own.main, second: look.second ?? (badge === undefined ? own.second : (badgeTint.main ?? own.second)) });
}

/** Where a held item sits on the 32×32 person figure (right hand at about x 22, y 23). */
const POSES: Readonly<Record<ItemPose, { readonly scale: number; readonly cx: number; readonly cy: number }>> = {
  lang: { scale: 0.8, cx: 23, cy: 16 },
  kurz: { scale: 0.55, cx: 23.5, cy: 19.5 },
  klein: { scale: 0.38, cx: 23.5, cy: 21.5 },
};

const overlayCache = new Map<string, readonly string[] | null>();

/**
 * The held item as 32×32 rows in the figure's frame, in the item symbols
 * `m` (item main colour) and `n` (item second colour); `o * ,` keep their meaning.
 */
export function itemRows(id: string): readonly string[] | undefined {
  const hit = overlayCache.get(id);
  if (hit !== undefined) return hit ?? undefined;
  const item = ITEMS.get(id);
  const art = item === undefined ? undefined : symbolSvg(item.symbol);
  let rows: readonly string[] | null = null;
  if (item !== undefined && art !== undefined) {
    const p = POSES[item.pose];
    const t = `translate(${String(p.cx - 16 * p.scale)} ${String(p.cy - 16 * p.scale)}) scale(${String(p.scale)}) rotate(${String(item.rotate ?? 0)} 16 16)`;
    const raw = rasterizeFrame(svg(`<g transform="${t}">${inner(art)}</g>`, {}));
    rows = raw?.map((r) => r.replaceAll("#", "m").replaceAll("+", "n")) ?? null;
  }
  overlayCache.set(id, rows);
  return rows ?? undefined;
}

/** The held item, if the form holds a known one and has hands. */
export function heldItem(form: Form): ItemSpec | undefined {
  if (form.archetype !== "humanoid" && form.archetype !== "giant") return undefined;
  const id = form.look?.holds;
  return id === undefined ? undefined : ITEMS.get(id);
}

/** Look fields that name something this library has (the rest is dropped). */
export function knownLook(look: FormLook): FormLook {
  const out: { -readonly [K in keyof FormLook]: FormLook[K] } = {};
  if (look.holds !== undefined && ITEMS.has(look.holds)) out.holds = look.holds;
  if (look.emblem !== undefined && SYMBOLS.has(look.emblem)) out.emblem = look.emblem;
  if (look.badge !== undefined && SYMBOLS.has(look.badge)) out.badge = look.badge;
  if (look.main !== undefined) out.main = look.main;
  if (look.second !== undefined) out.second = look.second;
  return out;
}
