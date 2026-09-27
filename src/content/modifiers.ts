import type { TagId } from "./tags.ts";
import type { VerbId } from "./verbs.ts";

/**
 * Modifiers turn "Wolf" into "riesiger gläserner Schattenwolf".
 * `words` are matched as word stems (so German inflection works:
 * "riesig" matches "riesiger", "riesigen" …), `prefixes` are matched as the
 * front part of compound nouns ("Eis" in "Eiswolf").
 */
export interface ModifierDef {
  readonly id: string;
  readonly label: string;
  readonly words: readonly string[];
  readonly prefixes: readonly string[];
  readonly addTags?: readonly TagId[];
  readonly removeTags?: readonly TagId[];
  readonly addVerbs?: readonly VerbId[];
  readonly addImmune?: readonly VerbId[];
  readonly addWeak?: readonly TagId[];
  readonly scaleDelta?: number;
}

const FLESH: readonly TagId[] = ["fleisch", "blutet", "isst", "atmet", "schlaeft"];
const LIFE: readonly TagId[] = ["lebendig", "atmet", "isst", "blutet", "schlaeft", "sterblich", "fleisch"];

export const MODIFIERS: readonly ModifierDef[] = [
  // ── Größe ───────────────────────────────────────────────────────────
  { id: "riesig", label: "riesig", words: ["riesig", "gigantisch", "gewaltig", "kolossal", "titanisch", "gross", "enorm", "monstroes"], prefixes: ["riesen", "mega", "giga", "titanen", "ur"], scaleDelta: 1 },
  { id: "winzig", label: "winzig", words: ["winzig", "klein", "mini", "zwergenhaft", "mikroskopisch"], prefixes: ["mini", "zwerg", "mikro", "baby"], scaleDelta: -1 },
  { id: "schwarm", label: "als Schwarm", words: ["schwarm", "horde", "armee", "heer", "rudel", "herde", "legion", "tausend", "hundert", "viele"], prefixes: [], addTags: ["schwarm"], scaleDelta: 1 },

  // ── Material ────────────────────────────────────────────────────────
  { id: "eis", label: "aus Eis", words: ["eis", "gefroren", "eisig", "frost", "vereist"], prefixes: ["eis", "frost", "schnee"], addTags: ["eis", "fest"], removeTags: ["feuer", "wasser", "fluessig"], addWeak: ["eis"] },
  { id: "feuer", label: "brennend", words: ["brennend", "flammend", "lodernd", "feurig", "gluehend", "feuer"], prefixes: ["feuer", "flammen", "glut", "lava", "magma"], addTags: ["feuer", "licht"], removeTags: ["eis", "wasser"], addImmune: ["verbrennt"] },
  { id: "glas", label: "gläsern", words: ["glaesern", "glas"], prefixes: ["glas"], addTags: ["glas", "fest"], removeTags: FLESH, addWeak: ["glas"] },
  { id: "stein", label: "steinern", words: ["steinern", "stein", "fels", "granit", "marmor", "versteinert"], prefixes: ["stein", "fels", "granit", "marmor"], addTags: ["stein", "fest"], removeTags: FLESH, addImmune: ["durchbohrt", "zerreisst"] },
  { id: "metall", label: "eisern", words: ["eisern", "eisen", "stahl", "staehlern", "metall", "gepanzert", "bronze", "ehern"], prefixes: ["eisen", "stahl", "metall", "bronze", "panzer"], addTags: ["metall", "fest"], addImmune: ["zerreisst"] },
  { id: "gold", label: "golden", words: ["golden", "gold", "vergoldet"], prefixes: ["gold"], addTags: ["metall", "licht", "fest"] },
  { id: "holz", label: "hölzern", words: ["hoelzern", "holz"], prefixes: ["holz"], addTags: ["holz", "fest"], removeTags: FLESH },
  { id: "papier", label: "aus Papier", words: ["papier", "papieren", "origami"], prefixes: ["papier"], addTags: ["stoff"], removeTags: FLESH, addWeak: ["stoff"] },
  { id: "kristall", label: "kristallen", words: ["kristall", "kristallen", "diamant", "juwelen"], prefixes: ["kristall", "diamant", "juwel"], addTags: ["kristall", "fest", "magisch"], removeTags: FLESH },
  { id: "mechanisch", label: "mechanisch", words: ["mechanisch", "uhrwerk", "dampfbetrieben", "robot", "kybernetisch", "kuenstlich"], prefixes: ["uhrwerk", "dampf", "robo", "maschinen", "cyber"], addTags: ["metall", "konstrukt", "braucht_energie", "gehorcht", "fest"], removeTags: LIFE, addImmune: ["vergiftet", "infiziert"] },

  // ── Elemente ────────────────────────────────────────────────────────
  { id: "wasser", label: "aus Wasser", words: ["wasser", "nass", "fluessig", "meer"], prefixes: ["wasser", "meer", "see", "fluss", "tiefsee"], addTags: ["wasser", "schwimmt"], removeTags: ["feuer"] },
  { id: "luft", label: "aus Wind", words: ["wind", "luft", "wolken", "windig"], prefixes: ["wind", "luft", "wolken", "sturm"], addTags: ["luft", "fliegt"] },
  { id: "blitz", label: "elektrisch", words: ["elektrisch", "blitz", "donner", "geladen"], prefixes: ["blitz", "donner", "gewitter"], addTags: ["blitz"] },
  { id: "erde", label: "aus Erde", words: ["erden", "lehm", "erdig", "schlamm"], prefixes: ["erd", "lehm", "schlamm", "sand"], addTags: ["erde"] },
  { id: "schatten", label: "schattenhaft", words: ["schatten", "dunkel", "finster", "schwarz", "nacht"], prefixes: ["schatten", "nacht", "dunkel", "finster"], addTags: ["schatten"], addWeak: ["schatten"] },
  { id: "licht", label: "leuchtend", words: ["leuchtend", "strahlend", "hell", "licht", "glaenzend"], prefixes: ["licht", "sonnen", "stern"], addTags: ["licht"] },
  { id: "gift", label: "giftig", words: ["giftig", "toxisch", "gift", "verseucht"], prefixes: ["gift", "pest"], addTags: ["gift"] },
  { id: "saeure", label: "ätzend", words: ["aetzend", "saeure"], prefixes: ["saeure"], addTags: ["saeure"] },

  // ── Existenz ────────────────────────────────────────────────────────
  { id: "untot", label: "untot", words: ["untot", "zombie", "tot", "verwest", "skelett"], prefixes: ["toten", "zombie", "leichen", "knochen", "skelett"], addTags: ["untot", "verflucht", "gehorcht"], removeTags: ["lebendig", "atmet", "blutet", "schlaeft", "sterblich", "hofft"], addImmune: ["vergiftet", "infiziert"] },
  { id: "geist", label: "geisterhaft", words: ["geisterhaft", "gespenstisch", "phantom", "spektral", "koerperlos", "geister"], prefixes: ["geister", "gespenster", "phantom"], addTags: ["koerperlos"], removeTags: [...FLESH, "fest", "metall", "stein", "holz", "knochen"] },
  { id: "heilig", label: "heilig", words: ["heilig", "goettlich", "gesegnet", "himmlisch", "geweiht"], prefixes: ["engels", "himmels", "gottes"], addTags: ["heilig", "licht"] },
  { id: "daemonisch", label: "dämonisch", words: ["daemonisch", "teuflisch", "infernal", "hoellisch"], prefixes: ["hoellen", "teufels", "daemonen"], addTags: ["daemonisch", "feuer", "gebunden"] },
  { id: "verflucht", label: "verflucht", words: ["verflucht", "verdammt", "verwunschen"], prefixes: ["fluch"], addTags: ["verflucht"] },
  { id: "magisch", label: "magisch", words: ["magisch", "verzaubert", "arkan", "mystisch", "zauber"], prefixes: ["zauber", "magie", "arkan"], addTags: ["magisch"] },
  { id: "traum", label: "geträumt", words: ["getraeumt", "traumhaft", "traum", "illusorisch"], prefixes: ["traum"], addTags: ["traum"], addWeak: ["traum"] },
  { id: "unsterblich", label: "unsterblich", words: ["unsterblich", "ewig", "zeitlos", "unvergaenglich"], prefixes: [], addTags: ["unsterblich"], removeTags: ["sterblich", "zeitgebunden"] },
  { id: "uralt", label: "uralt", words: ["uralt", "alt", "urzeitlich", "antik"], prefixes: [], addTags: ["erinnert", "magisch"] },
  { id: "fliegend", label: "geflügelt", words: ["fliegend", "gefluegelt", "schwebend"], prefixes: ["flug"], addTags: ["fliegt"] },

  // ── Geist ───────────────────────────────────────────────────────────
  { id: "stolz", label: "stolz", words: ["stolz", "eitel", "hochmuetig", "arrogant", "praechtig"], prefixes: [], addTags: ["stolz"], addWeak: ["stolz"] },
  { id: "gierig", label: "gierig", words: ["gierig", "habgierig", "hungrig", "gefraessig"], prefixes: [], addTags: ["gierig", "isst"] },
  { id: "einsam", label: "einsam", words: ["einsam", "verlassen", "traurig", "letzte"], prefixes: [], addTags: ["einsam"], addWeak: ["einsam"] },
  { id: "furchtsam", label: "ängstlich", words: ["aengstlich", "feige", "furchtsam", "scheu"], prefixes: [], addTags: ["furchtsam"], addWeak: ["furchtsam"] },
  { id: "wahnsinnig", label: "wahnsinnig", words: ["wahnsinnig", "irre", "verrueckt", "rasend", "tollwuetig"], prefixes: [], addTags: ["wahnsinnig", "chaotisch"] },
  { id: "schlafend", label: "schlafend", words: ["schlafend", "muede", "schlaefrig"], prefixes: [], addTags: ["schlaeft"], addWeak: ["schlaeft"] },
  { id: "blind", label: "blind", words: ["blind"], prefixes: [], removeTags: ["sieht"] },
  { id: "taub", label: "taub", words: ["taub"], prefixes: [], removeTags: ["hoert"] },
  { id: "gehorsam", label: "gehorsam", words: ["gehorsam", "dienend", "versklavt", "abgerichtet"], prefixes: [], addTags: ["gehorcht"], addWeak: ["gehorcht"] },
  { id: "namenlos", label: "namenlos", words: ["namenlos", "unbenannt"], prefixes: [], removeTags: ["benannt"] },
  { id: "rostig", label: "rostig", words: ["rostig", "verrostet", "morsch", "bruechig"], prefixes: [], addTags: ["zeitgebunden"], addWeak: ["metall", "holz"] },
];

/** Words that carry no meaning for parsing. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "ein", "eine", "einer", "eines", "einen", "einem", "der", "die", "das", "des", "dem", "den",
  "aus", "mit", "von", "vom", "und", "sehr", "ganz", "wie", "zu", "zum", "zur", "im", "in", "am",
  "ich", "bin", "spiele", "werde", "nun", "jetzt", "dann", "so", "ist", "sein",
]);
