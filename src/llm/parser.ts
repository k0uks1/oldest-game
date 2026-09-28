import { ESCAPE } from "../engine/rules.ts";
import { ITEM_IDS, knownLook, SYMBOL_IDS } from "../render/look.ts";
import { SKETCH_EXAMPLES, SKETCH_GUIDE, sanitizeSketch } from "../render/svgsprite.ts";
import type { Ontology } from "../engine/ontology/ontology.ts";
import { parseForm, suggest } from "../engine/parse.ts";
import { clampScale } from "../engine/rules.ts";
import { hash32, normalize } from "../engine/text.ts";
import { ARCHETYPES, PLANES, type Archetype, type Form, type FormLook, type Plane } from "../engine/types.ts";
import type { TagSpec, VerbSpec } from "../engine/ontology/pack.ts";
import { callClaude, type LlmSettings, type ToolDef } from "./client.ts";
import { EMPTY_DELTA, MAX_NEW_TAGS, slug, type LearningDelta } from "./learning.ts";

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
      intended_mechanism: {
        type: ["string", "null"],
        description: "Mechanismus-ID, falls der Spieler beschreibt WIE die Gestalt angreift, sonst null. \"entkommt\", wenn die Gestalt ausweichen/fliehen will statt anzugreifen.",
      },
      new_properties: {
        type: "array",
        maxItems: MAX_NEW_TAGS,
        description:
          "NUR wenn eine für diese Gestalt wesentliche Eigenschaft im Vokabular wirklich fehlt. Jede neue Eigenschaft MUSS unter bestehende Kategorien eingeordnet werden (parents) – so erbt sie deren Regeln.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Kurzer deutscher Name, z. B. „Käse“" },
            parents: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "Bestehende Eigenschaften, deren Unterart sie ist (z. B. fest, Pflanze, Tier)." },
            implies: { type: "array", items: { type: "string" }, maxItems: 4, description: "Bestehende Eigenschaften, die sie mit sich bringt (z. B. brennbar)." },
          },
          required: ["name", "parents"],
        },
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
      new_mechanism: {
        type: ["object", "null"],
        description: "NUR wenn keiner der Mechanismen auch nur annähernd passt. Wird vorsichtig mit kleinem Hebel übernommen.",
        properties: {
          label: { type: "string", description: "Verb im Präsens, z. B. „verschleimt“" },
          family: { type: "string", enum: [...FAMILIES] },
          targets: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4, description: "Bestehende Eigenschaften, auf die er wirkt." },
          blocked_by: { type: "array", items: { type: "string" }, maxItems: 4 },
          hint: { type: "string", description: "Ein Satz, wie er wirkt." },
        },
        required: ["label", "family", "targets", "hint"],
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
    .map((v) => `- ${v.spec.id}: ${v.spec.label} – ${v.spec.hint}`)
    .join("\n");
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

DAZULERNEN: Das Spiel lernt aus deinen Einordnungen. Wenn eine wesentliche Eigenschaft fehlt, schlage sie mit new_properties vor
(immer unter bestehende Eigenschaften eingeordnet). Einen neuen Mechanismus schlägst du nur vor, wenn wirklich keiner passt.
Erfinde nichts, was es schon gibt – nutze vorhandene Begriffe, wo immer sie passen.

REGELN FÜR DICH:
- Jede Gestalt braucht Angriffsfläche und mindestens eine plausible Schwäche.
- 1–3 Mechanismen, die zur Gestalt passen. Elemente bringen ihre Mechanismen selbst mit (Feuer verbrennt …).
- intended_mechanism nur setzen, wenn der Spieler ausdrücklich beschreibt, WIE angegriffen wird.
  Beschreibt er Flucht oder Ausweichen („fliegt davon“, „taucht ab“, „gräbt sich ein“), setze "entkommt".
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
  const verbs = onto.compileForm(f).verbs.join(", ");
  const tags = f.tags.map((t) => onto.tagLabel(t)).join(", ");
  return `- ${f.id}: ${f.name} · Stufe ${String(f.scale)} · ${f.plane} · Eigenschaften: ${tags} · Mechanismen: ${verbs}`;
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

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Turn the model's raw tool input into a validated Form (pure – unit-testable). */
export function formFromLlm(onto: Ontology, input: unknown, text: string): LlmParseResult | undefined {
  if (typeof input !== "object" || input === null) return undefined;
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
  if (tags.size === 0) return undefined;

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
  const form: Form = { ...draft, weak };
  if (onto.compileForm(form).verbs.length === 0 && delta.verbs.length === 0) return undefined;
  const iv = typeof o["intended_mechanism"] === "string" ? (resolveVerb(o["intended_mechanism"]) ?? null) : null;
  const look = lookOf(o["aussehen"]) ?? base?.look;
  const looked: Form = look === undefined ? form : { ...form, look };
  // an emblem is the better picture – a freehand sketch only where no part fits
  const sketch = look?.emblem === undefined ? sketchOf(onto, base, looked, o["skizze"]) : undefined;
  return { form: looked, intendedVerb: iv, base, unresolved, fromCache: false, delta, ...(sketch === undefined ? {} : { sketch }) };
}

