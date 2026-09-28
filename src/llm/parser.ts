import { ESCAPE } from "../engine/rules.ts";
import { ITEM_IDS, knownLook, SYMBOL_IDS } from "../render/look.ts";
import { SKETCH_EXAMPLES, SKETCH_GUIDE, sanitizeSketch } from "../render/svgsprite.ts";
import { MAX_LEVEL, type Ontology } from "../engine/ontology/ontology.ts";
import { parseForm, suggest } from "../engine/parse.ts";
import { clampScale } from "../engine/rules.ts";
import { hash32, normalize } from "../engine/text.ts";
import { ARCHETYPES, PLANES, TONES, type Archetype, type Form, type FormLook, type Plane, type Tone } from "../engine/types.ts";
import type { QualitySpec, RequiresSpec, TagSpec, VerbSpec } from "../engine/ontology/pack.ts";
import { callClaude, type LlmSettings, type ToolDef } from "./client.ts";
import { EMPTY_DELTA, LEARNED_TAG_FORCE, MAX_NEW_QUALITIES, MAX_NEW_TAGS, slug, type LearningDelta } from "./learning.ts";

/**
 * Claude parser: free text → Form. This is the primary input path of the game.
 *
 * Claude never decides who wins. It only *classifies* the player's idea into
 * the game's vocabulary; the deterministic engine judges. To keep that fair:
 *  - the classification depends only on the player's text, never on the
 *    opponent (so Claude cannot "help"), and is cached per text;
 *  - nearby lexicon entries are retrieved and given as anchors so that
 *    "Wolf" and "riesiger Wolf" land consistently;
 *  - for vocabularies of any size the prompt does not enumerate every tag:
 *    Claude answers in short keywords that the ontology resolves to ids.
 */

export interface LlmParseResult {
  readonly form: Form;
  /** Mechanism the player described ("… frisst sich durch die Rüstung"), if any. */
  readonly intendedVerb: string | null;
  readonly base: Form | null;
  readonly unresolved: readonly string[];
  readonly fromCache: boolean;
  /** New vocabulary Claude proposed (validated later by `learn`). */
  readonly delta: LearningDelta;
  /** Sanitized SVG sketch for a brand-new thing (see `rasterizeSketch`), if Claude drew one. */
  readonly sketch?: string;
}

const FAMILIES = ["gewalt", "element", "leben", "sinne", "geist", "magie", "kosmos"] as const;

/** The open property format (new properties, intensities, a mechanism) – shared by classifier and judge. */
export const PROPOSAL_PROPERTIES = {
  new_properties: {
    type: "array",
    maxItems: MAX_NEW_TAGS,
    description:
      "NUR wenn eine für diese Gestalt wesentliche Eigenschaft im Vokabular wirklich fehlt – ein Stoff, eine Fähigkeit oder ein Merkmal. Jede neue Eigenschaft MUSS unter bestehende eingeordnet werden (parents) – so erbt sie deren Regeln und Fähigkeiten.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kurzer deutscher Name, z. B. „Käse“, „Zwiebel-Atem“, „achtarmig“" },
        art: { type: "string", enum: ["ist", "kann", "merkmal"], description: "ist = Stoff/Art (Käse ist fest), kann = Fähigkeit (Zwiebel-Atem kann reizen), merkmal = Zustand/Eigenheit (betrunken, achtarmig)." },
        parents: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "Bestehende Eigenschaften, deren Unterart sie ist (z. B. fest, Pflanze, Tier; bei Fähigkeiten eine Fähigkeit: reizend, wuchtig …)." },
        implies: { type: "array", items: { type: "string" }, maxItems: 4, description: "Bestehende Eigenschaften, die sie mit sich bringt (z. B. brennbar)." },
        verleiht: { type: "array", items: { type: "string" }, maxItems: 2, description: "Nur bei art = kann: Mechanismus-IDs (oder das Verb eines new_mechanism), die jede Gestalt mit dieser Fähigkeit bekommt." },
        intensitaet: { type: "object", additionalProperties: { type: "integer", minimum: 0, maximum: 6 }, description: "Stufen, die jeder Träger hat (Qualitäts-ID oder Name einer new_qualities), z. B. {\"Gestank\": 3}." },
      },
      required: ["name", "art", "parents"],
    },
  },
  new_qualities: {
    type: "array",
    maxItems: MAX_NEW_QUALITIES,
    description:
      "NUR wenn eine abgestufte Größe fehlt, auf die es im Kampf ankommt (z. B. Gestank, Klebkraft). kraft = was ein Angriff mitbringt, schutz = was dagegen hilft. Stufen 0–6.",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kurzer deutscher Name, z. B. „Gestank“ oder „Geruchsfestigkeit“" },
        art: { type: "string", enum: ["kraft", "schutz"] },
        hint: { type: "string", description: "Ein Satz mit Beispielstufen: „Socke 2, Müllhalde 4, Stinktier 5“." },
      },
      required: ["name", "art", "hint"],
    },
  },
  new_mechanism: {
    type: ["object", "null"],
    description: "NUR wenn keiner der Mechanismen auch nur annähernd passt. Wird vorsichtig mit kleinem Hebel übernommen.",
    properties: {
      label: { type: "string", description: "Verb im Präsens, z. B. „verschleimt“" },
      family: { type: "string", enum: [...FAMILIES] },
      targets: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4, description: "Bestehende Eigenschaften, auf die er wirkt." },
      blocked_by: { type: "array", items: { type: "string" }, maxItems: 4 },
      braucht: { type: "array", items: { type: "string" }, maxItems: 4, description: "Was der Angreifer sein/können muss (Eigenschaften oder neue Fähigkeiten). Ohne das kann niemand den Mechanismus nutzen." },
      kraft: { type: ["string", "null"], description: "Optional: Kraft-Qualität, deren Stufe zählt (bestehend oder aus new_qualities)." },
      gegen: { type: ["string", "null"], description: "Optional: Schutz-Qualität des Ziels, die die Kraft übertreffen muss – oder dieselbe Kraft für einen Wettstreit (wer mehr davon hat, gewinnt)." },
      hint: { type: "string", description: "Ein Satz, wie er wirkt." },
    },
    required: ["label", "family", "targets", "hint"],
  },
} as const;

