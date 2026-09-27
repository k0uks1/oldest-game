import type { Archetype, Form, Plane, Scale } from "../engine/types.ts";
import type { TagId } from "./tags.ts";
import type { VerbId } from "./verbs.ts";

export interface LexiconEntry extends Form {
  readonly aliases: readonly string[];
}

interface Extra {
  readonly immune?: readonly VerbId[];
  readonly weak?: readonly TagId[];
  readonly aliases?: readonly string[];
  readonly flavor?: string;
}

function f(
  id: string,
  name: string,
  archetype: Archetype,
  scale: Scale,
  plane: Plane,
  tags: readonly TagId[],
  verbs: readonly VerbId[],
  extra: Extra = {},
): LexiconEntry {
  return {
    id,
    name,
    archetype,
    scale,
    plane,
    tags,
    verbs,
    immune: extra.immune ?? [],
    weak: extra.weak ?? [],
    aliases: extra.aliases ?? [],
    origin: "lexikon",
    ...(extra.flavor === undefined ? {} : { flavor: extra.flavor }),
  };
}

// Frequently reused tag bundles
const TIER = ["lebendig", "atmet", "sieht", "hoert", "isst", "schlaeft", "blutet", "fleisch", "tier", "sterblich", "zeitgebunden"] as const satisfies readonly TagId[];
const MENSCH = ["lebendig", "atmet", "sieht", "hoert", "isst", "schlaeft", "blutet", "fleisch", "mensch", "denkt", "fuehlt", "erinnert", "sterblich", "zeitgebunden"] as const satisfies readonly TagId[];
const UNTOT = ["untot", "knochen", "fest", "gehorcht", "sieht", "verflucht"] as const satisfies readonly TagId[];
const KONZEPT = ["koerperlos", "unsterblich"] as const satisfies readonly TagId[];

/**
 * The lexicon. Every entry is just data; the engine never special-cases ids.
 * Scale guide: 1 winzig · 2 klein · 3 menschengroß · 4 groß · 5 gewaltig ·
 * 6 Landschaft · 7 Welt · 8 kosmisch.
 */