/** Turn Claude's vocabulary proposals into specs – only what resolves against existing tags survives. */
function proposeDelta(onto: Ontology, o: Record<string, unknown>, unresolved: string[]): LearningDelta {
  const tags: TagSpec[] = [];
  const rawTags = Array.isArray(o["new_properties"]) ? (o["new_properties"] as unknown[]) : [];
  for (const raw of rawTags.slice(0, MAX_NEW_TAGS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;
    const name = typeof p["name"] === "string" ? p["name"].trim() : "";
    if (name.length < 2 || name.length > 40) continue;
    if (onto.resolveTag(name) !== undefined) continue; // already known – not new
    const parents = strings(p["parents"]).map((k) => (onto.hasTag(k) ? k : onto.resolveTag(k))).filter((x): x is string => x !== undefined);
    if (parents.length === 0) continue; // must hang under the existing taxonomy
    const implies = strings(p["implies"]).map((k) => (onto.hasTag(k) ? k : onto.resolveTag(k))).filter((x): x is string => x !== undefined);
    const first = onto.tagAt(onto.tagIndexOf(parents[0] ?? "") ?? -1);
    const id = `g_${slug(name)}`;
    if (onto.hasTag(id) || tags.some((t) => t.id === id)) continue;
    tags.push({
      id,
      label: name,
      group: first?.group ?? "existenz",
      parents: [...new Set(parents)].slice(0, 3),
      ...(implies.length > 0 ? { implies: [...new Set(implies)].slice(0, 4) } : {}),
      aliases: [name],
    });
    const i = unresolved.findIndex((u) => normalize(u) === normalize(name));
    if (i >= 0) unresolved.splice(i, 1);
  }
  const verbs: VerbSpec[] = [];
  const m = o["new_mechanism"];
  if (typeof m === "object" && m !== null) {
    const v = m as Record<string, unknown>;
    const label = typeof v["label"] === "string" ? v["label"].trim() : "";
    const family = FAMILIES.find((f) => f === v["family"]) ?? "gewalt";
    const resolve = (k: string): string | undefined => (onto.hasTag(k) ? k : (onto.resolveTag(k) ?? tags.find((t) => normalize(t.label) === normalize(k))?.id));
    const targets = strings(v["targets"]).map(resolve).filter((x): x is string => x !== undefined);
    const blockedBy = strings(v["blocked_by"]).map(resolve).filter((x): x is string => x !== undefined && !targets.includes(x));
    const id = `g_${slug(label)}`;
    if (label.length >= 3 && label.length <= 40 && targets.length > 0 && onto.resolveVerb(label) === undefined && !onto.verbs.has(id)) {
      verbs.push({
        id,
        label,
        family,
        // Learned mechanisms stay weak: brute force needs size, everything else a small lever.
        leverage: family === "gewalt" ? 1 : 2,
        targets: [...new Set(targets)],
        ...(blockedBy.length > 0 ? { blockedBy: [...new Set(blockedBy)] } : {}),
        hint: `(gelernt) ${typeof v["hint"] === "string" ? v["hint"].slice(0, 160) : label}`,
      });
    }
  }
  return tags.length === 0 && verbs.length === 0 ? EMPTY_DELTA : { tags, verbs };
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
  const result = await callClaude(settings, { system: systemPrompt(onto), user, maxTokens: 1000, tool: TOOL });
  const parsed = formFromLlm(onto, result.toolInput, text);
  if (parsed !== undefined) cacheSet(key, parsed);
  return parsed;
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