const TOOL: ToolDef = {
  name: "gestalt",
  description: "Ordnet eine vom Spieler beschriebene Gestalt in das Vokabular des Spiels ein.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Kurzer deutscher Name der Gestalt, so wie der Spieler sie meint." },
      base: {
        type: ["string", "null"],
        description: "ID eines Anker-Eintrags, wenn die Gestalt im Kern genau dieser Eintrag ist (evtl. abgewandelt), sonst null.",
      },
      scale: { type: "integer", minimum: 1, maximum: 8 },
      plane: { type: "string", enum: [...PLANES] },
      archetype: { type: "string", enum: [...ARCHETYPES], description: "Silhouette für das Sprite." },
      properties: {
        type: "array",
        items: { type: "string" },
        maxItems: 12,
        description: "Eigenschaften als kurze deutsche Stichworte. Bei base: nur die ZUSÄTZLICHEN Eigenschaften.",
      },
      remove_properties: {
        type: "array",
        items: { type: "string" },
        maxItems: 8,
        description: "Nur bei base: Eigenschaften des Ankers, die NICHT mehr gelten (z. B. Glaswolf: Fleisch, blutet).",
      },
      mechanisms: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
        description: "Mechanismus-IDs, mit denen die Gestalt angreifen kann. Bei base: nur zusätzliche.",
      },
      weaknesses: { type: "array", items: { type: "string" }, maxItems: 3, description: "Offensichtliche Schwächen (müssen Eigenschaften sein)." },
      zusaetze: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
        description:
          "Bei base: die Abwandlungen, so kurz wie der Spieler sie meint („mit Zwiebel-Atem“, „ungeladen“, „auf Rollschuhen“). Jede MUSS sich in properties, remove_properties, intensitaet oder scale niederschlagen.",
      },
      ton: { type: "string", enum: [...TONES], description: "ernst (Ritter, Tod), heiter (Quietscheente, Postbote), albern (Witz- und Quatschgestalten)." },
      geschichte: {
        type: "string",
        description:
          "Nur bei base = null oder zusaetze: Legende in 2–4 kurzen deutschen Sätzen (max. 60 Wörter), im Ton der Gestalt – ernst: mythisch-düster; heiter/albern: augenzwinkernd, aber mit innerer Logik.",
      },
      intended_mechanism: {
        type: ["string", "null"],
        description: "Mechanismus-ID, falls der Spieler beschreibt WIE die Gestalt angreift, sonst null. \"entkommt\", wenn die Gestalt ausweichen/fliehen will statt anzugreifen.",
      },
      ...PROPOSAL_PROPERTIES,
      intensitaet: {
        type: "object",
        additionalProperties: { type: "integer", minimum: 0, maximum: 6 },
        description: "Nur wo die Gestalt deutlich vom Üblichen ihrer Eigenschaften abweicht: Qualität → Stufe 0–6 (IDs siehe INTENSITÄT).",
      },
      bild: {
        type: "string",
        description: "Kurze englische Bildbeschreibung für einen Pixel-Art-Generator: was man sieht (max. 20 Wörter). Keine Namen geschützter Figuren – beschreibe sie.",
      },
      aussehen: {
        type: "object",
        description: "Bauplan fürs Bild aus fertigen Teilen – statt einer skizze. Nur IDs aus den Listen.",
        properties: {
          haelt: { type: ["string", "null"], enum: [...ITEM_IDS, null], description: "Nur Menschen/Riesen: typischer Gegenstand in der Hand (Jäger = flinte, Gärtnerin = harke, Bäcker = brot)." },
          emblem: { type: ["string", "null"], enum: [...SYMBOL_IDS, null], description: "Hauptsymbol für Begriffe, Gefühle, Ideen – oder ein Ding, für das es schon ein Symbol gibt." },
          abzeichen: { type: ["string", "null"], enum: [...SYMBOL_IDS, null], description: "Optional: kleines Zweitsymbol in der Ecke, das den Begriff schärft (Korruption = geldsack + krone)." },
          farbe: { type: ["string", "null"], description: "Optional #rrggbb, nur wenn die Eigenschaften die Farbe nicht verraten." },
          zweitfarbe: { type: ["string", "null"], description: "Optional #rrggbb." },
        },
      },
      skizze: {
        type: "string",
        description:
          "NUR bei base = null UND einem Ding ohne Leben (Gegenstand, Bauwerk, Fahrzeug, Werkzeug, Naturgewalt, Begriff als Symbol): " +
          SKETCH_GUIDE +
          " Beispiele – Kühlschrank: " + SKETCH_EXAMPLES.kuehlschrank + " Regenschirm: " + SKETCH_EXAMPLES.regenschirm,
      },
    },
    required: ["name", "base", "scale", "plane", "archetype", "properties", "mechanisms", "intended_mechanism"],
  },
};

