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
import modifiers from "./core/modifiers.json" with { type: "json" };
import tags from "./core/tags.json" with { type: "json" };
import verbs from "./core/verbs.json" with { type: "json" };

/** Forms are split by theme to keep files reviewable; order = lookup priority for aliases. */
const FORM_FILES: readonly unknown[][] = [grundstock, tiere, mythos, menschen, dinge, natur, kosmos, konzepte, alltag, maerchen, film, werbung, alltag2];

/** The built-in content pack ("Grundspiel"). */
export const CORE_PACK_RAW: unknown = {
  id: "core",
  name: "Grundspiel",
  version: "1.1.0",
  tags,
  verbs,
  modifiers,
  forms: FORM_FILES.flat(),
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
