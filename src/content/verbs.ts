import type { VerbDef } from "../engine/types.ts";
import type { TagId } from "./tags.ts";

/**
 * Mechanisms ("Wie besiegst du es?"). A counter is a (form, mechanism) pair.
 * Rules are written purely against tags, never against concrete forms.
 *
 * Leverage guideline:
 *   0  brute force – you must be at least as big
 *   1  elemental advantage
 *   2  targeted weakness (senses, poison, time)
 *   3  subtle / mind / magic – small beats big
 *   4+ mythic leverage (true names, waking the dreamer, hope)
 */
const defs = [
  // ── Gewalt ──────────────────────────────────────────────────────────
  {
    id: "zerschlaegt", label: "zerschlägt", family: "gewalt", leverage: 0,
    targets: ["fest", "glas", "stein", "knochen", "kristall", "eis"],
    blockedBy: ["koerperlos", "fluessig", "gas"],
    hint: "Rohe Kraft gegen Festes. Größe entscheidet.",
  },
  {
    id: "zerreisst", label: "zerreißt", family: "gewalt", leverage: 0,
    targets: ["fleisch", "stoff", "pflanze"],
    blockedBy: ["koerperlos", "metall", "stein"],
    hint: "Klauen und Zähne gegen Weiches.",
  },
  {
    id: "durchbohrt", label: "durchbohrt", family: "gewalt", leverage: 1,
    targets: ["fleisch", "holz", "stoff"],
    blockedBy: ["koerperlos", "schwarm", "metall", "stein"],
    hint: "Spitze gegen Ungepanzertes. Ein Stich braucht wenig Größe.",
  },
  {
    id: "verschlingt", label: "verschlingt", family: "gewalt", leverage: 0, minRelativeScale: 1,
    targets: ["fleisch", "pflanze", "tier", "mensch"],
    blockedBy: ["koerperlos", "gift"],
    hint: "Fressen. Nur wer größer ist, kann schlucken.",
  },
  {
    id: "zermalmt", label: "zermalmt", family: "gewalt", leverage: 0,
    targets: ["masse", "fest", "konstrukt"],
    blockedBy: ["koerperlos"],
    hint: "Gewicht und Schwerkraft. Reine Größe.",
  },
  {
    id: "sprengt", label: "sprengt", family: "gewalt", leverage: 1,
    targets: ["fest", "stein", "metall", "konstrukt"],
    blockedBy: ["koerperlos", "fluessig", "gas"],
    hint: "Explosive Kraft gegen starre Dinge.",
  },
  {
    id: "ueberrennt", label: "überrennt", family: "gewalt", leverage: 1,
    targets: ["lebendig", "konstrukt"],
    blockedBy: ["koerperlos", "fliegt"],
    hint: "Masse aus Vielen. Wer nicht fliegen kann, wird überrollt.",
  },
  {
    id: "fesselt", label: "fesselt", family: "gewalt", leverage: 2,
    targets: ["tier", "mensch"],
    blockedBy: ["koerperlos", "fluessig", "gas", "schwarm"],
    hint: "Netze, Ketten, Ranken. Klein kann Groß binden.",
  },

  // ── Elemente ────────────────────────────────────────────────────────
  {
    id: "verbrennt", label: "verbrennt", family: "element", leverage: 1,
    targets: ["holz", "stoff", "pflanze", "fleisch", "krankheit"],
    blockedBy: ["feuer", "wasser", "stein", "koerperlos"],
    hint: "Feuer frisst, was brennt.",
  },
  {
    id: "schmilzt", label: "schmilzt", family: "element", leverage: 1,
    targets: ["eis", "metall", "glas"],
    blockedBy: ["feuer"],
    hint: "Hitze gegen Eis, Metall und Glas.",
  },
  {
    id: "verdampft", label: "verdampft", family: "element", leverage: 0,
    targets: ["wasser", "fluessig"],
    blockedBy: ["masse", "eis"],
    hint: "Große Hitze lässt Wasser verkochen – Größe entscheidet.",
  },
  {
    id: "loest_auf", label: "löst auf", family: "element", leverage: 2,
    targets: ["loeslich"],
    blockedBy: [],
    hint: "Salz, Zucker, Tinte – Wasser löst es auf.",
  },
  {
    id: "loescht", label: "löscht", family: "element", leverage: 2,
    targets: ["feuer"],
    blockedBy: [],
    hint: "Wasser gegen Feuer – der älteste Konter.",
  },
  {
    id: "gefriert", label: "lässt erstarren", family: "element", leverage: 1,
    targets: ["wasser", "fluessig", "lebendig"],
    blockedBy: ["eis", "feuer"],
    hint: "Kälte hält alles an, was fließt oder lebt.",
  },
  {
    id: "ertraenkt", label: "ertränkt", family: "element", leverage: 1,
    targets: ["atmet", "feuer"],
    blockedBy: ["schwimmt", "wasser", "koerperlos"],
    hint: "Wer atmen muss, fürchtet die Tiefe.",
  },
  {
    id: "erodiert", label: "trägt ab", family: "element", leverage: 2,
    targets: ["stein", "erde"],
    blockedBy: [],
    hint: "Stetes Wasser höhlt den Stein.",
  },
  {
    id: "begraebt", label: "begräbt", family: "element", leverage: 1,
    targets: ["atmet", "feuer"],
    blockedBy: ["fliegt", "koerperlos", "graebt"],
    hint: "Erde erstickt Atem und Flamme.",
  },
  {
    id: "verweht", label: "verweht", family: "element", leverage: 1,
    targets: ["gas", "schwarm", "feuer"],
    blockedBy: ["masse"],
    hint: "Wind zerstreut Leichtes und bläst Flammen aus.",
  },
  {
    id: "trifft_blitz", label: "trifft mit einem Blitz", family: "element", leverage: 1,
    targets: ["metall", "wasser", "konstrukt"],
    blockedBy: ["erde", "stein", "koerperlos"],
    hint: "Strom sucht Metall und Wasser. Erde leitet ab.",
  },
  {
    id: "blendet", label: "blendet", family: "sinne", leverage: 2,
    targets: ["sieht"],
    blockedBy: ["licht"],
    hint: "Wer sieht, kann geblendet werden.",
  },
  {
    id: "durchleuchtet", label: "vertreibt mit Licht", family: "element", leverage: 2,
    targets: ["schatten", "untot", "falsch"],
    blockedBy: ["licht"],
    hint: "Licht vertreibt Schatten und Untote.",
  },
  {
    id: "verdunkelt", label: "verschluckt das Licht", family: "element", leverage: 1,
    targets: ["licht"],
    blockedBy: ["schatten"],
    hint: "Dunkelheit gegen Licht.",
  },
  {
    id: "vergiftet", label: "vergiftet", family: "leben", leverage: 2,
    targets: ["lebendig"],
    blockedBy: ["untot", "konstrukt", "gift", "koerperlos"],
    hint: "Ein Tropfen genügt für alles, was lebt.",
  },
  {
    id: "zersetzt", label: "zersetzt", family: "element", leverage: 1,
    targets: ["metall", "fleisch", "stein", "holz", "stoff"],
    blockedBy: ["glas", "saeure", "koerperlos"],
    hint: "Säure frisst fast alles – außer Glas.",
  },
  {
    id: "rostet", label: "lässt rosten", family: "element", leverage: 3,
    targets: ["metall"],
    blockedBy: [],
    hint: "Rost braucht nur Zeit. Metall kann nicht fliehen.",
  },

  // ── Leben ───────────────────────────────────────────────────────────
  {
    id: "infiziert", label: "befällt", family: "leben", leverage: 3,
    targets: ["lebendig", "blutet"],
    blockedBy: ["untot", "konstrukt", "koerperlos", "heilig"],
    hint: "Seuchen machen das Winzige tödlich.",
  },
  {
    id: "verhungern", label: "lässt verhungern", family: "leben", leverage: 2,
    targets: ["isst"],
    blockedBy: [],
    hint: "Wer essen muss, kann ausgehungert werden.",
  },
  {
    id: "verrottet", label: "lässt verrotten", family: "leben", leverage: 2,
    targets: ["holz", "pflanze", "fleisch", "stoff"],
    blockedBy: ["metall", "stein", "glas", "koerperlos"],
    hint: "Fäulnis, Schimmel, Zerfall.",
  },
  {
    id: "heilt", label: "heilt", family: "leben", leverage: 3,
    targets: ["krankheit", "verflucht"],
    blockedBy: [],
    hint: "Heilkunst gegen Seuche und Fluch.",
  },
  {
    id: "saugt_aus", label: "saugt aus", family: "leben", leverage: 2,
    targets: ["blutet", "braucht_energie"],
    blockedBy: ["untot"],
    hint: "Blut oder Energie – was fließt, kann abgezapft werden.",
  },

  // ── Sinne ───────────────────────────────────────────────────────────
  {
    id: "uebertoent", label: "übertönt", family: "sinne", leverage: 2,
    targets: ["hoert"],
    blockedBy: [],
    hint: "Lärm betäubt, wer hören kann.",
  },
  {
    id: "lockt", label: "lockt fort", family: "sinne", leverage: 2,
    targets: ["tier", "gierig", "neugierig"],
    blockedBy: ["konstrukt"],
    hint: "Köder, Melodien, Verheißungen.",
  },

  // ── Geist ───────────────────────────────────────────────────────────
  {
    id: "aengstigt", label: "ängstigt", family: "geist", leverage: 2,
    targets: ["furchtsam"],
    blockedBy: ["wahnsinnig", "konstrukt", "untot"],
    hint: "Furcht lähmt die Furchtsamen.",
  },
  {
    id: "verfuehrt", label: "verführt", family: "geist", leverage: 3,
    targets: ["gierig"],
    blockedBy: ["heilig"],
    hint: "Gier ist ein Haken, den man nur ködern muss.",
  },
  {
    id: "demuetigt", label: "demütigt", family: "geist", leverage: 3,
    targets: ["stolz"],
    blockedBy: [],
    hint: "Hochmut kommt vor dem Fall.",
  },
  {
    id: "befreundet", label: "zähmt mit Freundschaft", family: "geist", leverage: 3,
    targets: ["einsam"],
    blockedBy: ["daemonisch", "wahnsinnig"],
    hint: "Das einsame Monster will keinen Kampf – es will einen Freund.",
  },
  {
    id: "taeuscht", label: "täuscht", family: "geist", leverage: 2,
    targets: ["denkt"],
    blockedBy: ["wahnsinnig"],
    hint: "Wer denkt, kann getäuscht werden.",
  },
  {
    id: "entlarvt", label: "entlarvt", family: "geist", leverage: 3,
    targets: ["falsch", "traum"],
    blockedBy: [],
    hint: "Trugbilder zerfallen, sobald jemand sie beim Namen nennt.",
  },
  {
    id: "vergessen", label: "lässt vergessen", family: "geist", leverage: 3,
    targets: ["erinnert", "braucht_glaube"],
    blockedBy: [],
    hint: "Was vergessen ist, war nie.",
  },
  {
    id: "einschlaefern", label: "wiegt in Schlaf", family: "geist", leverage: 3,
    targets: ["schlaeft"],
    blockedBy: ["untot", "wahnsinnig"],
    hint: "Ein Wiegenlied besiegt Riesen.",
  },
  {
    id: "befiehlt", label: "übernimmt den Befehl über", family: "geist", leverage: 2,
    targets: ["gehorcht"],
    blockedBy: [],
    hint: "Wer gehorcht, dient auch einem anderen Herrn.",
  },
  {
    id: "zweifel", label: "sät Zweifel in", family: "geist", leverage: 3,
    targets: ["glaubt", "braucht_glaube"],
    blockedBy: ["wahnsinnig"],
    hint: "Götter und Fanatiker leben vom Glauben.",
  },
  {
    id: "verzweiflung", label: "raubt die Hoffnung", family: "geist", leverage: 2,
    targets: ["hofft", "fuehlt"],
    blockedBy: ["konstrukt"],
    hint: "Verzweiflung erstickt jedes Gefühl.",
  },
  {
    id: "weckt", label: "weckt den Träumer von", family: "geist", leverage: 4,
    targets: ["traum", "traeumt"],
    blockedBy: [],
    hint: "Träume enden, wenn jemand erwacht.",
  },

  // ── Magie ───────────────────────────────────────────────────────────
  {
    id: "bannt", label: "bannt", family: "magie", leverage: 3,
    targets: ["daemonisch", "untot"],
    blockedBy: ["heilig"],
    hint: "Heiliges bannt Dämonen und Untote.",
  },
  {
    id: "erloest", label: "erlöst", family: "magie", leverage: 3,
    targets: ["verflucht"],
    blockedBy: [],
    hint: "Ein Fluch endet, wenn jemand erlöst.",
  },
  {
    id: "verflucht", label: "verflucht", family: "magie", leverage: 1,
    targets: ["sterblich", "benannt"],
    blockedBy: ["heilig", "verflucht"],
    hint: "Flüche treffen Sterbliche und Benannte.",
  },
  {
    id: "entzaubert", label: "entzaubert", family: "magie", leverage: 2,
    targets: ["magisch"],
    blockedBy: [],
    hint: "Kalter Stahl, Salz, Vernunft – Magie zerfällt.",
  },
  {
    id: "wahrer_name", label: "nennt den wahren Namen von", family: "magie", leverage: 4,
    targets: ["benannt"],
    blockedBy: [],
    hint: "Wer den wahren Namen kennt, hat Macht.",
  },
  {
    id: "bricht_pakt", label: "bricht den Pakt von", family: "magie", leverage: 3,
    targets: ["gebunden"],
    blockedBy: [],
    hint: "Was durch einen Pakt existiert, vergeht mit ihm.",
  },
  {
    id: "versiegelt", label: "versiegelt", family: "magie", leverage: 2,
    targets: ["daemonisch", "gas", "koerperlos"],
    blockedBy: ["leer", "unsterblich"],
    hint: "Flasche, Lampe, Siegel.",
  },

  // ── Kosmos ──────────────────────────────────────────────────────────
  {
    id: "ueberdauert", label: "überdauert", family: "kosmos", leverage: 2,
    targets: ["sterblich", "zeitgebunden"],
    blockedBy: ["unsterblich"],
    hint: "Alles Vergängliche vergeht – man muss nur warten.",
  },
  {
    id: "beendet", label: "beendet", family: "kosmos", leverage: 1,
    targets: ["sterblich", "zeitgebunden", "lebendig", "braucht_energie", "masse"],
    blockedBy: ["unsterblich", "hofft", "leer"],
    hint: "Entropie. Das Ende aller Dinge. Nur was hofft oder nichts ist, entgeht ihm.",
  },
  {
    id: "trotzt", label: "trotzt", family: "kosmos", leverage: 5,
    targets: ["endgueltig", "leer"],
    blockedBy: [],
    hint: "Selbst im Nichts kann es Hoffnung geben.",
  },
  {
    id: "fuellt", label: "füllt die Leere von", family: "kosmos", leverage: 3,
    targets: ["leer"],
    blockedBy: [],
    hint: "Leere ist nur ein Raum, der auf etwas wartet.",
  },
  {
    id: "ordnet", label: "bringt Ordnung über", family: "kosmos", leverage: 2,
    targets: ["chaotisch"],
    blockedBy: ["geordnet"],
    hint: "Gesetz gegen Chaos.",
  },
  {
    id: "entfesselt", label: "stürzt ins Chaos:", family: "kosmos", leverage: 2,
    targets: ["geordnet", "konstrukt", "gebunden"],
    blockedBy: ["chaotisch"],
    hint: "Chaos gegen alles Geordnete und Gebaute.",
  },
  {
    id: "entzieht_energie", label: "entzieht die Energie von", family: "kosmos", leverage: 2,
    targets: ["braucht_energie", "magisch"],
    blockedBy: [],
    hint: "Was brennt, leuchtet oder zaubert, braucht Energie.",
  },
] as const satisfies readonly VerbDef<string, TagId>[];

export type VerbId = (typeof defs)[number]["id"];

export const VERBS: ReadonlyMap<VerbId, VerbDef<VerbId, TagId>> = new Map(
  defs.map((d) => [d.id, d as VerbDef<VerbId, TagId>]),
);

export const VERB_IDS: readonly VerbId[] = defs.map((d) => d.id);

export function isVerbId(value: string): value is VerbId {
  return VERBS.has(value as VerbId);
}

export function getVerb(id: string): VerbDef<VerbId, TagId> | undefined {
  return isVerbId(id) ? VERBS.get(id) : undefined;
}