export const LEXICON: readonly LexiconEntry[] = [
  // ════════════════════ 1 · winzig ════════════════════
  f("funke", "Funke", "flame", 1, "materie", ["feuer", "licht", "zeitgebunden"], [], { weak: ["zeitgebunden"], aliases: ["funken", "glut"] }),
  f("staubkorn", "Staubkorn", "rock", 1, "materie", ["fest", "stein"], ["blendet"], { aliases: ["staub", "sandkorn", "sand"], flavor: "Ins Auge geweht, blendet es Riesen." }),
  f("floh", "Floh", "insect", 1, "leben", ["lebendig", "blutet", "isst", "tier", "sterblich"], ["infiziert", "saugt_aus"], { aliases: ["zecke", "laus"] }),
  f("muecke", "Mücke", "insect", 1, "leben", ["lebendig", "blutet", "isst", "tier", "fliegt", "sterblich", "hoert"], ["infiziert", "saugt_aus"], { aliases: ["moskito", "stechmuecke"] }),
  f("ameise", "Ameise", "insect", 1, "leben", ["lebendig", "isst", "tier", "graebt", "gehorcht", "sterblich"], ["zerreisst"], { weak: ["gehorcht"] }),
  f("rost", "Rost", "blob", 1, "materie", ["fest", "metall", "zeitgebunden"], ["rostet"], { aliases: ["korrosion"], flavor: "Geduldig. Unaufhaltsam. Für Metall." }),
  f("schimmel", "Schimmel", "blob", 1, "leben", ["lebendig", "pflanze", "zeitgebunden"], ["verrottet", "infiziert"], { aliases: ["pilz", "sporen", "faeulnis"] }),
  f("virus", "Virus", "orb", 1, "leben", ["zeitgebunden", "krankheit"], ["infiziert"], { weak: ["zeitgebunden"], aliases: ["keim", "erreger", "bakterie"] }),
  f("nadel", "Nadel", "weapon", 1, "materie", ["metall", "fest"], ["durchbohrt"], { aliases: ["dorn", "stachel"] }),
  f("schluessel", "Schlüssel", "key", 1, "materie", ["metall", "fest", "magisch"], ["bricht_pakt", "versiegelt"], { aliases: ["schluessel"], flavor: "Jede Tür, jeder Pakt hat ein Schloss." }),
  f("samen", "Samenkorn", "plant", 1, "leben", ["lebendig", "pflanze", "zeitgebunden", "hofft"], ["fuellt"], { aliases: ["samen", "saat", "eichel"], flavor: "Winzig – und doch wartet darin ein Wald." }),
  f("traene", "Träne", "wave", 1, "geist", ["wasser", "fluessig", "fuehlt"], ["loescht", "erloest"], { aliases: ["traenen"], flavor: "Eine aufrichtige Träne löst Flüche." }),
  f("wort", "Ein Wort", "book", 1, "geist", ["koerperlos", "magisch"], ["wahrer_name", "taeuscht"], { aliases: ["name", "zauberwort", "silbe"] }),
  f("gluehwuermchen", "Glühwürmchen", "insect", 1, "leben", ["lebendig", "licht", "tier", "fliegt", "sterblich"], ["durchleuchtet"], { aliases: ["leuchtkaefer"] }),
  f("schneeflocke", "Schneeflocke", "crystal", 1, "materie", ["eis", "kristall", "fest", "zeitgebunden"], ["gefriert"], { aliases: ["eiskristall", "eiszapfen", "frostblume"] }),
  f("heilkraut", "Heilkraut", "plant", 1, "leben", ["lebendig", "pflanze", "zeitgebunden"], ["heilt"], { aliases: ["kraut", "arznei", "medizin", "salbe", "kamille"] }),
  f("kaffee", "Tasse Kaffee", "orb", 1, "materie", ["fluessig", "wasser", "zeitgebunden"], ["weckt"], { aliases: ["kaffee", "espresso", "tee"], flavor: "Die mächtigste Waffe gegen den Schlaf." }),
  f("salz", "Salz", "crystal", 1, "materie", ["kristall", "fest", "loeslich"], ["bannt", "entzaubert"], { aliases: ["salzkreis", "salzkorn"], flavor: "Ein Kreis aus Salz hält Geister fern." }),

  // ════════════════════ 2 · klein ════════════════════
  f("katze", "Katze", "beast", 2, "leben", [...TIER, "neugierig", "stolz"], ["zerreisst"], { aliases: ["kater"] }),
  f("ratte", "Ratte", "beast", 2, "leben", [...TIER, "gierig"], ["infiziert", "zerreisst"], { aliases: ["maus", "maeuse"] }),
  f("schlange", "Schlange", "serpent", 2, "leben", [...TIER], ["vergiftet", "fesselt"], { aliases: ["viper", "natter", "kobra", "otter"] }),
  f("skorpion", "Skorpion", "spider", 2, "leben", ["lebendig", "tier", "isst", "sterblich", "fest"], ["vergiftet", "durchbohrt"]),
  f("spinne", "Spinne", "spider", 2, "leben", ["lebendig", "tier", "isst", "sterblich", "sieht"], ["fesselt", "vergiftet"], { aliases: ["tarantel", "netz"] }),
  f("kraehe", "Krähe", "bird", 2, "leben", [...TIER, "fliegt", "neugierig", "erinnert"], ["zerreisst", "lockt"], { aliases: ["rabe", "elster"] }),
  f("eule", "Eule", "bird", 2, "leben", [...TIER, "fliegt", "denkt"], ["zerreisst", "taeuscht"], { aliases: ["kauz"] }),
  f("fledermaus", "Fledermaus", "bird", 2, "leben", ["lebendig", "atmet", "hoert", "isst", "blutet", "fleisch", "tier", "fliegt", "sterblich"], ["saugt_aus", "infiziert"]),
  f("kroete", "Kröte", "blob", 2, "leben", [...TIER, "gift", "schwimmt"], ["vergiftet"], { aliases: ["frosch", "unke"] }),
  f("dolch", "Dolch", "weapon", 2, "materie", ["metall", "fest"], ["durchbohrt"], { aliases: ["messer", "klinge"] }),
  f("kerze", "Kerze", "flame", 2, "materie", ["feuer", "licht", "zeitgebunden", "fest"], ["durchleuchtet"], { aliases: ["licht", "flamme"] }),
  f("fackel", "Fackel", "flame", 2, "materie", ["feuer", "licht", "holz"], ["verbrennt", "durchleuchtet"]),
  f("spiegel", "Spiegel", "crystal", 2, "materie", ["glas", "fest", "magisch"], ["blendet", "entlarvt", "demuetigt"], { flavor: "Zeigt dem Stolzen, was er wirklich ist." }),
  f("kind", "Kind", "humanoid", 2, "leben", [...MENSCH, "neugierig", "hofft", "traeumt"], ["befreundet", "entlarvt"], { flavor: "Sieht, dass der Kaiser nackt ist." }),
  f("floete", "Flöte", "weapon", 2, "materie", ["holz", "fest", "magisch"], ["lockt", "einschlaefern"], { aliases: ["rattenfaenger", "melodie", "schalmei"] }),
  f("buch", "Buch", "book", 2, "geist", ["stoff", "erinnert", "magisch", "loeslich"], ["wahrer_name", "bricht_pakt"], { aliases: ["grimoire", "zauberbuch", "schriftrolle"] }),
  f("maske", "Maske", "mask", 2, "geist", ["holz", "magisch", "falsch"], ["taeuscht", "aengstigt"], { aliases: ["larve"] }),
  f("glocke", "Glocke", "tower", 2, "materie", ["metall", "fest", "heilig"], ["uebertoent", "weckt"], { aliases: ["kirchenglocke", "gong"] }),
  f("hahn", "Hahn", "bird", 2, "leben", [...TIER, "stolz"], ["weckt", "uebertoent"], { aliases: ["gockel", "hahnenschrei"], weak: ["stolz"] }),
  f("pilzsporen", "Sporenwolke", "cloud", 2, "leben", ["lebendig", "gas", "gift", "krankheit"], ["infiziert", "vergiftet"], { aliases: ["sporenwolke", "giftwolke"] }),
  f("saeureschleim", "Säureschleim", "blob", 2, "materie", ["saeure", "fluessig", "lebendig"], ["zersetzt"], { aliases: ["schleim", "saeure", "gallert"] }),
  f("wiegenlied", "Wiegenlied", "heart", 2, "geist", ["koerperlos", "fuehlt"], ["einschlaefern", "befreundet"], { aliases: ["lied", "schlaflied"] }),
  f("witz", "Ein Witz", "mask", 2, "geist", ["koerperlos", "zeitgebunden", "fuehlt"], ["demuetigt", "taeuscht"], { weak: ["zeitgebunden"], aliases: ["spott", "gelaechter", "lachen", "hohn"] }),

  // ════════════════════ 3 · menschengroß ════════════════════
  f("wolf", "Wolf", "beast", 3, "leben", [...TIER, "gehorcht"], ["zerreisst", "verschlingt"], { aliases: ["woelfe"] }),
  f("ritter", "Ritter", "humanoid", 3, "leben", [...MENSCH, "metall", "stolz", "glaubt"], ["durchbohrt", "zerschlaegt"], { aliases: ["krieger", "soldat", "paladin"], weak: ["stolz"] }),
  f("hexe", "Hexe", "humanoid", 3, "geist", [...MENSCH, "magisch", "gierig", "benannt"], ["verflucht", "vergiftet", "wahrer_name"], { aliases: ["zauberin", "magierin"] }),
  f("magier", "Magier", "humanoid", 3, "geist", [...MENSCH, "magisch", "stolz"], ["entzaubert", "trifft_blitz", "versiegelt"], { aliases: ["zauberer", "hexer", "hexenmeister"] }),
  f("dieb", "Dieb", "humanoid", 3, "leben", [...MENSCH, "gierig", "schatten"], ["durchbohrt", "taeuscht"], { aliases: ["schurke", "assassine", "meuchler"] }),
  f("heilerin", "Heilerin", "humanoid", 3, "leben", [...MENSCH, "hofft"], ["heilt", "erloest"], { aliases: ["heiler", "arzt", "aerztin", "medicus", "druide"] }),
  f("moench", "Mönch", "humanoid", 3, "geist", [...MENSCH, "heilig", "glaubt"], ["bannt", "erloest", "heilt"], { aliases: ["priester", "exorzist", "nonne", "heiliger"] }),
  f("jaeger", "Jäger", "humanoid", 3, "leben", [...MENSCH], ["durchbohrt", "fesselt", "lockt"], { aliases: ["bogenschuetze", "fallensteller"] }),
  f("gaukler", "Gaukler", "humanoid", 3, "geist", [...MENSCH, "neugierig"], ["taeuscht", "demuetigt", "lockt"], { aliases: ["narr", "hofnarr", "trickser", "clown"] }),
  f("dichter", "Dichter", "humanoid", 3, "geist", [...MENSCH, "traeumt", "hofft", "einsam"], ["wahrer_name", "befreundet"], { aliases: ["barde", "poet", "saenger"] }),
  f("koenig", "König", "humanoid", 3, "geist", [...MENSCH, "stolz", "gierig", "geordnet"], ["befiehlt", "verhungern"], { aliases: ["kaiser", "koenigin", "herrscher"], weak: ["stolz"] }),
  f("skelett", "Skelett", "skull", 3, "materie", [...UNTOT], ["zerschlaegt", "aengstigt"], { aliases: ["knochenmann"] }),
  f("zombie", "Zombie", "humanoid", 3, "materie", ["untot", "fleisch", "gehorcht", "isst", "verflucht"], ["infiziert", "zerreisst"], { aliases: ["ghul", "wiedergaenger"] }),
  f("gespenst", "Gespenst", "ghost", 3, "geist", ["koerperlos", "untot", "einsam", "erinnert", "verflucht"], ["aengstigt", "verzweiflung", "taeuscht"], { aliases: ["geist", "spuk", "phantom", "poltergeist"] }),
  f("vampir", "Vampir", "humanoid", 3, "leben", ["untot", "fleisch", "stolz", "denkt", "benannt", "verflucht", "schatten", "sieht"], ["saugt_aus", "verfuehrt", "befiehlt"], { immune: ["vergiftet", "infiziert"], weak: ["untot"], aliases: ["nosferatu", "dracula"] }),
  f("loewe", "Löwe", "beast", 3, "leben", [...TIER, "stolz"], ["zerreisst", "verschlingt"], { aliases: ["tiger", "panther", "raubkatze"] }),
  f("adler", "Adler", "bird", 3, "leben", [...TIER, "fliegt", "stolz"], ["zerreisst", "durchbohrt"], { aliases: ["falke", "habicht", "greifvogel"] }),
  f("hai", "Hai", "fish", 3, "leben", ["lebendig", "isst", "blutet", "fleisch", "tier", "schwimmt", "sterblich", "gierig"], ["zerreisst", "verschlingt"]),
  f("schwert", "Schwert", "weapon", 3, "materie", ["metall", "fest", "magisch"], ["durchbohrt", "zerreisst", "entzaubert"], { aliases: ["klinge", "axt", "speer", "lanze"] }),
  f("schwarm_bienen", "Bienenschwarm", "swarm", 3, "leben", ["lebendig", "tier", "fliegt", "schwarm", "gehorcht", "sterblich"], ["vergiftet", "ueberrennt"], { aliases: ["bienen", "wespen", "hornissen", "bienenschwarm"] }),
  f("golem", "Golem", "giant", 4, "materie", ["stein", "fest", "konstrukt", "gehorcht", "magisch", "benannt"], ["zerschlaegt", "zermalmt"], { immune: ["vergiftet", "aengstigt", "infiziert"], weak: ["benannt"], aliases: ["steingolem", "lehmgolem"], flavor: "Ein Wort auf der Stirn gibt ihm Leben – und nimmt es." }),
  f("uhrwerk", "Uhrwerkritter", "humanoid", 3, "materie", ["metall", "konstrukt", "geordnet", "gehorcht", "braucht_energie", "fest"], ["zerschlaegt", "durchbohrt"], { aliases: ["automat", "roboter", "maschine", "androide"] }),
  f("irrlicht", "Irrlicht", "orb", 2, "geist", ["licht", "koerperlos", "magisch", "falsch"], ["lockt", "taeuscht"], { aliases: ["irrlichter", "will-o-wisp"] }),
  f("nebel", "Nebel", "cloud", 3, "materie", ["gas", "wasser", "koerperlos"], ["blendet", "taeuscht"], { aliases: ["dunst", "nebelschwaden"] }),
  f("schatten", "Schatten", "ghost", 3, "geist", ["schatten", "koerperlos"], ["aengstigt", "verdunkelt"], { aliases: ["dunkelheit", "finsternis", "schattenwesen"] }),
  f("luege", "Lüge", "mask", 3, "abstrakt", [...KONZEPT, "zeitgebunden", "falsch"], ["taeuscht", "zweifel"], { aliases: ["taeuschung", "betrug"], weak: ["falsch"] }),
  f("hoffnung", "Hoffnung", "star", 3, "abstrakt", [...KONZEPT, "hofft", "licht"], ["trotzt", "fuellt", "erloest"], { weak: ["hofft"], aliases: ["zuversicht"], flavor: "Was bist du, wenn du nicht Hoffnung bist?" }),
  f("mut", "Mut", "heart", 3, "abstrakt", [...KONZEPT, "fuehlt", "hofft"], ["aengstigt", "trotzt"], { aliases: ["tapferkeit", "courage"], weak: ["fuehlt"] }),
  f("zweifel", "Zweifel", "mask", 3, "abstrakt", [...KONZEPT, "denkt"], ["zweifel", "verzweiflung"], { aliases: ["skepsis", "unsicherheit"] }),
  f("erinnerung", "Erinnerung", "book", 3, "abstrakt", [...KONZEPT, "erinnert", "fuehlt"], ["wahrer_name", "erloest"], { aliases: ["gedaechtnis", "erinnerungen"] }),
  f("stille", "Stille", "void", 3, "abstrakt", [...KONZEPT, "leer"], ["uebertoent", "einschlaefern"], { aliases: ["schweigen", "ruhe"] }),
  f("wahrheit", "Wahrheit", "eye", 4, "abstrakt", [...KONZEPT, "licht", "geordnet"], ["durchleuchtet", "entlarvt", "wahrer_name"], { aliases: ["erkenntnis"], flavor: "Sie tötet die Lüge nicht – sie macht sie sichtbar." }),

  // ════════════════════ 4 · groß ════════════════════
  f("baer", "Bär", "beast", 4, "leben", [...TIER], ["zerreisst", "zerschlaegt"], { aliases: ["grizzly", "hoehlenbaer"] }),
  f("troll", "Troll", "giant", 4, "leben", [...TIER, "stein", "gierig", "denkt"], ["zerschlaegt", "verschlingt"], { weak: ["stein"], aliases: ["oger", "zyklop"], flavor: "Im Sonnenlicht wird er zu Stein." }),
  f("minotaurus", "Minotaurus", "giant", 4, "leben", [...TIER, "einsam", "wahnsinnig"], ["zerschlaegt", "zerreisst"], { aliases: ["minotaur", "stiermensch"] }),
  f("baum", "Uralte Eiche", "tree", 4, "leben", ["lebendig", "pflanze", "holz", "erinnert", "fest"], ["fesselt", "zermalmt"], { aliases: ["baum", "eiche", "ent", "weide"] }),
  f("wolfsrudel", "Wolfsrudel", "swarm", 4, "leben", [...TIER, "schwarm", "gehorcht"], ["zerreisst", "ueberrennt"], { aliases: ["rudel", "meute"] }),
  f("elefant", "Elefant", "beast", 4, "leben", [...TIER, "erinnert", "furchtsam"], ["zermalmt", "ueberrennt"], { aliases: ["mammut"], flavor: "Vergisst nie – und fürchtet die Maus." }),
  f("greif", "Greif", "bird", 4, "leben", [...TIER, "fliegt", "stolz", "gierig"], ["zerreisst", "durchbohrt"], { aliases: ["hippogreif", "griffin"] }),
  f("feuerelementar", "Feuerelementar", "flame", 4, "materie", ["feuer", "licht", "koerperlos", "magisch", "braucht_energie"], ["verbrennt", "schmilzt"], { aliases: ["flammengeist", "salamander", "ifrit"] }),
  f("eiselementar", "Eiselementar", "crystal", 4, "materie", ["eis", "fest", "kristall", "magisch"], ["gefriert", "zerschlaegt"], { aliases: ["frostgeist", "eisgeist"] }),
  f("mauer", "Mauer", "tower", 4, "materie", ["stein", "fest", "geordnet", "masse"], ["zermalmt"], { aliases: ["wall", "festungsmauer", "tor"] }),
  f("schiff", "Kriegsschiff", "tower", 4, "materie", ["holz", "stoff", "schwimmt", "fest"], ["zermalmt", "sprengt"], { aliases: ["schiff", "galeone", "fregatte"] }),
  f("daemon", "Dämon", "giant", 4, "geist", ["daemonisch", "feuer", "stolz", "gierig", "benannt", "gebunden", "unsterblich"], ["zerreisst", "verbrennt"], { weak: ["gebunden", "benannt"], aliases: ["teufel", "imp", "unhold", "choronzon"] }),
  f("dschinn", "Dschinn", "cloud", 4, "geist", ["gas", "magisch", "gebunden", "gehorcht", "luft", "benannt"], ["verweht", "taeuscht", "befiehlt"], { aliases: ["djinn", "flaschengeist", "genie"] }),
  f("banshee", "Banshee", "ghost", 4, "geist", ["koerperlos", "untot", "fuehlt", "einsam", "verflucht"], ["uebertoent", "aengstigt", "verzweiflung"], { aliases: ["todesfee", "klageweib"] }),
  f("mumie", "Mumie", "humanoid", 4, "materie", ["untot", "stoff", "verflucht", "gebunden", "stolz"], ["verflucht", "infiziert"], { aliases: ["pharao"] }),
  f("werwolf", "Werwolf", "beast", 4, "leben", [...TIER, "mensch", "verflucht", "wahnsinnig"], ["zerreisst", "infiziert"], { weak: ["verflucht"], aliases: ["lykanthrop"] }),
  f("angst", "Angst", "eye", 4, "abstrakt", [...KONZEPT, "schatten", "fuehlt"], ["aengstigt", "verzweiflung"], { aliases: ["furcht", "panik", "grauen", "schrecken"] }),
  f("liebe", "Liebe", "heart", 4, "abstrakt", [...KONZEPT, "fuehlt", "hofft", "licht"], ["befreundet", "erloest", "fuellt"], { aliases: ["zuneigung", "freundschaft"] }),
  f("traum", "Traum", "cloud", 4, "abstrakt", ["koerperlos", "traum", "traeumt", "hofft", "magisch", "falsch"], ["taeuscht", "einschlaefern"], { weak: ["traum"], aliases: ["tagtraum", "vision"] }),
  f("albtraum", "Albtraum", "mask", 4, "abstrakt", ["koerperlos", "traum", "schatten", "wahnsinnig"], ["aengstigt", "verzweiflung"], { weak: ["traum"], aliases: ["alptraum", "nachtmahr", "mahr"] }),
  f("schlaf", "Schlaf", "cloud", 4, "abstrakt", [...KONZEPT, "traeumt"], ["einschlaefern", "vergessen"], { aliases: ["sandmann", "morpheus", "schlummer"] }),
  f("gier", "Gier", "mask", 4, "abstrakt", [...KONZEPT, "gierig"], ["verfuehrt", "lockt"], { aliases: ["habsucht", "geiz"] }),
  f("hochmut", "Hochmut", "mask", 4, "abstrakt", [...KONZEPT, "stolz", "fuehlt"], ["demuetigt", "taeuscht"], { weak: ["stolz"], aliases: ["stolz", "arroganz", "eitelkeit"] }),
  f("raetsel", "Rätsel", "book", 3, "abstrakt", [...KONZEPT, "denkt", "geordnet"], ["lockt", "taeuscht"], { aliases: ["sphinx", "riddle", "paradoxon"] }),
  f("musik", "Musik", "heart", 3, "abstrakt", [...KONZEPT, "fuehlt"], ["einschlaefern", "befreundet", "uebertoent"], { aliases: ["lied", "gesang", "harfe"] }),

  // ════════════════════ 5 · gewaltig ════════════════════
  f("drache", "Drache", "dragon", 5, "leben", [...TIER, "feuer", "fliegt", "stolz", "gierig", "denkt", "benannt", "magisch"], ["verbrennt", "verschlingt", "zerreisst"], { immune: ["verbrennt"], weak: ["gierig", "stolz"], aliases: ["lindwurm", "wyvern", "feuerdrache"], flavor: "Schläft auf Gold. Kann Rätseln nicht widerstehen." }),
  f("riese", "Riese", "giant", 5, "leben", [...MENSCH, "masse", "stolz"], ["zermalmt", "zerschlaegt"], { aliases: ["titan", "frostriese", "goliath"], weak: ["schlaeft"] }),
  f("kraken", "Kraken", "serpent", 5, "leben", [...TIER, "schwimmt", "wasser"], ["ertraenkt", "fesselt", "zermalmt"], { aliases: ["krake", "riesenkrake", "tentakel"] }),
  f("hydra", "Hydra", "serpent", 5, "leben", [...TIER, "gift", "schwimmt"], ["vergiftet", "verschlingt"], { immune: ["zerreisst", "durchbohrt"], aliases: ["vielkopf"], flavor: "Schlag einen Kopf ab, zwei wachsen nach." }),
  f("phoenix", "Phönix", "bird", 5, "leben", ["feuer", "licht", "fliegt", "lebendig", "hofft", "magisch"], ["verbrennt", "durchleuchtet", "erloest"], { immune: ["verbrennt", "ueberdauert"], weak: ["feuer"], aliases: ["feuervogel"], flavor: "Stirbt in Flammen, ersteht aus Asche." }),
  f("basilisk", "Basilisk", "serpent", 5, "leben", [...TIER, "gift", "stolz"], ["vergiftet", "aengstigt"], { weak: ["sieht"], aliases: ["gorgone", "medusa"], flavor: "Sein Blick versteinert – auch im Spiegel." }),
  f("lich", "Lich", "skull", 5, "geist", [...UNTOT, "magisch", "denkt", "stolz", "benannt", "gebunden"], ["verflucht", "befiehlt", "entzieht_energie"], { weak: ["gebunden"], flavor: "Seine Seele liegt in einem Gefäß – zerbrich den Pakt.", aliases: ["nekromant", "totenbeschwoerer", "leichnam"] }),
  f("erzengel", "Erzengel", "humanoid", 5, "geist", ["heilig", "licht", "fliegt", "glaubt", "gehorcht", "unsterblich", "geordnet"], ["bannt", "durchleuchtet", "durchbohrt"], { weak: ["gehorcht", "glaubt"], aliases: ["engel", "seraph", "cherub"] }),
  f("sturm", "Sturm", "cloud", 5, "materie", ["luft", "wasser", "blitz", "gas", "chaotisch", "zeitgebunden"], ["verweht", "trifft_blitz"], { aliases: ["gewitter", "unwetter", "orkan", "hurrikan"] }),
  f("tornado", "Tornado", "cloud", 5, "materie", ["luft", "gas", "chaotisch", "zeitgebunden"], ["verweht", "zermalmt"], { aliases: ["wirbelsturm", "windhose", "zyklon"] }),
  f("lawine", "Lawine", "rock", 5, "materie", ["eis", "stein", "fest", "masse", "chaotisch"], ["begraebt", "zermalmt"], { aliases: ["erdrutsch", "steinschlag", "geroell"] }),
  f("flutwelle", "Flutwelle", "wave", 5, "materie", ["wasser", "fluessig", "masse", "zeitgebunden"], ["ertraenkt", "zermalmt", "loescht"], { aliases: ["tsunami", "welle", "flut"] }),
  f("wahnsinn", "Wahnsinn", "eye", 5, "abstrakt", [...KONZEPT, "wahnsinnig", "chaotisch"], ["entfesselt", "aengstigt", "taeuscht"], { aliases: ["irrsinn", "raserei", "tollheit"] }),
  f("glaube", "Glaube", "star", 5, "abstrakt", [...KONZEPT, "glaubt", "heilig", "hofft"], ["bannt", "trotzt", "erloest"], { weak: ["glaubt"], aliases: ["gebet", "vertrauen"] }),
  f("verzweiflung", "Verzweiflung", "void", 5, "abstrakt", [...KONZEPT, "leer", "fuehlt"], ["verzweiflung", "zweifel"], { aliases: ["hoffnungslosigkeit", "resignation", "trauer"] }),
  f("fluch", "Uralter Fluch", "skull", 5, "abstrakt", ["koerperlos", "verflucht", "magisch", "gebunden"], ["verflucht", "verzweiflung"], { weak: ["verflucht"], aliases: ["fluch", "bann", "verwuenschung"] }),

  // ════════════════════ 6 · Landschaft ════════════════════
  f("morgenroete", "Morgenröte", "star", 5, "materie", ["licht", "zeitgebunden", "hofft"], ["weckt", "durchleuchtet", "blendet"], { aliases: ["sonnenaufgang", "morgengrauen", "daemmerung", "morgen"], flavor: "Jeder Albtraum endet beim ersten Licht." }),
  f("vulkan", "Vulkan", "rock", 6, "materie", ["feuer", "stein", "erde", "masse", "fest", "zeitgebunden"], ["verbrennt", "begraebt", "schmilzt"], { aliases: ["lava", "magma", "ausbruch"] }),
  f("ozean", "Ozean", "wave", 6, "materie", ["wasser", "fluessig", "masse", "erinnert"], ["ertraenkt", "loescht", "erodiert"], { aliases: ["meer", "see", "tiefsee"] }),
  f("armee", "Armee", "swarm", 6, "leben", [...MENSCH, "schwarm", "gehorcht", "metall", "geordnet"], ["ueberrennt", "durchbohrt", "verhungern"], { weak: ["gehorcht"], aliases: ["heer", "legion", "horde"] }),
  f("untotenheer", "Untotenheer", "swarm", 6, "materie", [...UNTOT, "schwarm"], ["ueberrennt", "aengstigt"], { weak: ["gehorcht"], aliases: ["totenheer", "skelettarmee", "zombiehorde"] }),
  f("stadt", "Stadt", "tower", 6, "leben", ["stein", "holz", "masse", "geordnet", "isst", "fuehlt", "erinnert", "zeitgebunden"], ["ueberrennt", "verhungern"], { aliases: ["metropole", "hauptstadt", "koenigreich"] }),
  f("wald", "Urwald", "tree", 6, "leben", ["lebendig", "pflanze", "holz", "erinnert", "chaotisch"], ["fesselt", "taeuscht", "verrottet"], { aliases: ["wald", "dschungel", "forst"] }),
  f("wueste", "Wüste", "rock", 6, "materie", ["erde", "leer", "stein", "masse"], ["verhungern", "begraebt", "blendet"], { aliases: ["sandwueste", "duene"] }),
  f("gebirge", "Gebirge", "rock", 6, "materie", ["stein", "fest", "masse", "erde", "geordnet"], ["zermalmt", "begraebt"], { aliases: ["berg", "berge", "massiv"] }),
  f("erdbeben", "Erdbeben", "rock", 6, "materie", ["erde", "chaotisch", "zeitgebunden"], ["zermalmt", "begraebt", "sprengt"], { aliases: ["beben"] }),
  f("seuche", "Seuche", "swarm", 6, "leben", ["lebendig", "zeitgebunden", "schwarm", "krankheit"], ["infiziert", "verhungern"], { weak: ["krankheit"], aliases: ["pest", "plage", "epidemie", "pandemie"] }),
  f("heuschrecken", "Heuschreckenplage", "swarm", 6, "leben", ["lebendig", "tier", "fliegt", "schwarm", "isst", "sterblich"], ["verhungern", "ueberrennt"], { aliases: ["heuschrecken", "insektenschwarm", "plage"] }),
  f("leviathan", "Leviathan", "serpent", 6, "leben", [...TIER, "schwimmt", "masse", "einsam"], ["verschlingt", "ertraenkt", "zermalmt"], { weak: ["einsam"], aliases: ["seeschlange", "seeungeheuer", "wal"] }),
  f("festung", "Festung", "tower", 6, "materie", ["stein", "metall", "masse", "geordnet", "fest", "isst"], ["zermalmt", "durchbohrt"], { weak: ["isst"], aliases: ["burg", "zitadelle", "bollwerk"] }),
  f("krieg", "Krieg", "skull", 6, "abstrakt", [...KONZEPT, "chaotisch", "gierig", "braucht_energie"], ["ueberrennt", "verhungern", "entfesselt"], { weak: ["gierig"], aliases: ["schlacht", "gewalt"] }),
  f("vergessen", "Vergessen", "void", 6, "abstrakt", [...KONZEPT, "leer"], ["vergessen", "ueberdauert"], { aliases: ["vergessenheit", "lethe", "amnesie"] }),
  f("ordnung", "Ordnung", "crystal", 6, "abstrakt", [...KONZEPT, "geordnet"], ["ordnet", "fesselt"], { aliases: ["gesetz", "logik", "struktur"] }),
  f("chaos", "Chaos", "void", 6, "abstrakt", [...KONZEPT, "chaotisch", "wahnsinnig"], ["entfesselt"], { aliases: ["unordnung", "anarchie", "entropie_klein"] }),

  // ════════════════════ 7 · Welt ════════════════════
  f("planet", "Planet", "planet", 7, "materie", ["masse", "stein", "erde", "fest", "braucht_energie", "zeitgebunden"], ["zermalmt"], { aliases: ["erde", "welt", "globus"] }),
  f("mond", "Mond", "planet", 7, "materie", ["masse", "stein", "licht", "fest", "zeitgebunden"], ["zermalmt", "taeuscht"], { aliases: ["vollmond", "mondlicht"] }),
  f("eiszeit", "Eiszeit", "crystal", 7, "materie", ["eis", "masse", "zeitgebunden", "leer"], ["gefriert", "verhungern", "begraebt"], { aliases: ["ewiger_winter", "fimbulwinter", "frost"] }),
  f("sintflut", "Sintflut", "wave", 7, "materie", ["wasser", "masse", "zeitgebunden", "heilig"], ["ertraenkt", "loescht", "erodiert"], { aliases: ["weltflut", "grosse_flut"] }),
  f("weltenbaum", "Weltenbaum", "tree", 7, "leben", ["lebendig", "pflanze", "holz", "masse", "magisch", "erinnert", "geordnet"], ["fesselt", "fuellt", "zermalmt"], { aliases: ["yggdrasil", "weltesche"] }),
  f("gott", "Ein Gott", "star", 7, "abstrakt", ["koerperlos", "unsterblich", "braucht_glaube", "stolz", "heilig", "licht", "benannt"], ["bannt", "trifft_blitz", "verflucht"], { weak: ["braucht_glaube"], aliases: ["gottheit", "goetze", "zeus", "odin"], flavor: "Ein Gott, an den niemand glaubt, ist nur ein Name." }),
  f("tod", "Tod", "skull", 7, "abstrakt", [...KONZEPT, "geordnet", "einsam", "benannt"], ["beendet", "ueberdauert"], { weak: ["einsam"], aliases: ["sensenmann", "gevatter", "thanatos"], flavor: "Auch der Tod hat eine große Schwester." }),
  f("zeitalter", "Zeitalter der Finsternis", "void", 7, "abstrakt", [...KONZEPT, "schatten", "chaotisch", "zeitgebunden"], ["verdunkelt", "vergessen", "verzweiflung"], { aliases: ["finsternis", "dunkles_zeitalter", "ewige_nacht"] }),

  // ════════════════════ 8 · kosmisch ════════════════════
  f("sonne", "Sonne", "star", 8, "materie", ["feuer", "licht", "masse", "gas", "braucht_energie", "zeitgebunden"], ["verbrennt", "blendet", "schmilzt"], { immune: ["verbrennt", "loescht"], aliases: ["stern", "sol", "helios"] }),
  f("supernova", "Supernova", "star", 8, "materie", ["feuer", "licht", "gas", "zeitgebunden", "chaotisch"], ["sprengt", "verbrennt", "zermalmt"], { immune: ["loescht"], weak: ["zeitgebunden"], aliases: ["sternexplosion", "nova", "hypernova"] }),
  f("schwarzes_loch", "Schwarzes Loch", "void", 8, "materie", ["masse", "leer", "schatten", "braucht_energie", "zeitgebunden"], ["zermalmt", "verdunkelt", "entzieht_energie"], { immune: ["blendet", "durchleuchtet"], weak: ["zeitgebunden"], aliases: ["singularitaet", "black_hole", "ereignishorizont"], flavor: "Selbst es verdampft – in einer Ewigkeit." }),
  f("galaxie", "Galaxie", "star", 8, "materie", ["masse", "licht", "gas", "geordnet", "zeitgebunden"], ["zermalmt", "blendet"], { aliases: ["milchstrasse", "sternennebel", "kosmos"] }),
  f("zeit", "Zeit", "hourglass", 8, "abstrakt", [...KONZEPT, "geordnet"], ["ueberdauert", "erodiert", "vergessen"], { weak: ["geordnet"], aliases: ["chronos", "ewigkeit", "aeon"] }),
  f("ende", "Das Ende aller Dinge", "void", 8, "abstrakt", [...KONZEPT, "endgueltig", "leer"], ["beendet", "ueberdauert", "vergessen"], { weak: ["endgueltig"], aliases: ["ende", "entropie", "antileben", "anti-leben", "nichts", "das_nichts", "waermetod", "apokalypse"], flavor: "Ich bin Anti-Leben, das Biest des Gerichts." }),
  f("urknall", "Urknall", "star", 8, "abstrakt", ["licht", "feuer", "chaotisch", "masse"], ["sprengt", "fuellt", "entfesselt"], { aliases: ["schoepfung", "genesis", "big_bang"] }),
];

export const LEXICON_BY_ID: ReadonlyMap<string, LexiconEntry> = new Map(LEXICON.map((e) => [e.id, e]));
