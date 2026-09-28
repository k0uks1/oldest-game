import { Ontology } from "../engine/ontology/ontology.ts";
import { parsePack, type ContentPack } from "../engine/ontology/pack.ts";
import dinge from "./core/forms/dinge.json" with { type: "json" };
import grundstock from "./core/forms/grundstock.json" with { type: "json" };
import konzepte from "./core/forms/konzepte.json" with { type: "json" };
import kosmos from "./core/forms/kosmos.json" with { type: "json" };
import menschen from "./core/forms/menschen.json" with { type: "json" };
import mythos from "./core/forms/mythos.json" with { type: "json" };
import natur from "./core/forms/natur.json" with { type: "json" };
import tiere from "./core/forms/tiere.json" with { type: "json" };
import alltag from "./core/forms/alltag.json" with { type: "json" };
import maerchen from "./core/forms/maerchen.json" with { type: "json" };
import fields from "./core/fields.json" with { type: "json" };
import film from "./core/forms/film.json" with { type: "json" };
import werbung from "./core/forms/werbung.json" with { type: "json" };
import alltag2 from "./core/forms/alltag2.json" with { type: "json" };
import zukunft from "./core/forms/zukunft.json" with { type: "json" };
import tierreich from "./core/forms/tierreich.json" with { type: "json" };
import goetter from "./core/forms/goetter.json" with { type: "json" };
import grundelemente from "./core/forms/grundelemente.json" with { type: "json" };
import selbstspiel1 from "./core/forms/selbstspiel1.json" with { type: "json" };
import selbstspiel2 from "./core/forms/selbstspiel2.json" with { type: "json" };
import werkzeug from "./core/forms/werkzeug.json" with { type: "json" };
import spiele from "./core/forms/spiele.json" with { type: "json" };
import basis from "./core/forms/basis.json" with { type: "json" };
import basis2 from "./core/forms/basis2.json" with { type: "json" };
import modifiers from "./core/modifiers.json" with { type: "json" };
import tags from "./core/tags.json" with { type: "json" };
import verbs from "./core/verbs.json" with { type: "json" };
import sketches from "./core/sketches.json" with { type: "json" };

/** Forms are split by theme to keep files reviewable; order = lookup priority for aliases. */
const FORM_FILES: readonly unknown[][] = [grundstock, tiere, mythos, menschen, dinge, natur, kosmos, konzepte, alltag, maerchen, film, werbung, alltag2, zukunft, tierreich, goetter, grundelemente, selbstspiel1, selbstspiel2, werkzeug, spiele, basis, basis2];

/** Hand-drawn SVG sketches for everyday things live in one file (id → svg), merged in here. */
function withSketches(forms: readonly unknown[]): unknown[] {
  const byId = sketches as Readonly<Record<string, string>>;
  return forms.map((f) => {
    if (typeof f !== "object" || f === null || !("id" in f) || typeof f.id !== "string") return f;
    const sketch = byId[f.id];
    return sketch === undefined ? f : { ...f, sketch };
  });
}

/** The built-in content pack ("Grundspiel"). */
export const CORE_PACK_RAW: unknown = {
  id: "core",
  name: "Grundspiel",
  version: "1.1.0",
  tags,
  verbs,
  modifiers,
  forms: withSketches(FORM_FILES.flat()),
  fields,
};

export function loadPack(raw: unknown): ContentPack {
  const result = parsePack(raw);
  if (!result.ok) throw new Error(`Pack ungültig:\n${result.errors.join("\n")}`);
  return result.pack;
}

let core: Ontology | undefined;

/** Compiled ontology for the core pack (memoised). */
export function coreOntology(): Ontology {
  core ??= Ontology.compile([loadPack(CORE_PACK_RAW)]);
  return core;
}
