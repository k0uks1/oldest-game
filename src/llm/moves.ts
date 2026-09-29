/**
 * "Beleben": three things a form typically does, for the animator. Invented forms get them from
 * their classification; hand-written ones ask here once (the server keeps the answer).
 */
import type { Ontology } from "../engine/ontology/ontology.ts";
import { MAX_MOVES } from "../engine/ontology/pack.ts";
import type { AnimMove, Form } from "../engine/types.ts";
import { callClaude, type LlmSettings, type ToolDef } from "./client.ts";
import { movesOf } from "./parser.ts";

const TOOL: ToolDef = {
  name: "bewegungen",
  description: "Drei kurze Animationen, die zu dieser Gestalt passen.",
  input_schema: {
    type: "object",
    properties: {
      bewegungen: {
        type: "array",
        maxItems: MAX_MOVES,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Deutsch, 2–4 Wörter („heult den Mond an“)." },
            action: { type: "string", description: "Englisch, nur die Bewegung am Platz, 5–12 Wörter („howling up at the moon, head raised“)." },
          },
          required: ["label", "action"],
        },
      },
    },
    required: ["bewegungen"],
  },
};

const SYSTEM = `Eine Gestalt aus dem „ältesten Spiel“ soll als Pixel-Art zum Leben erwachen: Ein Animator bewegt ihr Bild
ein paar Sekunden lang am Platz. Schlage genau drei Bewegungen vor, die gerade DIESE Gestalt ausmachen – ihr typisches Tun,
ihre Pointe, ihre Macht (Wolf: heult den Mond an · schleicht geduckt · fletscht die Zähne; Kettensäge: heult auf ·
sägt in die Luft · tuckert im Leerlauf; Hoffnung: flackert auf · leuchtet warm · treibt sanft nach oben).
label: deutsch, 2–4 Wörter. action: englisch, nur Bewegung am Platz, keine Szenenwechsel, keine neuen Figuren.
Keine Allerwelts-Bewegungen wie „atmet“, wenn es Besseres gibt. Antworte nur mit dem Werkzeug.`;

export async function movesWithClaude(onto: Ontology, settings: LlmSettings, form: Form): Promise<AnimMove[] | undefined> {
  const tags = form.tags.map((t) => onto.tagLabel(t)).join(", ");
  const verbs = onto
    .compileForm(form)
    .verbs.slice(0, 4)
    .map((v) => onto.verbs.get(v)?.spec.label ?? v)
    .join(", ");
  const user = [`Gestalt: ${form.name}`, `Eigenschaften: ${tags}`, verbs === "" ? "" : `Kann: ${verbs}`, form.artPrompt === undefined ? "" : `Bild: ${form.artPrompt}`]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const r = await callClaude(settings, { system: SYSTEM, user, maxTokens: 260, temperature: 0.6, tool: TOOL });
    const o = r.toolInput;
    return typeof o === "object" && o !== null ? movesOf((o as Record<string, unknown>)["bewegungen"]) : undefined;
  } catch {
    return undefined;
  }
}