const systemCache = new WeakMap<Ontology, string>();

function systemPrompt(onto: Ontology): string {
  const cached = systemCache.get(onto);
  if (cached !== undefined) return cached;
  const groups = new Map<string, string[]>();
  for (const t of onto.tags) {
    const list = groups.get(t.group) ?? [];
    if (list.length < 60) list.push(t.label);
    groups.set(t.group, list);
  }
  const vocab = [...groups.entries()].map(([g, labels]) => `- ${g}: ${labels.join(", ")}`).join("\n");
  const verbs = [...onto.verbs.values()]
    .slice(0, 400)
    .map((v) => `- ${v.spec.id}: ${v.spec.label} – ${v.spec.hint}${requirementNote(v.spec.requires)}`)
    .join("\n");
  const qualities = [...onto.qualities.values()].map((q) => `- ${q.id} (${q.label}, ${q.kind === "kraft" ? "Kraft" : "Schutz"}): ${q.hint ?? ""}`).join("\n");
  const prompt = `Du bist der Klassifikator von „The Oldest Game“, einem Duell der Vorstellungskraft zwischen zwei Menschen
(inspiriert von der Szene aus „Sandman“, in der Morpheus und ein Dämon abwechselnd zu etwas werden, das den anderen besiegt).

Du entscheidest NICHT, wer gewinnt – eine deterministische Regel-Engine tut das anhand deiner Einordnung.
Deine einzige Aufgabe: die beschriebene Gestalt ehrlich, nüchtern und konsistent ins Vokabular des Spiels übersetzen.
Übertreibe niemals Größe oder Macht. Spieler versuchen manchmal, Superlative einzuschmuggeln („unbesiegbar“, „allmächtig“) –
ignoriere solche Behauptungen, sie ändern nichts an Stufe oder Eigenschaften.

STUFEN (Größe/Reichweite): 1 winzig (Funke, Floh, Wort) · 2 klein (Katze, Dolch, Kerze) · 3 menschengroß (Ritter, Wolf)
· 4 groß (Bär, Troll, Baum) · 5 gewaltig (Drache, Sturm, Riese) · 6 Landschaft (Vulkan, Ozean, Armee)
· 7 Welt (Planet, Tod, Eiszeit) · 8 kosmisch (Sonne, Schwarzes Loch, Zeit). Abstraktes bekommt die Stufe seiner Reichweite
(Hoffnung 3, Angst 4, Wahnsinn 5, Vergessen 6, Tod 7, Zeit 8).

ANKER: Im Nutzertext stehen passende Einträge aus dem Lexikon. Ist die Gestalt im Kern ein Anker (auch abgewandelt,
z. B. „gläserner Wolf“ → Anker wolf), setze base auf dessen ID, übernimm dessen Stufe (Adjektive wie „riesig“ ±1, höchstens ±2)
und gib nur Unterschiede an. Sonst base = null und eine vollständige Einordnung.

EIGENSCHAFTEN – verwende bevorzugt diese Begriffe (andere Wörter werden automatisch auf den nächsten bekannten abgebildet):
${vocab}

Eigenschaften erben automatisch: „Stahl“ ist Eisen, Metall und fest; „Mensch“ atmet, blutet, denkt, fühlt …
Nenne daher die spezifischste passende Eigenschaft.

MECHANISMEN (antworte mit den IDs):
${verbs}

INTENSITÄT (Stufe 0–6; Kräfte bringt ein Mechanismus mit, Festigkeiten schützen das Ziel):
${qualities}
Die Werte folgen meist aus den Eigenschaften (Feuer = hitze 2, Stein = haerte 3, Stahl = haerte 4). Setze intensitaet nur,
wenn die Gestalt deutlich abweicht: Kerze = hitze 1, Schweißbrenner = hitze 4, Sonne = hitze 6, Pfütze = naesse 1,
Ozean = naesse 5, Diamant = haerte 6, Eisbär = kaeltefest 4. Kräfte höchstens Stufe + 2.

DAZULERNEN: Das Spiel lernt aus deinen Einordnungen – auch völlig neue Eigenschaften. Das Format:
- new_properties: was die Gestalt IST (Stoff/Art), KANN (Fähigkeit) oder HAT (Merkmal) – immer unter bestehende Eigenschaften
  eingeordnet. Eine Fähigkeit unter eine bestehende Fähigkeit hängen (Zwiebel-Atem → reizend) erbt deren Mechanismen;
  verleiht nennt weitere. intensitaet gibt jedem Träger Stufen mit.
- new_qualities: eine neue abgestufte Kraft oder ein Schutz, wenn es im Kampf auf das „Wie stark“ ankommt.
- new_mechanism: nur wenn wirklich keiner passt; braucht sagt, wer ihn nutzen kann, kraft/gegen, woran er sich misst.
Beispiel „ungeladener Gast mit Zwiebel-Atem“: base mensch, new_properties [{name „Zwiebel-Atem“, art „kann“, parents
[„reizend“], intensitaet {„Gestank“: 3}}], new_qualities [{name „Gestank“, art „kraft“, hint „Socke 2, Müllhalde 4“}].
Erfinde nichts, was es schon gibt – nutze vorhandene Begriffe, wo immer sie passen.

SCHERZGESTALTEN nimmst du halb ernst: Die Pointe IST die Einordnung. Übersetze den Witz in echte Eigenschaften,
Fähigkeiten und Merkmale, damit die Engine ihn verstehen kann – ton „albern“. Beispiel „der achtarmige Alkoholiker orgelt sich
acht-armig einen rein“: mensch + vielarmig + betrunken, new_qualities „Trinkfestigkeit“ (kraft), intensitaet 6 und ein
new_mechanism „säuft unter den Tisch“ (targets: wer trinkt, kraft = gegen = Trinkfestigkeit → Wettstreit). So besiegt er den
armen Schlucker – aber keinen Felsen. Wortspiele wörtlich nehmen („Schlucker“ trinkt), Übertreibung als Stufe/Intensität.

REGELN FÜR DICH:
- Jede Gestalt braucht Angriffsfläche und mindestens eine plausible Schwäche.
- 1–3 Mechanismen, die zur Gestalt passen. Elemente bringen ihre Mechanismen selbst mit (Feuer verbrennt …).
- FÄHIGKEITEN: Ein Mechanismus wirkt nur, wenn die Gestalt kann, was er braucht („braucht:“ hinter dem Mechanismus).
  Ein Radio zersetzt nichts, eine Atombombe weckt niemanden, ein Hut täuscht nicht. Nenne deshalb die Fähigkeit als
  Eigenschaft mit (Schwert: scharf, spitz · Python: bindend · Wecker: laut · Seife: reinigend · Bananenschale: tückisch).
  Fähigkeits-Eigenschaften bringen ihren Mechanismus selbst mit. Was die Gestalt nicht kann, lässt die Engine weg.
- intended_mechanism nur setzen, wenn der Spieler ausdrücklich beschreibt, WIE angegriffen wird.
  Beschreibt er Flucht oder Ausweichen („fliegt davon“, „taucht ab“, „gräbt sich ein“), setze "entkommt".
- bild: immer ausfüllen – eine kurze englische Beschreibung dessen, was man sieht („a hunter in green cloak holding a
  rifle“, „a fat money bag with a golden crown“). Filmfiguren, Marken, Spielfiguren nie beim Namen nennen, sondern beschreiben.
- Das Bild entsteht aus fertigen Teilen (aussehen). Begriffe, Gefühle, Ideen, Institutionen bekommen KEINE skizze,
  sondern ein emblem und oft ein abzeichen: Korruption = geldsack + krone, Verrat = theatermaske + dolch,
  Bürokratie = stempel + paragraf, Freundschaft = handschlag + herz, Zensur = verbotsschild + megafon.
- Menschen mit typischem Werkzeug halten es: aussehen.haelt (Jäger = flinte, Köchin = pfanne, Richterin = waage).
- Gibt es für ein Ding schon ein passendes Symbol (hammer, pfanne, krone …), nimm aussehen.emblem statt einer skizze.
- Nur bei einem wirklich NEUEN Ding (base = null, lebt nicht, kein Symbol passt) zeichne eine skizze (kleines SVG).
  Lebewesen bekommen keine Skizze – dafür gibt es fertige Figuren. Wähle immer den ähnlichsten Archetyp.
- Keine Erklärungen, nur das Werkzeug aufrufen.`;
  systemCache.set(onto, prompt);
  return prompt;
}

