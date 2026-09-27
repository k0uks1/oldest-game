import type { TagDef } from "../engine/types.ts";

/**
 * Closed vocabulary of properties. Rules never mention concrete forms –
 * only these tags – so any new form (lexicon, composed or LLM-parsed)
 * automatically takes part in the rule system.
 */
const defs = [
  // ── Material ────────────────────────────────────────────────────────
  { id: "fest", label: "fest", group: "material" },
  { id: "fluessig", label: "flüssig", group: "material" },
  { id: "gas", label: "gasförmig", group: "material" },
  { id: "metall", label: "Metall", group: "material" },
  { id: "holz", label: "Holz", group: "material" },
  { id: "stein", label: "Stein", group: "material" },
  { id: "glas", label: "Glas", group: "material" },
  { id: "stoff", label: "Stoff/Papier", group: "material" },
  { id: "fleisch", label: "Fleisch", group: "material" },
  { id: "knochen", label: "Knochen", group: "material" },
  { id: "kristall", label: "Kristall", group: "material" },
  { id: "koerperlos", label: "körperlos", group: "material" },
  { id: "masse", label: "gewaltige Masse", group: "material" },

  // ── Elemente ────────────────────────────────────────────────────────
  { id: "feuer", label: "Feuer", group: "element", grants: ["verbrennt", "schmilzt", "verdampft"] },
  { id: "wasser", label: "Wasser", group: "element", grants: ["loescht", "erodiert", "ertraenkt", "loest_auf"] },
  { id: "eis", label: "Eis", group: "element", grants: ["gefriert"] },
  { id: "erde", label: "Erde", group: "element", grants: ["begraebt"] },
  { id: "luft", label: "Wind", group: "element", grants: ["verweht"] },
  { id: "blitz", label: "Blitz", group: "element", grants: ["trifft_blitz"] },
  { id: "licht", label: "Licht", group: "element", grants: ["blendet", "durchleuchtet"] },
  { id: "schatten", label: "Schatten", group: "element", grants: ["verdunkelt", "taeuscht"] },
  { id: "gift", label: "Gift", group: "element", grants: ["vergiftet"] },
  { id: "saeure", label: "Säure", group: "element", grants: ["zersetzt"] },

  // ── Körper ──────────────────────────────────────────────────────────
  { id: "lebendig", label: "lebendig", group: "koerper" },
  { id: "atmet", label: "atmet", group: "koerper" },
  { id: "sieht", label: "sieht", group: "koerper" },
  { id: "hoert", label: "hört", group: "koerper" },
  { id: "isst", label: "muss essen", group: "koerper" },
  { id: "schlaeft", label: "schläft", group: "koerper" },
  { id: "blutet", label: "blutet", group: "koerper" },
  { id: "pflanze", label: "Pflanze", group: "koerper" },
  { id: "tier", label: "Tier", group: "koerper" },
  { id: "mensch", label: "Mensch", group: "koerper" },
  { id: "untot", label: "untot", group: "koerper", grants: ["aengstigt"] },
  { id: "konstrukt", label: "Konstrukt", group: "koerper" },
  { id: "schwarm", label: "Schwarm/Heer", group: "koerper", grants: ["ueberrennt"] },
  { id: "fliegt", label: "fliegt", group: "koerper" },
  { id: "schwimmt", label: "schwimmt", group: "koerper" },
  { id: "graebt", label: "gräbt", group: "koerper" },

  // ── Geist ───────────────────────────────────────────────────────────
  { id: "denkt", label: "denkt", group: "geist" },
  { id: "fuehlt", label: "fühlt", group: "geist" },
  { id: "stolz", label: "stolz", group: "geist" },
  { id: "gierig", label: "gierig", group: "geist" },
  { id: "furchtsam", label: "furchtsam", group: "geist" },
  { id: "einsam", label: "einsam", group: "geist" },
  { id: "neugierig", label: "neugierig", group: "geist" },
  { id: "glaubt", label: "glaubt", group: "geist" },
  { id: "erinnert", label: "erinnert sich", group: "geist" },
  { id: "traeumt", label: "träumt", group: "geist" },
  { id: "wahnsinnig", label: "wahnsinnig", group: "geist" },
  { id: "gehorcht", label: "gehorcht", group: "geist" },
  { id: "hofft", label: "hofft", group: "geist" },

  // ── Existenz ────────────────────────────────────────────────────────
  { id: "sterblich", label: "sterblich", group: "existenz" },
  { id: "unsterblich", label: "unsterblich", group: "existenz" },
  { id: "zeitgebunden", label: "vergänglich", group: "existenz" },
  { id: "magisch", label: "magisch", group: "existenz" },
  { id: "heilig", label: "heilig", group: "existenz", grants: ["bannt", "erloest"] },
  { id: "verflucht", label: "verflucht", group: "existenz" },
  { id: "daemonisch", label: "dämonisch", group: "existenz", grants: ["verflucht", "verfuehrt"] },
  { id: "geordnet", label: "Ordnung", group: "existenz", grants: ["ordnet"] },
  { id: "chaotisch", label: "Chaos", group: "existenz", grants: ["entfesselt"] },
  { id: "benannt", label: "hat einen wahren Namen", group: "existenz" },
  { id: "gebunden", label: "an einen Pakt gebunden", group: "existenz" },
  { id: "leer", label: "Leere", group: "existenz" },
  { id: "endgueltig", label: "Endgültigkeit", group: "existenz" },
  { id: "braucht_glaube", label: "braucht Glauben", group: "existenz" },
  { id: "braucht_energie", label: "braucht Energie", group: "existenz" },
  { id: "traum", label: "aus Traumstoff", group: "existenz" },
  { id: "krankheit", label: "Krankheit", group: "existenz" },
  { id: "falsch", label: "Trugbild", group: "existenz" },
  { id: "loeslich", label: "löslich", group: "material" },
] as const satisfies readonly TagDef[];

export type TagId = (typeof defs)[number]["id"];

export const TAGS: ReadonlyMap<TagId, TagDef<TagId>> = new Map(
  defs.map((d) => [d.id, d as TagDef<TagId>]),
);

export const TAG_IDS: readonly TagId[] = defs.map((d) => d.id);

export function isTagId(value: string): value is TagId {
  return TAGS.has(value as TagId);
}

export function tagLabel(id: string): string {
  return isTagId(id) ? (TAGS.get(id)?.label ?? id) : id;
}