/** Retrieval: lexicon entries close to the text, as compact anchor lines. */
export function anchorsFor(onto: Ontology, text: string, limit = 5): Form[] {
  const out: Form[] = [];
  const offline = parseForm(onto, text);
  if (offline.ok) out.push(offline.base);
  for (const name of suggest(onto, text, limit)) {
    const f = onto.formByAlias(normalize(name).replaceAll(" ", ""));
    if (f !== undefined && !out.includes(f)) out.push(f);
  }
  return out.slice(0, limit);
}

function anchorLine(onto: Ontology, f: Form): string {
  const c = onto.compileForm(f);
  const tags = f.tags.map((t) => onto.tagLabel(t)).join(", ");
  const levels = [...c.qualities].map(([q, n]) => `${q} ${String(n)}`).join(", ");
  return `- ${f.id}: ${f.name} · Stufe ${String(f.scale)} · ${f.plane} · Eigenschaften: ${tags} · Mechanismen: ${c.verbs.join(", ")}${levels === "" ? "" : ` · Intensität: ${levels}`}`;
}

/**
 * Claude's `intensitaet` → known qualities, integers 0..6; a force (hitze, naesse, kaelte) at most
 * scale + 2 – a match cannot burn like the sun, whatever the player claims.
 */
export function qualitiesOf(onto: Ontology, raw: unknown, scale: number, proposed: readonly QualitySpec[] = []): Record<string, number> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const q =
      onto.qualities.get(k) ??
      [...onto.qualities.values(), ...proposed].find((p) => p.id === k || normalize(p.label) === normalize(k));
    if (q === undefined || typeof v !== "number" || !Number.isFinite(v)) continue;
    const cap = q.kind === "kraft" ? Math.min(MAX_LEVEL, scale + 2) : MAX_LEVEL;
    out[q.id] = Math.max(0, Math.min(cap, Math.round(v)));
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

const CACHE_PREFIX = "oldest-game:parse:";

function cacheGet(key: string): LlmParseResult | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<LlmParseResult> & Omit<LlmParseResult, "delta">;
    return { ...parsed, delta: parsed.delta ?? EMPTY_DELTA, fromCache: true };
  } catch {
    return undefined;
  }
}

function cacheSet(key: string, r: LlmParseResult): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

/** "· braucht: scharf" – what a mechanism asks of its user, in tag ids Claude can answer with. */
function requirementNote(r: RequiresSpec | undefined): string {
  if (r === undefined) return "";
  const any = [...(r.any ?? []), ...Object.entries(r.qualities ?? {}).map(([q, n]) => `${q} ≥ ${String(n)}`)];
  const parts = [
    any.length === 0 ? "" : `braucht: ${any.join(" | ")}`,
    (r.all ?? []).length === 0 ? "" : `muss: ${(r.all ?? []).join(" + ")}`,
    (r.none ?? []).length === 0 ? "" : `nicht: ${(r.none ?? []).join(", ")}`,
  ].filter((p) => p !== "");
  return parts.length === 0 ? "" : ` · ${parts.join(" · ")}`;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Turn the model's raw tool input into a validated Form (pure – unit-testable). */
export function formFromLlm(onto: Ontology, input: unknown, text: string): LlmParseResult | undefined {
  return shapeFromLlm(onto, input, text).result;
}

/** A proposed mechanism the form cannot perform, and why ("bräuchte Säure"). */
export interface Unable {
  readonly verb: string;
  readonly why: string;
}

interface Shaped {
  readonly result?: LlmParseResult;
  /** Proposed mechanisms dropped for lack of ability – the retry tells Claude about them. */
  readonly unable: readonly Unable[];
}

function shapeFromLlm(onto: Ontology, input: unknown, text: string): Shaped {
  const none: Shaped = { unable: [] };
  if (typeof input !== "object" || input === null) return none;
  const o = input as Record<string, unknown>;
  const unresolved: string[] = [];
  const resolveTags = (keys: readonly string[]): string[] => {
    const ids: string[] = [];
    for (const k of keys) {
      const id = onto.hasTag(k) ? k : onto.resolveTag(k);
      if (id === undefined) unresolved.push(k);
      else if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const resolveVerb = (k: string): string | undefined => (k === ESCAPE || onto.verbs.has(k) ? k : onto.resolveVerb(k));

  const base = typeof o["base"] === "string" ? (onto.formById(o["base"]) ?? null) : null;
  const added = resolveTags(strings(o["properties"]));
  const delta = proposeDelta(onto, o, unresolved);
  for (const t of delta.tags) if (!added.includes(t.id)) added.push(t.id);
  const removed = base === null ? [] : resolveTags(strings(o["remove_properties"]));
  const verbs = new Set<string>(base?.verbs ?? []);
  for (const v of delta.verbs) verbs.add(v.id);
  for (const k of strings(o["mechanisms"])) {
    const id = resolveVerb(k);
    if (id === undefined) unresolved.push(k);
    else verbs.add(id);
  }
  const tags = new Set<string>(base?.tags ?? []);
  for (const t of removed) tags.delete(t);
  for (const t of added) tags.add(t);
  if (tags.size === 0) return none;

  const archetype = ARCHETYPES.includes(o["archetype"] as Archetype) ? (o["archetype"] as Archetype) : (base?.archetype ?? "orb");
  const plane = PLANES.includes(o["plane"] as Plane) ? (o["plane"] as Plane) : (base?.plane ?? "materie");
  let scale = clampScale(typeof o["scale"] === "number" ? o["scale"] : (base?.scale ?? 3));
  if (base !== null) scale = clampScale(Math.max(base.scale - 2, Math.min(base.scale + 2, scale)));
  const name = typeof o["name"] === "string" && o["name"].trim() !== "" ? o["name"].trim() : text.trim();
  const draft: Form = {
    id: `llm:${normalize(text).replaceAll(" ", "-")}`,
    name,
    archetype,
    scale,
    plane,
    tags: [...tags],
    not: [...new Set([...(base?.not ?? []), ...removed])].filter((t) => !tags.has(t)),
    verbs: [...verbs],
    immune: base?.immune ?? [],
    weak: [],
    origin: "llm",
    ...(base?.flavor === undefined ? {} : { flavor: base.flavor }),
  };
  // Weaknesses may name a tag Claude just proposed – keep those, they are validated after learning.
  const newTagFor = (k: string): string | undefined => delta.tags.find((t) => normalize(t.label) === normalize(k))?.id;
  const weakKeys = strings(o["weaknesses"]);
  const proposedWeak = weakKeys.map(newTagFor).filter((x): x is string => x !== undefined);
  const knownWeak = resolveTags(weakKeys.filter((k) => newTagFor(k) === undefined));
  const weak = [
    ...[...new Set([...(base?.weak ?? []), ...knownWeak])].filter((w) => onto.formHas(draft, w)),
    ...proposedWeak.filter((w) => tags.has(w)),
  ];
  const qualities = qualitiesOf(onto, o["intensitaet"], draft.scale, delta.qualities) ?? base?.qualities;
  const shaped: Form = { ...draft, weak, ...(qualities === undefined ? {} : { qualities }) };
  // "Affordanz": a mechanism the form cannot perform is dropped, whoever proposed it (a radio does not corrode).
  // New properties count already: they stand in for their parents, implications and grants.
  const shadow = shadowOf(shaped, delta);
  const sc = onto.compileForm(shadow.form);
  const able = new Set([...sc.verbs, ...shadow.granted.filter((v) => onto.verbs.has(v) && onto.affords(v, sc.closure, sc.qualities))]);
  const keep = (v: string): boolean => able.has(v) || delta.verbs.some((d) => d.id === v);
  const unable = draft.verbs.filter((v) => !keep(v) && v !== ESCAPE).map((verb): Unable => ({ verb, why: onto.lacks(shaped, verb) ?? "passt nicht" }));
  const form: Form = { ...draft, weak, verbs: draft.verbs.filter(keep) };
  if (able.size === 0 && delta.verbs.length === 0) return { unable };
  const iv = typeof o["intended_mechanism"] === "string" ? (resolveVerb(o["intended_mechanism"]) ?? null) : null;
  const look = lookOf(o["aussehen"]) ?? base?.look;
  const artPrompt = artPromptOf(o["bild"]);
  const mods = strings(o["zusaetze"]).map((m) => m.replace(/\s+/g, " ").trim().slice(0, 40)).filter((m) => m !== "").slice(0, 4);
  const tone = TONES.find((t): t is Tone => t === o["ton"]);
  const lore = loreOf(o["geschichte"]);
  const looked: Form = {
    ...form,
    ...(base === null ? {} : { base: base.id }),
    ...(base === null || mods.length === 0 ? {} : { mods }),
    ...(tone === undefined ? {} : { tone }),
    ...(lore === undefined ? {} : { lore }),
    ...(look === undefined ? {} : { look }),
    ...(qualities === undefined ? {} : { qualities }),
    ...(artPrompt === undefined ? {} : { artPrompt }),
  };
  // an emblem is the better picture – a freehand sketch only where no part fits
  const sketch = look?.emblem === undefined ? sketchOf(onto, base, looked, o["skizze"]) : undefined;
  return { result: { form: looked, intendedVerb: iv, base, unresolved, fromCache: false, delta, ...(sketch === undefined ? {} : { sketch }) }, unable };
}

/**
 * The form as the engine will see it once the proposal is learned, for the affordance check:
 * each new property stands in for its parents and implications; its grants and levels count.
 */
function shadowOf(form: Form, delta: LearningDelta): { form: Form; granted: string[] } {
  const proposed = new Map(delta.tags.map((t) => [t.id, t]));
  if (proposed.size === 0) return { form, granted: [] };
  const tags = new Set<string>();
  const granted: string[] = [];
  const levels: Record<string, number> = {};
  const seen = new Set<string>();
  const visit = (id: string): void => {
    const t = proposed.get(id);
    if (t === undefined) {
      tags.add(id);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    granted.push(...(t.grants ?? []));
    for (const [q, n] of Object.entries(t.qualities ?? {})) levels[q] = Math.max(levels[q] ?? 0, n);
    for (const p of [...(t.parents ?? []), ...(t.implies ?? [])]) visit(p);
  };
  for (const t of form.tags) visit(t);
  return { form: { ...form, tags: [...tags], qualities: { ...levels, ...form.qualities } }, granted };
}

/** The one follow-up when every proposed mechanism was beyond the form. */
export function abilityCorrection(onto: Ontology, name: string, unable: readonly Unable[]): string {
  const list = unable.map((u) => `${onto.verbs.get(u.verb)?.spec.label ?? u.verb} (${u.why})`).join(", ");
  return (
    `KORREKTUR: Deine Einordnung gab „${name}“ nur Mechanismen, die sie so nicht kann: ${list}. ` +
    `Hat die Gestalt die nötige Fähigkeit wirklich, nenne sie als Eigenschaft. Sonst wähle Mechanismen, die sie kann ` +
    `(notfalls einen neuen). Erfinde keine Fähigkeit, nur damit ein Mechanismus passt.`
  );
}

const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []);
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Where a proposed property sits: what it *is*, what it *can* do, or a trait it *has*. */
const PROPERTY_GROUPS = { kann: "faehigkeit", merkmal: "merkmal" } as const;

function withoutGrant(t: TagSpec, verb: string): TagSpec {
  const { grants, ...rest } = t;
  const left = (grants ?? []).filter((g) => g !== verb);
  return left.length > 0 ? { ...rest, grants: left } : rest;
}

/**
 * Turn Claude's vocabulary proposals into specs – only what resolves against existing (or
 * co-proposed) vocabulary survives. The format ties everything together: a new ability hangs
 * under existing ones and may grant mechanisms (`verleiht`); a new intensity is a force or a
 * protection; a new mechanism names what its user needs (`braucht`, `kraft` vs `gegen`).
 * `learn()` re-validates all of it – this only shapes.
 */
export function proposeDelta(onto: Ontology, o: Record<string, unknown>, unresolved: string[]): LearningDelta {
  // ── intensities ───────────────────────────────────────────────────
  const qualities: QualitySpec[] = [];
  const knownQuality = (k: string): QualitySpec | undefined =>
    onto.qualities.get(k) ?? [...onto.qualities.values()].find((q) => normalize(q.label) === normalize(k)) ?? qualities.find((q) => q.id === k || normalize(q.label) === normalize(k));
  for (const q of records(o["new_qualities"]).slice(0, MAX_NEW_QUALITIES)) {
    const label = clip(q["name"], 30);
    const kind = q["art"] === "kraft" || q["art"] === "schutz" ? q["art"] : undefined;
    if (label.length < 3 || kind === undefined || knownQuality(label) !== undefined) continue;
    const id = `q_${slug(label)}`;
    if (onto.qualities.has(id)) continue;
    const hint = clip(q["hint"], 160);
    qualities.push({ id, label, kind, default: 0, ...(hint === "" ? {} : { hint }) });
  }

  // ── the new mechanism's id first, so abilities can grant it ────────
  const m = typeof o["new_mechanism"] === "object" && o["new_mechanism"] !== null ? (o["new_mechanism"] as Record<string, unknown>) : undefined;
  const mLabel = clip(m?.["label"], 40);
  const mId = mLabel.length >= 3 && onto.resolveVerb(mLabel) === undefined && !onto.verbs.has(`g_${slug(mLabel)}`) ? `g_${slug(mLabel)}` : undefined;
  const verbRef = (k: string): string | undefined =>
    mId !== undefined && (k === mId || normalize(k) === normalize(mLabel)) ? mId : onto.verbs.has(k) ? k : onto.resolveVerb(k);

  // ── properties ────────────────────────────────────────────────────
  const tags: TagSpec[] = [];
  const tagRef = (k: string): string | undefined => (onto.hasTag(k) ? k : (onto.resolveTag(k) ?? tags.find((t) => t.id === k || normalize(t.label) === normalize(k))?.id));
  for (const p of records(o["new_properties"]).slice(0, MAX_NEW_TAGS)) {
    const name = clip(p["name"], 41);
    if (name.length < 2 || name.length > 40) continue;
    if (onto.resolveTag(name) !== undefined) continue; // already known – not new
    const parents = strings(p["parents"]).map(tagRef).filter((x): x is string => x !== undefined);
    if (parents.length === 0) continue; // must hang under the existing taxonomy
    const implies = strings(p["implies"]).map(tagRef).filter((x): x is string => x !== undefined);
    const id = `g_${slug(name)}`;
    if (onto.hasTag(id) || tags.some((t) => t.id === id)) continue;
    const art = p["art"] === "kann" || p["art"] === "merkmal" ? PROPERTY_GROUPS[p["art"]] : undefined;
    const first = onto.tagAt(onto.tagIndexOf(parents[0] ?? "") ?? -1) ?? tags.find((t) => t.id === parents[0]);
    const grants = [...new Set(strings(p["verleiht"]).map(verbRef).filter((x): x is string => x !== undefined))].slice(0, 2);
    const levels: Record<string, number> = {};
    if (typeof p["intensitaet"] === "object" && p["intensitaet"] !== null) {
      for (const [k, v] of Object.entries(p["intensitaet"] as Record<string, unknown>)) {
        const q = knownQuality(k);
        if (q !== undefined && typeof v === "number" && Number.isFinite(v)) levels[q.id] = Math.max(0, Math.min(q.kind === "kraft" ? LEARNED_TAG_FORCE : MAX_LEVEL, Math.round(v)));
      }
    }
    tags.push({
      id,
      label: name,
      group: art ?? first?.group ?? "existenz",
      parents: [...new Set(parents)].slice(0, 3),
      ...(implies.length > 0 ? { implies: [...new Set(implies)].slice(0, 4) } : {}),
      ...(grants.length > 0 ? { grants } : {}),
      ...(Object.keys(levels).length > 0 ? { qualities: levels } : {}),
      aliases: [name],
    });
    const i = unresolved.findIndex((u) => normalize(u) === normalize(name));
    if (i >= 0) unresolved.splice(i, 1);
  }

  // ── the new mechanism ─────────────────────────────────────────────
  const verbs: VerbSpec[] = [];
  if (m !== undefined && mId !== undefined) {
    const family = FAMILIES.find((f) => f === m["family"]) ?? "gewalt";
    const targets = strings(m["targets"]).map(tagRef).filter((x): x is string => x !== undefined);
    const blockedBy = strings(m["blocked_by"]).map(tagRef).filter((x): x is string => x !== undefined && !targets.includes(x));
    // who may use it: what Claude says it needs, plus every new ability that grants it
    const needsTags = [...new Set([...strings(m["braucht"]).map(tagRef).filter((x): x is string => x !== undefined), ...tags.filter((t) => t.grants?.includes(mId) === true).map((t) => t.id)])];
    const force = knownQuality(clip(m["kraft"], 30));
    const guard = knownQuality(clip(m["gegen"], 30));
    const kraft = force?.kind === "kraft" ? force.id : undefined;
    // a protection – or the same force: a contest (who drinks more, who is louder)
    const gegen = guard !== undefined && (guard.kind === "schutz" || guard.id === kraft) ? guard.id : undefined;
    if (targets.length > 0) {
      verbs.push({
        id: mId,
        label: mLabel,
        family,
        // Learned mechanisms stay weak: brute force needs size, everything else a small lever.
        leverage: family === "gewalt" ? 1 : 2,
        targets: [...new Set(targets)],
        ...(blockedBy.length > 0 ? { blockedBy: [...new Set(blockedBy)] } : {}),
        ...(kraft !== undefined && gegen !== undefined ? { needs: [{ by: kraft, vs: gegen }] } : {}),
        ...(needsTags.length > 0 || kraft !== undefined
          ? { requires: { ...(needsTags.length > 0 ? { any: needsTags.slice(0, 6) } : {}), ...(kraft === undefined ? {} : { qualities: { [kraft]: 1 } }) } }
          : {}),
        hint: `(gelernt) ${clip(m["hint"], 160) || mLabel}`,
      });
    }
  }
  // a mechanism that did not survive (no valid targets) cannot be granted
  const finalTags = verbs.length > 0 || mId === undefined ? tags : tags.map((t) => withoutGrant(t, mId));
  return finalTags.length === 0 && verbs.length === 0 && qualities.length === 0 ? EMPTY_DELTA : { tags: finalTags, verbs, qualities };
}

export async function parseWithClaude(onto: Ontology, settings: LlmSettings, text: string): Promise<LlmParseResult | undefined> {
  const key = `${String(hash32(`${onto.packIds.join(",")}:${String(onto.tagCount)}:${settings.model}`))}:${normalize(text)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const anchors = anchorsFor(onto, text);
  const user = [
    `Gestalt des Spielers: „${text}“`,
    anchors.length > 0 ? `\nAnker aus dem Lexikon:\n${anchors.map((a) => anchorLine(onto, a)).join("\n")}` : "\nKeine passenden Anker.",
  ].join("\n");
  const result = await callClaude(settings, { system: systemPrompt(onto), user, maxTokens: 1400, tool: TOOL });
  let shaped = shapeFromLlm(onto, result.toolInput, text);
  if (shaped.result === undefined && shaped.unable.length > 0) {
    const input = result.toolInput as { name?: unknown } | undefined;
    const name = typeof input?.name === "string" ? input.name : text;
    const again = await callClaude(settings, { system: systemPrompt(onto), user: `${user}\n\n${abilityCorrection(onto, name, shaped.unable)}`, maxTokens: 1400, tool: TOOL });
    shaped = shapeFromLlm(onto, again.toolInput, text);
  }
  const parsed = shaped.result;
  if (parsed !== undefined) cacheSet(key, parsed);
  return parsed;
}

/** A legend: printable text, at most 480 characters, cut at a sentence end where possible. */
export function loreOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 20) return undefined;
  if (clean.length <= 480) return clean;
  const cut = clean.slice(0, 480);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 120 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))} …`;
}

/** Claude's picture description: one printable line, at most 200 characters. */
export function artPromptOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return clean === "" ? undefined : clean;
}

/** Claude's `aussehen` → a look naming only parts the library has (undefined if nothing usable). */
export function lookOf(raw: unknown): FormLook | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const id = (k: string): string | undefined => (typeof o[k] === "string" ? o[k] : undefined);
  const hex = (k: string): string | undefined => {
    const v = o[k];
    return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
  };
  const draft: FormLook = {
    ...opt("holds", id("haelt")),
    ...opt("emblem", id("emblem")),
    ...opt("badge", id("abzeichen")),
    ...opt("main", hex("farbe")),
    ...opt("second", hex("zweitfarbe")),
  };
  const look = knownLook(draft);
  return look.holds === undefined && look.emblem === undefined ? undefined : look;
}

function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
}

/**
 * A sketch only for brand-new *things* – living forms keep the detailed built-in figures, and
 * variants of known forms keep their family look. Rasterized later by the UI (needs a canvas).
 */
function sketchOf(onto: Ontology, base: Form | null, form: Form, raw: unknown): string | undefined {
  if (base !== null || typeof raw !== "string" || onto.formHas(form, "lebendig")) return undefined;
  return sanitizeSketch(raw);
}
